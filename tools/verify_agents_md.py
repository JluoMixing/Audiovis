"""校验 AGENTS.md 里的事实描述。

## 为什么必须校验

AGENTS.md 是新 agent 的**第一份文档**。
如果它写错了，新人会按错的信息行动 —— 比没有文档更糟。

逐条核对：全局名、文件路径、测试数量、命令是否存在。
"""
import json
import pathlib
import re
import subprocess
import sys
import subprocess

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
print("AGENTS.md 事实校验")
print("=" * 70)
print()

a = (根 / "AGENTS.md").read_text(encoding="utf-8")

# ---- 1) 文件路径 ----
print("【1】文档里提到的文件都存在")
路径 = [
    "run.py", "app_server.py", "src/cli.py",
    "src/core/paint.js", "src/core/registry.js", "src/core/surfaces.js",
    "preview/themes/artdirections.json", "preview/gui/js/app.js",
    "preview/build_gui.py", "src/build/build.py",
    "src/bloom/dispatch.js", "packaging/Audiovis.spec",
    "packaging/make_zip.py", "tools/run_tests.py",
    "tools/cleanup_test_browsers.py", "tools/test_parity.mjs",
    "tools/verify_docs_final.py", "docs/INDEX.md",
    "docs/ADD_COMPONENT.md", "docs/ADD_THEME.md",
]
for p in 路径:
    断言(p, (根 / p).exists())

# dist 产物
断言("dist/Audiovis-v1.0.0-win64.zip",
     (根 / "dist" / "Audiovis-v1.0.0-win64.zip").is_file())
print()

# ---- 2) 全局名 ----
print("【2】文档列的全局名确实存在于页面里")
html = (根 / "preview" / "gui_prototype.html").read_text(encoding="utf-8")
全局 = {
    "DATA": r"^\s*const DATA\s*=",
    "P": r"^\s*let P\s*=",
    "TY": r"^\s*let TY\s*=",
    "TR": r"^\s*let TR\s*=",
    "DCOL": r"^\s*let DCOL\s*=",
    "WAVE": r"^\s*const WAVE\s*=",
    "SPEC": r"^\s*const SPEC\s*=",
    "TL": r"^\s*const TL\s*=",
    "SHAPES": r"^\s*const SHAPES\s*=",
}
for 名, pat in 全局.items():
    命中 = re.search(pat, html, re.M) is not None
    断言("全局 %s 存在" % 名, 命中)
print()

# ---- 3) 数量 ----
print("【3】文档里的数字")
组件 = len(list((根 / "src" / "components").glob("*.js")))
断言("组件 12 个（文档说 12）", 组件 == 12, 组件)

ad = json.loads((根 / "preview" / "themes" / "artdirections.json")
                .read_text(encoding="utf-8"))
主题数 = len(ad.get("directions") or {})
断言("主题 12 套（文档说 12）", 主题数 == 12, 主题数)

bloom = len(list((根 / "src" / "bloom" / "themes").glob("*.js")))
断言("bloom 11 个（文档说 12 套主题、11 个 bloom）", bloom == 11, bloom)

测试 = (len(list((根 / "tools").glob("test_*.py"))) +
        len(list((根 / "tools").glob("test_*.mjs"))))
# 文档不写死数字（会随开发变化），只验证「数量合理」
断言("测试数量合理（30-100）", 30 <= 测试 <= 100, 测试)
断言("AGENTS.md 不写死测试数量",
     "48 个正式测试" not in a and "56 个正式测试" not in a)

# tools/_archive/ 已从仓库移除（151 个临时诊断脚本，属开发过程）。
# 文档里也不再提它，故这里断言「不存在」而不是「有 151 个」。
断言("tools/_archive/ 不在仓库里",
     not (根 / "tools" / "_archive").exists())
print()

# ---- 4) 命令 ----
print("【4】文档里的命令可用")
r = subprocess.run([sys.executable, "run.py", "--help"],
                   capture_output=True, text=True, encoding="utf-8",
                   errors="replace", cwd=str(根), timeout=60)
out = (r.stdout or "") + (r.stderr or "")
断言("run.py 支持 --port", "--port" in out)
断言("run.py 支持 --no-open", "--no-open" in out)
断言("run.py 支持 --browser", "--browser" in out)
print()

# ---- 5) 关键约束的描述准确 ----
print("【5】关键约束描述准确")
paint = (根 / "src" / "core" / "paint.js").read_text(encoding="utf-8")
断言("paint.js 有 绘制组件实例", "function 绘制组件实例" in paint)
断言("paint.js 有 绘制布局", "function 绘制布局" in paint)

bp = (根 / "src" / "build" / "build.py").read_text(encoding="utf-8")
断言("build.py 扫目录（_扫主题）", "_扫主题" in bp)
断言("build.py 扫目录（_扫组件）", "_扫组件" in bp)
断言("build.py 不再手写 themes 清单",
     '"themes/sumi.js"' not in bp)

# app.js 里不应再有手写 COMPS 表
appjs = (根 / "preview" / "gui" / "js" / "app.js").read_text(encoding="utf-8")
断言("app.js 的 COMPS 从 COMPONENTS 自动生成",
     "COMPONENTS.forEach" in appjs and "const COMPS = (function" in appjs)
断言("app.js 无手写 COMPS 表",
     "id:'text',      name:'文字'" not in appjs)
print()

# ---- 6) 测试项目路径 ----
print("【6】测试项目路径（不强制存在，仅检查格式）")
for p in ("E:/FL_Project/amapiano/amapiano.flp",
          "E:/FL_Project/nujabes/nujabes.flp",
          "E:/FL_Project/island/island.flp"):
    ok = pathlib.Path(p).is_file()
    print("  %s %s" % ("✓" if ok else "（不存在，可能是别的机器）", p))
print()

print("=" * 70)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 70)
