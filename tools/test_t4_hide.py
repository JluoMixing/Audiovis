"""任务4 验证：隐藏按钮状态与隐藏组件仍可选中。

不依赖 CDP，直接检查代码与数据流。
"""
import pathlib
import re
import sys

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


js = (根 / "preview" / "gui" / "js" / "app.js").read_text(encoding="utf-8")
css = (根 / "preview" / "gui" / "css" / "app.css").read_text(encoding="utf-8")
html = (根 / "preview" / "gui_prototype.html").read_text(encoding="utf-8")

print("=" * 72)
print("任务4 验证：隐藏按钮")
print("=" * 72)
print()

# ---- 1) 按钮文案跟随状态 ----
print("【1】按钮文案跟随状态")
断言("有 prop.show 文案", "prop.show" in js)
断言("btnHide 里调用 渲染属性（更新文案）",
     re.search(r"\$\('btnHide'\)\.onclick[\s\S]{0,400}渲染属性\(\)", js) is not None)
断言("渲染属性 里有更新隐藏按钮的代码",
     "更新隐藏按钮" in js)
断言("按钮文字用 译(隐 ? 'prop.show' : 'prop.hide')",
     "prop.show' : 'prop.hide" in js)
print()

# ---- 2) 隐藏后仍可选中 ----
print("【2】隐藏后仍可选中（不用 display:none）")
# 找渲染画布里的 className 拼接
m = re.search(r"d\.className = 'win'[\s\S]{0,200}", js)
段 = m.group(0) if m else ""
print("    className 拼接：")
for line in 段.split("\n")[:6]:
    print("      " + line.strip()[:80])
断言("className 含 isHidden", "isHidden" in 段)
断言("style 里不再有 display:none（隐藏）",
     "'display:none;' : '')" not in js or "p.hidden ? 'display:none" not in js)
断言("CSS 有 .win.isHidden", ".win.isHidden" in css)
断言("用 opacity:0", re.search(r"\.win\.isHidden\s*\{[^}]*opacity:\s*0", css)
     is not None)
断言("pointer-events:auto（可点击）",
     re.search(r"\.win\.isHidden\s*\{[^}]*pointer-events:\s*auto", css) is not None)
# 只看 .win.isHidden 这条规则内部 —— CSS 别处的 visibility:hidden
# （如 .win.editing canvas）与隐藏组件无关。
_规则 = re.search(r"\.win\.isHidden\s*\{([^}]*)\}", css)
_规则体 = _规则.group(1) if _规则 else ""
断言(".win.isHidden 规则内没有 visibility/display",
     "visibility" not in _规则体 and "display" not in _规则体,
     _规则体.strip()[:60])
print()

# ---- 3) 产物里包含这些改动 ----
print("【3】构建产物")
断言("产物含 isHidden", "isHidden" in html)
断言("产物含 更新隐藏按钮", "更新隐藏按钮" in html)
断言("产物含 .win.isHidden 样式",
     ".win.isHidden" in html)
print()

# ---- 4) 导出仍会跳过隐藏组件 ----
print("【4】导出时隐藏组件不出现")
断言("导出收集组件时过滤 hidden",
     re.search(r"放置\.filter\(p => !p\.hidden\)\.map", js) is not None)
print()

print("=" * 72)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 72)
sys.exit(1 if 失败 else 0)
