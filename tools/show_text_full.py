"""看模板里 text 组件的完整字段（有没有 w/h）。"""
import json
import pathlib

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
ts = json.loads((根 / "preview" / "templates.json").read_text(encoding="utf-8"))

for t in ts:
    if t.get("name") not in ("基础", "变体"):
        continue
    print("=== %s（横屏）===" % t["name"])
    for c in (t.get("land") or []):
        if c.get("id") == "text":
            print("  " + json.dumps(c, ensure_ascii=False))
    print()

# 对比：竖屏的
for t in ts:
    if t.get("name") != "基础":
        continue
    print("=== 基础（竖屏）===")
    for c in (t.get("port") or []):
        if c.get("id") == "text":
            print("  " + json.dumps(c, ensure_ascii=False))
