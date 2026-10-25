# AGENTS.md —— 给 AI Agent 的项目入口

> **如果你是新接手这个项目的 agent，先读完这一页。**
> 它包含：项目是什么、怎么跑、关键约束（踩过的坑）、改代码前必须知道的事。
>
> 详细文档见 `docs/INDEX.md`。最后核对：2026-10-20（v1 打包后）。

---

## 1. 项目是什么

**Audiovis** —— 为 FL Studio Beat 制作人生成展示视频的 Windows 桌面应用。

**核心差异**：不是屏幕录制、不是素材拼接、不是普通频谱可视化，
而是**理解工程结构**：读取 FLP 的 Playlist / Pattern / Clip / Note，
与音频同步渲染成视频。

**当前状态**：全部阶段完成，已打包 v1（`dist/Audiovis-v1.0.0-win64.zip`，97.6 MB）。

---

## 2. 怎么跑

### 环境（这台机器已验证）

| 项 | 值 |
|---|---|
| Python | 3.9.5 · `D:\Program Files\Python39\python.exe` |
| Node | v22.11.0 · `D:\nodejs\node.exe` |
| 浏览器 | Edge（系统自带） |
| 系统 | Windows 10 x64 |

### 启动应用

```powershell
python run.py                      # 起服务 + 打开窗口（pywebview 无边框）
python run.py --port 11000         # 指定端口
python run.py --no-open            # 只起服务，不开窗口（调试用）
python run.py --browser            # 用默认浏览器打开标签页
```

### 命令行渲染（不用界面）

```powershell
python src\cli.py render --flp 工程.flp --audio 混音.mp3 --out 输出.mp4 `
    --theme sumi --layout 布局.json
```

### 跑测试

```powershell
python tools\run_tests.py                  # 全部（约 10 分钟）
python tools\run_tests.py test_gui test_parity    # 指定几个
python tools\run_tests.py --server 11000   # 指定服务端口给需要服务的测试
```

**注意**：`run_tests.py` 没有 `--help`，参数是手工解析的。

### 打包

```powershell
python -m PyInstaller packaging\Audiovis.spec --noconfirm --clean `
    --distpath dist --workpath out\pybuild
python packaging\make_zip.py               # 打 zip 并校验
```

全量打包约 6 分钟。**只改 JS/CSS 不需要重新打包** ——
界面在启动时从磁盘重建（`preview/build_gui.py`，0.5 秒）。

---

## 3. 架构速览

```
浏览器（GUI）                本地服务（app_server.py）        渲染管线
────────────                ────────────────────────        ────────
拖拽 / 属性 / 模板    ──►    /api/import   解析 FLP+音频   ──►  src/parser
点「导出视频」        ──►    /api/render   写 layout.json  ──►  src/audio
                             /api/job      进度轮询              src/render
```

### 数据流

```
FLP 工程 ──→ Parser ──→ project_snapshot.json ──┐
                     （稳定 Schema，只保留 PPQ）  ├─→ 渲染 ─→ mp4
音频文件 ──→ 音频分析（波形/频谱/onset/鼓组）────┘
```

### 渲染管线（关键）

```
Python 写 layout.json
  ↓
Node（capture_v2.mjs）通过 CDP 驱动无头 Edge
  ↓
页面加载 → 逐帧渲染 → canvas.toDataURL → HTTP POST 回传二进制
  ↓
Python 用 imageio-ffmpeg 编码 mp4
```

**并行度 4 最优**（实测）。

### 关键文件

| 文件 | 作用 |
|---|---|
| `run.py` | 启动器（依赖检查 → 建界面 → 起服务 → 开窗口） |
| `app_server.py` | HTTP 服务（路由、会话、导入/渲染调度） |
| `src/core/paint.js` | **`绘制组件实例()` / `绘制布局()`** —— GUI 与导出共用 |
| `src/core/registry.js` | `register()` 与 `COMPONENTS` |
| `src/core/surfaces.js` | 各主题质感（`fill`/`stroke`/`mark`/`grid`） |
| `src/bloom/themes/*.js` | 各主题的音符落点（`BLOOM.<名>`） |
| `preview/themes/artdirections.json` | **12 套主题定义（视觉的唯一真相源）** |
| `preview/gui/js/app.js` | GUI 主逻辑（约 3200 行） |

---

## 4. 关键约束（都是踩过的坑）

### ⚠️ 4.1 绝不无差别杀浏览器进程

本项目大量用无头 Edge 做渲染与测试，会留残留进程。
**清理必须精确识别**，否则会关掉用户正在用的浏览器。

```powershell
# 正确：只清理带已知临时 profile 的进程（默认 dry-run）
python tools\cleanup_test_browsers.py
python tools\cleanup_test_browsers.py --kill

# 禁止
Stop-Process chrome
Get-Process msedge | Stop-Process
taskkill /IM chrome.exe /F
```

判定规则：只有命令行带 `--user-data-dir` 且匹配
`tools/cleanup_test_browsers.py` 里登记的已知前缀的进程才可杀。

### ⚠️ 4.2 预览与导出必须共用同一处绘制实现

`src/core/paint.js` 的 `绘制组件实例()` 是**唯一**绘制入口。
GUI 预览与视频导出都调它。

**不要为导出另写一套** —— 否则会出现「界面调好的效果导出后拿不到」。
`tools/test_parity.mjs` 逐像素比对守住这条。

### ⚠️ 4.3 全局变量命名前必须搜一遍

项目里已有这些全局名，**不要复用**：

