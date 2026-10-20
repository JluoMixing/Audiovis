"""对比两条路径产出的 drumGroups / drumUsage 数据。

预览：preview/build_gui.py  → 用 preview/.cache/analysis.json
导出：src/cli.py _组装页面  → 现场调 src/audio/analyze.py 重新分析
"""
import json
import pathlib
import sys

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

print("=" * 76)
print("两条路径的鼓组数据对比")
print("=" * 76)
print()

# ---- 路径 A：预览用的缓存 ----
print("【A】预览路径（preview/.cache/analysis.json）")
缓存 = 根 / "preview" / ".cache" / "analysis.json"
d = json.loads(缓存.read_text(encoding="utf-8"))["data"]
A组 = d.get("drumGroups") or []
A用 = d.get("drumUsage") or {}
print("   drumGroups %d 个 · drumUsage %d 个 pattern" % (len(A组), len(A用)))
for g in A组:
    print("     P%-3s %s" % (g.get("id"),
          "  ".join(r.get("group", "?") for r in g.get("rows", []))))
print("   usage: " + ", ".join("P%s×%d" % (k, len(v))
                              for k, v in sorted(A用.items(),
                                                 key=lambda x: int(x[0]))))
print()

# ---- 路径 B：现场重新分析 ----
print("【B】导出路径（现场调 analyze.构建）")
from src.audio import analyze as 分析模块  # noqa: E402

快照路径 = 根 / "data" / "projects" / "nujabes" / "project_snapshot.json"
数据 = 分析模块.构建(r"E:\FL_Project\nujabes\nujabes.mp3", 快照路径)
B组 = 数据.get("drumGroups") or []
B用 = 数据.get("drumUsage") or {}
print("   drumGroups %d 个 · drumUsage %d 个 pattern" % (len(B组), len(B用)))
for g in B组:
    print("     P%-3s %s" % (g.get("id"),
          "  ".join(r.get("group", "?") for r in g.get("rows", []))))
print("   usage: " + ", ".join("P%s×%d" % (k, len(v))
                              for k, v in sorted(B用.items(),
                                                 key=lambda x: int(x[0]))))
print()

# ---- 差异 ----
print("【差异】")
A_k, B_k = set(A用), set(B用)
print("   只在预览里的 pattern:   %s" % (sorted(A_k - B_k) or "无"))
print("   只在导出里的 pattern:   %s" % (sorted(B_k - A_k) or "无"))
print()
A类 = {}
for g in A组:
    for r in g.get("rows", []):
        A类[r.get("group")] = A类.get(r.get("group"), 0) + 1
B类 = {}
for g in B组:
    for r in g.get("rows", []):
        B类[r.get("group")] = B类.get(r.get("group"), 0) + 1
print("   预览各族行数: %s" % A类)
print("   导出各族行数: %s" % B类)
