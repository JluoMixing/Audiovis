# 目录结构说明

本项目区分**产品层**、**设计层**、**调研归档层**，避免技术验证代码与产品代码混杂。

> 最后核对：2026-10-20（v1 打包后）

---

## 顶层

```
FL_VISUAL_TEST/
├── run.py                 启动器（服务 + 窗口）
├── app_server.py          HTTP 服务（界面、接口、渲染调度）
├── README.md              项目总览
├── .gitignore
│
├── src/                   【产品层】核心代码
├── preview/               【设计层】界面、主题、模板
├── data/                  【数据层】Schema 与工程快照
├── packaging/             【打包层】PyInstaller 配置与 zip 脚本
├── docs/                  【文档层】
├── tools/                 【工具层】测试与诊断脚本
│
├── bundles/               外部二进制（node.exe，gitignore）
├── dist/                  打包产物（gitignore）
├── out/                   渲染输出与临时产物（gitignore）
└── build/                 构建中间产物（gitignore）
```

---

## src/ —— 产品层

```
src/
├── __init__.py
├── ARCHITECTURE.md        架构说明（渲染管线、数据流）
│
├── core/                  【共享绘制核心】GUI 与导出共用
│   ├── canvas-kit.js      绘图原语（rgba / seed / rnd / mixHex …）
│   ├── registry.js        register() 与 COMPONENTS 数组
│   ├── theme.js           主题访问器（P / TY / TR / DCOL）
│   ├── surfaces.js        各主题的质感实现（fill / stroke / mark / grid）
│   ├── paint.js           绘制组件实例() / 绘制布局()
│   ├── data.js            数据访问封装
│   ├── time.js            时间与动画
│   ├── notes.js           音符绘制原语
│   └── fonts.js           字体栈
│
├── components/            【组件】12 个，各自 register()
│   ├── text.js  playlist.js  stepper.js  pianoroll.js
│   ├── pitchwheel.js  spectrum.js  waveform.js  vectorscope.js
│   └── loudness.js  brightness.js  transient.js  transport.js
│
├── bloom/                 【主题绽放（音符落点）】
│   ├── declare.js         声明 BLOOM 容器（必须最先加载）
│   ├── themes/            11 个主题实现（扫目录自动收集；default 无 bloom，回退 sumi）
│   ├── dispatch.js        按主题键分发（必须最后加载）
│   └── stepper-core.js    步进器绘制核心
│
├── app/                   【界面逻辑】
│   ├── bindings.js        数据绑定（模块顶层就读数据，必须最先）
│   ├── gallery.js         组件画廊
│   └── showcase.js        多主题总览
│
├── build/                 【界面构建】
│   └── build.py           把上述 JS 拼成单文件 HTML
│
├── parser/                【解析】FLP → Snapshot
├── audio/                 【音频分析】波形 / 频谱 / onset / 鼓组
├── render/                【渲染管线】
│   ├── render.py          Python 驱动
│   ├── page.html          导出页模板
│   └── capture_v2.mjs     CDP 逐帧截图
│
├── cli.py                 命令行入口
├── project.py             工程元数据
├── settings.py            用户设置
├── runtime.py             打包版路径处理（freeze-aware）
└── webview_host.py        pywebview 无边框窗口
```

---

## preview/ —— 设计层

```
preview/
├── build_gui.py           构建界面产物
├── gui_prototype.html     产物（单文件 HTML，构建后生成）
├── design_templates.py    模板生成脚本
├── templates.json         6 套模板（横竖屏各一套坐标）
│
├── gui/                   界面源
│   ├── index.html
│   ├── css/
│   ├── js/                含 app.js（主逻辑）、i18n-data.js（语言包）
│   └── i18n/              zh.json / en.json
│
├── themes/
│   └── artdirections.json 12 套主题定义（**视觉的唯一真相源**）
```

---

## data/ —— 数据层

```
data/
└── schema/
    └── project_snapshot.schema.json    稳定 Schema（变更需谨慎）
```

---

## packaging/ —— 打包层

```
packaging/
├── Audiovis.spec      PyInstaller 配置（onedir）
├── make_zip.py            打 zip 并校验
└── 使用说明.txt           随包分发
```

---

## docs/ —— 文档层

**入口**：[`INDEX.md`](INDEX.md) —— 按需求查文档的索引。

| 文件 | 内容 |
|---|---|
| `INDEX.md` | 文档索引（从哪读起） |
| `ROADMAP.md` | 设计决策记录 |
| `STRUCTURE.md` | 本文件 |
| `ADD_COMPONENT.md` | 如何添加新组件（3 步） |
| `ADD_THEME.md` | 如何添加新主题（4 步） |
| `PACKAGING.md` | 打包说明 |
| `VENDOR_VERSIONS.md` | 第三方依赖版本与许可证 |

---

## tools/ —— 工具层

```
tools/
├── run_tests.py           测试运行器
├── run_app.py             带任务栏保护的启动器
├── taskbar_guard.py       任务栏状态检测与修复
├── cleanup_disk.py        磁盘清理
├── test_*.py / *.mjs      56 个正式测试
```

---

## 分层原则

| 层 | 可变性 | 说明 |
|---|---|---|
| `data/` | **谨慎** | 稳定契约。Schema 变更需同步升级版本号并记录理由 |
| `src/` | 自由 | 产品代码，可重构 |
| `preview/` | 自由 | 设计层，可随时调整 |
| `packaging/` | 自由 | 打包配置 |
| `docs/` | 自由 | 文档，需与实际状态同步 |
| `out/` `dist/` `build/` | 临时 | 可随时清空重新生成 |

---

## 关键约束

1. **原始工程文件绝不入库**。用户的 FLP 与音频不在本仓库内；
   `.gitignore` 中另有防御性规则。
2. **`preview/themes/artdirections.json` 是视觉的唯一真相源**。
   渲染代码不得硬编码颜色或尺寸。
3. **组件与主题的 `name` / `w` / `h` / `group` 只在 `register()` 里写一次**。
   不要在别处重复 —— 重复必然漂移（曾发生过：`app.js` 里的手写 `COMPS` 表
   与 `register()` 漂移 4 项，导致拖进画布的组件尺寸错误）。
4. **构建清单扫目录，不手写**。`src/build/build.py` 的
   `BLOOM_FILES` / `COMPONENT_FILES` 由目录扫描生成 ——
   新增文件自动被发现，漏登记不可能发生。
