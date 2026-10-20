"""看「基础」「变体」模板的横屏文字组件位置。"""
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
            st = c.get("样式") or {}
            print("  x=%-5s y=%-5s 锚=%-3s 对齐=%-6s 内容=%r"
                  % (c.get("x"), c.get("y"), c.get("锚"),
                     st.get("对齐"), (st.get("内容") or "")[:24]))
    print()
