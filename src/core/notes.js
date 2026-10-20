/* ============================================================
   音符绘制原语（主题感知）
   ------------------------------------------------------------
   主时间轴用的音符画法。与步进器的「绽放」不同：
   这里表达的是**音符的持续存在**，不是一次击打的绽放。
   故鼓组与旋律共用同一套动画（emphasis），保证统一。

   依赖：core/canvas-kit.js, core/theme.js
   ============================================================ */

/* 打击乐符点：墨点（边缘不规则，随强调放大）
   用于主时间轴与钢琴卷帘的打击乐行。 */
function inkDot(g, x, y, r, alpha, em, seedKey) {
  seed(seedKey);
  g.fillStyle = rgba(P.ink, Math.min(1, alpha + em * 0.25));
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    const rad = r * (1 + em * 0.6) * (0.82 + rnd() * 0.36);
    i ? g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad)
      : g.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  g.closePath();
  g.fill();
}

/* 旋律/和弦音符：圆角矩形 + 强调描边
   与主时间轴的墨点略加区分，但同属墨·紙语汇。 */
function inkNote(g, x, y, w, h, alpha, em, seedKey) {
  seed(seedKey);
  const W2 = w * (1 + em * 0.26), H2 = h * (1 + em * 0.38);
  g.fillStyle = rgba(P.ink, Math.min(1, alpha + em * 0.22));
  const r = Math.min(W2, H2) * 0.34;
  roundRect(g, x - W2 / 2, y - H2 / 2, W2, H2, r);
  g.fill();
  if (em > 0.05) {
    g.strokeStyle = rgba(P.accent, em * 0.55);
    g.lineWidth = 1;
    roundRect(g, x - W2 / 2 - 0.5, y - H2 / 2 - 0.5, W2 + 1, H2 + 1, r);
    g.stroke();
  }
}

/* 带横向渐变的音符：透明度由「渐变 × globalAlpha」共同决定。
   ------------------------------------------------------------
   用途：让音符在组件左右边缘渐隐（纵向滚动视图的常见需要）。

   为什么不按「音符中心/两端」算一个统一 alpha：
   实测这类 pattern 的音符是**长音符**（持续的和弦），
   一根音符常常横跨整个可视区 —— 任何「整根一个透明度」
   的方案都必然导致某些像素在边缘处仍是全不透明，
   于是仍然会「捅出画布」或突然消失。

   渐变按像素求值，天然解决这个问题：
   同一条渐变可以被所有音符共用（fillStyle 复用，开销很小），
   每个音符自己的力度/强调则用 globalAlpha 叠乘。

   grad  由调用方用 createLinearGradient 建好，
         边缘 rgba(ink,0)、中段 rgba(ink,1)。
*/
function inkNoteFade(g, x, y, w, h, alpha, em, seedKey, grad) {
  seed(seedKey);
  const W2 = w * (1 + em * 0.26), H2 = h * (1 + em * 0.38);
  const a = Math.min(1, alpha + em * 0.22);
  if (a <= 0.004) return;
  const prev = g.globalAlpha;
  g.globalAlpha = prev * a;
  g.fillStyle = grad;
  const r = Math.min(W2, H2) * 0.34;
  roundRect(g, x - W2 / 2, y - H2 / 2, W2, H2, r);
  g.fill();
  if (em > 0.05) {
    g.strokeStyle = grad;
    g.globalAlpha = prev * Math.min(1, em * 0.55);
    g.lineWidth = 1;
    roundRect(g, x - W2 / 2 - 0.5, y - H2 / 2 - 0.5, W2 + 1, H2 + 1, r);
    g.stroke();
  }
  g.globalAlpha = prev;
}
