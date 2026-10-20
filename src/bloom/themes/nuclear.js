/* 核警示：仪表脉冲。
   ------------------------------------------------------------
   工业设备的读数：不是绽放，是**一次脉冲**。

   落笔  → 一道弧（仪表指针扫过）
   扩散  → 弧张开，像刻度在展开
   消散  → 弧淡出

   全部用 2px 线，无填充 —— 与「模板喷涂」的断续边形成对比。
*/
BLOOM.nuclear = function (g, T, x, y, size, vel, L, seedKey, color) {
  const P = T.palette;
  const 色 = color || P.accent;
  const R = size * (0.48 + vel * 0.50) * L.grow;

  /* 主弧：从 -140° 扫到 -40°（仪表盘上半圈） */
  const a0 = 0.72 * L.land * L.fade;
  if (a0 > 0.02) {
    g.strokeStyle = rgba(色, a0);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y + R * 0.42, R, -Math.PI * 0.78, -Math.PI * 0.22);
    g.stroke();
  }

  /* 刻度：三条短径向线 */
  const a1 = 0.55 * L.spread * L.fade;
  if (a1 > 0.02) {
    g.strokeStyle = rgba(色, a1);
    g.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI * 0.78 + i * Math.PI * 0.28;
      const cx = x, cy = y + R * 0.42;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * R * 0.82, cy + Math.sin(a) * R * 0.82);
      g.lineTo(cx + Math.cos(a) * R * 1.10, cy + Math.sin(a) * R * 1.10);
      g.stroke();
    }
  }
};
