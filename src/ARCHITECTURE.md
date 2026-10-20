# 项目架构说明

面向长期维护的模块化结构。**新增组件只需三步**，不必理解全貌。

## 目录结构

```
src/
├── core/                       核心基础设施（组件无关）
│   ├── canvas-kit.js           绘图原语：rgba / mixHex / roundRect / seed / smooth
│   ├── theme.js                主题访问器 + 令牌读取
│   ├── time.js                 时间换算 + 播放指针强调动画
│   ├── data.js                 数据访问：鼓组收集、Pattern 优先级解析
│   └── registry.js             组件注册表 + 公共绘制工具
│
├── components/                 每个组件一个文件，自包含
│   ├── playlist.js             主时间轴
│   ├── stepper.js              步进器（鼓组）
│   ├── pianoroll.js            钢琴卷帘
│   ├── pitchwheel.js           音级轮
│   ├── spectrum.js             频谱（滚动窗）
│   ├── waveform.js             波形（滚动窗）
│   ├── vectorscope.js          声场
│   ├── loudness.js             响度
│   ├── brightness.js           明亮度
│   ├── transient.js            瞬态
│   └── transport.js            走带读数
│
├── bloom/                      绽放语言（步进器专用）
│   ├── lifecycle.js            三阶段生命周期 + BPM 换算
│   ├── index.js                按主题键分派
│   └── themes/                 每个主题一个文件
│       ├── sumi.js             墨·紙：宣纸晕染
│       ├── blueprint.js        図面：等高线测绘
│       ├── longexposure.js     長曝光：光晕溢出
│       ├── construct.js        構成：几何扩张
│       ├── tape.js             磁帶：磁粉散开
│       ├── staratlas.js        星図：星芒爆发
│       ├── weave.js            織：线头散开
│       └── risograph.js        孔版：油墨渗开
│
├── app/
│   ├── gallery.js              组件画廊（预览台 UI）
│   └── style.css               预览台样式
│
└── build/
    └── build.py                组装为单文件 HTML
```

## 分层原则

| 层 | 职责 | 依赖方向 |
|---|---|---|
| `core/` | 与具体组件无关的基础设施 | 不依赖任何上层 |
| `bloom/` | 绽放动画（步进器专用） | 依赖 core |
| `components/` | 各组件渲染逻辑 | 依赖 core、bloom |
| `app/` | 预览台外壳 | 依赖全部 |
| `build/` | 打包 | 不参与运行 |

**依赖只能向下，不能向上。** 组件不直接引用其他组件，只通过 core 提供的工具。

## 新增一个组件

### 第 1 步：创建文件

`src/components/mycomponent.js`：

```js
/* 组件名 · 简短说明
   ------------------------------------------------------------
   说明这个组件呈现什么、数据来自哪里、与哪些组件互补。 */
register({
  id: 'mycomponent',          // 唯一标识（小写，无空格）
  name: '我的组件',            // 显示名
  group: '结构',              // 分组：结构 / 内容 / 音频 / 信息
  w: 600, h: 300,             // 默认尺寸
  desc: '一段说明，支持 <b>HTML</b>。',

  draw: function(g, w, h) {
    // g 已按 DPR 缩放，直接用 CSS 像素坐标绘制
    // 可用工具见下方「可用的绘制工具」
    const pad = 14;
    label(g, 'MY COMPONENT', pad, pad + 6);
    // ... 绘制逻辑
  }
});
```

### 第 2 步：加入构建清单

在 `src/build/build.py` 的 `COMPONENT_FILES` 列表中加入文件名。

### 第 3 步：构建并验证

```powershell
python src\build\build.py
node tools\capture_baseline.mjs "file:///.../dist/components.html" out.json
```

## 可用的绘制工具

### 绘图原语（core/canvas-kit.js）

| 函数 | 用途 |
|---|---|
| `rgba(hex, alpha)` | 十六进制色 + 透明度 → CSS 颜色 |
| `mixHex(a, b, t)` | 两色插值 |
| `roundRect(g,x,y,w,h,r)` | 圆角矩形路径 |
| `seed(n)` / `rnd()` | 确定性伪随机（保证每帧一致，不闪烁） |
| `smooth(t)` | smoothstep 缓动 |
| `tracked(g,text,x,y,sp,align)` | 带字距的文本 |

**重要**：凡是要用随机的地方，必须先 `seed()`。否则每帧结果不同，画面会闪烁。

### 主题与数据（core/theme.js, core/data.js）

| 对象 | 用途 |
|---|---|
| `THEME` | 当前主题（含 palette / type / treatment） |
| `P` | `THEME.palette` 的简写 |
| `TR` | `THEME.treatment` 的简写 |
| `label(g,text,x,y,opt)` | 按主题字体绘制标签 |
| `tintOf(pid)` | 按 Pattern ID 生成稳定色调 |
| `nowTick()` | 当前播放位置的绝对 tick |
| `featAt(sec)` | 取音频特征帧索引 |
| `collectDrums(nt)` | 收集该时刻所有发声鼓组（合并后的鼓件行） |
| `resolvePattern(rank, kind)` | 按优先级解析当前 Pattern |

### 时间与动画（core/time.js）

| 函数 | 用途 |
|---|---|
| `emphasis(absTick, len, nt)` | 瞬时强调 0..1（用于主时间轴等） |
| `lifecycle(absTick, nt, decay)` | 三阶段生命周期（用于绽放类动画） |
| `decaySeconds(beats)` | 拍 → 秒（BPM 挂钩） |

## 设计约定

1. **零硬编码颜色**：所有颜色取自 `P.*`（主题令牌），不写字面色值。
2. **零指针**：需要指示"现在"时，用动画余晖而非指针线。
3. **确定性**：使用随机前必须 `seed()`。
4. **数据诚实**：区分「工程数据」与「算法推测」，后者必须标注。
5. **组件自包含**：不引用其他组件的内部变量。

## 已知约束

- `DECAY_BEATS` 等可调参数是全局量，由预览台控制。
- 组件尺寸 `w`/`h` 是默认值，预览台可缩放。
- 音频类组件的滚动窗由 `WIN_BARS` 控制，主时间轴由 `MAIN_WIN_BARS` 控制。
