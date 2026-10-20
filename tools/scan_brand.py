"""任务2：找出所有用户可见的「FL Visualizer」并替换为 Audiovis。

## 原则（用户要求）

只改**显式显示**的地方；文件目录/变量名等用户看不见的**不动**，避免混乱。

## 分类

用户可见：
  · HTML 文本节点、title
  · 窗口标题（应用模式用页面 title）
  · 文案（i18n 语言包）
  · 提示消息、toast
  · 使用说明.txt
  · 导出视频里可能出现的地方（无）

不可见（不动）：
  · 文件名 / 目录名（FLVisualizer.exe、%APPDATA%/FLVisualizer）
  · Python 变量名、模块名
  · 内部注释
  · 打包 spec 里的 name

注意：exe 名与数据目录名保持不变 —— 改名会让已存的设置/工程失效。
"""
import json
import pathlib
import re

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")

print("=" * 74)
print("任务2：扫描用户可见的 FL Visualizer")
print("=" * 74)
print()

# ---- 1) 界面文件 ----
print("【1】界面文件里的出现位置")
目标文件 = [
    "preview/gui/index.html",
    "preview/gui/js/app.js",
    "preview/gui/css/app.css",
    "preview/gui/css/base.css",
    "preview/gui/css/modal.css",
    "preview/gui/i18n/zh.json",
    "preview/gui/i18n/en.json",
]
for f in 目标文件:
    p = 根 / f
    if not p.is_file():
        continue
    s = p.read_text(encoding="utf-8", errors="replace")
    hits = []
    for m in re.finditer(r"FL\s*Visualizer|FL\s*VISUALIZER|FLVisualizer",
                         s, re.I):
        ln = s[:m.start()].count("\n") + 1
        line = s.split("\n")[ln - 1].strip()
        hits.append((ln, m.group(0), line[:80]))
    if hits:
        print("  %s：" % f)
        for ln, 原文, line in hits[:12]:
            print("    L%-4d %-16s %s" % (ln, 原文, line))
        if len(hits) > 12:
            print("    …共 %d 处" % len(hits))
print()

# ---- 2) Python 里的用户可见文案 ----
print("【2】Python 里的用户可见文案")
for f in ("app_server.py", "run.py", "src/settings.py",
          "src/render/render.py", "src/project.py"):
    p = 根 / f
    if not p.is_file():
        continue
    s = p.read_text(encoding="utf-8", errors="replace")
    for m in re.finditer(r'"[^"]*FL\s*Visualizer[^"]*"', s, re.I):
        ln = s[:m.start()].count("\n") + 1
        print("  %s:L%d  %s" % (f, ln, m.group(0)[:80]))
print()

# ---- 3) 使用说明 ----
print("【3】打包说明文件")
zp = 根 / "packaging" / "make_zip.py"
if zp.is_file():
    s = zp.read_text(encoding="utf-8")
    n = len(re.findall(r"FL\s*Visualizer", s, re.I))
    print("  packaging/make_zip.py 里 %d 处（使用说明.txt 的内容）" % n)
print()

# ---- 4) 不该改的（确认它们在哪里）----
print("【4】用户看不见、保持不动的地方")
for f, 说明 in (
        ("packaging/FLVisualizer.spec", "exe 名与打包配置"),
        ("src/settings.py", "配置目录 %APPDATA%/FLVisualizer"),
):
    print("  %-32s %s" % (f, 说明))
