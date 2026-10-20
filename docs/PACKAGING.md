# 打包分发说明

## 产物

| 文件 | 说明 | 大小 |
|---|---|---|
| `dist/FLVisualizer/` | onedir 产物（957 个文件） | 266.8 MB |
| `dist/FLVisualizer-win64.zip` | 分发用压缩包 | **100.4 MB** |

zip 里除程序本体外还带一份 `使用说明.txt`（启动方式、系统要求、
文件位置、自查方法、许可）。

## 怎么构建

```bash
# 1) 构建界面（模板改动后必须做）
python preview/build_gui.py

# 2) 打包
python -m PyInstaller packaging/FLVisualizer.spec --noconfirm --clean

# 3) 打 zip
python packaging/make_zip.py
```

构建前先结束残留进程（`dist/` 里的 exe 或 Edge 占着文件会导致
`PermissionError: 拒绝访问`）：

```powershell
Get-Process FLVisualizer,msedge -ErrorAction SilentlyContinue | Stop-Process -Force
```

## zip 里包含什么

```
FLVisualizer/
  FLVisualizer.exe            入口（3–6 MB）
  使用说明.txt
  bundles/node.exe            视频渲染（76.8 MB）
  imageio_ffmpeg/binaries/    ffmpeg（83.6 MB）
  numpy/ + numpy.libs/        numpy 及其 BLAS（53 MB）
  preview/                    界面、模板、主题、分析缓存
  data/                       示例工程快照
  src/                        渲染页、CDP 脚本、界面源码、build.py
  research/vendor/            FLP 解析库（pyflp 等 4 个包，需自行获取，见 VENDOR_VERSIONS.md）
```

## 外部依赖

| 依赖 | 能否打包 | 说明 |
|---|---|---|
| Microsoft Edge / Chrome | ❌ | 视频导出靠它逐帧渲染 Canvas。Win10/11 自带 Edge |
| 字体 | ❌ | 主题用系统字体（Inter/Gelasio 有 fallback），
不同机器字形可能微差 |

## 打包时踩过的坑（都已修，记录以便回溯）

### 1. `build_gui` 动态导入

`run.py` 用 `importlib.import_module("build_gui")` 加载构建模块，
PyInstaller 的静态分析看不到 → `ModuleNotFoundError`。

修：`build_gui` 进 hiddenimports + 作数据文件；同时 `run.py` 在
导入失败时回退「直接用随包分发的产物」。

### 2. `import build` 撞名

`build_gui.py` 里 `import build`（指 `src/build/build.py`），
但 `build` 是极常见的名字，打包后命中了别的模块，报
`module 'build' has no attribute 'collect'`。

修：改用 `importlib.util.spec_from_file_location("flv_build", 路径)`
按文件路径加载，不依赖 sys.path 猜名字。

### 3. numpy 导入失败（最耗时的一个）

报错是：

```
ImportError: Error importing numpy: you should not try to import numpy from
        its source directory; please exit the numpy source tree...
```

**这个报错是误导的。** 真实原因分两层：

- 表层：`numpy.__config__` 导入失败
- 真实：`numpy.core._multiarray_umath` 报
  `DLL load failed … 找不到指定的模块`

根因是 **OpenBLAS 运行库没打进去**。numpy 1.26 的 OpenBLAS 在
`site-packages/numpy.libs/` —— 那是 **numpy 包的兄弟目录**，
`collect_all("numpy")` 只扫包内，扫不到。

修：
- `collect_all('numpy')` 让磁盘上的 numpy 成为完整包
  （否则只有 `.pyd`、缺 `__init__.py`，会被当成 namespace package
  遮蔽 PYZ 里的完整版本）
- 显式把 `numpy.libs/*.dll` 复制到 `dist/numpy.libs/`（与源码布局一致）
- 过滤掉 numpy 的 tests 子模块（几十 MB，运行时用不到）

### 4. `pyflp` 及其依赖

