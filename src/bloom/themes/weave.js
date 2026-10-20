/* 織：线散。一小束经纬线从落点散开，线端渐隐。
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

BLOOM.weave=function(g,T,x,y,size,vel,L,seedKey,color){
  const P=T.palette;
  const INK=color||P.ink;   /* 主墨色：步进器按鼓件族传入 */
  const base=size*(0.42+vel*0.34);
  const R=base*L.grow*(1+vel*0.5);
  seed(seedKey);
  /* 放射的短线段：像散开的线头 */
  const n=6+Math.round(vel*5);
  for(let k=0;k<n;k++){
    const a=(k/n)*Math.PI*2 + rnd()*0.3;
    const len=R*(0.5+rnd()*0.7);
    const x0=x+Math.cos(a)*R*0.18, y0=y+Math.sin(a)*R*0.18;
    const x1=x+Math.cos(a)*len,    y1=y+Math.sin(a)*len;
    const grd=g.createLinearGradient(x0,y0,x1,y1);
    grd.addColorStop(0, rgba(INK, L.alpha*0.78));
    grd.addColorStop(1, rgba(INK, 0));
    g.strokeStyle=grd;
    g.lineWidth=0.9+vel*0.7;
    g.beginPath(); g.moveTo(x0,y0); g.lineTo(x1,y1); g.stroke();
  }
  /* 交织核心：小十字（经纬交点） */
  if(L.land>0.12){
    const s=Math.max(1.6, base*0.34*L.land*(1+vel*0.4));
    g.strokeStyle=rgba(INK, L.alpha*0.95);
    g.lineWidth=1.3;
    g.beginPath();
    g.moveTo(x-s,y); g.lineTo(x+s,y);
    g.moveTo(x,y-s); g.lineTo(x,y+s);
    g.stroke();
  }
  /* 落笔：一圈织纹环 */
  if(L.impact>0.32){
    g.strokeStyle=rgba(P.accent, L.impact*0.55);
    g.lineWidth=1;
    g.setLineDash([2.5,2.5]);
    g.beginPath(); g.arc(x,y,R*0.9,0,Math.PI*2); g.stroke();
    g.setLineDash([]);
  }
};
