"""量化步进器的配色可分性。

用实测数据回答：kick / snare / hihat 三行在这个主题下，
颜色差异到底有多大。
"""
import json
import pathlib
import re
import sys

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    """与 canvas-kit.js 的 mixHex 同义：t=0 取 a，t=1 取 b。"""
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def 亮度(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def 距离(c1, c2):
    return sum((c1[i] - c2[i]) ** 2 for i in range(3)) ** 0.5


方向 = json.loads((根 / "preview" / "themes" /
                   "artdirections.json").read_text(encoding="utf-8"))

关键词 = ["default", "sumi", "construct"]
print("=" * 78)
print("步进器三族配色的可分性（数值越大越容易分辨）")
print("=" * 78)
print()

for 键 in 关键词:
    if 键 not in 方向["directions"]:
        continue
    t = 方向["directions"][键]
    P = t["palette"]
    bg = hex2rgb(P["bg"])
    ink = hex2rgb(P["ink"])
    acc = hex2rgb(P["accent"])

    色 = {
        "kick":  mix(ink, (0, 0, 0), 0.08),
        "snare": mix(acc, ink, 0.10),
        "hihat": mix(ink, bg, 0.44),
        "openhat": mix(acc, bg, 0.32),
        "tom": mix(acc, ink, 0.42),
        "crash": mix(acc, bg, 0.06),
    }
    print("【%s】%s   底色 %s" % (键, t["name"], P["bg"]))
    for k, c in 色.items():
        # 与底色的对比（能否看清）
        print("    %-8s rgb(%3d,%3d,%3d)  与底色差 %6.1f  亮度 %5.1f" % (
            k, c[0], c[1], c[2], 距离(c, bg), 亮度(c)))

    三 = ["kick", "snare", "hihat"]
    print()
    print("    三大件两两色差：")
    最差 = 999
    for i in range(3):
        for j in range(i + 1, 3):
            a, b = 三[i], 三[j]
            d = 距离(色[a], 色[b])
            最差 = min(最差, d)
            flag = "  ← 太接近" if d < 40 else ""
            print("      %-6s vs %-6s  %6.1f%s" % (a, b, d, flag))
    print()
    print("    三大件与底色对比最小者: %.1f%s" % (
        min(距离(色[k], bg) for k in 三),
        "  ← 有族几乎看不见" if min(距离(色[k], bg) for k in 三) < 40 else ""))
    print("    三大件彼此最小色差: %.1f%s" % (
        最差, "  ← 分不清 ← BUG" if 最差 < 40 else ""))
    print()
