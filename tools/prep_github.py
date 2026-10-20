"""准备 GitHub 发布：清理工作区到「最终成品」状态。

## 保留

  src/                  产品源码
  preview/gui/          界面源
  preview/themes/       12 套主题
  preview/build_gui.py  界面构建
  preview/design_templates.py + templates.json
  data/schema/          Schema 契约
  packaging/            打包配置
  docs/                 5 个保留文档
  tools/                测试与工具（不含 _archive）
  根目录文件

## 删除

  research/             开发过程记录（备份在 G 盘）
  preview/_archive/     旧版界面产物
  preview/gui_prototype.html   构建产物
  preview/gui_legacy.html      旧界面
  preview/gui_v2_template.html 旧模板
  tools/_archive/       临时诊断脚本
  .testtml/             Edge 缓存（误提交）
  docs/_history/        历史文档
  docs/GUI_DONE.md      阶段报告
  docs/GPU_AND_HARDWARE.md  调研报告
  docs/PERF_AUDIT.md    内部审计
  data/projects/        示例快照（用户不要）

## 安全

删除前先确认备份存在。
"""
import pathlib
import shutil

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
备份 = pathlib.Path(r"G:\FL_VISUAL_TEST_backup_2026-10-20")

# ---- 安全检查 ----
if not 备份.is_dir():
    raise SystemExit("✗ 备份不存在，拒绝删除：%s" % 备份)
if not (备份 / ".git").is_dir():
    raise SystemExit("✗ 备份里没有 .git，拒绝删除")

print("=" * 70)
print("准备 GitHub 发布：清理工作区")
print("=" * 70)
print()
print("备份确认：%s" % 备份)
print()

# ---- 要删的目录 ----
删目录 = [
    "research",
    "preview/_archive",
    "tools/_archive",
    ".testtml",
    "docs/_history",
    "data/projects",
]

# ---- 要删的文件 ----
删文件 = [
    "preview/gui_prototype.html",
    "preview/gui_legacy.html",
    "preview/gui_v2_template.html",
    "docs/GUI_DONE.md",
    "docs/GPU_AND_HARDWARE.md",
    "docs/PERF_AUDIT.md",
]

前大小 = 0
前文件 = 0
for p in (根.rglob("*")):
    if p.is_file() and ".git" not in p.parts and "dist" not in p.parts:
        前大小 += p.stat().st_size
        前文件 += 1
print("清理前：%.0f MB / %d 个文件（不含 .git / dist）" % (前大小 / 1e6, 前文件))
print()

print("删除目录：")
for d in 删目录:
    p = 根 / d
    if p.is_dir():
        n = sum(1 for f in p.rglob("*") if f.is_file())
        s = sum(f.stat().st_size for f in p.rglob("*") if f.is_file())
        try:
            shutil.rmtree(p)
            print("  ✓ %-28s %4d 个  %6.1f MB" % (d, n, s / 1e6))
        except Exception as e:
            print("  ✗ %-28s %s" % (d, e))
    else:
        print("  - %-28s （不存在）" % d)

print()
print("删除文件：")
for f in 删文件:
    p = 根 / f
    if p.is_file():
        s = p.stat().st_size
        try:
            p.unlink()
            print("  ✓ %-36s %6.2f MB" % (f, s / 1e6))
        except Exception as e:
            print("  ✗ %-36s %s" % (f, e))
    else:
        print("  - %-36s （不存在）" % f)

后大小 = 0
后文件 = 0
for p in (根.rglob("*")):
    if p.is_file() and ".git" not in p.parts and "dist" not in p.parts:
        后大小 += p.stat().st_size
        后文件 += 1

print()
print("清理后：%.0f MB / %d 个文件" % (后大小 / 1e6, 后文件))
print("减少：%.0f MB / %d 个文件" % ((前大小 - 后大小) / 1e6, 前文件 - 后文件))
print()

# ---- 列出保留的目录 ----
print("=" * 70)
print("保留的目录")
print("=" * 70)
for d in sorted(根.iterdir()):
    if not d.is_dir() or d.name.startswith(".") and d.name != ".gitignore":
        continue
    if d.name in ("dist", "out", "build", "__pycache__"):
        continue
    n = sum(1 for f in d.rglob("*") if f.is_file()
            and "__pycache__" not in f.parts)
    s = sum(f.stat().st_size for f in d.rglob("*") if f.is_file()
            and "__pycache__" not in f.parts)
    print("  %-14s %4d 个  %7.2f MB" % (d.name, n, s / 1e6))
