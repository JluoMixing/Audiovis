/* 孔版：油墨渗开 + 网点扩散。Riso 油墨在纸上会渗出毛边。
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

BLOOM.risograph=function(g,T,x,y,size,vel,L,seedKey,color){
  const P=T.palette;
  const INK=color||P.ink;   /* 主墨色：步进器按鼓件族传入 */
  const base=size*(0.44+vel*0.34);
  const R=base*L.grow*(1+vel*0.55);
  seed(seedKey);
  /* 油墨渗出：不规则实心块，用 multiply 叠印出第三色 */
  g.save();
  g.globalCompositeOperation='multiply';
  const dens=L.alpha*(0.42+vel*0.30);
  g.fillStyle=rgba(P.accent, dens);
  g.beginPath();
  const N=14;
  for(let i=0;i<N;i++){
    const a=i/N*Math.PI*2;
    const wob=1+(rnd()-0.5)*0.42;
    const rad=R*wob;
    i? g.lineTo(x+Math.cos(a)*rad, y+Math.sin(a)*rad)
     : g.moveTo(x+Math.cos(a)*rad, y+Math.sin(a)*rad);
  }
  g.closePath(); g.fill();
  /* 第二色偏移叠印：Riso 套印偏移的工艺特征 */
  g.fillStyle=rgba(P.accent2, dens*0.72);
  g.beginPath();
  seed(seedKey+3);
  for(let i=0;i<N;i++){
    const a=i/N*Math.PI*2;
    const wob=1+(rnd()-0.5)*0.42;
    const rad=R*0.86*wob;
    const ox=1.8, oy=-1.4;
    i? g.lineTo(x+ox+Math.cos(a)*rad, y+oy+Math.sin(a)*rad)
     : g.moveTo(x+ox+Math.cos(a)*rad, y+oy+Math.sin(a)*rad);
  }
  g.closePath(); g.fill();
  g.restore();
  /* 半调网点：在墨块外围散开，随消散变疏 */
  const cell=Math.max(2.4, base*0.30);
  const rings=2;
  for(let ring=1;ring<=rings;ring++){
    const rr0=R*(0.85+ring*0.42);
    const cnt=Math.round(6+ring*4);
    for(let k=0;k<cnt;k++){
      const a=(k/cnt)*Math.PI*2 + ring*0.4;
      const px=x+Math.cos(a)*rr0, py=y+Math.sin(a)*rr0;
      const v=L.alpha*(0.62-ring*0.20);
      if(v<=0.05) continue;
      g.fillStyle=rgba(ring===1?P.accent2:P.accent, v);
      g.beginPath(); g.arc(px,py, cell*0.30, 0, Math.PI*2); g.fill();
    }
  }
  /* 落笔：套准十字 */
  if(L.impact>0.3){
    const s=R*0.5;
    g.strokeStyle=rgba(INK, L.impact*0.72);
    g.lineWidth=1.1;
    g.beginPath();
    g.moveTo(x-s,y); g.lineTo(x+s,y);
    g.moveTo(x,y-s); g.lineTo(x,y+s);
    g.stroke();
  }
};
