/* ============================================================
   主题访问器
   ------------------------------------------------------------
   组件通过这里读取主题，不直接触碰 THEME 对象结构。

   **主题可切换**：为支持「全主题总览」这类需要同时渲染多个
   主题的场景，P / TY / TR 改为可变绑定，用 setActiveTheme() 切换。
   单主题预览下不会调用切换，行为与常量一致。

   依赖：core/canvas-kit.js
   ============================================================ */

/* 当前生效的主题（由构建时注入初始值） */
let THEME = window.__THEME__;
let ACTIVE_KEY = window.__THEME_KEY__;

/* 主题派生量。用 let 而非 const，以便 setActiveTheme 切换。 */
let P  = THEME.palette;      /* 调色板 */
let TY = THEME.type;         /* 字体与字号 */
let TR = THEME.treatment;    /* 处理手法 */

/* 数据色：各组件的**数据主体**用色。
   ------------------------------------------------------------
   与 accent 的区别：
     accent  强调/焦点（播放头、当前列、标题点缀）—— 面积小、饱和高
     DATA    数据主体（波形包络、频谱色图、瞬态圈）—— 面积大、需可读

   缺省时从 accent 推导，保证旧主题不写 data 也能工作。 */
function 推导数据色(pal) {
  const 混 = function (a, b, t) {
    a = String(a).replace('#', '');
    b = String(b).replace('#', '');
    const r = [parseInt(a.substr(0,2),16), parseInt(a.substr(2,2),16),
               parseInt(a.substr(4,2),16)];
    const s = [parseInt(b.substr(0,2),16), parseInt(b.substr(2,2),16),
               parseInt(b.substr(4,2),16)];
    return '#' + r.map(function (v, i) {
      const x = Math.round(v + (s[i] - v) * t);
      return ('0' + Math.max(0, Math.min(255, x)).toString(16)).slice(-2);
    }).join('');
  };
  const acc = pal.accent || pal.ink;
  return {
    data:  pal.data  || 混(acc, pal.ink, 0.20),
    data2: pal.data2 || 混(acc, pal.bg, 0.45),
    data3: pal.data3 || 混(acc, pal.bg, 0.72),
  };
}

/* 数据色对象。**不能叫 DATA** —— 那是数据对象的全局名，
   同名会重复声明并让整个脚本不执行（踩过）。 */
let DCOL = 推导数据色(P);

let FONT = TY.body;
let MONO = TY.mono;
let DISP = TY.display;

/* 切换生效主题。传入主题对象（含 palette/type/treatment）。 */
function setActiveTheme(themeObj, key) {
  THEME = themeObj;
  P  = themeObj.palette;
  TY = themeObj.type;
  TR = themeObj.treatment;
  DCOL = 推导数据色(P);
  FONT = TY.body;
  MONO = TY.mono;
  DISP = TY.display;
  if (key !== undefined) ACTIVE_KEY = key;
}

/* 当前主题键（步进器据此选择绽放语汇） */
function activeThemeKey() { return ACTIVE_KEY; }

/* 当前主题对象（需要传给需要主题参数的函数时使用） */
function currentTheme() { return THEME; }

/* ============================================================
   组件内文字的显示开关
   ------------------------------------------------------------
   组件会画一些自带的文字：数值读数、刻度、单位、轨道名等。
   有时不需要它们（画面更干净），故做成可关闭的。

   ## 为什么用「替换上下文方法」而不是逐个调用点加判断
   各组件里有 20+ 处**直接调用** fillText 画文字（数值/刻度/标签），
   加上 label() 内部的 tracked()。逐个加判断：
     · 啰嗦（20 多处）
     · 容易漏（将来新增的调用点必然漏）
   替换 fillText/strokeText 是单点控制，天然覆盖所有现存与将来的调用。
   已核实：组件内 fillText 只用于画文字，没有「非文字却用 fillText」的情况。
   ============================================================ */
let 显示组件文字 = true;

function 设组件文字(可见) { 显示组件文字 = !!可见; }
function 组件文字可见() { return 显示组件文字; }

/* 在「隐藏组件文字」的状态下执行绘制。
   恢复放在 finally —— 否则一次异常会让上下文永久失去 fillText。 */
function 无文字绘制(g, fn) {
  if (显示组件文字) { fn(); return; }
  const 原fill = g.fillText;
  const 原stroke = g.strokeText;
  g.fillText = function () {};
  g.strokeText = function () {};
  try {
    fn();
  } finally {
    g.fillText = 原fill;
    g.strokeText = 原stroke;
  }
}

