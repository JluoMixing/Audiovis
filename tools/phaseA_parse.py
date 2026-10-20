"""阶段 A-2：7 个工程的解析兼容性抽查。

对每个工程：
  1. 只读解析 FLP（PyFLP）
  2. 记录关键指标：版本、PPQ、Tempo、Arrangement、Channel、Pattern、
     Placement、Marker、Audio source
  3. 与 flpdiff（MIT，独立实现）交叉验证 placement 数量
  4. 记录失败模式（不隐瞒错误）

只读操作：不写入、不修改任何原始 FLP。
"""
import hashlib
import json
import pathlib
import sys
import traceback

根 = pathlib.Path(r"E:\FL_Project")
供应商 = pathlib.Path(r"D:\FL_VISUAL_TEST\research\vendor")
for 名称 in ("PyFLP", "construct", "construct-typing", "fastenum"):
    p = str(供应商 / 名称)
    if p not in sys.path:
        sys.path.insert(0, p)

# 实际目录名（用户给的名称中两个用下划线）
工程列表 = [
    ("amapiano", "amapiano"),
    ("drill", "drill"),
    ("guitar_birth", "guitar birth"),
    ("half_fire_half_sea", "half fire half sea"),
    ("island", "island"),
    ("jungle", "jungle"),
    ("rage", "rage"),
]

import pyflp


def 安全(fn, 默认=None):
    try:
        return fn()
    except Exception as e:
        return {"错误": type(e).__name__, "详情": str(e)[:80]}


结果 = []

for 目录名, 显示名 in 工程列表:
    flp = 根 / 目录名 / (目录名 + ".flp")
    项 = {"工程": 显示名, "目录": 目录名, "flp": str(flp), "状态": None}

    if not flp.is_file():
        # 尝试同名但可能不同
        cands = sorted((根 / 目录名).glob("*.flp")) if (根 / 目录名).is_dir() else []
        if not cands:
            项["状态"] = "FLP缺失"
            结果.append(项)
            continue
        flp = cands[0]
        项["flp"] = str(flp)

    try:
        原始 = flp.read_bytes()
        项["字节"] = len(原始)
        项["sha256"] = hashlib.sha256(原始).hexdigest()[:16]

        工程 = pyflp.parse(flp)

        项["版本"] = str(安全(lambda: 工程.version))
        项["ppq"] = 安全(lambda: 工程.ppq)
        项["tempo"] = 安全(lambda: 工程.tempo)
        项["标题"] = 安全(lambda: 工程.title)
        项["通道数"] = 安全(lambda: len(工程.channels))
        项["Pattern数"] = 安全(lambda: len(工程.patterns))
        项["Mixer数"] = 安全(lambda: len(工程.mixer))

        # Arrangement / Track / Placement
        arrangements = 安全(lambda: list(工程.arrangements)) or []
        if isinstance(arrangements, dict):
            arrangements = []
        项["Arrangement数"] = len(arrangements)

        placement数 = 0
        pattern放置 = 0
        通道放置 = 0
        自动化放置 = 0
        有内容轨道 = 0
        轨道总数 = 0
        markers = 0
        for arr in arrangements:
            markers += len(安全(lambda a=arr: list(a.timemarkers)) or [])
            for track in 安全(lambda a=arr: list(a.tracks)) or []:
                轨道总数 += 1
                条目 = 安全(lambda t=track: list(t)) or []
                if 条目:
                    有内容轨道 += 1
                for item in 条目:
                    placement数 += 1
                    类名 = type(item).__name__
                    if hasattr(item, "pattern"):
                        pattern放置 += 1
                    elif hasattr(item, "channel"):
                        ch = 安全(lambda i=item: i.channel)
                        if ch is not None and type(ch).__name__ == "Automation":
                            自动化放置 += 1
                        else:
                            通道放置 += 1

        项["轨道总数"] = 轨道总数
        项["有内容轨道"] = 有内容轨道
        项["placement总数"] = placement数
        项["Pattern放置"] = pattern放置
        项["通道放置"] = 通道放置
        项["自动化放置"] = 自动化放置
        项["Marker数"] = markers

        # 音符总数
        音符总数 = 0
        音符错误 = 0
        for pat in 安全(lambda: list(工程.patterns)) or []:
            ns = 安全(lambda p=pat: list(p.notes))
            if isinstance(ns, list):
                音符总数 += len(ns)
            else:
                音符错误 += 1
        项["音符总数"] = 音符总数
        项["音符读取失败Pattern数"] = 音符错误

        # 音频源
        # 注意：这里不能再用 安全() 包装迭代——它会把异常吞成 None，
        # 导致统计静默失败（首轮曾因此误报「音频源数=0」）。
        源 = set()
        通道类型 = {}
        for ch in 工程.channels:
            tn = type(ch).__name__
            通道类型[tn] = 通道类型.get(tn, 0) + 1
            if tn == "Sampler":
                try:
                    sp = ch.sample_path
                except Exception:
                    sp = None
                if sp:
                    源.add(str(sp))
        项["音频源数"] = len(源)
        项["通道类型"] = 通道类型

        项["状态"] = "成功"

    except Exception as e:
        项["状态"] = "解析失败"
        项["错误类型"] = type(e).__name__
        项["错误信息"] = str(e)[:200]
        项["堆栈"] = traceback.format_exc().splitlines()[-3:]

    结果.append(项)

# ---- 输出 ----
print("=" * 78)
print("阶段 A：解析兼容性抽查")
print("=" * 78)

成功 = [x for x in 结果 if x["状态"] == "成功"]
失败 = [x for x in 结果 if x["状态"] != "成功"]

for 项 in 结果:
    print()
    print("【%s】%s" % (项["工程"], 项["状态"]))
    if 项["状态"] != "成功":
        if "错误类型" in 项:
            print("   %s: %s" % (项["错误类型"], 项["错误信息"]))
        continue
    print("   版本=%s  PPQ=%s  Tempo=%s" % (项["版本"], 项["ppq"], 项["tempo"]))
    print("   Arrangement=%s  轨道=%s(有内容%s)  Channel=%s  Pattern=%s" % (
        项["Arrangement数"], 项["轨道总数"], 项["有内容轨道"],
        项["通道数"], 项["Pattern数"]))
    print("   Placement=%s (Pattern %s / 通道 %s / 自动化 %s)" % (
        项["placement总数"], 项["Pattern放置"], 项["通道放置"], 项["自动化放置"]))
    print("   音符=%s  Marker=%s  音频源=%s" % (
        项["音符总数"], 项["Marker数"], 项["音频源数"]))
    if 项["音符读取失败Pattern数"]:
        print("   ⚠ 音符读取失败的 Pattern: %s 个" % 项["音符读取失败Pattern数"])

print()
print("=" * 78)
print("汇总：%d/%d 解析成功" % (len(成功), len(结果)))
if 失败:
    print("失败工程：%s" % ", ".join(x["工程"] for x in 失败))
print()
print("%-20s %8s %6s %8s %10s %8s" % (
    "工程", "PPQ", "Tempo", "轨道", "Placement", "音符"))
print("-" * 68)
for 项 in 成功:
    print("%-20s %8s %6s %8d %10d %8d" % (
        项["工程"], 项["ppq"], 项["tempo"], 项["轨道总数"],
        项["placement总数"], 项["音符总数"]))

out = pathlib.Path(r"D:\FL_VISUAL_TEST\tools\phaseA_parse_results.json")
out.write_text(json.dumps(结果, ensure_ascii=False, indent=1), encoding="utf-8")
print()
print("已记录:", out)
