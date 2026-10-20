/* 异形铬：切角碎片。
   ------------------------------------------------------------
   签名与其它主题一致：
     bloom(g, T, x, y, size, vel01, L, seedKey, color)

   异形铬的几何语言是**斜切**（见 SURFACE.chrome_freak 的厚板）。
   音符不该是十字 —— 那是「针」，而这里是「板」。

   落笔：一个带斜切角的实心小四边形
   扩散：碎片沿 45° 斜向飞散成 3 片
   消散：碎片缩小消失，不留残影

   全部沿同一斜向 —— 这是「被切开的金属」的动势。
*/
BLOOM.chrome_freak = function (g, T, x, y, size, vel, L, seedKey, color) {
  const P = T.palette;
  const 色 = color || (typeof DATA !== 'undefined' ? DCOL.data : P.accent);

  /* 碎片边长。系数 0.36 —— 音符是视频的主角，不能太小。 */
  const s = Math.max(4, size * (0.36 + vel * 0.24));
  /* 斜切量：边长的 32% */
  const 切 = s * 0.32;

  /* 画一个带斜切角的四边形（左上与右下各切一角） */
  const 画片 = function (cx, cy, r, a) {
    if (a < 0.02) return;
    g.fillStyle = rgba(色, a);
    const h = r / 2, c = r * 0.32;
    g.beginPath();
    g.moveTo(cx - h + c, cy - h);
    g.lineTo(cx + h, cy - h);
    g.lineTo(cx + h, cy + h - c);
    g.lineTo(cx + h - c, cy + h);
    g.lineTo(cx - h, cy + h);
    g.lineTo(cx - h, cy - h + c);
    g.closePath();
    g.fill();
  };

  /* 主碎片：实心，落笔最强 */
  if (L.land > 0.04) {
    画片(x, y, s, Math.min(1, (0.92 + vel * 0.08) * L.land * L.fade));
  }

  /* 飞散碎片：沿 45° 斜向，3 片依次变小变淡 */
  const 飞 = L.spread * L.fade;
  if (飞 > 0.05) {
    for (let k = 1; k <= 3; k++) {
      const 距 = s * (1.05 + k * 0.80) * (0.6 + L.grow * 0.9);
      const a = 飞 * (0.68 / k);
      if (a < 0.025) continue;
      const r = s * (1 - k * 0.20);
      /* 45° 斜向：右下为正，左上为负 */
      const 号 = (k % 2 === 0) ? -1 : 1;
      画片(x + 号 * 距 * 0.707, y + 号 * 距 * 0.707, r, a);
    }
  }

  /* 斜切参考线：只有力度大时，一道极短的 45° 细线 */
  if (vel > 0.70) {
    const la = 0.30 * L.spread * L.fade * (vel - 0.6) * 2.5;
    if (la > 0.02) {
      const L2 = s * 2.4;
      g.strokeStyle = rgba(色, la);
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(x - L2 * 0.5, y + L2 * 0.5);
      g.lineTo(x + L2 * 0.5, y - L2 * 0.5);
      g.stroke();
    }
  }
};
