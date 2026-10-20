"""island 里的音频 clip（采样），以及它们能否纳入步进器。"""
import pathlib
import sys
from collections import Counter

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

from src.parser import flp as flp模块  # noqa: E402
from src.parser import snapshot as 快照模块  # noqa: E402

工程 = pathlib.Path(r"E:\FL_Project\island")
快照 = 快照模块.规范化(flp模块.解析(str(工程 / "island.flp")))
PPQ = 快照["metadata"]["ppq"]
tempo = (快照["metadata"]["tempo"] or {}).get("value") or 155.0

print("=" * 84)
print("island 的音频 clip（采样形式）")
print("=" * 84)
print()

音频源 = 快照.get("audio_sources") or {}
print("  识别到 %d 个音频源" % len(音频源))
print()

# 每个音频源用了几次、总时长
统计 = {}
for tr in 快照["arrangement"]["tracks"]:
    for c in tr.get("clips") or []:
        if c.get("type") != "audio":
            continue
        sid = (c.get("source") or {}).get("id")
        st = (c.get("start") or {}).get("value") or 0
        en = (c.get("end") or {}).get("value") or 0
        e = 统计.setdefault(sid, {"次数": 0, "总tick": 0, "最早": st,
                                  "名字": (c.get("source") or {}).get("name")})
        e["次数"] += 1
        e["总tick"] += en - st
        e["最早"] = min(e["最早"], st)

print("  %-5s %-40s %5s %10s" % ("id", "名称", "次数", "总时长(秒)"))
print("  " + "-" * 70)
for sid, e in sorted(统计.items(), key=lambda kv: -kv[1]["总tick"]):
    名 = str(e["名字"] or "")
    print("  %-5s %-40s %5d %10.1f" % (
        sid, 名[:40], e["次数"], e["总tick"] / PPQ * 60 / tempo))
print()

print("=" * 84)
print("关键判断")
print("=" * 84)
print()
print("  音频 clip 有确定的 start/end —— 也就是说「它什么时候响起」是**已知的**。")
print("  所以「把音频形式的鼓纳入步进器」在数据上是可行的：")
print("  不需要识别它是什么鼓，只需知道它在时间轴上占的区间。")
print()

# 看看这些音频 clip 的分布形态：是短促的一次次，还是长段铺底
print("  音频 clip 的形态（按时长分布）：")
长度档 = Counter()
for tr in 快照["arrangement"]["tracks"]:
    for c in tr.get("clips") or []:
        if c.get("type") != "audio":
            continue
        st = (c.get("start") or {}).get("value") or 0
        en = (c.get("end") or {}).get("value") or 0
        ln = (en - st) / PPQ          # 拍
        if ln < 1:
            长度档["< 1 拍（打击式）"] += 1
        elif ln < 8:
            长度档["1~8 拍（乐句）"] += 1
        else:
            长度档["> 8 拍（长段铺底）"] += 1
for k, v in 长度档.most_common():
    print("     %-24s %d 个" % (k, v))
