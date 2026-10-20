"""EZdrummer 音高（音名）→ MIDI → GM 鼓。

音高值是 "G#3" 这样的音名。FL 的写法里 C5 = MIDI 72（即 C3=48），
需要确认具体约定，这里同时给出两种换算下的结果。
"""
import pathlib
import sys
from collections import Counter

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

from src.parser import flp as flp模块  # noqa: E402
from src.parser import snapshot as 快照模块  # noqa: E402

音名表 = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6,
         "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}

GM = {35: "Acoustic Bass Drum", 36: "Bass Drum 1", 37: "Side Stick",
      38: "Acoustic Snare", 39: "Hand Clap", 40: "Electric Snare",
      41: "Low Floor Tom", 42: "Closed Hi-Hat", 43: "High Floor Tom",
      44: "Pedal Hi-Hat", 45: "Low Tom", 46: "Open Hi-Hat",
      47: "Low-Mid Tom", 48: "Hi-Mid Tom", 49: "Crash Cymbal 1",
      50: "High Tom", 51: "Ride Cymbal 1", 52: "Chinese Cymbal",
      53: "Ride Bell", 54: "Tambourine", 55: "Splash Cymbal",
      56: "Cowbell", 57: "Crash Cymbal 2", 59: "Ride Cymbal 2"}


def 音名到midi(名, 约定="C5=72"):
    """'G#3' -> MIDI。约定：FL 默认 C5=72（即 C3=48）。"""
    if not isinstance(名, str):
        return None
    s = 名.strip()
    if not s:
        return None
    八度 = int(s[-1])
    音 = s[:-1]
    if 音 not in 音名表:
        return None
    base = 12 if 约定 == "C5=72" else 0    # C5=72 => C0=12
    return base + 八度 * 12 + 音名表[音]


工程 = pathlib.Path(r"E:\FL_Project\island")
快照 = 快照模块.规范化(flp模块.解析(str(工程 / "island.flp")))

目标通道 = {24, 37}
计数 = Counter()
for p in 快照["patterns"]:
    for n in p["notes"]:
        cid = (n.get("channel_id") or {}).get("value")
        if cid not in 目标通道:
            continue
        pv = n.get("pitch")
        v = pv.get("value") if isinstance(pv, dict) else pv
        if v is None:
            continue
        计数[v] += 1

print("=" * 78)
print("EZdrummer 音高 → MIDI → GM 鼓")
print("=" * 78)
print()
print("  %-6s %-6s %-8s %-24s %s" % ("音名", "MIDI", "次数", "GM(C5=72)", "GM(C4=60)"))
print("  " + "-" * 70)

总 = sum(计数.values())
命中 = 0
for 名, c in 计数.most_common():
    m1 = 音名到midi(名, "C5=72")
    m2 = 音名到midi(名, "C4=60")
    g1 = GM.get(m1, "")
    g2 = GM.get(m2, "")
    if g1:
        命中 += c
    print("  %-6s %-6s %-8s %-24s %s" % (名, m1, c, g1, g2))
print()
print("  总音符 %d，按 C5=72 换算落在 GM 鼓范围内的: %d (%.0f%%)" % (
    总, 命中, 命中 / max(1, 总) * 100))
print()

# 用 EZdrummer 自家的默认映射（它不用 GM，是 C1=36 之类）
print("=" * 78)
print("按「相对关系」判断（不依赖标准映射）")
print("=" * 78)
print()
排序 = 计数.most_common()
print("  出现最多的 3 个音高：")
for 名, c in 排序[:3]:
    print("     %-6s %4d 次 (%.0f%%)" % (名, c, c / 总 * 100))
print()
print("  在鼓组里，出现最频繁、且节奏规整（每拍/每半拍）的通常是 hat；")
print("  次频繁、落在 1/3 位的是 kick/snare。单靠音高无法可靠区分。")
print()

# 打印前 2 个 pattern 的步进图
PPQ = 快照["metadata"]["ppq"]
n = 0
for p in 快照["patterns"]:
    含 = [x for x in p["notes"]
          if ((x.get("channel_id") or {}).get("value") in 目标通道)]
    if not 含:
        continue
    n += 1
    if n > 2:
        break
    pname = p.get("name")
    if isinstance(pname, dict):
        pname = pname.get("value")
    print("  Pattern %s 「%s」" % (p.get("id"), str(pname or "")[:40]))
    音高集 = sorted({(x.get("pitch") or {}).get("value") for x in 含},
                    key=lambda v: -计数[v])
    for m in 音高集:
        子 = [x for x in 含 if (x.get("pitch") or {}).get("value") == m]
        格 = set()
        for x in 子:
            t = (x.get("start") or {}).get("value")
            if t is not None:
                格.add(int(round(t / (PPQ / 4))) % 16)
        print("     %-6s %s   (%d)" % (
            m, "".join("X" if i in 格 else "." for i in range(16)), len(子)))
    print()
