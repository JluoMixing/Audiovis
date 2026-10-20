"""清理 out/ —— 只留有用的产物，删掉渲染临时目录。

## out/ 的构成（956 MB）

    render_*   600+ 个   每个含完整页面副本 + 布局 JSON（1-4 MB）
    session_*  300+ 个   同上
    pybuild/             PyInstaller 中间产物 24.5 MB
    smoke/               冒烟测试 16 MB
    work_nujabes/        旧工程工作区 4.5 MB
    components/          36 张组件渲染图 4.1 MB  ← **保留**
    *.mp4                测试视频 151 MB
    *.png                抽帧 16.5 MB
    *.html               预览页 576 MB（含内嵌 base64 图）

## 保留什么

  · `out/components/`          —— 三套主题的全组件渲染图（预览页需要）
  · `out/three_themes_components.html` —— 预览页（最终交付物之一）
  · 顶层几个关键抽帧（sumi/risograph/blueprint/wh_soft/chrome_freak/nuclear）

## 删什么

  · 所有 `render_*` / `session_*` 目录（临时，可重新生成）
  · `pybuild/`（PyInstaller 中间产物）
  · `smoke/` / `work_nujabes/` / `layouts/` / `pairempty/` 等
  · 其它 mp4（测试视频）
  · 其它 png（中间抽帧）
  · 其它 html（旧预览页）

## 安全

删之前先统计，删之后报告释放了多少。
"""
import pathlib
import shutil

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
out = 根 / "out"

# ---- 保留清单 ----
保留文件 = {
    "three_themes_components.html",     # 全组件预览页（最终交付物）
}
保留前缀 = ("old_", "chk_", "t_", "fix", "exe_", "reg_", "exe_wh_soft")
保留目录 = {"components"}

print("=" * 70)
print("清理 out/")
print("=" * 70)
print()

前 = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
print("清理前: %.0f MB / %d 个文件"
      % (前 / 1e6, sum(1 for f in out.rglob("*") if f.is_file())))
print()

删目录 = []
删文件 = []
保留 = []

for item in out.iterdir():
    if item.is_dir():
        if item.name in 保留目录:
            保留.append(item.name + "/")
            continue
        删目录.append(item)
    else:
        if item.name in 保留文件:
            保留.append(item.name)
            continue
        # 保留关键抽帧
        if item.suffix == ".png" and item.name.startswith(保留前缀):
            保留.append(item.name)
            continue
        删文件.append(item)

print("保留 %d 项：" % len(保留))
for x in 保留[:20]:
    print("  " + x)
if len(保留) > 20:
    print("  …")
print()

print("删除 %d 个目录 + %d 个文件" % (len(删目录), len(删文件)))
for d in 删目录:
    try:
        shutil.rmtree(d)
    except Exception as e:
        print("  ✗ %s: %s" % (d.name, e))
for f in 删文件:
    try:
        f.unlink()
    except Exception as e:
        print("  ✗ %s: %s" % (f.name, e))

后 = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
剩 = sum(1 for f in out.rglob("*") if f.is_file())
print()
print("清理后: %.0f MB / %d 个文件" % (后 / 1e6, 剩))
print("释放: %.0f MB" % ((前 - 后) / 1e6))
print()

# 复查保留项还在
print("=== 保留项复查 ===")
for x in ("components", "three_themes_components.html"):
    p = out / x
    print("  %-32s %s" % (x, "✓" if p.exists() else "✗ 丢了"))
n = len(list((out / "components").glob("*.png"))) if (out / "components").is_dir() else 0
print("  components/ 里 %d 张图" % n)
