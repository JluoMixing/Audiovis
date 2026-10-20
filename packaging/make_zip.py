"""把 onedir 产物打成可分发的 zip。

## 内容

    FLVisualizer/
      FLVisualizer.exe      双击启动
      bundles/node.exe      视频渲染
      imageio_ffmpeg/...    ffmpeg
      preview/ data/ src/   界面与资源
      research/vendor/...   FLP 解析库

## 附带说明文件

zip 里放一份 `使用说明.txt`，写清：
  · 怎么启动
  · 需要 Edge/Chrome（系统自带）
  · 设置与工程文件存在哪
  · 出问题怎么自查（--selftest）

用户拿到 zip 不该还要来问我们怎么用。

## 为什么用 zip 而不是安装程序

用户选的是 onedir + zip：解压即用、无需安装权限、
卸载就是删文件夹。做安装程序还要额外处理快捷方式与卸载登记。
"""
import pathlib
import subprocess
import sys
import time
import zipfile

根 = pathlib.Path(__file__).resolve().parent.parent
源 = 根 / "dist" / "FLVisualizer"
输出 = 根 / "dist" / "FLVisualizer-win64.zip"

if not (源 / "FLVisualizer.exe").is_file():
    print("✗ 找不到 dist/FLVisualizer/FLVisualizer.exe，请先构建")
    sys.exit(1)

说明 = """Audiovis
================

FL Studio 工程的音乐可视化工具。导入 .flp 与混音音频，
在画布上排布组件，导出成视频。


启动
----

双击 FLVisualizer.exe


首次使用
--------

1. 把 .flp 和音频一起拖进窗口（或点两个卡片分别选文件）
   · 用对话框选 FLP 时会自动带出同目录同名音频
2. 进入编辑器，从左侧拖组件或套用模板
3. 底栏「导出视频」

按 ? 查看全部快捷键。


系统要求
--------

· Windows 10 / 11（64 位）
· 需要本机装有 Microsoft Edge 或 Google Chrome
  视频导出靠它逐帧渲染画面。Windows 10/11 自带 Edge，通常不用另外装。


文件存在哪
----------

设置与缓存：%APPDATA%\\FLVisualizer\\settings.json
             %LOCALAPPDATA%\\FLVisualizer\\
工程文件：  默认在「文档\\FLVisualizer\\Projects」，保存时可另选


出问题怎么办
------------

在命令行里运行：

    FLVisualizer.exe --selftest

它会检查依赖、外部程序与资源文件，并把报告写到：

    %LOCALAPPDATA%\\FLVisualizer\\selftest.txt

（窗口版没有控制台，所以报告写文件并自动用记事本打开）

常见情况：
· 导出报「找不到 Node.js」        → 程序不完整，重新解压
· 导出报「找不到 ffmpeg」         → 同上
· 导出报「找不到浏览器」          → 装 Edge 或 Chrome
· 导入报「FLP 解析失败」          → 该 .flp 版本可能不受支持


许可
----

本项目以 GPL-3.0 发布。
内置的 PyFLP（FLP 解析）为 GPL-3.0，与本项目兼容。
"""


def 主():
    print("=" * 70)
    print("打包分发 zip")
    print("=" * 70)
    print()

    总 = sum(f.stat().st_size for f in 源.rglob("*") if f.is_file())
    文件数 = sum(1 for f in 源.rglob("*") if f.is_file())
    print("  源目录：%s" % 源)
    print("  %d 个文件，%.1f MB" % (文件数, 总 / 1e6))
    print()

    if 输出.exists():
        输出.unlink()

    print("  压缩中（%d 个文件，需要一两分钟）…" % 文件数)
    t0 = time.time()

    with zipfile.ZipFile(输出, "w", zipfile.ZIP_DEFLATED,
                         compresslevel=6) as z:
        # 说明文件放在 zip 根，用户解压先看到
        z.writestr("FLVisualizer/使用说明.txt",
                   说明.encode("utf-8"))
        for f in sorted(源.rglob("*")):
            if not f.is_file():
                continue
            z.write(f, "FLVisualizer/" + str(
                f.relative_to(源)).replace("\\", "/"))

    耗时 = time.time() - t0
    大小 = 输出.stat().st_size
    print()
    print("  完成，耗时 %.0f 秒" % 耗时)
    print("  %s" % 输出)
    print("  %.1f MB（压缩前 %.1f MB，压缩率 %.0f%%）"
          % (大小 / 1e6, 总 / 1e6, 大小 / 总 * 100))
    print()

    # 自检 zip 完整性
    print("  校验 zip…")
    with zipfile.ZipFile(输出) as z:
        坏 = z.testzip()
        if 坏:
            print("  ✗ 损坏条目：%s" % 坏)
            return 1
        名单 = z.namelist()
        print("  ✓ %d 个条目，无损坏" % len(名单))
        for 必须 in ("FLVisualizer/FLVisualizer.exe",
                     "FLVisualizer/使用说明.txt",
                     "FLVisualizer/bundles/node.exe"):
            ok = 必须 in 名单
            print("  %s %s" % ("✓" if ok else "✗", 必须))
            if not ok:
                return 1
    return 0


if __name__ == "__main__":
    sys.exit(主())
