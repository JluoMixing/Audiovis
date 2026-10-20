"""诊断 2：DRUMS / DRUM_USE 的实际内容与 clip 时序。

回答：为什么步进器只显示 hihat。
前一轮已确认分类没问题（kick/snare/hihat 都识别对了），
所以问题在「哪些鼓组、在什么时间段」这一层。
"""
import json
import pathlib
import sys

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

from src.audio.analyze import _鼓组步进器  # noqa: E402

快照 = json.loads((根 / "data" / "projects" / "nujabes" /
                   "project_snapshot.json").read_text(encoding="utf-8"))
原始 = json.loads((根 / "research" / "results" /
                   "parser_snapshot.json").read_text(encoding="utf-8"))
通道表 = {c["iid"]: c for c in 原始["channels"]}

鼓组 = _鼓组步进器(快照, 通道表)

print("=" * 78)
print("鼓组数据诊断（analyze.py 产出）")
print("=" * 78)
print()
print("共 %d 个被判定为鼓组的 Pattern" % len(鼓组))
print()

for g in 鼓组:
    print("  Pattern %-4s  行数 %d" % (g.get("id"), len(g.get("rows", []))))
    for r in g.get("rows", []):
        print("      %-9s %-32s %d 步" % (
            r.get("group"), str(r.get("name"))[:32], len(r.get("steps", {}))))
    print()

# ---- clip 使用情况 ----
print("【关键】每个鼓组 Pattern 在 Playlist 里的使用区间")
print()
PPQ = 快照["metadata"]["ppq"]
TICK = PPQ  # 一拍
# clip 挂在 arrangement.tracks[].clips 下（不是顶层 clips）
clips = []
for tr in 快照["arrangement"]["tracks"]:
    for c in (tr.get("clips") or []):
        c = dict(c)
        c["_track"] = tr.get("index")
        clips.append(c)
print("（共读到 %d 个 clip）" % len(clips))
print()

按pattern = {}
for c in clips:
    pid = ((c.get("source") or {}).get("id"))
    按pattern.setdefault(pid, []).append(c)

鼓组id = {g.get("id") for g in 鼓组}
for g in 鼓组:
    pid = g.get("id")
    cs = 按pattern.get(pid, [])
    类别集 = sorted({r.get("group") for r in g.get("rows", [])})
    print("  P%-4s %-10s  出现 %d 次" % (
        pid, ",".join(类别集), len(cs)))
    for c in cs[:6]:
        pos = (c.get("start") or {}).get("value")
        ln = (c.get("length") or {}).get("value")
        if pos is None or ln is None:
            continue
        print("         t=%8.2fs ~ %8.2fs  (%.1f 拍)" % (
            pos / TICK, (pos + ln) / TICK, ln / TICK))
    if len(cs) > 6:
        print("         … 共 %d 个" % len(cs))
    print()

# ---- 检查覆盖：某一时刻有哪些鼓组在响 ----
print("【关键】按时间扫描：不同时刻各鼓组的可用情况")
print()
所有区间 = []
for g in 鼓组:
    pid = g.get("id")
    for c in 按pattern.get(pid, []):
        pos = (c.get("start") or {}).get("value")
        ln = (c.get("length") or {}).get("value")
        if pos is None or ln is None:
            continue
        所有区间.append((pos, pos + ln, pid,
                        sorted({r.get("group") for r in g.get("rows", [])})))
所有区间.sort()

for 检查点 in [0, 16, 32, 48, 64, 96, 128]:
    t = 检查点 * TICK
    活 = [x for x in 所有区间 if x[0] <= t < x[1]]
    类别 = sorted({c for x in 活 for c in x[3]})
    print("  %3d 拍: %d 个鼓组 clip 在放 → 类别 %s" % (
        检查点, len(活), ",".join(类别) if 类别 else "(无)"))
print()

print("结论提示：若各时刻的类别始终只有 hihat，说明 kick/snare 的 clip")
print("          根本不在这些时段，或它们的时间轴位置与 hihat 不同。")
