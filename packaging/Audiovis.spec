# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包配置（onedir）。

## 为什么是 onedir 而不是 onefile

用户选的 onedir：
  · 启动快（不用每次解压 100+ MB）
  · 目录结构可见，出问题好排查
  · 打成 zip 分发，用户解压即用

## 打进包里什么

  bundles/node.exe     视频渲染必需（76.8 MB）
  bundles/ffmpeg.exe   编码必需（83.6 MB）
  preview/…            界面、模板、主题、分析缓存
  data/…               示例工程快照
  src/…                渲染页、分析代码（运行时要读 .mjs / .html）

## 不打进包里什么

  · 浏览器（体积与许可都不允许，且系统自带）
  · tools/ 与测试（开发者用）
  · 用户工程（在用户目录）

## 关键点

`src/render/page.html` 与 `capture_v2.mjs` 是**运行时按路径读取**的文件，
不是 import 进来的 —— PyInstaller 的依赖分析看不到它们，必须显式 add-data。
"""
import pathlib
import sys

# SPECPATH 是 spec 文件所在目录（packaging/），项目根在它上一级
根 = pathlib.Path(SPECPATH).resolve().parent

# ---------------------------------------------------------------- 数据文件
数据 = [
    # 界面（构建后的单文件 HTML）
    (str(根 / "preview" / "gui_prototype.html"), "preview"),
    # 界面源与图标（run.py 的增量重建需要模板）
    (str(根 / "preview" / "gui"), "preview/gui"),
    # 模板库与主题
    (str(根 / "preview" / "templates.json"), "preview"),
    (str(根 / "preview" / "themes"), "preview/themes"),
    # 示例工程与分析缓存
    (str(根 / "preview" / ".cache" / "analysis.json"), "preview/.cache"),
    (str(根 / "data" / "projects"), "data/projects"),
    # 构建脚本（动态导入；静态分析看不到，故既作 hiddenimport 也作数据）
    (str(根 / "preview" / "build_gui.py"), "preview"),
    # 界面构建所需的 JS 源码 —— build_gui 用 build.collect() 从磁盘读它们。
    # 不打进去的话 `import build` 会失败，界面无法按会话状态重建。
    (str(根 / "src" / "core"), "src/core"),
    (str(根 / "src" / "app"), "src/app"),
    (str(根 / "src" / "bloom"), "src/bloom"),
    (str(根 / "src" / "components"), "src/components"),
    (str(根 / "src" / "build"), "src/build"),
    # vendored 依赖（FLP 解析）。
    # src/parser/flp.py 是「运行时 sys.path.insert + import pyflp」，
    # 静态分析看不到，必须作为数据打进去。
    #
    # **只打实际包目录**：整个 vendor 里还有 flpdiff-windows-x64.exe
    # （112 MB 的 FLP 对比工具）与各包的 tests/gallery，
    # 那些运行时用不到 —— 全打进去会让体积从 208 MB 涨到 365 MB。
    (str(根 / "research" / "vendor" / "PyFLP" / "pyflp"),
     "research/vendor/PyFLP/pyflp"),
    (str(根 / "research" / "vendor" / "construct" / "construct"),
     "research/vendor/construct/construct"),
    (str(根 / "research" / "vendor" / "construct-typing" / "construct_typed"),
     "research/vendor/construct-typing/construct_typed"),
    (str(根 / "research" / "vendor" / "fastenum" / "fastenum"),
     "research/vendor/fastenum/fastenum"),
    # 渲染页与 CDP 脚本（运行时按路径读，不是 import）
    (str(根 / "src" / "render" / "page.html"), "src/render"),
    (str(根 / "src" / "render" / "capture_v2.mjs"), "src/render"),
]

# 只把真实存在的加进去，缺了要明确报出来（静默缺文件会变成运行时白屏）
校验后 = []
for 源, 目标 in 数据:
    p = pathlib.Path(源)
    if p.exists():
        校验后.append((源, 目标))
    else:
        print("[spec] 警告：数据文件不存在，已跳过：%s" % 源)

# ---------------------------------------------------------------- 外部可执行
def 加外部(源, 名):
    p = pathlib.Path(源)
    if p.is_file():
        return (str(p), "bundles")
    print("[spec] 警告：找不到 %s，该功能在打包版里会不可用" % 名)
    return None

外部 = []
# node：视频渲染
_node = None
for cand in (根 / "bundles" / "node.exe",
             pathlib.Path(r"D:\nodejs\node.exe")):
    if cand.is_file():
        _node = cand
        break
if _node:
    外部.append((str(_node), "bundles"))
    print("[spec] node: %s (%.1f MB)" % (_node, _node.stat().st_size / 1e6))
else:
    print("[spec] 警告：找不到 node.exe，视频导出在打包版里会不可用")

# ffmpeg：**不手动加**。
# PyInstaller 对 imageio_ffmpeg 的 hook 会自动收集它的二进制，
# 再手动加一份会造成 84 MB 重复（实测发生过）。
# runtime.ffmpeg路径() 优先调 imageio_ffmpeg.get_ffmpeg_exe()，能命中收集的那份。
try:
    import imageio_ffmpeg
    _ff = imageio_ffmpeg.get_ffmpeg_exe()
    print("[spec] ffmpeg 由 imageio_ffmpeg hook 自动收集：" + str(_ff))
except Exception as e:
    print("[spec] 警告：imageio_ffmpeg 不可用：" + str(e))

# ---------------------------------------------------------------- 隐藏导入
# 这些是运行时才用到的模块，PyInstaller 的静态分析可能漏掉
隐藏 = [
    # vendored pyflp 的第三方依赖 —— pyflp 从磁盘加载，分析不到它的 import
    "arrow",
    "binascii",
    "bz2",
    "cryptography",
    "gc",
    "lzma",
    "numpy",
    "operator",
    "platform",
    "sortedcontainers",
    "timeit",
    "typing_extensions",
    "build_gui",               # 动态导入，静态分析看不到
    "src.runtime",
    "src.webview_host",        # 函数内 import（app_server._窗口接口），静态分析可能漏
    "src.window",              # 已删除，但旧版本可能引用；加着无害
    "src.render.render",
    "src.audio.analyze",
    "src.audio.stepper",
    "src.audio.drums",
    "src.settings",
    "src.project",
    "src.parser.snapshot",
    "PIL._tkinter_finder",     # 让 PIL 别去拉 tkinter
    "imageio_ffmpeg",
]

# tkinter 只在非 Windows 的回退路径里用；Windows 上不需要（省 10 MB）
排开 = [
    "tkinter",
    "_tkinter",
    "matplotlib",
    "scipy",
    "pandas",
    "pytest",
    "PyQt5",
    "PySide2",
]

# ---- numpy 必须完整收集 ----
# 只靠默认 hook 会得到「磁盘上缺 __init__.py 的 numpy 目录」，
# 它会被当成 namespace package 遮蔽 PYZ 里的完整版本，
# 导致 numpy.__config__ 导入失败（报错文案会误导成「在源码目录运行」）。
from PyInstaller.utils.hooks import collect_all

_np_datas, _np_bins, _np_hidden = collect_all("numpy")


def _非测试(x):
    """过滤掉 numpy 的测试套件 —— 运行时用不到，几十 MB。"""
    t = x if isinstance(x, str) else (x[0] if isinstance(x, (list, tuple)) else str(x))
    return not ("tests" in t.replace("\\", "/").split("/"))


_np_datas = [x for x in _np_datas if _非测试(x[0])]
_np_bins = [x for x in _np_bins if _非测试(x[0])]
_np_hidden = [h for h in _np_hidden if ".tests" not in h and not h.endswith(".tests")]

print("[spec] numpy 完整收集：%d datas / %d binaries / %d hidden（已滤掉 tests）"
      % (len(_np_datas), len(_np_bins), len(_np_hidden)))
校验后 += _np_datas
外部 += _np_bins
隐藏 += _np_hidden

# ---- pywebview（无边框窗口宿主）----
# pywebview 用 WebView2 做窗口，它的 `webview/lib/` 里有：
#   Microsoft.Web.WebView2.Core.dll
#   Microsoft.Web.WebView2.WinForms.dll
#   WebBrowserInterop.x64.dll / .x86.dll
#   runtimes/（WebView2Loader.dll 等）
# 这些是**运行时由 .NET 加载**的，PyInstaller 的静态分析看不到。
# 漏了会表现为「exe 启动后窗口不出现」或「找不到 WebView2」。
#
# 用 collect_all 收集整个包（含 datas / binaries / hiddenimports）。
try:
    _wv_datas, _wv_bins, _wv_hidden = collect_all("webview")
    print("[spec] pywebview 收集：%d datas / %d binaries / %d hidden"
          % (len(_wv_datas), len(_wv_bins), len(_wv_hidden)))
    校验后 += _wv_datas
    外部 += _wv_bins
    隐藏 += _wv_hidden
except Exception as _e:
    print("[spec] 警告：pywebview 收集失败（%s）—— "
          "打包版会退回 Edge --app 模式" % _e)

# ---- numpy 的 BLAS 运行库 ----
# numpy 1.26 的 OpenBLAS 放在 `numpy.libs/` —— 那是 **numpy 包的兄弟目录**，
# 不在包内，故 collect_all("numpy") 扫不到它。
# 缺了它 numpy 会在 `import _multiarray_umath` 时报
# 「DLL load failed … 找不到指定的模块」，而 numpy 又把该异常包成
# 「you should not try to import numpy from its source directory」（误导）。
# 目标目录必须叫 numpy.libs，且与 numpy/ 同级 —— 与源码安装时的布局一致。
_sp = pathlib.Path(sys.executable).resolve().parent / "Lib" / "site-packages"
if not _sp.is_dir():
    _sp = pathlib.Path(sys.executable).resolve().parent / "lib" / "site-packages"
_手动_np_libs = []
for _cand in (_sp / "numpy.libs", _sp / "numpy" / ".libs"):
    if _cand.is_dir():
        for _dll in _cand.glob("*.dll"):
            外部.append((str(_dll), "numpy.libs"))
            _手动_np_libs.append(_dll.name)
if _手动_np_libs:
    print("[spec] numpy.libs：%d 个 DLL %s"
          % (len(_手动_np_libs), _手动_np_libs))
else:
    print("[spec] 警告：找不到 numpy.libs，numpy 在打包版里会导入失败")

a = Analysis(
    [str(根 / "run.py")],
    pathex=[str(根), str(根 / "preview")],
    binaries=外部,
    datas=校验后,
    hiddenimports=隐藏,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=排开,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=None,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=None)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Audiovis",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,              # 不弹控制台窗口
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(根 / "preview" / "gui" / "icon.ico"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="Audiovis",
)
