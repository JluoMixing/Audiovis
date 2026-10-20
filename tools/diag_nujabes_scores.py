"""查：nujabes 的 kick 与 snare 为何分数相同（0.61）被并成一行。"""
import json
import pathlib
import sys

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

from src.audio.stepper import 提取_鼓组  # noqa: E402

缓存 = json.loads((根 / "preview" / ".cache" / "analysis.json")
                  .read_text(encoding="utf-8"))["data"]
组 = 缓存.get("drumGroups") or []

print("=" * 74)
print("nujabes 各 pattern 的行与分数")
print("=" * 74)
print()
print("  %-6s %-4s %-10s %-8s %-8s %s" % ("P", "行", "key", "family", "score", "节奏特征"))
print("  " + "-" * 66)
for g in 组:
    for i, r in enumerate(g.get("rows") or []):
        f = r.get("features") or {}
        print("  %-6s %-4s %-10s %-8s %-8s 每小节=%-5s 八分比=%.2f 正拍=%.2f 反拍=%.2f" % (
            g["id"] if i == 0 else "",
            i + 1, r.get("key") or "-", r.get("family") or "-",
            r.get("score"),
            f.get("每小节"), f.get("八分比", 0),
            f.get("正拍比", 0), f.get("反拍比", 0)))
    print()

# 统计所有行的分数
全部分数 = []
for g in 组:
    for r in g.get("rows") or []:
        全部分数.append((g["id"], r.get("midi"), r.get("score")))
print("  所有 (pattern, midi, score):")
for x in 全部分数:
    print("     P%-4s midi=%-5s score=%s" % x)
