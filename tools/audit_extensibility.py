"""审视可扩展性：添加新主题 / 新组件各需改几处。

## 为什么做这个

GUI 阶段开始前约定：保证添加新主题和新组件的可扩展性。
现在自查：这两件事是否清晰、易维护。

## 判断标准

「改一处就能加」= 好
「改 5 处且分散在 js/py/json」= 差，容易漏
"""
import pathlib
import re

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")

print("=" * 74)
print("可扩展性审视")
print("=" * 74)
print()

# ================================================================ 新主题
print("【1】添加一个新主题，需要改哪些地方？")
print()

# 1a) 主题定义
主题文件 = 根 / "src" / "bloom" / "themes"
现有 = sorted([f.stem for f in 主题文件.glob("*.js")])
print("  ① 新增 bloom 文件：src/bloom/themes/<名>.js")
print("     现有 %d 个：%s" % (len(现有), ", ".join(现有)))
print()

# 1b) build.py 的模块清单
bp = (根 / "src" / "build" / "build.py").read_text(encoding="utf-8")
m = re.search(r'BLOOM_FILES\s*=\s*\[(.*?)\]', bp, re.S)
if m:
    清单 = re.findall(r'"([^"]+)"', m.group(1))
    print("  ② 改 src/build/build.py 的 BLOOM_FILES（%d 项）" % len(清单))
    print("     %s" % ", ".join(清单[:4]))
    print()

# 1c) surfaces.js
sf = (根 / "src" / "core" / "surfaces.js").read_text(encoding="utf-8")
surfaces = re.findall(r"^SURFACE\.(\w+)\s*=", sf, re.M)
print("  ③ 改 src/core/surfaces.js 加 SURFACE.<名>（现有 %d 个）" % len(surfaces))
print("     %s" % ", ".join(surfaces))
print()

# 1d) artdirections.json
ad = (根 / "preview" / "themes" / "artdirections.json")
import json
d = json.loads(ad.read_text(encoding="utf-8"))
方向 = d.get("directions") or {}
print("  ④ 改 preview/themes/artdirections.json 加一项（现有 %d 个）" % len(方向))
print()

# 1e) dispatch.js
dp = (根 / "src" / "bloom" / "dispatch.js").read_text(encoding="utf-8")
print("  ⑤ 改 src/bloom/dispatch.js 的 BLOOM 描述表")
print("     （可选：不改会回退到 sumi 的描述）")
print()

print("  小结：**5 处**，分布在 js（2）+ py（1）+ json（2）")
print()

# ================================================================ 新组件
print("【2】添加一个新组件，需要改哪些地方？")
print()

组件目录 = 根 / "src" / "components"
组件 = sorted([f.stem for f in 组件目录.glob("*.js")])
print("  ① 新增组件文件：src/components/<名>.js")
print("     现有 %d 个：%s" % (len(组件), ", ".join(组件)))
print()

# build.py COMPONENT_FILES
m2 = re.search(r'COMPONENT_FILES\s*=\s*\[(.*?)\]', bp, re.S)
if m2:
    清单2 = re.findall(r'"([^"]+)"', m2.group(1))
    print("  ② 改 src/build/build.py 的 COMPONENT_FILES（%d 项）" % len(清单2))
    print()

# GUI 侧是否要加
js = (根 / "preview" / "gui" / "js" / "app.js").read_text(encoding="utf-8")
# 找组件列表定义
m3 = re.search(r"const 组件库\s*=\s*\[(.*?)\];", js, re.S)
if not m3:
    m3 = re.search(r"COMPONENTS\.(?:filter|map)", js)
print("  ③ GUI 组件库列表：%s" % ("需手工加（在 app.js）" if "组件库" in js else "自动从 COMPONENTS 读"))
print()

print("  小结：**2-3 处**，比主题好一些")
print()

# ================================================================ 关键问题
print("=" * 74)
print("发现的问题")
print("=" * 74)
print()

print("【问题 A】主题需要改 5 处，且分散在 js/py/json")
print("  最易漏的是 build.py 的 BLOOM_FILES —— 漏了那个主题代码不会被注入页面，")
print("  表现为「选了主题但没效果」，而且不报错。")
print()

print("【问题 B】surfaces.js 里有「未登记的主题回退到 sumi」")
print("  这是**兜底**，但也掩盖了「忘记登记」的错误：")
print("  新主题没加 SURFACE 时，不会报错，只是底板颜色用 sumi 的。")
print()

print("【问题 C】组件与主题的注册方式不一致")
print("  组件：COMPONENTS 数组（每项自带 id/name/默认）")
print("  主题：三套独立登记（BLOOM 函数表 / SURFACE 表 / artdirections.json）")
print("  → 主题更容易漏")
print()

# 检查是否有自动发现机制
print("【问题 D】有没有「自动发现」机制？")
for f, 名 in ((根 / "src" / "build" / "build.py", "build.py"),
              (根 / "preview" / "build_gui.py", "build_gui.py")):
    s = f.read_text(encoding="utf-8")
    if "glob" in s or "iterdir" in s:
        print("  %s: 有目录扫描" % 名)
    else:
        print("  %s: 手写清单（无自动发现）" % 名)
