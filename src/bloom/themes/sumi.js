/* 墨·紙：宣纸晕染。墨滴落下，边缘不规则外扩，浓度随之稀释。
   ------------------------------------------------------------
   签名一致：bloom(g, T, x, y, size, vel01, L, seedKey)
     g        画布上下文
     T        当前主题对象
     x, y     落点坐标
     size     基准尺寸（已按行高与列宽取小）
     vel01    力度归一化 0..1
     L        lifecycle() 结果，含 land/spread/fade/alpha/grow/impact
     seedKey  确定性随机种子（保证同一音符每帧一致）

   设计要求：几何语言必须属于该主题自己的世界观，不是换色。
   全部遵循「落笔 → 扩散 → 消散」的同一节奏结构。
*/

BLOOM.sumi=function(g,T,x,y,size,vel,L,seedKey,color){
  const P=T.palette;
  /* color：调用方指定的主墨色（步进器用于区分鼓件族）。
     不传时退回 P.ink，保持其它调用方的外观不变。 */
  const INK=color||P.ink;
  const base=size*(0.42+vel*0.34);
  const R=base*L.grow*(1+vel*0.5);
  const dens=(0.34+vel*0.34)*L.alpha;
  seed(seedKey);
  /* 三层不规则墨团：外淡内浓 */
  for(let layer=0;layer<3;layer++){
    const lr=R*(1-layer*0.24);
    g.fillStyle=rgba(INK, dens*(0.46-layer*0.11));
    g.beginPath();
    const N=18;
    for(let i=0;i<N;i++){
      const a=i/N*Math.PI*2;
      const wob=1+(rnd()-0.5)*0.36;
      const rad=lr*wob;
      i? g.lineTo(x+Math.cos(a)*rad, y+Math.sin(a)*rad)
       : g.moveTo(x+Math.cos(a)*rad, y+Math.sin(a)*rad);
    }
    g.closePath(); g.fill();
  }
  /* 核心：刚落笔时最浓 */
  if(L.land>0.15){
    g.fillStyle=rgba(INK, Math.min(1,(0.52+vel*0.38)*L.land*L.fade));
    g.beginPath();
    g.arc(x,y, Math.max(0.8, base*0.20*L.land*(1+vel*0.5)), 0, Math.PI*2);
    g.fill();
  }
  /* 飞溅：仅在落笔冲击时 */
  if(L.impact>0.22){
    seed(seedKey+7);
    const n=Math.floor(L.impact*7);
    for(let k=0;k<n;k++){
      const a=rnd()*Math.PI*2, d=R*(1.05+rnd()*0.6);
      g.fillStyle=rgba(INK, L.impact*0.5*(0.35+rnd()*0.6));
      g.beginPath();
      g.arc(x+Math.cos(a)*d, y+Math.sin(a)*d, 0.9+rnd()*2.3*L.impact, 0, Math.PI*2);
      g.fill();
    }
  }
};
