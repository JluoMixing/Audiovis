/* 明亮度 · brightness
   已重做：不再是曲线仪表。明亮度表达为墨团在容器中的垂直位移与扩散——暗时墨团下沉、收拢；亮时上浮、扩散成雾。与响度是两个独立维度：可以很响但很暗，也可以很轻但很亮。 */

register({ id:'brightness', name:'明亮度', w:420, h:300, group:'音频',
  desc:'<b>已重做</b>：不再是曲线仪表。明亮度表达为<b>墨团在容器中的垂直位移与扩散</b>——暗时墨团下沉、收拢；亮时上浮、扩散成雾。与响度是两个独立维度：可以很响但很暗，也可以很轻但很亮。',
  draw:function(g,w,h){
    const pad=14;
    label(g,'BRIGHTNESS · 明亮度',pad,pad+6);
    const fi=featAt(CUR);
    const v=FEAT.centroidNorm[fi];
    const cx=w/2, cy=h/2+14;
    const R=Math.min(w,h)/2-46;

    g.strokeStyle=rgba(P.inkFaint,0.28); g.lineWidth=1;
    g.beginPath(); g.arc(cx,cy,R,0,Math.PI*2); g.stroke();

    const yOff=(0.5-v)*R*0.72;
    const spread=R*(0.34+v*0.44);
    const density=0.30+v*0.30;
    seed(133);
    g.save();
    g.beginPath(); g.arc(cx,cy,R,0,Math.PI*2); g.clip();
    const layers=Math.round(16+v*22);
    for(let k=0;k<layers;k++){
      const a=rnd()*Math.PI*2;
      const d=Math.pow(rnd(),0.7)*spread;
      const px=cx+Math.cos(a)*d;
      const py=cy+yOff+Math.sin(a)*d*0.78;
      const rad=R*(0.10+(1-v)*0.16+rnd()*0.10);
      sMark(g, px, py, rad, DCOL.data, density*(0.32+rnd()*0.55),
            { seedKey: Math.round(px*7+py*13) });
    }
    g.restore();

    g.strokeStyle=rgba(DCOL.data2,0.62); g.lineWidth=1.1;
    g.beginPath(); g.moveTo(cx-R*0.5, cy+yOff);
    g.lineTo(cx+R*0.5, cy+yOff); g.stroke();

    g.fillStyle=rgba(P.inkMid,0.9);
    g.font='400 10px '+MONO; g.textAlign='center'; g.textBaseline='top';
    g.fillText(Math.round(FEAT.centroidHz[fi])+' Hz', cx, cy+R+14);
    g.textAlign='left';
  }
});
