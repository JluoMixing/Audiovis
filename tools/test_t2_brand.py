"""任务2 验证：用户可见处已改名，不可见处保持不动。"""
import json
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


html = (根 / "preview" / "gui_prototype.html").read_text(encoding="utf-8")
zh = json.loads((根 / "preview" / "gui" / "i18n" / "zh.json")
               .read_text(encoding="utf-8"))
en = json.loads((根 / "preview" / "gui" / "i18n" / "en.json")
               .read_text(encoding="utf-8"))

print("=" * 72)
print("任务2 验证：改名 Audiovis")
print("=" * 72)
print()

# ---- 1) 用户可见 ----
print("【1】用户可见处")
断言("页面 title 为 Audiovis", "<title>Audiovis</title>" in html)
断言("欢迎页品牌 AUDIOVIS", "AUDIOVIS" in html)
断言("顶栏品牌 AUDIOVIS", 'class="tbBrand">AUDIOVIS' in html
     or "tbBrand\">AUDIOVIS" in html)
断言("zh app.title", zh.get("app.title") == "Audiovis", zh.get("app.title"))
断言("en app.title", en.get("app.title") == "Audiovis", en.get("app.title"))
断言("zh footerTitle 无旧名",
     "FL Visualizer" not in (zh.get("start.footerTitle") or ""),
     zh.get("start.footerTitle"))
断言("en footerTitle 无旧名",
     "FL Visualizer" not in (en.get("start.footerTitle") or ""),
     en.get("start.footerTitle"))

# 产物里是否还有 FL Visualizer 文本（排除注释与路径）
文本命中 = []
for m in re.finditer(r"FL\s*Visualizer", html, re.I):
    ln = html[:m.start()].count("\n") + 1
    line = html.split("\n")[ln - 1].strip()
    # 排除路径/注释/配置目录
    if any(x in line for x in ("%APPDATA%", "//", "/*", "* ",
                               "settings.json", "FLVisualizer.exe",
                               "flvisualizer")):
        continue
    文本命中.append((ln, line[:80]))
断言("产物无残留旧名（用户可见）", not 文本命中,
     文本命中[:3] if 文本命中 else "")
print()

# ---- 2) 改名已全面完成 ----
print("【2】旧名已清除（产品名统一为 Audiovis）")
# 注：本段在「只改显示文案」阶段是反过来的（断言内部名仍是 FLVisualizer）。
# 现在需求是全部改名，故断言改为「不能再出现旧名」。
# 例外：src/settings.py 与 src/runtime.py 里的 旧名 是数据迁移逻辑，必须保留。
设置源码 = (根 / "src" / "settings.py").read_text(encoding="utf-8")
断言("settings.py 保留迁移用的旧名常量",
     '旧名 = "FLVisualizer"' in 设置源码)

打包源码 = (根 / "packaging" / "make_zip.py").read_text(encoding="utf-8")
断言("exe 名已改为 Audiovis.exe",
     "Audiovis.exe" in 打包源码 and "FLVisualizer.exe" not in 打包源码)
断言("zip 内目录已改为 Audiovis/",
     "Audiovis/使用说明.txt" in 打包源码 and
     "FLVisualizer/使用说明.txt" not in 打包源码)

规格源码 = (根 / "packaging" / "Audiovis.spec").read_text(encoding="utf-8")
断言("spec 里 name=Audiovis",
     'name="Audiovis"' in 规格源码 and 'name="FLVisualizer"' not in 规格源码)
print()

# ---- 3) run.py 启动横幅 ----
print("【3】启动横幅")
run = (根 / "run.py").read_text(encoding="utf-8")
断言("启动横幅为 Audiovis", 'print("  Audiovis")' in run)
断言("自检标题为 Audiovis 自检", "Audiovis 自检" in run)
print()

print("=" * 72)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 72)
sys.exit(1 if 失败 else 0)
