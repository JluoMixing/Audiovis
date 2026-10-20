/* 磁帶：磁粉散开。颗粒从落点向外飞散并逐渐失去能量。
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

BLOOM.tape=function(g,T,x,y,size,vel,L,seedKey,color){
  const P=T.palette;
  const INK=color||P.ink;   /* 主墨色：步进器按鼓件族传入 */
  const base=size*(0.40+vel*0.32);
  const R=base*L.grow*(1+vel*0.55);
  seed(seedKey);
  /* 磁粉颗粒：随扩散向外分布，颗粒本身也变小变淡 */
  const n=8+Math.round(vel*8);
  for(let k=0;k<n;k++){
    const a=rnd()*Math.PI*2;
    const d=Math.pow(rnd(),0.6)*R;
    const px=x+Math.cos(a)*d, py=y+Math.sin(a)*d;
    const ps=Math.max(0.7, base*0.16*(1-L.spread*0.5)*(0.6+rnd()*0.8));
    g.fillStyle=rgba(INK, L.alpha*(0.40+rnd()*0.5));
    g.fillRect(px-ps/2, py-ps/2, ps, ps);
  }
  /* 落点：一小段磁迹（横向短线） */
  if(L.land>0.12){
    const w=base*0.85*L.land*(1+vel*0.4);
    g.fillStyle=rgba(INK, L.alpha*0.92);
    g.fillRect(x-w/2, y-base*0.09, w, base*0.18);
  }
  /* 落笔：横向擦痕 */
  if(L.impact>0.28){
    g.strokeStyle=rgba(P.accent, L.impact*0.62);
    g.lineWidth=0.9;
    g.beginPath();
    g.moveTo(x-R*1.5, y); g.lineTo(x+R*1.5, y);
    g.stroke();
  }
};
