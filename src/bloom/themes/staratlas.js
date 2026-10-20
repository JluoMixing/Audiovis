/* 星図：星芒爆发。恒星爆发——核心 + 四道衍射光芒，缓慢黯淡。
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

BLOOM.staratlas=function(g,T,x,y,size,vel,L,seedKey,color){
  const P=T.palette;
  const INK=color||P.ink;   /* 主墨色：步进器按鼓件族传入 */
  const base=size*(0.44+vel*0.36);
  const R=base*L.grow*(1+vel*0.6);
  g.save();
  g.globalCompositeOperation='lighter';
  /* 核心光点 */
  const core=Math.max(0.9, base*0.26*L.land*(1+vel*0.6));
  const grd=g.createRadialGradient(x,y,0,x,y,core*2.6);
  grd.addColorStop(0, rgba(INK, Math.min(0.95,L.alpha)));
  grd.addColorStop(1, rgba(INK,0));
  g.fillStyle=grd;
  g.beginPath(); g.arc(x,y,core*2.6,0,Math.PI*2); g.fill();
  /* 四道衍射光芒：长度随扩散增长，随消散变淡。
     注意：横向光芒若过长，密集的踩镲会连成一条直线。
     故限制最大长度，并让长度随消散收敛。 */
  if(L.spread>0.12){
    const spike=Math.min(R*1.35, size*1.20)*(0.62+0.38*L.fade)*(1+vel*0.45);
    g.strokeStyle=rgba(P.accent, L.alpha*0.72);
    g.lineWidth=0.8+vel*0.9;
    g.beginPath();
    g.moveTo(x-spike,y); g.lineTo(x+spike,y);
    g.moveTo(x,y-spike); g.lineTo(x,y+spike);
    g.stroke();
    /* 斜向副芒：更短更淡 */
    const d2=spike*0.40;
    g.strokeStyle=rgba(INK, L.alpha*0.32);
    g.lineWidth=0.7;
    g.beginPath();
    g.moveTo(x-d2,y-d2); g.lineTo(x+d2,y+d2);
    g.moveTo(x-d2,y+d2); g.lineTo(x+d2,y-d2);
    g.stroke();
  }
  g.restore();
  /* 落笔：一圈极淡的星环 */
  if(L.impact>0.3){
    g.strokeStyle=rgba(INK, L.impact*0.5);
    g.lineWidth=0.8;
    g.beginPath(); g.arc(x,y,R*0.7,0,Math.PI*2); g.stroke();
  }
};
