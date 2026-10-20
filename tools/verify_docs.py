"""验证两份文档里的事实描述是否准确。"""
import json
import pathlib
import re

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
通过 = 0
失败 = 0


def 断言(名, 条件, 详情=""):
    global 通过, 失败
    if 条件:
        通过 += 1
        print("  ✓ " + 名)
    else:
        失败 += 1
        print("  ✗ " + 名 + ("  → " + str(详情) if 详情 else ""))


print("=" * 70)
print("文档事实校验")
print("=" * 70)
print()

# ---- 文档 1：组件 ----
print("【1】ADD_COMPONENT.md 的事实")
注册表 = (根 / "src" / "core" / "registry.js").read_text(encoding="utf-8")
断言("register 校验 id/name/w/h/draw",
     "const need = ['id', 'name', 'w', 'h', 'draw']" in 注册表
     or "['id', 'name', 'w', 'h', 'draw']" in 注册表)

bp = (根 / "src" / "build" / "build.py").read_text(encoding="utf-8")
断言("build.py 有 COMPONENT_FILES",
     "COMPONENT_FILES" in bp)
断言("build.py 有 BLOOM_FILES", "BLOOM_FILES" in bp)

js = (根 / "preview" / "gui" / "js" / "app.js").read_text(encoding="utf-8")
断言("COMPS 已从 COMPONENTS 自动生成",
     "COMPONENTS.forEach" in js and "const COMPS = (function" in js)
断言("app.js 里没有手写 COMPS 表",
     "id:'text',      name:'文字'" not in js)

paint = (根 / "src" / "core" / "paint.js").read_text(encoding="utf-8")
断言("paint.js 支持无 w/h 时调 测量",
     "spec.测量" in paint and "Object.assign({}, item" in paint)
断言("paint.js 有 绘制布局", "function 绘制布局" in paint)
print()

# ---- 文档 2：主题 ----
print("【2】ADD_THEME.md 的事实")
sf = (根 / "src" / "core" / "surfaces.js").read_text(encoding="utf-8")
断言("surfaces.js 有回退到 sumi",
     "SURFACE[activeThemeKey()] || SURFACE.sumi" in sf)

dp = (根 / "src" / "bloom" / "dispatch.js").read_text(encoding="utf-8")
断言("dispatch.js 有回退到 sumi",
     "BLOOM[themeKey] || BLOOM.sumi" in dp)

ad = json.loads((根 / "preview" / "themes" / "artdirections.json")
                .read_text(encoding="utf-8"))
断言("artdirections.json 有 directions", "directions" in ad)
断言("artdirections.json 有 order", "order" in ad)
一项 = list(ad["directions"].values())[0]
断言("主题含 id/name/subtitle/palette/type",
     all(k in 一项 for k in ("id", "name", "subtitle",
                             "palette", "type")))
断言("palette 有 8 个色",
     len(一项["palette"]) == 8, len(一项["palette"]))

断言("app.js 的 THEMES 从 DIRECTIONS.order 生成",
     "(DIRECTIONS.order || [])" in js)

主题文件 = sorted([f.stem for f in (根 / "src" / "bloom" / "themes")
                   .glob("*.js")])
断言("现有主题数 8", len(主题文件) == 8, 主题文件)
断言("文档提到的 8 个主题都存在",
     all(x in 主题文件 for x in
         ("sumi", "blueprint", "longexposure", "construct",
          "tape", "staratlas", "weave", "risograph")),
     主题文件)
print()

# ---- 文档 3：sFill 等函数存在 ----
print("【3】文档里引用的函数确实存在")
断言("surfaces.js 有 sFill", "function sFill" in sf)
断言("surfaces.js 有 sStroke", "function sStroke" in sf)
断言("surfaces.js 有 sMark", "function sMark" in sf)
断言("surfaces.js 有 sGrid", "function sGrid" in sf)

t = (根 / "src" / "components" / "text.js").read_text(encoding="utf-8")
断言("text.js 有 测量", "测量: function" in t)
print()

# ---- 文档 4：两份文档存在 ----
print("【4】文档文件")
断言("docs/ADD_COMPONENT.md 存在",
     (根 / "docs" / "ADD_COMPONENT.md").is_file())
断言("docs/ADD_THEME.md 存在",
     (根 / "docs" / "ADD_THEME.md").is_file())
print()

print("=" * 70)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 70)