/* 按主题字体绘制标签。opt: {color, size, weight, font, baseline, align, tracking} */
function label(g, text, x, y, opt) {
  if (!显示组件文字) return;
  opt = opt || {};
  g.save();
  g.fillStyle = opt.color || rgba(P.inkMid, 1);
  g.font = (opt.weight || 400) + ' ' + (opt.size || TY.labelSize) + 'px ' +
           (opt.font || FONT);
  g.textBaseline = opt.baseline || 'middle';
  g.textAlign = 'left';
  tracked(g, text, x, y,
          opt.tracking === undefined ? TY.tracking : opt.tracking,
          opt.align);
  g.restore();
}

/* 按 Pattern ID 生成稳定色调。
   用黄金比散列，保证同一 Pattern 在任何位置颜色一致。 */
function tintOf(pid) {
  const t = ((pid * 0.618033988749895) % 1);
  const lift = (t - 0.5) * 0.34;
  return lift >= 0 ? mixHex(P.ink, P.bg, lift * 0.9)
                   : mixHex(P.ink, '#000000', -lift * 0.55);
}

/* 边缘柔化参数（可在 GUI 属性面板中按组件调整）

   ## 为什么做成可调属性

   柔化强度是**构图语言**的一部分：密集排布时希望弱一些（组件间
   需要可辨识的边界），稀疏排布时可以强一些（营造融入感）。
   固定值无法同时满足，故暴露为属性。

   ## 取值

   0    = 关闭柔化，组件是硬边卡片
   0.18 = 默认，约短边的 18%
   0.5  = 强柔化，组件几乎化为一片光晕

   ## 历史教训

   初版固定 0.045（1180×600 上仅 18px），用户反馈「根本没看到柔化」。
   改为 0.18 后约 108px，视觉上才明显。
*/
let EDGE_FADE = 0.18;         /* 当前柔化强度（全局默认，GUI 可按组件覆盖） */
const EDGE_MIN = 28;
const EDGE_MAX = 140;

/* 按组件覆盖柔化强度。GUI 在绘制每个组件前调用。 */
let __当前柔化 = null;
function 设柔化(v) { __当前柔化 = v; }

function panelBackground(g, w, h, 柔化) {
  /* 1) 铺底色 */
  g.fillStyle = P.bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = rgba(P.surface, TR.texture === 'paper' ? 0.55 : 0.35);
  g.fillRect(0, 0, w, h);

  /* 2) 边缘柔化
     优先级：显式参数 > 组件级覆盖 > 全局默认 */
  const 强度 = (柔化 !== undefined && 柔化 !== null) ? 柔化
    : (__当前柔化 !== null ? __当前柔化 : EDGE_FADE);
  if (强度 <= 0) return;                       /* 0 = 关闭柔化 */

  const f = Math.max(EDGE_MIN, Math.min(EDGE_MAX,
    Math.round(Math.min(w, h) * 强度)));
  const bg = P.bg;

  const 边 = [
    [[0, 0, f, 0], [0, 0, f, h]],                       // 左
    [[w, 0, w - f, 0], [w - f, 0, f, h]],               // 右
    [[0, 0, 0, f], [0, 0, w, f]],                       // 上
    [[0, h, 0, h - f], [0, h - f, w, f]],               // 下
  ];
  边.forEach(function (x) {
    const grd = g.createLinearGradient(x[0][0], x[0][1], x[0][2], x[0][3]);
    grd.addColorStop(0, rgba(bg, 1));
    grd.addColorStop(0.28, rgba(bg, 0.82));
    grd.addColorStop(0.60, rgba(bg, 0.42));
    grd.addColorStop(1, rgba(bg, 0));
    g.fillStyle = grd;
    g.fillRect(x[1][0], x[1][1], x[1][2], x[1][3]);
  });

  /* 3) 四角补强：径向渐变，消除角落的方形残留 */
  const 角 = [[0, 0], [w, 0], [0, h], [w, h]];
  角.forEach(function (p) {
    const rg = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], f * 1.5);
    rg.addColorStop(0, rgba(bg, 1));
    rg.addColorStop(0.35, rgba(bg, 0.72));
    rg.addColorStop(0.70, rgba(bg, 0.30));
    rg.addColorStop(1, rgba(bg, 0));
    g.fillStyle = rg;
    g.beginPath();
    g.arc(p[0], p[1], f * 1.5, 0, Math.PI * 2);
    g.fill();
  });
}
