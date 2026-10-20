/* 瞬态 · transient
   已重做：不再是柱状仪表。瞬态表达为从中心向外扩散的同心圆环——每次鼓点冲击产生一圈涟漪，环的粗细与扩散随强度变化。静默时画面归于平静，鼓点密集时涟漪交叠。 */

register({ id:'transient', name:'瞬态', w:420, h:300, group:'音频',
  desc:'<b>已重做</b>：不再是柱状仪表。瞬态表达为<b>从中心向外扩散的同心圆环</b>——每次鼓点冲击产生一圈涟漪，环的粗细与扩散随强度变化。静默时画面归于平静，鼓点密集时涟漪交叠。',
  draw:function(g,w,h){
    const pad=14;
    label(g,'TRANSIENT · 瞬态',pad,pad+6);
    const cx=w/2, cy=h/2+14;
    const R=Math.min(w,h)/2-40;
    const fi=featAt(CUR);

    g.strokeStyle=rgba(P.inkFaint,0.22); g.lineWidth=1;
    g.beginPath(); g.arc(cx,cy,R*0.28,0,Math.PI*2); g.stroke();

    const LOOK=Math.round(FEAT.fps*1.5);
    for(let k=LOOK;k>=0;k--){
      const j=fi-k;
      if(j<0) continue;
      const v=FEAT.fluxNorm[j];
      if(v<0.16) continue;
      const t=(k/FEAT.fps)/1.5;
      const r=R*(0.26+t*0.74);
      const alpha=(1-t)*v*0.85;
      /* 用主题表面原语描边：线质随主题变化（虚线/网点/实线等） */
      g.strokeStyle=rgba(DCOL.data, alpha);
      g.lineWidth=0.8+(1-t)*v*3.2;
      if(activeThemeKey()==='blueprint'){ g.setLineDash([3,3]); }
      else if(activeThemeKey()==='weave'){ g.setLineDash([1.5,2.5]); }
      else if(activeThemeKey()==='risograph'){ g.setLineDash([2,2]); }
      g.beginPath(); g.arc(cx,cy,r,0,Math.PI*2); g.stroke();
      g.setLineDash([]);
      if(v>0.55){
        g.strokeStyle=rgba(DCOL.data2, alpha*0.75);
        g.lineWidth=0.9;
        g.beginPath(); g.arc(cx,cy,r*1.04,0,Math.PI*2); g.stroke();
      }
    }
    const vNow=FEAT.fluxNorm[fi];
    const coreR=R*0.20*(0.7+vNow*1.5);
    seed(211);
    g.fillStyle=rgba(DCOL.data, 0.20+vNow*0.68);
    g.beginPath();
    for(let i=0;i<14;i++){
      const a=i/14*Math.PI*2;
      const rad=coreR*(0.82+rnd()*0.36);
      i? g.lineTo(cx+Math.cos(a)*rad, cy+Math.sin(a)*rad)
       : g.moveTo(cx+Math.cos(a)*rad, cy+Math.sin(a)*rad);
    }
    g.closePath(); g.fill();

    g.fillStyle=rgba(P.inkMid,0.9);
    g.font='400 10px '+MONO; g.textAlign='center'; g.textBaseline='top';
    g.fillText((vNow*100).toFixed(0)+'%', cx, cy+R+14);
    g.textAlign='left';
  }
});