`src/parser/flp.py` 是「运行时 `sys.path.insert` 再 `import pyflp`」，
静态分析完全看不到。故：

- 把 `research/vendor` 下 4 个包的实际目录打进包
- 把 pyflp 的第三方依赖（`sortedcontainers`、`arrow`、`cryptography`、
  `typing_extensions`）加进 hiddenimports

注意：**不要**整个 `research/vendor` 打进去 —— 里面有
`flpdiff-windows-x64.exe`（112 MB 的 FLP 对比工具），
实测让体积从 208 MB 涨到 365 MB。

### 5. ffmpeg 定位

`imageio_ffmpeg.get_ffmpeg_exe()` 在冻结版里返回不存在的路径
（它靠 `__file__` 推导包目录，而模块在 PYZ 里）。

修：`runtime.ffmpeg路径()` 加显式兜底 glob；
`render.py` 的 `_找ffmpeg()` 改为统一走它，避免两处分叉。

### 6. 文件对话框用 `sys.executable`

原实现 `subprocess.run([sys.executable, "-c", 脚本, kind])`。
冻结后 `sys.executable` 是 exe，会重启一个实例而不是弹对话框。

修：改 `ctypes` 调 `comdlg32.GetOpenFileNameW/GetSaveFileNameW`。
顺带省掉打包 tkinter（约 10 MB）。
实测 `OPENFILENAMEW` 结构体 152 字节，与 Win32 定义一致。

### 7. 浏览器 profile 写在 exe 旁边

应用模式的 `--user-data-dir` 原来用 `根/.appdata`。
装到 `Program Files` 后那里只读；而且会弄脏 `dist/`，
实测导致下次构建 `PermissionError: 拒绝访问`。

修：改用 `%LOCALAPPDATA%/FLVisualizer/appdata`。

### 8. 自检在无控制台下看不见

`console=False` 的窗口版里 `sys.stdout is None`，`print()` 静默返回
（不抛异常），所以"用 try/except print 判断有没有控制台"永远为真。

修：`--selftest` **总是**把报告写到
`%LOCALAPPDATA%/FLVisualizer/selftest.txt`，
只在 `sys.stdout is None` 时自动用记事本打开。

## 验证方式

不能只看「构建成功」。实际验证分三层：

### 1. 成品自检

```
FLVisualizer.exe --selftest
```

检查依赖模块、项目模块、外部可执行（node/ffmpeg/浏览器）、资源文件。
结果写 `%LOCALAPPDATA%/FLVisualizer/selftest.txt`。

### 2. 端到端（`tools/test_exe_e2e.py`，14 项）

启动 exe → 取页面 → 导入真实 FLP+音频 → 提交渲染 → 核验 mp4 可解码。

这一步同时考验 `node.exe`、`ffmpeg`、系统浏览器三个环节。

### 3. 布局生效（`tools/test_exe_layout.py`，6 项）

用「只在右下角放一小块」的布局渲染，抽帧后测量：
左上区域接近纯背景（std < 6），右下区域有内容（std > 8）。

**这一项很重要**：前一层只证明「视频出来了」，
但那时我的请求参数用错了键（用了 `布局.组件` 而不是顶层 `组件`），
渲染用了兜底布局也能出片 —— 是这一层才证明「用户的布局被尊重」。

### 4. 解压到全新位置再跑

把 zip 解压到 `D:\flv_dist_test` 后重跑上面三层，
确认不依赖构建目录。全部通过。

## 已知限制

- **需要 Edge 或 Chrome**：无法打包，是渲染方案的基础。
- **字体微差**：主题里 `Inter` / `Gelasio` 非 Windows 标配，有 fallback。
- **体积 100 MB**：主要来自 ffmpeg 83.6 MB + node 76.8 MB + numpy 53 MB。
  三者都可以再优化（例如改用系统已有的 ffmpeg），但会引入外部依赖。
- **启动约 1–2 秒**：onedir 无需解压，主要是 Python 与 numpy 初始化。
