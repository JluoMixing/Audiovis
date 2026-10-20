# 添加新主题

一份可执行的清单。按顺序做，每步都写清了**改哪里**、**漏了会怎样**。

---

## 快速版（4 步）

| # | 做什么 | 文件 | 漏了会怎样 |
|---|---|---|---|
| 1 | 新建绽放（bloom）实现 | `src/bloom/themes/<名>.js` | — |
| 2 | 登记底板质感 | `src/core/surfaces.js` 的 `SURFACE.<名>` | **静默：底板用 sumi 的** |
| 3 | 加主题定义（色板/字体） | `preview/themes/artdirections.json` | 主题卡片不出现 |
| 4 | 加描述文案 | `src/bloom/dispatch.js` 的 `BLOOM` 表 | 静默：描述用 sumi 的 |

**不需要改构建清单** —— `build.py` 扫 `src/bloom/themes/` 目录，
新增文件自动被发现（已用 `tools/test_auto_discover.py` 验证）。

⚠️ **第 2、4 步漏了不会报错**，只是"效果不对"。这是最难查的一类问题。

---

## 详细步骤

### 1. 新建绽放实现

路径：`src/bloom/themes/<名>.js`

"绽放"（bloom）指**音频驱动的视觉动效**，比如墨团扩散、光斑脉动。

```js
/* 主题说明写在这里 */
(function () {
  'use strict';

  /* 绘制一帧绽放效果。
     参数约定（与其它主题一致，改动会破坏 dispatch）：
       g      Canvas 2D 上下文
       t      当前时刻（秒）
       w, h   画布尺寸
       P      当前主题色板（见 artdirections.json 的 palette）
       ...    其它由 dispatch.js 传入的参数 */
  function 绘制(g, t, w, h, P) {
    // 你的实现
  }

  /* 注册到全局 BLOOM 表。
     键名必须与 artdirections.json 里的主题 id 一致。 */
  BLOOM.mytool = {
    绘制: 绘制,
  };
})();
```

参考现有 8 个实现（`sumi` / `blueprint` / `longexposure` /
`construct` / `tape` / `staratlas` / `weave` / `risograph`）。

### 2. 登记底板质感

文件：`src/core/surfaces.js`

```js
SURFACE.mytool = {
  fill: function (g, x, y, w, h, col, a, opt) {
    // 填充的质感实现
  },
  stroke: function (g, x, y, w, h, col, a, opt) {
    // 描边的质感实现
  },
  mark: function (g, x, y, r, col, a) {
    // 标记点（可选）
  },
  grid: function (g, x, y, w, h, col, a, major) {
    // 网格（可选）
  },
};
```

**漏了会怎样**：`surfaces.js` 里有这行兜底：

```js
function surface() {
  return SURFACE[activeThemeKey()] || SURFACE.sumi;
}
```

于是所有组件的底板质感都用 `sumi`（水墨）的 ——
你的主题色板是对的，但**填充/描边的手感是错的**，且不报错。

### 3. 加主题定义

文件：`preview/themes/artdirections.json`

在 `directions` 里加一项，并在 `order` 里加键名：

```json
{
  "directions": {
    "mytool": {
      "id": "mytool",
      "name": "我的主题",
      "subtitle": "MYTOOL",
      "concept": "设计意图说明（会显示在主题卡片上）",
      "translation": "数据映射说明",
      "signature": "seal",
      "palette": {
        "bg": "#E6E4DD",
        "surface": "#DEDCD4",
        "ink": "#1A1815",
        "inkMid": "#5A564C",
        "inkFaint": "#A29C8E",
        "accent": "#A8362A",
        "accent2": "#2C3B4A",
        "accent3": "#7A6A4E"
      },
      "type": {
        "display": "\"楷体\", \"KaiTi\", Georgia, serif",
        "body": "\"宋体\", \"SimSun\", Georgia, serif",
        "mono": "\"Consolas\", monospace",
        "displaySize": 78,
        "labelSize": 12,
        "tracking": 2.4,
        "displayWeight": 400
      },
      "treatment": {
        "texture": "paper",
        "clip": "brush",
        "spectrum": "inktones",
        "wave": "stroke",
        "notes": "splatter",
        "frame": "none",
        "labels": "vertical",
        "titles": "left"
      }
    }
  },
  "order": ["sumi", "blueprint", "...", "mytool"]
}
```

**必填字段**：`id` / `name` / `subtitle` / `palette`（8 个色）/
`type`（字体与字号）。

`order` 决定主题卡片的排列顺序。**忘了加进 `order` 卡片不会出现**
（`app.js` 的 `THEMES` 从 `DIRECTIONS.order` 生成）。

### 4. 加描述文案

文件：`src/bloom/dispatch.js`

```js
const BLOOM_DESC = {
  sumi: '宣纸晕染（不规则墨团 + 飞溅）',
  ...
  mytool: '一句话描述你的绽放效果',      // ← 加这一行
};
```

**漏了会怎样**：`dispatch.js` 里也有兜底：

```js
return BLOOM[themeKey] || BLOOM.sumi;
```

描述会用 `sumi` 的。不影响渲染，只是文案不对。

### 5. 重建

```bash
python preview/build_gui.py
```

### 6. 验证

打开界面，检查：

- 主题卡片出现，位置在 `order` 指定的地方
- 点卡片，**色板变化**（底板、文字色都对）
- **质感变化**（不是水墨手感）—— 验证第 3 步
- **绽放效果变化** —— 验证第 2 步
- 导出视频里也一致

---

## 常见错误

| 症状 | 原因 | 修法 |
|---|---|---|
| 卡片不出现 | 忘了加进 `order` | 补上 |
| 色板对但质感是水墨 | 漏 `SURFACE.<名>` | 补第 3 步 |
| 完全没效果（用 sumi 的） | 文件不在 `src/bloom/themes/` 或语法错误 | 检查路径与控制台 |
| 描述文案是 sumi 的 | 漏 `BLOOM` 表 | 补第 5 步 |
| 字体不生效 | `type` 里的字体本机没有 | 用系统自带字体，或在 `type` 里加多个回退 |

---

## 为什么主题比组件麻烦

| | 组件 | 主题 |
|---|---|---|
| 注册方式 | **一处**（`register()` 自带 name/w/h/group） | **三处独立登记**（BLOOM 函数表 / SURFACE 表 / artdirections.json） |
| 漏登记 | 不会（`register()` 有字段校验） | **会，且静默回退** |
| 改动处数 | 2 处（建文件 + 重建） | 4 处 |

**已做**：`BLOOM_FILES` / `COMPONENT_FILES` 改为扫目录 ——
新增文件自动被发现，不需要登记。

**还没做**（可选）：

1. 把 `SURFACE` 合并进 `artdirections.json`（4 处 → 3 处）
2. 主题漏 `SURFACE` 时**启动报错**而不是静默回退 sumi
3. 主题漏 `BLOOM` 描述时同理

这两条是"让错误可见"的改进，不是必须的。
当前靠这份文档 + 人的注意力。

---

## 相关文件

| 文件 | 作用 |
|---|---|
| `src/bloom/themes/*.js` | 各主题的绽放实现 |
| `src/bloom/dispatch.js` | 按主题键分发到对应实现 |
| `src/core/surfaces.js` | 各主题的底板质感 |
| `preview/themes/artdirections.json` | 色板 / 字体 / 设计意图 |
| `preview/gui/js/app.js` | `THEMES` 从 `DIRECTIONS.order` 自动生成 |
