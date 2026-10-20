/* ============================================================
   绘图原语
   ------------------------------------------------------------
   与具体组件无关的基础工具。所有组件都应使用这里的函数，
   而不是直接写死色值或自建随机数。

   依赖：无
   ============================================================ */

/* 十六进制颜色 → [r,g,b] */
function hex2rgb(h) {
  return [parseInt(h.slice(1, 3), 16),
          parseInt(h.slice(3, 5), 16),
          parseInt(h.slice(5, 7), 16)];
}

/* 十六进制颜色 + 透明度 → CSS rgba() */
function rgba(h, a) {
  const c = hex2rgb(h);
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
}

/* 两色插值：t=0 取 a，t=1 取 b */
function mixHex(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return '#' + [0, 1, 2].map(function (i) {
    return Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, '0');
  }).join('');
}

/* 圆角矩形路径（只建路径，不填充/描边，由调用方决定） */
function roundRect(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  if (r <= 0) { g.rect(x, y, w, h); return; }
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
/* 简写别名：部分旧代码用 rr */
const rr = roundRect;

/* ---- 确定性伪随机 ----
   重要：凡是要用随机的地方必须先 seed()。
   否则每帧结果不同，画面会闪烁。 */
let __seed = 1;
function rnd() {
  __seed = (__seed * 1664525 + 1013904223) % 4294967296;
  return __seed / 4294967296;
}
function seed(s) { __seed = (s >>> 0) || 1; }

/* smoothstep 缓动：0→1 平滑过渡 */
function smooth(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }

/* 带字距的文本绘制。Canvas 无 letterSpacing，故逐字绘制。
   返回文本总宽度。 */
function tracked(g, text, x, y, sp, align) {
  let w = 0;
  for (const ch of text) w += g.measureText(ch).width + sp;
  w -= sp;
  let cx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  for (const ch of text) {
    g.fillText(ch, cx, y);
    cx += g.measureText(ch).width + sp;
  }
  return w;
}

/* ---- base64 解码 ---- */

/* 解码 uint8 数组（频谱等） */
function decodeB64(b64) {
  const bin = atob(b64), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

/* 解码 int16 数组（降采样立体声等） */
function decodeI16(b64) {
  const bin = atob(b64), n = bin.length / 2, out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = ((bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) << 16) >> 16;
  }
  return out;
}

/* 时钟格式：秒 → "m:ss.s" */
function clockStr(s) {
  const m = Math.floor(s / 60), r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
}
