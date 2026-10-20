"""音频分析：从音频文件提取可视化所需的全部数据。

输入：音频文件 + Snapshot（提供 PPQ / Tempo / 鼓组信息）
输出：一个字典，含波形、频谱、矢量图、特征、鼓组步进等

所有分析参数集中在文件顶部，便于调整。

## 缓存

`构建()` 支持可选的磁盘缓存（`用缓存=True` 且给出 `缓存目录`）。
缓存键包含：分析版本 + 音频大小/修改时间 + 快照修改时间 + 全部参数。
任一变化即失效 —— 避免「改了参数但拿到旧结果」这类静默错误。

历史上这里与 preview/audio_analysis.py 各有一份完整实现，
两边函数名相同但内容不同步，导致过「改了代码但界面没变」的排查困难。
现已合并：算法只在本文件，preview 侧只做薄封装。
"""
import base64
import json
import pathlib

import numpy as np

仓库根 = pathlib.Path(__file__).resolve().parents[1]


# 分析逻辑版本：任何影响输出数值的算法改动都必须递增此值，
# 否则旧缓存会被误用（曾发生：修正相关度算法后缓存仍返回旧值）。
分析版本 = 7

# --- 分析参数（集中于此，便于调整）---
# 波形与频谱都提高分辨率，以支持「2 小节滚动窗口」组件
# （旧的 2400 点全曲包络在 2 小节窗内只有约 17 个点，会呈阶梯状）
波形点数 = 21300        # 约 80 点/秒
频谱帧率 = 12.0         # 频谱图每秒帧数（2 小节窗内约 50 帧）
频谱频带 = 96           # 对数频带数
频谱窗口 = 4096
频谱低频 = 30.0
频谱高频 = 16000.0
频谱动态范围 = 72.0     # dB

# 实时 Vectorscope 用的降采样立体声
# 存降采样音频而非预先算好的密度帧，渲染端即可逐帧实时计算，
# 从而得到连贯动画（旧版只存 8 张静帧，播放时是跳帧的）。
矢声采样率 = 2205       # 降采样目标采样率 Hz（44100/20）
矢声窗秒 = 0.85         # 每帧统计窗长
# 窗长权衡：过短则窗内样本太少（0.18s 仅 396 个样本），
# 散布到 96x96 网格后图像稀疏、且相邻帧高度重叠显得粘滞；
# 0.85s 约 1870 个样本，密度分布饱满且仍能反映声场变化。

# 音频特征参数（响度 / 明亮度 / 瞬态 / 宽度）
特征帧率 = 12.0         # 特征每秒帧数
特征窗口 = 2048         # 特征 FFT 窗口


def 读取快照(路径=None):
    """读取 Snapshot 文件。

    无参时回退到示例工程的快照（便于脚本直接调用）。
    显式传路径时行为与以前一致。
    """
    if 路径 is None:
        路径 = 仓库根 / "data" / "projects" / "nujabes" / "project_snapshot.json"
    return json.loads(pathlib.Path(路径).read_text(encoding="utf-8"))


def _读音频(路径):
    import soundfile as sf

    数据, 采样率 = sf.read(str(路径), dtype="float32", always_2d=True)
    return 数据, 采样率


def _波形(单声道, 点数=波形点数):
    """峰值与 RMS 双包络：峰值画外廓，RMS 画能量主体，是专业波形窗的标准做法。"""
    分桶 = np.array_split(单声道, 点数)
    峰值 = np.array([float(np.abs(b).max()) if len(b) else 0.0 for b in 分桶], dtype=np.float32)
    RMS = np.array([float(np.sqrt((b ** 2).mean())) if len(b) else 0.0 for b in 分桶], dtype=np.float32)
    return 峰值, RMS


