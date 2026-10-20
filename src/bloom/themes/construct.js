/* 構成：几何扩张。包豪斯式的硬边形状，分步放大后溶解。
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

BLOOM.construct=function(g,T,x,y,size,vel,L,seedKey,color){
  const P=T.palette;
  const INK=color||P.ink;   /* 主墨色：步进器按鼓件族传入 */
  const base=size*(0.42+vel*0.34);
  /* 量化成 4 级：几何感来自"跳步"而非连续变化 */
  const steps=4;
  const q=Math.ceil(L.spread*steps)/steps;
  const s=Math.max(2.2, base*q*(1+vel*0.5));
  /* 实心方块：随消散缩小（与水墨的扩散相反，构成是"收"） */
  const inner=s*(0.30+0.70*L.fade);
  g.fillStyle=rgba(INK, L.alpha*0.92);
  g.fillRect(x-inner/2, y-inner/2, inner, inner);
  /* 外框：硬边方形轮廓，随扩散外移 */
  if(L.spread>0.25){
    g.strokeStyle=rgba(P.accent, L.alpha*0.68);
    g.lineWidth=1.6;
    g.strokeRect(x-s/2, y-s/2, s, s);
  }
  /* 第二层框：错位，构成语汇 */
  if(L.spread>0.6){
    const s2=s*1.42;
    g.strokeStyle=rgba(INK, L.alpha*0.32);
    g.lineWidth=1;
    g.strokeRect(x-s2/2+2, y-s2/2-2, s2, s2);
  }
  /* 落笔：对角切线 */
  if(L.impact>0.3){
    const d=s*0.85;
    g.strokeStyle=rgba(P.accent, L.impact*0.85);
    g.lineWidth=2.2;
    g.beginPath();
    g.moveTo(x-d,y-d); g.lineTo(x+d,y+d);
    g.stroke();
  }
};
