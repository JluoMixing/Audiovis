"""验证 COMPS 自动生成的结果。"""
import json
import pathlib
import re

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
html = (根 / "preview" / "gui_prototype.html").read_text(encoding="utf-8")

print("=== 产物里 COMPS 的生成逻辑 ===")
i = html.find("const COMPS = (function")
print(html[i:i + 620])
print()

# 检查组件注册数据是否都在产物里
print("=== 组件注册数据（从产物里提取）===")
注册 = re.findall(
    r"register\(\{\s*id:\s*'(\w+)',\s*name:\s*'([^']+)',\s*"
    r"w:\s*(\d+),\s*h:\s*(\d+),\s*group:\s*'([^']+)'", html)
for cid, name, w, h, g in 注册:
    print("  %-12s %-10s %sx%s  %s" % (cid, name, w, h, g))
print()
print("  共 %d 个组件" % len(注册))

# 按分组统计
print()
print("=== 预期分组结果 ===")
组 = {}
for cid, name, w, h, g in 注册:
    组.setdefault(g, []).append((cid, name, w, h))
for g in ("内容", "结构", "音频", "信息"):
    if g in 组:
        print("  %s (%d):" % (g, len(组[g])))
        for cid, name, w, h in 组[g]:
            print("    %-12s %-10s %sx%s" % (cid, name, w, h))
其它 = set(组) - {"内容", "结构", "音频", "信息"}
if 其它:
    print("  其它分组:", 其它)
