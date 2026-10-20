"""共享音频分析：**薄封装**（算法全部在 src/audio/analyze.py）。

## 为什么改成薄封装

本文件原先自带一份完整的分析实现（21 个函数，与 analyze.py 同名）。
实测比对：18 个函数完全相同，3 个有实质差异 ——
两边各自演化的结果是**改了 A 但 B 没改**，
表现为「改了代码但 GUI 没变化」，排查过很久。

现算法只在 `src/audio/analyze.py`，本文件只负责两件事：
  1. 提供示例工程的默认路径（供脚本直接运行）
  2. 绑定缓存目录（GUI 需要缓存，命令行不需要）

## 缓存

缓存在 `preview/.cache/analysis.json`，键含分析版本、音频大小/修改时间、
快照修改时间与全部参数。任一变化即失效。
"""
import pathlib
import sys

仓库根 = pathlib.Path(__file__).resolve().parents[1]
缓存目录 = pathlib.Path(__file__).resolve().parent / ".cache"

if str(仓库根) not in sys.path:
    sys.path.insert(0, str(仓库根))

# 示例工程的默认路径。
# 注意：**不写死盘符** —— 打包分发后别人的机器上不会有 E:\FL_Project。
# 先看环境变量（便于本机开发指定），再退回「同目录同名」约定。
from src import runtime as _rt  # noqa: E402

默认快照 = _rt.示例快照()


def _找默认音频():
    """示例音频的位置。

    仓库里不存放音频（版权与体积），故源码运行时用环境变量指定：
        set FLV_DEMO_AUDIO=E:\FL_Project\nujabes\nujabes.mp3
    找不到就返回 None —— 调用方会给出可读的提示，而不是指向一个假路径。
    """
    import os
    v = os.environ.get("FLV_DEMO_AUDIO")
    if v and pathlib.Path(v).is_file():
        return pathlib.Path(v)
    # 常见位置兜底（仅本机开发有用，打包后不存在也无妨）
    for c in (pathlib.Path(r"E:\FL_Project\nujabes\nujabes.mp3"),
              _rt.资源根() / "data" / "demo.mp3"):
        if c.is_file():
            return c
    return None


默认音频 = _找默认音频()

# ---- 从 analyze 转发全部算法 ----
from src.audio.analyze import (          # noqa: E402,F401
    分析版本, 波形点数, 频谱帧率, 频谱频带, 频谱窗口, 频谱低频, 频谱高频,
    频谱动态范围, 矢声采样率, 矢声窗秒, 特征帧率, 特征窗口,
    读取快照, _读音频, _波形, _频谱图, _降采样立体声, _节奏事件,
    _时间轴, _模式音符, _midi, _模式形状, _音级分布, _全局音高范围,
    _pattern使用, _音频特征, _轨道活动, _模式使用矩阵, _段落检测,
    _鼓组分类, _鼓组步进器, _鼓组使用, 工程范围,
)
from src.audio.analyze import 构建 as _构建  # noqa: E402


def 构建(音频路径=None, 快照路径=None, 用缓存=True):
    """示例工程 / GUI 用入口：给默认路径并启用缓存。

    与 analyze.构建 的唯一区别是「默认参数 + 缓存目录绑定」，
    算法完全一致。
    """
    音频 = 音频路径 or 默认音频
    if not 音频:
        raise SystemExit(
            "找不到示例音频。请用环境变量指定：\n"
            "    set FLV_DEMO_AUDIO=<你的音频文件路径>\n"
            "或者直接调用 构建(音频路径=...) 传入。")
    return _构建(
        音频,
        快照路径 or 默认快照,
        用缓存=用缓存,
        缓存目录=缓存目录,
    )


if __name__ == "__main__":
    import json

    数据 = 构建()
    print(json.dumps({
        "时长秒": 数据["audio"]["duration"],
        "波形点数": len(数据["waveform"]["peak"]),
        "频谱帧": 数据["spectrogram"]["frames"],
        "频谱fps": 数据["spectrogram"]["fps"],
        "矢声": {"采样率": 数据["vectorscope"]["rate"],
                 "样本数": 数据["vectorscope"]["count"]},
        "Pattern分类": {
            "打击乐": sum(1 for s in 数据["patternShapes"].values()
                          if s.get("kind") == "percussive"),
            "旋律": sum(1 for s in 数据["patternShapes"].values()
                        if s.get("kind") == "melodic"),
        },
        "检出鼓组Pattern": len(数据["drumGroups"]),
        "鼓组明细": [{"id": g["id"], "rows": len(g["rows"]),
                     "basis": g.get("basis"),
                     "scores": [r.get("score") for r in g["rows"]],
                     "steps": sum(len(r.get("steps") or {})
                                  for r in g["rows"])}
                    for g in 数据["drumGroups"]],
    }, ensure_ascii=False, indent=1))
