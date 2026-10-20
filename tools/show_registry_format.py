"""查各登记点的确切格式，供写文档用。"""
import json
import pathlib
import re

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")

# ---- 1) build.py 的清单 ----
bp = (根 / "src" / "build" / "build.py").read_text(encoding="utf-8")
print("=== build.py 清单 ===")
for 名 in ("PRE_FILES", "CORE_FILES", "BLOOM_FILES", "COMPONENT_FILES"):
    m = re.search(名 + r"\s*=\s*\[(.*?)\]", bp, re.S)
    if m:
        items = re.findall(r'"([^"]+)"', m.group(1))
        print("  %s (%d 项):" % (名, len(items)))
        for x in items[:2]:
            print('      "%s",' % x)
        if len(items) > 2:
            print("      …")
print()

# ---- 2) surfaces.js 的 SURFACE 格式 ----
sf = (根 / "src" / "core" / "surfaces.js").read_text(encoding="utf-8")
i = sf.find("SURFACE.sumi")
print("=== surfaces.js SURFACE 格式 ===")
print(sf[i:i + 520])
print()

# ---- 3) artdirections.json 一项的完整结构 ----
ad = json.loads((根 / "preview" / "themes" / "artdirections.json")
                .read_text(encoding="utf-8"))
k = list((ad.get("directions") or {}).keys())[0]
print("=== artdirections.json 一项（%s）===" % k)
print(json.dumps(ad["directions"][k], ensure_ascii=False, indent=1)[:900])
print()
print("=== 顶层结构 ===")
print("  键:", list(ad.keys()))
print("  order:", ad.get("order"))
print()

# ---- 4) dispatch.js 的 BLOOM 表 ----
dp = (根 / "src" / "bloom" / "dispatch.js").read_text(encoding="utf-8")
print("=== dispatch.js BLOOM 表 ===")
print(dp[:700])
