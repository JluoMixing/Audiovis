/* 白塑料：LED 点阵。
   ------------------------------------------------------------
   签名与其它主题一致：
     bloom(g, T, x, y, size, vel01, L, seedKey, color)

   白塑料设备的「绽放」不是圆环 —— 那太像抽象图形。
   真实设备上是**点阵屏的一个亮格**，且亮格会留下拖尾
   （相邻格依次变暗，像余晖）。

   几何语言：**方形**。因为点阵屏的物理像素是方的。
   圆环是「魔法」，方格子才是「设备」。
*/
BLOOM.wh_soft = function (g, T, x, y, size, vel, L, seedKey, color) {
  const P = T.palette;
  const 主色 = color || (typeof DATA !== 'undefined' ? DCOL.data : P.accent);

  /* 格边长：随力度略变。
     系数 0.34 —— 音符是视频的主角，不能太小（0.19 时几乎看不见）。 */
  const 格 = Math.max(3.0, size * (0.34 + vel * 0.22));

  /* 主格：实心方块，亮度随落笔强度 */
  if (L.land > 0.05) {
    g.fillStyle = rgba(主色, Math.min(1, (0.88 + vel * 0.12) * L.land * L.fade));
    g.fillRect(x - 格 / 2, y - 格 / 2, 格, 格);
  }

  /* 拖尾：左邻三格依次变暗（设备余晖） */
  const 拖 = L.spread * L.fade;
  if (拖 > 0.04) {
    for (let k = 1; k <= 3; k++) {
      const a = 拖 * (0.52 / k) * (1 - L.fade * 0.20);
      if (a < 0.02) continue;
      g.fillStyle = rgba(主色, a);
      const s = 格 * (1 - k * 0.13);
      g.fillRect(x - 格 * 0.5 - k * (格 + 2.5) - s / 2 + s / 2,
                 y - s / 2, s, s);
    }
  }

  /* 扩散框：一圈极淡的方框，只在大力度时出现 */
  if (vel > 0.62) {
    const 框a = 0.26 * L.spread * L.fade * (vel - 0.5) * 2;
    if (框a > 0.02) {
      const r = 格 * (1.5 + L.grow * 2.2);
      g.strokeStyle = rgba(主色, 框a);
      g.lineWidth = 1;
      g.strokeRect(x - r / 2, y - r / 2, r, r);
    }
  }
};
