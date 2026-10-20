/* 長曝光：光晕溢出。胶片高光向外渗出暖色，缓慢衰减。
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

BLOOM.longexposure=function(g,T,x,y,size,vel,L,seedKey,color){
  const P=T.palette;
  const INK=color||P.ink;   /* 主墨色：步进器按鼓件族传入 */
  const base=size*(0.44+vel*0.36);
  const R=base*L.grow*(1+vel*0.6);
  g.save();
  g.globalCompositeOperation='lighter';
  /* 内核：暖白 */
  const core=Math.max(1, base*0.30*L.land*(1+vel*0.5));
  let grd=g.createRadialGradient(x,y,0,x,y,core*2.2);
  grd.addColorStop(0, rgba(INK, Math.min(0.95,L.alpha*1.05)));
  grd.addColorStop(1, rgba(INK,0));
  g.fillStyle=grd;
  g.beginPath(); g.arc(x,y,core*2.2,0,Math.PI*2); g.fill();
  /* 光晕：accent 暖色外扩 */
  grd=g.createRadialGradient(x,y,0,x,y,R*1.9);
  grd.addColorStop(0, rgba(P.accent, L.alpha*0.62));
  grd.addColorStop(0.45, rgba(P.accent, L.alpha*0.24));
  grd.addColorStop(1, rgba(P.accent,0));
  g.fillStyle=grd;
  g.beginPath(); g.arc(x,y,R*1.9,0,Math.PI*2); g.fill();
  g.restore();
  /* 落笔：横向光斑（镜头眩光语汇） */
  if(L.impact>0.3){
    const w=R*3.2*L.impact;
    const grd2=g.createLinearGradient(x-w,0,x+w,0);
    grd2.addColorStop(0,rgba(P.accent,0));
    grd2.addColorStop(0.5,rgba(INK,L.impact*0.55));
    grd2.addColorStop(1,rgba(P.accent,0));
    g.fillStyle=grd2;
    g.fillRect(x-w, y-0.9, w*2, 1.8);
  }
};
