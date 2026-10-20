"""EZdrummer 通道的音高峰值分布 —— 判断能否按通用鼓映射识别。

通用 MIDI 鼓映射（GM）：36=kick 38=snare 42=closed hat 46=open hat ...
若音高集中在这些值，就能不依赖通道名识别。
"""
import json
import pathlib
import sys
from collections import Counter

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

from src.parser import flp as flp模块  # noqa: E402
from src.parser import snapshot as 快照模块  # noqa: E402

工程 = pathlib.Path(r"E:\FL_Project\island")
快照 = 快照模块.规范化(flp模块.解析(str(工程 / "island.flp")))

GM = {35: "35 Acoustic Bass Drum", 36: "36 Bass Drum 1", 37: "37 Side Stick",
      38: "38 Acoustic Snare", 39: "39 Hand Clap", 40: "40 Electric Snare",
      41: "41 Low Floor Tom", 42: "42 Closed Hi-Hat", 43: "43 High Floor Tom",
      44: "44 Pedal Hi-Hat", 45: "45 Low Tom", 46: "46 Open Hi-Hat",
      47: "47 Low-Mid Tom", 48: "48 Hi-Mid Tom", 49: "49 Crash Cymbal 1",
      50: "50 High Tom", 51: "51 Ride Cymbal 1", 52: "52 Chinese Cymbal",
      53: "53 Ride Bell", 54: "54 Tambourine", 55: "55 Splash Cymbal",
      56: "56 Cowbell", 57: "57 Crash Cymbal 2", 59: "59 Ride Cymbal 2"}

目标通道 = {24, 37}   # EZdrummer

音高计数 = Counter()
音符数 = 0
for p in 快照["patterns"]:
    for n in p["notes"]:
        cid = (n.get("channel_id") or {}).get("value")
        if cid not in 目标通道:
            continue
        pv = n.get("pitch")
        m = pv.get("value") if isinstance(pv, dict) else pv
        if m is None:
            continue
        音高计数[m] += 1
        音符数 += 1

print("=" * 70)
print("EZdrummer 通道（ch24 / ch37）的音高分布")
print("=" * 70)
print()
print("  总音符: %d    不同音高: %d 种" % (音符数, len(音高计数)))
print()
print("  %-6s %-8s %-30s" % ("音高", "次数", "对应 GM 鼓"))
print("  " + "-" * 62)
for m, c in 音高计数.most_common():
    print("  %-6s %-8s %-30s" % (m, c, GM.get(m, "")))
print()

# 音高是否落在 GM 鼓范围内
在GM = sum(c for m, c in 音高计数.items() if 35 <= m <= 59)
print("  落在 GM 鼓范围(35..59) 的比例: %.1f%%" % (在GM / max(1, 音符数) * 100))
print()

# 检查一个具体 pattern 的节奏
print("=" * 70)
print("含 EZdrummer 的 pattern 示例（前 3 个）")
print("=" * 70)
print()
PPQ = 快照["metadata"]["ppq"]
tempo = (快照["metadata"]["tempo"] or {}).get("value") or 120

计数 = 0
for p in 快照["patterns"]:
    含 = [n for n in p["notes"]
          if ((n.get("channel_id") or {}).get("value") in 目标通道)]
    if not 含:
        continue
    计数 += 1
    if 计数 > 3:
        break
    pname = p.get("name")
    if isinstance(pname, dict):
        pname = pname.get("value")
    print("  Pattern %s 「%s」 %d 音符" % (p.get("id"),
                                       str(pname or "")[:36], len(含)))
    音高集 = sorted({(n.get("pitch") or {}).get("value") for n in 含})
    print("     用到的音高: %s" % 音高集)
    # 按音高分行的 16 分格
    for m in 音高集:
        格 = []
        子 = [n for n in 含 if (n.get("pitch") or {}).get("value") == m]
        for n in 子:
            t = (n.get("start") or {}).get("value")
            if t is None:
                continue
            格.append(int(round(t / (PPQ / 4))) % 16)
        s = "".join("X" if i in 格 else "." for i in range(16))
        print("        %-4s %-8s %s" % (m, GM.get(m, ""), s))
    print()
