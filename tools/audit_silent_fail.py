"""深查：漏登记时会不会报错（还是静默失败）。"""
import json
import pathlib
import re

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")

print("=" * 74)
print("漏登记时的行为（静默失败 vs 报错）")
print("=" * 74)
print()

# ---- 1) 主题漏 SURFACE ----
sf = (根 / "src" / "core" / "surfaces.js").read_text(encoding="utf-8")
i = sf.find("未登记的主题回退")
if i > 0:
    print("【1】主题漏 SURFACE 登记")
    print(sf[max(0, i - 260):i + 200])
    print()

# ---- 2) 主题漏 BLOOM ----
dp = (根 / "src" / "bloom" / "dispatch.js").read_text(encoding="utf-8")
print("【2】主题漏 BLOOM 函数")
for i, l in enumerate(dp.split("\n"), 1):
    if "BLOOM[" in l or "回退" in l or "||" in l:
        print("  L%-4d %s" % (i, l.strip()[:86]))
print()

# ---- 3) GUI 组件库是否手工 ----
js = (根 / "preview" / "gui" / "js" / "app.js").read_text(encoding="utf-8")
print("【3】GUI 组件库列表")
m = re.search(r"(const|let)\s+(组件库|组件列表|COMP_GROUPS)\s*=\s*[\[{]", js)
if m:
    ln = js[:m.start()].count("\n") + 1
    print("  在 app.js:L%d 手工定义：" % ln)
    seg = js[m.start():m.start() + 700]
    for line in seg.split("\n")[:14]:
        print("    " + line[:88])
else:
    print("  未找到显式定义，可能从 COMPONENTS 自动生成")
    for i, l in enumerate(js.split("\n"), 1):
        if "COMPONENTS" in l and ("forEach" in l or "map" in l or "filter" in l):
            print("    L%-4d %s" % (i, l.strip()[:86]))
print()

# ---- 4) 主题列表是否从 artdirections 自动生成 ----
print("【4】主题列表来源")
for i, l in enumerate(js.split("\n"), 1):
    if "THEMES" in l and ("=" in l or "forEach" in l):
        print("  L%-4d %s" % (i, l.strip()[:86]))
