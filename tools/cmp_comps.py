"""对比 COMPS 表与组件自带的 name/w/h/group，判断是否重复数据。"""
import pathlib
import re

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")

comps = {}
for f in (根 / "src" / "components").glob("*.js"):
    s = f.read_text(encoding="utf-8")
    m = re.search(
        r"register\(\{\s*id:\s*'(\w+)',\s*name:\s*'([^']+)',\s*"
        r"w:\s*(\d+),\s*h:\s*(\d+),\s*group:\s*'([^']+)'", s)
    if m:
        comps[m.group(1)] = {
            "name": m.group(2), "w": int(m.group(3)),
            "h": int(m.group(4)), "group": m.group(5)}

print("组件自带（%d 个）:" % len(comps))
for k in sorted(comps):
    v = comps[k]
    print("  %-12s name=%-8s %sx%s  group=%s"
          % (k, v["name"], v["w"], v["h"], v["group"]))

print()
js = (根 / "preview" / "gui" / "js" / "app.js").read_text(encoding="utf-8")
i = js.find("const COMPS = [")
j = js.find("\n];", i)
表 = js[i:j + 3]
print("COMPS 表：")
print(表)

# 逐项对比
print()
print("差异：")
for m in re.finditer(
        r"id:'(\w+)',\s*name:'([^']+)',\s*w:(\d+),\s*h:(\d+)", 表):
    cid, name, w, h = m.group(1), m.group(2), int(m.group(3)), int(m.group(4))
    c = comps.get(cid)
    if not c:
        print("  %-12s 组件里没有这个 id！" % cid)
        continue
    if (name, w, h) != (c["name"], c["w"], c["h"]):
        print("  %-12s COMPS=%s %sx%s / 组件=%s %sx%s  ← 不一致"
              % (cid, name, w, h, c["name"], c["w"], c["h"]))
    else:
        print("  %-12s 一致" % cid)
