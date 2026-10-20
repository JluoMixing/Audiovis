"""确认：analyze.py 的通道表是否与传入的快照脱钩。"""
import json
import pathlib
import sys

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

from src.audio.analyze import _鼓组分类  # noqa: E402

原始 = json.loads((根 / "research" / "results" /
                   "parser_snapshot.json").read_text(encoding="utf-8"))
通道表 = {c["iid"]: c for c in 原始["channels"]}

print("=" * 76)
print("写死的 parser_snapshot.json 里的通道名")
print("=" * 76)
for iid in [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17]:
    c = 通道表.get(iid) or {}
    名 = c.get("名称") or c.get("内部名称") or ""
    类, _ = _鼓组分类(名)
    print("  ch%-3s 名称=%-30s → %s" % (str(iid), (名 or "(空)")[:30], 类))

print()
print("=" * 76)
print("关键问题")
print("=" * 76)
print("  这份 JSON 是**仓库里写死的文件**（research/results/parser_snapshot.json），")
print("  不是由传入的 project_snapshot.json 生成的。")
print("  它的通道 iid → 名称映射属于某个特定工程。")
print()
print("  若真实工程的通道 iid 与它对不上（或名称不同），")
print("  分类就会全部落到 other —— 这正是导出时看到「其它」的原因。")
print()

# 检查真实 FLP 的通道名
print("=" * 76)
print("真实 nujabes.flp 解析出来的通道名")
print("=" * 76)
try:
    from src.parser import flp as flp模块
    from src.parser import snapshot as 快照模块
    快照 = 快照模块.规范化(flp模块.解析(r"E:\FL_Project\nujabes\nujabes.flp"))
    print("  快照顶层键: %s" % list(快照.keys()))
    for k in 快照:
        if "chan" in k.lower():
            print("  含通道键: %s" % k)
except Exception as e:
    print("  解析失败: %s" % e)
