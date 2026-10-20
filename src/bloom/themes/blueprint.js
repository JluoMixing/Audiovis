/* 図面：等高线测绘。像地形测绘——每次击打展开一圈圈精确的等高环。
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

BLOOM.blueprint=function(g,T,x,y,size,vel,L,seedKey,color){
  const P=T.palette;
  const INK=color||P.ink;   /* 主墨色：步进器按鼓件族传入 */
  const base=size*(0.40+vel*0.32);
  const Rmax=base*L.grow*(1+vel*0.5);
  /* 三层同心等高环，随扩散依次显现 */
  for(let k=0;k<3;k++){
    const off=k*0.30;
    const t=Math.max(0, Math.min(1, L.spread*1.25-off));
    if(t<=0.02) continue;
    const r=Rmax*t;
    g.strokeStyle=rgba(INK, L.alpha*(0.62-k*0.16));
    g.lineWidth= k===0? 1.2 : 0.8;
    g.beginPath(); g.arc(x,y,r,0,Math.PI*2); g.stroke();
    /* 环上的方位刻度：图纸语汇 */
    if(k===0){
      for(let i=0;i<8;i++){
        const a=i/8*Math.PI*2;
        g.beginPath();
        g.moveTo(x+Math.cos(a)*r, y+Math.sin(a)*r);
        g.lineTo(x+Math.cos(a)*(r+3.2), y+Math.sin(a)*(r+3.2));
        g.stroke();
      }
    }
  }
  /* 中心：实心小方块（图纸的基准点） */
  if(L.land>0.1){
    const s=Math.max(1.4, base*0.26*L.land*(1+vel*0.4));
    g.fillStyle=rgba(INK, L.alpha*0.95);
    g.fillRect(x-s/2,y-s/2,s,s);
  }
  /* 落笔时的十字准线 */
  if(L.impact>0.25){
    const r=Rmax*0.55;
    g.strokeStyle=rgba(P.accent, L.impact*0.7);
    g.lineWidth=0.9;
    g.beginPath();
    g.moveTo(x-r,y); g.lineTo(x+r,y);
    g.moveTo(x,y-r); g.lineTo(x,y+r);
    g.stroke();
  }
};