```
DATA      数据对象（audio / timeline / patterns …）
P         当前主题色板
TY        字体
TR        treatment
DCOL      数据色（data / data2 / data3）
WAVE      波形数据
SPEC      频谱数据
TL        timeline
SHAPES    patternShapes
```

**真实事故**：曾把数据色变量命名为 `DATA`，与已有的
`const DATA = {...}` 冲突 → 重复声明 → SyntaxError →
整个脚本不执行 → 所有渲染失败「页面未就绪」。

### ⚠️ 4.4 组件与主题的数据只写一次

组件的 `name` / `w` / `h` / `group` **只在 `register()` 里写**。
主题的色板只在 `artdirections.json` 里写。

**真实事故**：`app.js` 里曾有手写的 `COMPS` 表与 `register()` 重复，
漂移 4 项（vectorscope 名字、brightness/transient/transport 尺寸），
导致拖进画布的组件尺寸错误。已改为从 `COMPONENTS` 自动生成。

### ⚠️ 4.5 构建清单扫目录，不手写

`src/build/build.py` 的 `BLOOM_FILES` / `COMPONENT_FILES` 由目录扫描生成。
**新增文件自动被发现**，不需要改清单。

若改回手写，漏登记会**静默失败**（主题没效果、组件看不到），不报错。

### ⚠️ 4.6 渲染的起点必须在音频长度内

**真实事故**：某工程音频只有 39.6 秒，工程总长 211.7 秒。
静帧起点设 48 秒 → 频谱/波形/响度全空，但渲染"成功"。

测试或调试渲染时，起点要小于音频时长。

---

## 5. 加新东西

### 加组件（3 步）

1. 新建 `src/components/<名>.js`，调 `register({ id, name, w, h, group, 绘制 })`
2. `python preview/build_gui.py`
3. 打开界面，组件库应出现

详见 `docs/ADD_COMPONENT.md`。

### 加主题（4 步）

1. 新建 `src/bloom/themes/<名>.js`（`BLOOM.<名>`）
2. `src/core/surfaces.js` 加 `SURFACE.<名>`（`fill`/`stroke`/`mark`/`grid`）
3. `preview/themes/artdirections.json` 加主题定义（含 `order`）
4. `src/bloom/dispatch.js` 加描述文案

详见 `docs/ADD_THEME.md`。

**注意**：第 2、4 步漏了会**静默回退到 sumi**，不报错。

---

## 6. 测试

### 数量

正式测试在 `tools/test_*.py` 与 `tools/test_*.mjs`（约 50 个，随时会增）。
（`tools/_archive/` 的临时诊断脚本已从仓库移除，仍在 git 历史里。）

**查当前数量**：

```powershell
(Get-ChildItem tools -Filter 'test_*').Count
```

### 分类

| 类型 | 例子 | 需要服务 |
|---|---|---|
| 纯逻辑 | `test_window_robust.py` | 否 |
| 界面交互（file://） | `test_interaction.mjs` `test_gui.mjs` | 否 |
| 需要服务 | `test_parity.mjs` `test_export_params.mjs` | 是（`--server`） |
| 端到端 | `test_acceptance.py` `test_exe_e2e.py` | 是 |

### 什么时候跑全量

| 场景 | 跑什么 |
|---|---|
| 改一个模块 | 只跑该模块的测试 |
| 改共享核心（`paint.js` / `data.js` / `canvas-kit.js`） | 相关模块 + `test_parity` |
| 删/改 DOM 元素或接口 | **跑全量**（会影响别的测试的假设） |
| 打包前 | 全量 |

---

## 7. 已知边界

### 不做

- Automation Clip 的完整解析与可视化
- Channel → Mixer Track 映射
- Mixer / Plugin Chain 视图
- 实时音频驱动渲染（只做离线）

### 未验证

- 只测过 **FL Studio 21.1.1.3750**、PPQ 96 的工程
- 未测其他 FL Studio 版本与更复杂结构
- 只在 Windows 上跑过

### 测试项目（本机）

```
E:\FL_Project\amapiano\amapiano.flp + .mp3   （音频 39.6s，工程 211.7s）
E:\FL_Project\nujabes\nujabes.flp + .mp3     （266s，PPQ 96，21 patterns）
E:\FL_Project\island\island.flp              （165.9s 工程，80.56s 音频）
```

---

## 8. 常见问题

| 症状 | 原因 | 修法 |
|---|---|---|
| 页面空白 / 渲染「页面未就绪」 | 页面 JS 报错（多半是全局名冲突） | 用 CDP 抓 `Runtime.exceptionThrown` |
| 主题没效果 | 漏 `BLOOM_FILES` 或 `SURFACE.<名>` | 检查文件是否在目录里 |
| 组件库看不到新组件 | 文件不在 `src/components/` 或语法错误 | 检查路径与控制台 |
| 打包后窗口不出现 | 漏 pywebview / WebView2 的 DLL | spec 里用 `collect_all("webview")` |
| 频谱/波形全空 | 渲染起点超出音频长度 | 起点设小于音频时长 |
| 导出与预览不一致 | 有人为导出另写了绘制代码 | 必须走 `paint.js` |

---

## 9. 工作约定

1. **改完就提交**，便于回滚
2. **不要跑全量测试除非必要**（见 §6）
3. **验证要程序化**，不靠"看起来对"
4. **文档要与实际同步** —— 有 `tools/verify_docs_final.py` 可校验
5. **诚实报告失误** —— 这个项目的文档里记了多个真实事故，便于后人避坑