def _频谱图(单声道, 采样率):
    """向量化 STFT → 对数频带 → 自动标定 → uint8。"""
    hop = max(1, int(采样率 / 频谱帧率))
    窗 = np.hanning(频谱窗口).astype(np.float32)

    填充 = np.pad(单声道, (频谱窗口 // 2, 频谱窗口 // 2 + hop), mode="constant")
    帧 = np.lib.stride_tricks.sliding_window_view(填充, 频谱窗口)[::hop]
    帧数 = len(帧)

    # 一次算完所有帧的幅度谱
    幅度 = np.abs(np.fft.rfft(帧 * 窗, axis=1)).astype(np.float32)
    幅度 = np.maximum(幅度, 1e-9)
    频率 = np.fft.rfftfreq(频谱窗口, 1.0 / 采样率)

    # 对数频带边界
    边界 = np.geomspace(频谱低频, 频谱高频, 频谱频带 + 1)
    索引 = [np.where((频率 >= 边界[i]) & (频率 < 边界[i + 1]))[0] for i in range(频谱频带)]

    db = np.full((帧数, 频谱频带), -120.0, dtype=np.float32)
    for b, ix in enumerate(索引):
        if len(ix):
            db[:, b] = 20.0 * np.log10(幅度[:, ix].mean(axis=1) + 1e-9)

    # 自动标定：峰值锚定 + 固定动态范围（避免固定常数导致贴顶或全黑）
    有效 = db[db > -119.0]
    if 有效.size == 0:
        有效 = db.ravel()
    天花板 = float(np.percentile(有效, 99.9))
    地板 = 天花板 - 频谱动态范围
    归一 = np.clip((db - 地板) / 频谱动态范围, 0.0, 1.0)
    量化 = (归一 * 255).astype(np.uint8)

    return 量化, {
        "floor_db": round(地板, 2),
        "ceil_db": round(天花板, 2),
        "range_db": 频谱动态范围,
        "method": "峰值锚定(P99.9) + 固定动态范围",
    }


def _降采样立体声(立体声, 采样率):
    """把立体声降采样后交给渲染端，用于**实时**计算 Vectorscope。

    旧做法是预先把整曲压成 8 张密度帧，播放时只是轮播静帧，
    看起来是跳帧的。改为存降采样音频后，渲染端可按当前时刻
    逐帧计算密度，动画才是连贯的。

    降采样用整数倍抽取 + 抗混叠（先低通再抽取），
    因为 Vectorscope 只关心 L/R 的幅度关系，2.2kHz 足够。
    """
    倍率 = max(1, int(round(采样率 / 矢声采样率)))
    实际率 = 采样率 / 倍率

    # 简单抗混叠：滑动平均后再抽取
    核 = np.ones(倍率, dtype=np.float32) / 倍率
    左 = np.convolve(立体声[:, 0], 核, mode="same")[::倍率]
    右 = (np.convolve(立体声[:, 1], 核, mode="same")[::倍率]
          if 立体声.shape[1] > 1 else 左)

    # int16 量化：体积减半，且对密度图无可见影响
    左i = np.clip(左 * 32767.0, -32768, 32767).astype(np.int16)
    右i = np.clip(右 * 32767.0, -32768, 32767).astype(np.int16)

    return {
        "rate": round(实际率, 3),
        "count": int(len(左i)),
        "windowSec": 矢声窗秒,
        "left": base64.b64encode(左i.tobytes()).decode("ascii"),
        "right": base64.b64encode(右i.tobytes()).decode("ascii"),
    }


def _节奏事件(快照, 桶数=256):
    """把 Pattern Clip 内的 note onset 展开到绝对时间并分桶。

    反映工程自身的节奏结构，而非通用能量检测。
    """
    ppq = 快照["metadata"]["ppq"]
    模式表 = {p["id"]: p for p in 快照["patterns"]}
    最大tick = 0
    位置表 = []
    for 轨道 in 快照["arrangement"]["tracks"]:
        for clip in 轨道["clips"]:
            if clip["type"] != "pattern":
                continue
            起 = clip["start"]["value"]
            止 = clip["end"]["value"]
            最大tick = max(最大tick, 止)
            模式 = 模式表.get(clip["source"]["id"])
            if not 模式:
                continue
            for note in 模式["notes"]:
                相对 = note["start"]["value"]
                if 相对 is None:
                    continue
                绝对 = 起 + 相对
                if 起 <= 绝对 < 止:
                    位置表.append(绝对)

    密度 = np.zeros(桶数, dtype=int)
    if 最大tick > 0 and 位置表:
        for 位置 in 位置表:
            密度[min(桶数 - 1, int(位置 / 最大tick * 桶数))] += 1

    return {
        "buckets": 密度.tolist(),
        "maxTick": 最大tick,
        "total": len(位置表),
        "ppq": ppq,
    }


def _时间轴(快照):
    轨道列表 = []
    for 轨道 in 快照["arrangement"]["tracks"]:
        if not 轨道["clips"]:
            continue
        片段 = []
        for clip in 轨道["clips"]:
            片段.append({
                "id": clip["id"],
                "type": clip["type"],
                "start": clip["start"]["value"],
                "end": clip["end"]["value"],
                "name": clip["source"]["name"],
                "sourceId": clip["source"]["id"],
            })
        轨道列表.append({
            "index": 轨道["index"],
            "clips": 片段,
        })
    最大 = max((c["end"] for t in 轨道列表 for c in t["clips"]), default=1)
    return {
        "ppq": 快照["metadata"]["ppq"],
        "tempo": 快照["metadata"]["tempo"]["value"],
        "tracks": 轨道列表,
        "maxTick": 最大,
        "markers": 快照["arrangement"]["markers"],
        "meta": {
            "schemaVersion": 快照["schema_version"],
            "flVersion": 快照["metadata"]["fl_version"],
            "clipCount": sum(len(t["clips"]) for t in 轨道列表),
            "patternCount": len(快照["patterns"]),
            "audioSourceCount": len(快照["audio_sources"]),
            "trackCount": len(轨道列表),
        },
    }


def _模式音符(快照):
    """每个 Pattern 的 note 起点列表，供时间轴 Clip 内绘制节奏刻度。"""
    return {p["id"]: [n["start"]["value"] for n in p["notes"] if n["start"]["value"] is not None]
            for p in 快照["patterns"]}


# --- 音名 → MIDI 音高 ---
_音名 = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_音名索引 = {}
for _i, _n in enumerate(_音名):
    _音名索引[_n] = _i
    _音名索引[_n.replace("#", "b") if "#" in _n else _n] = _i
# 补充降号拼写
for _n, _i in [("Db", 1), ("Eb", 3), ("Gb", 6), ("Ab", 8), ("Bb", 10)]:
    _音名索引[_n] = _i


def _midi(音名):
    """'D#5' → 75；无法解析返回 None。"""
    if not isinstance(音名, str) or len(音名) < 2:
        return None
    字母 = 音名[0].upper()
    if 字母 not in "ABCDEFG":
        return None
    八度位 = 1 if len(音名) > 1 and 音名[1] in "#b" else 0
    八度 = 音名[1 + 八度位:]
    if not 八度.lstrip("-").isdigit():
        return None
    键 = 音名[:1 + 八度位]
    if 键 not in _音名索引:
        return None
    return (int(八度) + 1) * 12 + _音名索引[键]


def _模式形状(快照, 通道表=None):
    """按 Pattern 提取**视觉形状**数据。

    关键设计判断（均为实测依据）：
    1. 鼓组 Pattern 多为单音高，纵向用音高映射必然退化成直线；
       鼓组真正的信息在**力度**（实测 70 个不同值，27..119）。
    2. 一个 Pattern 常含**多个乐器**：Pattern 2「drums - Vinl-Kick 3」
       实际含 ch2 Vinl-Kick 3（17 音符）+ ch3 Kick 3 #2（17 音符），
       两者完全同时起音——是叠层底鼓。
       因此按**通道分层**才能呈现鼓组真实结构，而不是糊成一根长条。
    3. 本工程存在 6 音和弦（Pattern 1），音高映射必须**全局统一**，
       否则同一音高在不同 Pattern 会出现在不同高度，造成误导。
    """
    通道表 = 通道表 or {}
    结果 = {}
    for p in 快照["patterns"]:
        音符 = []
        for n in p["notes"]:
            起 = n["start"]["value"]
            if 起 is None:
                continue
            通道 = n["channel_id"]["value"] if n["channel_id"] else None
            音符.append({
                "t": 起,
                "len": (n["duration"]["value"] or 0),
                "midi": _midi(n["pitch"]["value"]) if n["pitch"] else None,
                "vel": (n["velocity"]["value"] if n["velocity"] else None),
                "ch": 通道,
            })
        if not 音符:
            结果[p["id"]] = {"notes": [], "kind": "empty", "range": [0, 0],
                             "velRange": [0, 0], "length": 0, "channels": []}
            continue
        音高表 = [x["midi"] for x in 音符 if x["midi"] is not None]
        力度表 = [x["vel"] for x in 音符 if x["vel"] is not None]
        唯一音高 = len(set(音高表))
        # 判定类型：唯一音高 <= 2 视为打击乐（实测鼓组均为 1..2）
        类型 = "percussive" if 唯一音高 <= 2 else "melodic"

        # 通道分层：按音符数降序，附带可读名称
        分组 = {}
        for x in 音符:
            分组.setdefault(x["ch"], []).append(x)
        通道列表 = []
        for cid, 音符集 in sorted(分组.items(), key=lambda kv: -len(kv[1])):
            信息 = 通道表.get(cid) or {}
            名称 = 信息.get("名称") or 信息.get("内部名称") or ""
            if not 名称 and 信息.get("sample_path"):
                名称 = str(信息["sample_path"]).replace("/", "\\").split("\\")[-1]
            通道列表.append({
                "id": cid,
                "name": 名称[:40],
                "count": len(音符集),
            })

        结果[p["id"]] = {
            "notes": 音符,
            "kind": 类型,
            "uniquePitches": 唯一音高,
            "range": [min(音高表), max(音高表)] if 音高表 else [0, 0],
            "velRange": [min(力度表), max(力度表)] if 力度表 else [0, 0],
            "length": max((x["t"] + x["len"] for x in 音符), default=0),
            "channels": 通道列表,
        }
    return 结果


def _音级分布(形状):
    """12 音级直方图，仅统计旋律性 Pattern（鼓组单音高会淹没真实调性）。"""
    直方 = [0] * 12
    for v in 形状.values():
        if v["kind"] != "melodic":
            continue
        for n in v["notes"]:
            if n["midi"] is not None:
                直方[n["midi"] % 12] += 1
    return 直方


def _全局音高范围(形状):
    """全部 Pattern 的音高范围，用于**统一映射**。

    若每个 Pattern 各自拉伸到满高，同一音高在不同 Pattern 会出现在
    不同高度——那才是真正的误导。所以渲染端必须用这个全局范围。
    """
    全部 = [n["midi"] for v in 形状.values() for n in v["notes"] if n["midi"] is not None]
    if not 全部:
        return [0, 0]
    return [min(全部), max(全部)]


def _pattern使用(快照):
    """Pattern 在时间轴上的使用分段，供 Pattern 矩阵使用。

    返回 {patternId: [{start, end, track}, ...]}，单位 PPQ tick。
    """
    使用 = {}
    for 轨道 in 快照["arrangement"]["tracks"]:
        for clip in 轨道["clips"]:
            if clip["type"] != "pattern":
                continue
            pid = clip["source"]["id"]
            使用.setdefault(pid, []).append({
                "start": clip["start"]["value"],
                "end": clip["end"]["value"],
                "track": 轨道["index"],
            })
    return 使用


def _音频特征(立体声, 采样率):
    """按固定帧率提取时间序列特征，供响度表 / 明亮度 / 瞬态 / 立体声宽度组件使用。

    全部为实测计算，不做推测：
      rms      — 短时能量（dBFS），响度的直接来源
      centroid — 谱质心（Hz），听感"明亮度"
      flux     — 谱通量（正半波），瞬态/起音检测的标准做法
      width    — 立体声宽度，侧向能量占比
    """
    hop = max(1, int(采样率 / 特征帧率))
    左 = 立体声[:, 0]
    右 = 立体声[:, 1] if 立体声.shape[1] > 1 else 立体声[:, 0]
    单声道 = (左 + 右) * 0.5
    侧 = (左 - 右) * 0.5

    窗 = np.hanning(特征窗口).astype(np.float32)
    填充 = np.pad(单声道, (特征窗口 // 2, 特征窗口 // 2 + hop), mode="constant")
    帧 = np.lib.stride_tricks.sliding_window_view(填充, 特征窗口)[::hop]
    帧数 = len(帧)

    幅度 = np.abs(np.fft.rfft(帧 * 窗, axis=1)).astype(np.float32)
    频率 = np.fft.rfftfreq(特征窗口, 1.0 / 采样率)

    rms = np.sqrt((帧 ** 2).mean(axis=1) + 1e-12)
    rms_db = 20.0 * np.log10(rms + 1e-9)

    能量和 = 幅度.sum(axis=1) + 1e-9
    质心 = (幅度 * 频率).sum(axis=1) / 能量和

    通量 = np.zeros(帧数, dtype=np.float32)
    if 帧数 > 1:
        差 = np.diff(幅度, axis=0)
        通量[1:] = np.maximum(差, 0).sum(axis=1) / 能量和[1:]

    侧填充 = np.pad(侧, (特征窗口 // 2, 特征窗口 // 2 + hop), mode="constant")
    侧帧 = np.lib.stride_tricks.sliding_window_view(侧填充, 特征窗口)[::hop]
    侧能量 = (侧帧 ** 2).mean(axis=1)
    总能量 = (帧 ** 2).mean(axis=1) + 1e-12
    宽度 = np.clip(侧能量 / 总能量, 0.0, 1.0)

    def 归一小(v):
        lo, hi = float(np.percentile(v, 2)), float(np.percentile(v, 98))
        if hi - lo < 1e-9:
            return np.zeros_like(v), lo, hi
        return np.clip((v - lo) / (hi - lo), 0.0, 1.0), lo, hi

    质心小, 质心低, 质心高 = 归一小(质心)
    通量小, 通量低, 通量高 = 归一小(通量)
    rms小, rms低, rms高 = 归一小(rms_db)

    return {
        "fps": 特征帧率,
        "frames": 帧数,
        "rmsDb": [round(float(v), 2) for v in rms_db],
        "rmsNorm": [round(float(v), 4) for v in rms小],
        "centroidHz": [round(float(v), 1) for v in 质心],
        "centroidNorm": [round(float(v), 4) for v in 质心小],
        "flux": [round(float(v), 4) for v in 通量],
        "fluxNorm": [round(float(v), 4) for v in 通量小],
        "width": [round(float(v), 4) for v in 宽度],
        "calibration": {
            "rmsDb": [round(rms低, 2), round(rms高, 2)],
            "centroidHz": [round(质心低, 1), round(质心高, 1)],
            "flux": [round(通量低, 4), round(通量高, 4)],
        },
    }


def _轨道活动(快照, 桶数=240):
    """轨道 × 时间的活动密度，供活动条 / 密度热力图组件使用。"""
    最大 = 0
    for 轨道 in 快照["arrangement"]["tracks"]:
        for clip in 轨道["clips"]:
            最大 = max(最大, clip["end"]["value"])
    if 最大 <= 0:
        return {"buckets": 桶数, "maxTick": 0, "rows": []}

    行 = []
    for 轨道 in 快照["arrangement"]["tracks"]:
        if not 轨道["clips"]:
            continue
        密度 = [0] * 桶数
        for clip in 轨道["clips"]:
            起 = min(桶数 - 1, int(clip["start"]["value"] / 最大 * 桶数))
            止 = min(桶数 - 1, int(clip["end"]["value"] / 最大 * 桶数))
            for b in range(起, 止 + 1):
                密度[b] += 1
        行.append({"index": 轨道["index"], "density": 密度})
    return {"buckets": 桶数, "maxTick": 最大, "ppq": 快照["metadata"]["ppq"], "rows": 行}


def _模式使用矩阵(快照, 分段数=26):
    """Pattern × 时间分段的占用矩阵，供 Pattern 矩阵组件使用。"""
    最大 = 0
    for 轨道 in 快照["arrangement"]["tracks"]:
        for clip in 轨道["clips"]:
            最大 = max(最大, clip["end"]["value"])
    if 最大 <= 0:
        return {"segments": 分段数, "maxTick": 0, "patterns": []}

    分段tick = 最大 / 分段数
    占用 = {}
    for 轨道 in 快照["arrangement"]["tracks"]:
        for clip in 轨道["clips"]:
            if clip["type"] != "pattern":
                continue
            pid = clip["source"]["id"]
            格 = 占用.setdefault(pid, [0] * 分段数)
            起 = min(分段数 - 1, int(clip["start"]["value"] / 分段tick))
            止 = min(分段数 - 1, int(clip["end"]["value"] / 分段tick))
            for b in range(起, 止 + 1):
                格[b] += 1

    列表 = []
    for p in 快照["patterns"]:
        if p["id"] not in 占用:
            continue
        列表.append({
            "id": p["id"],
            "name": (p["name"]["value"] if p["name"] else None),
            "notes": len(p["notes"]),
            "cells": 占用[p["id"]],
        })
    列表.sort(key=lambda x: (-sum(x["cells"]), x["id"]))
    return {"segments": 分段数, "maxTick": 最大,
            "ppq": 快照["metadata"]["ppq"], "patterns": 列表}


def _段落检测(特征):
    """基于响度与谱通量自动分段（intro / 主体 / 过渡）。

    诚实说明：这是**启发式检测**，不是工程里真实存在的标记
    （本工程 markers 为空）。渲染端必须标注为"检测"而非"工程标记"。
    """
    rms = np.array(特征["rmsNorm"], dtype=np.float32)
    flux = np.array(特征["fluxNorm"], dtype=np.float32)
    n = len(rms)
    if n < 16:
        return []
    # 平滑
    k = max(3, n // 120)
    核 = np.ones(k, dtype=np.float32) / k
    平滑 = np.convolve(rms, 核, mode="same")
    # 以中位数为界，切出连续的高/低能量段
    阈值 = float(np.median(平滑))
    状态 = 平滑 >= 阈值
    段 = []
    起 = 0
    for i in range(1, n):
        if 状态[i] != 状态[i - 1]:
            段.append((起, i, bool(状态[i - 1])))
            起 = i
    段.append((起, n, bool(状态[n - 1])))
    # 过滤过短的段
    最短 = max(2, n // 40)
    段 = [s for s in 段 if s[1] - s[0] >= 最短]
    结果 = []
    for a, b, 高 in 段:
        强度 = float(平滑[a:b].mean())
        结果.append({
            "startFrame": a, "endFrame": b,
            "startSec": round(a / 特征["fps"], 3),
            "endSec": round(b / 特征["fps"], 3),
            "high": 高,
            "intensity": round(强度, 4),
        })
    return 结果


def _鼓组分类(名称):
    """从通道名推断鼓组类别。返回 (类别, 置信度0..1)。

    两级策略：
      1) 关键词匹配 —— 通道名通常是采样文件名，含 kick/snare/hat 等词
      2) 无法匹配时返回 ("other", 0)，由调用方按顺序兜底
    """
    if not 名称:
        return "other", 0.0
    n = 名称.lower()
    # 顺序有意义：先匹配更具体的（open hat 必须在 hat 之前）
    规则 = [
        ("openhat", ["open hat", "openhat", "opened hi", "openhh", "oh_", "_oh",
                     "open hi", "hihat open", "hh open"]),
        ("hihat",   ["hi hat", "hihat", "hi-hat", "hh ", "closed hat", "hat ",
                     "hats", "hh_", "_hh", "pedal hq", "shaker"]),
        ("snare",   ["snare", "rim", "clap", "snr", "sd_", "_sd"]),
        ("kick",    ["kick", "bd_", "_bd", "bass drum", "808"]),
        ("crash",   ["crash", "cymbal", "ride", "splash"]),
        ("tom",     ["tom", "perc", "conga", "bongo", "cowbell", "wood"]),
        ("fx",      ["fx", "riser", "uplift", "sweep", "noise", "vinyl",
                     "scratch", "vocal", "reverb"]),
    ]
    for 类别, 词表 in 规则:
        for w in 词表:
            if w in n:
                return 类别, 0.9
    return "other", 0.0


def _鼓组步进器(快照, 通道表, 每小节步数=16):
    """提取鼓组 Pattern 并整理成 F6 风格的步进器数据。

    判定为鼓组的条件（全部基于实测字段，不做主观推测）：
      · Pattern 的唯一音高 ≤ 2   —— 实测鼓组均为 1~2
      · 或所有音符的通道都被 _鼓组分类 识别为打击乐类别
    每条通道成为一行，行内按 16 分音符量化成格。
    """
    PPQ = 快照["metadata"]["ppq"]
    格长 = PPQ / 4                      # 16 分音符
    结果 = []
    for p in 快照["patterns"]:
        音符 = []
        for n in p["notes"]:
            起 = n["start"]["value"]
            if 起 is None:
                continue
            通道 = n["channel_id"]["value"] if n["channel_id"] else None
            音符.append({
                "t": 起,
                "vel": (n["velocity"]["value"] if n["velocity"] else None),
                "ch": 通道,
            })
        if not 音符:
            continue

        音高 = [_midi(n["pitch"]["value"]) for n in p["notes"] if n["pitch"]]
        音高 = [m for m in 音高 if m is not None]
        唯一 = len(set(音高))

        # 按通道分组并分类
        分组 = {}
        for x in 音符:
            分组.setdefault(x["ch"], []).append(x)
        通道信息 = []
        打击通道数 = 0
        for cid, 列表 in sorted(分组.items(), key=lambda kv: -len(kv[1])):
            信息 = 通道表.get(cid) or {}
            名称 = (信息.get("名称") or 信息.get("内部名称") or "")
            if not 名称 and 信息.get("sample_path"):
                名称 = str(信息["sample_path"]).replace("/", "\\").split("\\")[-1]
            类别, 置信 = _鼓组分类(名称)
            if 类别 != "other":
                打击通道数 += 1
            通道信息.append({
                "id": cid, "name": 名称[:40], "count": len(列表),
                "group": 类别, "confidence": 置信,
            })

        是鼓组 = (唯一 <= 2) or (打击通道数 == len(通道信息) and 打击通道数 > 0)
        if not 是鼓组:
            continue

        # 量化成格：以 Pattern 内最早音符为原点，按 16 分音符切
        起点 = min(x["t"] for x in 音符)
        行 = []
        for ch in 通道信息:
            列表 = 分组[ch["id"]]
            格 = {}
            for x in 列表:
                k = int(round((x["t"] - 起点) / 格长))
                v = x["vel"] if x["vel"] is not None else 100
                if k not in 格 or v > 格[k]:
                    格[k] = v
            行.append({
                "channel": ch["id"],
                "name": ch["name"],
                "group": ch["group"],
                "confidence": ch["confidence"],
                "steps": {str(k): v for k, v in sorted(格.items())},
                "count": len(列表),
            })

        总长 = max(x["t"] for x in 音符) + 格长
        结果.append({
            "id": p["id"],
            "name": (p["name"]["value"] if p["name"] else None),
            "notes": len(音符),
            # 量化原点：steps 的 0 格对应的 Pattern 内 tick。
            # 渲染端计算绝对时间须用 clip.start + origin + step*格长。
            "origin": int(起点),
            "stepCount": int(np.ceil((总长 - 起点) / 格长)),
            "rows": 行,
            "uniquePitches": 唯一,
        })

    结果.sort(key=lambda x: x["id"])
    return 结果


def _鼓组使用(快照, 鼓组):
    """鼓组在时间轴上的出现区间，供步进器组件跟随指针切换。

    收录两类：
      · pattern 鼓组 —— 按 pattern id 建键
      · 名字带 #step 的**音频 clip** —— 统一归到键 "audio"
        （音频采样没有 pattern，必须单独收录，否则前端永远选不中，
          表现为「步进器全空」）
    """
    已知 = {g["id"] for g in 鼓组}
    出现 = {}
    for 轨道 in 快照["arrangement"]["tracks"]:
        for clip in 轨道["clips"]:
            if clip["type"] == "pattern":
                pid = clip["source"]["id"]
                if pid not in 已知:
                    continue
                出现.setdefault(pid, []).append({
                    "start": clip["start"]["value"],
                    "end": clip["end"]["value"],
                    "track": 轨道["index"],
                })
            elif clip["type"] == "audio":
                名 = str((clip.get("source") or {}).get("name") or "")
                if "#step" not in 名:
                    continue
                出现.setdefault("audio", []).append({
                    "start": clip["start"]["value"],
                    "end": clip["end"]["value"],
                    "track": 轨道["index"],
                })
    for k in 出现:
        出现[k].sort(key=lambda x: x["start"])
    return 出现


def 工程范围(快照):
    """Playlist 里所有 clip 的最远结束点（tick）。"""
    最远 = 0
    for 轨道 in 快照.get("arrangement", {}).get("tracks", []):
        for clip in 轨道.get("clips") or []:
            end = (clip.get("end") or {}).get("value")
            if end is not None and end > 最远:
                最远 = end
    return 最远


def _缓存签名(音频路径, 快照路径):
    """缓存键：任一输入或参数变化都会失效。

    历史教训：曾用「只比文件大小」做缓存键，
    改了算法参数后仍命中旧缓存，表现为「代码改了但结果没变」。
    故把**全部分析参数**与**分析版本号**都纳入签名。
    """
    return {
        "analysis_version": 分析版本,
        "audio": str(音频路径),
        "audio_size": 音频路径.stat().st_size,
        "audio_mtime": int(音频路径.stat().st_mtime),
        "snap": str(快照路径),
        "snap_mtime": int(快照路径.stat().st_mtime),
        "params": [波形点数, 频谱帧率, 频谱频带, 频谱窗口, 频谱动态范围,
                   矢声采样率, 矢声窗秒, 特征帧率, 特征窗口],
    }


def 构建(音频路径, 快照路径, 用缓存=False, 缓存目录=None):
    """执行全部分析。

    参数：
        音频路径    混音音频（必需）
        快照路径    project_snapshot.json（必需）
        用缓存      是否使用磁盘缓存（默认关，命令行路径不受影响）
        缓存目录    缓存文件所在目录（用缓存时必需）

    缓存键包含分析版本、音频大小与修改时间、快照修改时间、全部分析参数。
    任一变化即失效 —— 避免「改了参数却拿到旧结果」这种静默错误。
    """
    音频路径 = pathlib.Path(音频路径)
    快照路径 = pathlib.Path(快照路径)
    if not 音频路径.exists():
        raise SystemExit("缺少音频：%s" % 音频路径)
    if not 快照路径.exists():
        raise SystemExit("缺少快照：%s" % 快照路径)

    # ---- 缓存查找 ----
    缓存文件 = None
    if 用缓存 and 缓存目录 is not None:
        缓存目录 = pathlib.Path(缓存目录)
        缓存文件 = 缓存目录 / "analysis.json"
        if 缓存文件.exists():
            try:
                旧 = json.loads(缓存文件.read_text(encoding="utf-8"))
                if 旧.get("signature") == _缓存签名(音频路径, 快照路径):
                    return 旧["data"]
            except Exception:
                pass      # 缓存损坏就当没有，重新分析

    快照 = 读取快照(快照路径)
    立体声, 采样率 = _读音频(音频路径)
    单声道 = 立体声.mean(axis=1)
    时长 = len(单声道) / 采样率

    # 通道表：供 Pattern 分层显示乐器名称、供鼓组做关键词分类
    # ------------------------------------------------------------
    # **必须优先从传入的快照读**。
    # 原先是直接读仓库里的 research/results/parser_snapshot.json ——
    # 那是某个特定工程的通道编号，换工程就对不上：
    # 拿不到名字 → _鼓组分类("") 全部返回 other →
    # 步进器只剩「其它」一行（用户实测导出后就是这个现象）。
    #
    # 快照里没有 channels 时才退回旧文件，仅为兼容老快照。
    通道表 = {}
    for c in 快照.get("channels") or []:
        iid = c.get("iid")
        if iid is None:
            continue
        通道表[iid] = {
            "名称": c.get("name") or "",
            "内部名称": c.get("internal_name") or "",
            "sample_path": c.get("sample_path"),
        }
    if not 通道表:
        try:
            原始 = json.loads(
                (仓库根 / "research" / "results" /
                 "parser_snapshot.json").read_text(encoding="utf-8"))
            通道表 = {c["iid"]: c for c in 原始["channels"]}
            来源 = "旧文件（快照无 channels）"
        except Exception:
            通道表 = {}
            来源 = "无"
    else:
        来源 = "快照"

    # 记下来源，便于排查「鼓组只有其它」这类问题
    _通道表来源 = 来源
    形状 = _模式形状(快照, 通道表)

    峰值, RMS = _波形(单声道)
    频谱, 标定 = _频谱图(单声道, 采样率)
    特征 = _音频特征(立体声, 采样率)
    矢声 = _降采样立体声(立体声, 采样率)
    # 新版鼓组提取：支持软音源（按 MIDI 音高拆行）、#step 后缀、
    # 频率+节奏行序、重合合并；**不输出行名**（避免猜错误导）。
    # 旧版 _鼓组步进器 依赖通道名认鼓件，对 EZdrummer 这类软音源必然失败。
    from src.audio.stepper import 提取_鼓组, 提取_音频鼓
    鼓组结果 = 提取_鼓组(快照, 通道表)
    # 音频 clip：默认不纳入，名字带 #step 才纳入。
    # 这类鼓没有音符、没有音高，但 start/end 已知 ——
    # 不需要识别它是什么鼓，只需知道它什么时候响起。
    音频结果 = 提取_音频鼓(快照, "#step")
    鼓组 = 鼓组结果["groups"] + 音频结果["groups"]

    # 工程范围：视频时长应当覆盖整个工程，不只是音频。
    # 实测 island：音频 80.6 秒，编曲到 165.9 秒 ——
    # 只按音频长度导出会截掉后一半（用户实测报的就是这个）。
    _ppq = 快照["metadata"]["ppq"]
    _tempo = (快照["metadata"].get("tempo") or {}).get("value") or 120.0
    工程tick = 工程范围(快照)
    工程秒 = 工程tick / _ppq * 60.0 / _tempo

    数据 = {
        "audio": {
            "duration": round(时长, 3),
            # 工程长度（Playlist 最远 clip）。可能大于 duration。
            "projectDuration": round(工程秒, 3),
            "sr": 采样率,
            "channels": int(立体声.shape[1]),
        },
        "waveform": {
            "peak": [round(float(v), 4) for v in 峰值],
            "rms": [round(float(v), 4) for v in RMS],
        },
        "spectrogram": {
            "fps": 频谱帧率,
            "bands": 频谱频带,
            "frames": int(频谱.shape[0]),
            "fmin": 频谱低频,
            "fmax": 频谱高频,
            "calibration": 标定,
            "data": base64.b64encode(频谱.tobytes()).decode("ascii"),
        },
        "vectorscope": 矢声,
        "events": _节奏事件(快照),
        "timeline": _时间轴(快照),
        "patternNotes": _模式音符(快照),
        "patternShapes": 形状,
        "pitchHistogram": _音级分布(形状),
        "pitchRange": _全局音高范围(形状),
        "patternUsage": _pattern使用(快照),
        "features": 特征,
        "sections": _段落检测(特征),
        "trackActivity": _轨道活动(快照),
        "patternMatrix": _模式使用矩阵(快照),
        "drumGroups": 鼓组,
        "drumStats": 鼓组结果["stats"],
        # 疑似鼓组但未纳入的 —— 界面据此提示用户加 #step
        "drumMissed": 鼓组结果.get("missed") or [],
        "drumAudio": 音频结果.get("stats") or {},
        # 诊断用：通道表来自快照还是旧文件
        "_channelSource": _通道表来源,
        "drumUsage": _鼓组使用(快照, 鼓组),
    }

    # ---- 写缓存 ----
    if 缓存文件 is not None:
        try:
            缓存目录.mkdir(parents=True, exist_ok=True)
            缓存文件.write_text(
                json.dumps({"signature": _缓存签名(音频路径, 快照路径),
                            "data": 数据}, ensure_ascii=False),
                encoding="utf-8")
        except Exception as e:
            # 缓存失败不影响本次结果
            import sys as _sys
            _sys.stderr.write("[analyze] 写缓存失败：%s\n" % e)

    return 数据
