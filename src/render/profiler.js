/* ============================================================
   性能剖析探针（浏览器内）
   ------------------------------------------------------------
   为渲染链路的每个阶段独立计时，输出 JSON 供 Python 侧汇总。

   计时的阶段（与用户要求一一对应）：
     stateCalc      时间戳与工程状态计算（collectDrums / lifecycle 等）
     dynamicDraw    动态视觉元素绘制（音符、绽放、频谱、波形）
     staticDraw     静态背景及 UI 绘制（底板、网格、标签）
     imageExport    截图/图像导出（toDataURL）
     formatConvert  图像格式转换（getImageData / 编码）
     ipc            进程通信（base64 往返）

   设计：通过 monkey-patch 包装关键函数，测量其累计耗时。
   注意：包装本身有开销，故同时测量空包装的基线开销以扣除。

   用法：由 perf_profile.mjs 注入并调用。
   ============================================================ */

window.__PROF = {
  enabled: false,
  /* 各阶段累计耗时（毫秒）与调用次数 */
  acc: {},
  /* 包装开销基线 */
  overhead: {},

  重置: function () {
    this.acc = {};
    this.overhead = {};
  },

  记: function (阶段, 毫秒) {
    if (!this.enabled) return;
    const a = this.acc[阶段] || (this.acc[阶段] = { ms: 0, n: 0 });
    a.ms += 毫秒;
    a.n += 1;
  },

  /* 包装一个全局函数，把耗时计入指定阶段 */
  包装: function (名称, 阶段) {
    const 原 = window[名称];
    if (typeof 原 !== 'function') return false;
    const self = this;
    window[名称] = function () {
      if (!self.enabled) return 原.apply(this, arguments);
      const t0 = performance.now();
      try {
        return 原.apply(this, arguments);
      } finally {
        self.记(阶段, performance.now() - t0);
      }
    };
    return true;
  },

  /* 测量包装开销：空函数的包装成本 */
  测开销: function (次数) {
    次数 = 次数 || 20000;
    const 空 = function () { return 1; };
    window.__profDummy = 空;
    const t0 = performance.now();
    for (let i = 0; i < 次数; i++) window.__profDummy();
    const 裸 = performance.now() - t0;

    this.enabled = true;
    this.包装('__profDummy', 'overheadTest');
    const t1 = performance.now();
    for (let i = 0; i < 次数; i++) window.__profDummy();
    const 包装后 = performance.now() - t1;
    this.enabled = false;

    return {
      裸调用总ms: Number(裸.toFixed(3)),
      包装后总ms: Number(包装后.toFixed(3)),
      单次开销ms: Number(((包装后 - 裸) / 次数).toFixed(6)),
    };
  },

  报告: function () {
    const out = {};
    Object.keys(this.acc).forEach(k => {
      const a = this.acc[k];
      out[k] = {
        totalMs: Number(a.ms.toFixed(2)),
        calls: a.n,
        perCallMs: a.n ? Number((a.ms / a.n).toFixed(4)) : 0,
      };
    });
    return out;
  },
};

/* 安装探针：包装渲染链路的关键函数 */
window.__PROF安装 = function () {
  const P = window.__PROF;
  const 已装 = [];

  /* 动态视觉元素：音符绘制、绽放、音频类组件 */
  if (P.包装('inkDot', 'dynamicDraw')) 已装.push('inkDot');
  if (P.包装('inkNote', 'dynamicDraw')) 已装.push('inkNote');
  if (P.包装('drawStepper', 'dynamicDraw')) 已装.push('drawStepper');
  if (P.包装('emphasis', 'stateCalc')) 已装.push('emphasis');
  if (P.包装('lifecycle', 'stateCalc')) 已装.push('lifecycle');
  if (P.包装('collectDrums', 'stateCalc')) 已装.push('collectDrums');
  if (P.包装('featAt', 'stateCalc')) 已装.push('featAt');
  if (P.包装('nowTick', 'stateCalc')) 已装.push('nowTick');

  /* 静态背景与 UI */
  if (P.包装('panelBackground', 'staticDraw')) 已装.push('panelBackground');
  if (P.包装('label', 'staticDraw')) 已装.push('label');
  if (P.包装('tracked', 'staticDraw')) 已装.push('tracked');

  /* 表面原语（主题质感）—— 归入动态，因其随内容变化 */
  if (P.包装('sFill', 'dynamicDraw')) 已装.push('sFill');
  if (P.包装('sMark', 'dynamicDraw')) 已装.push('sMark');
  if (P.包装('sStroke', 'dynamicDraw')) 已装.push('sStroke');
  if (P.包装('sGrid', 'staticDraw')) 已装.push('sGrid');

  return 已装;
};
