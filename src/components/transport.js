/* 走带读数 · transport
   大时钟 + 小节/拍 + 进度条。信息类里唯一保留的一个——它是观众的定位锚点，不是工程数据。 */

register({ id:'transport', name:'走带读数', w:320, h:170, group:'信息',
  desc:'大时钟 + 小节/拍 + 进度条。信息类里唯一保留的一个——它是观众的定位锚点，不是工程数据。',
  draw:function(g,w,h){
    const pad=16;
    g.fillStyle=rgba(P.ink,0.96);
    g.font='600 38px '+MONO; g.textBaseline='alphabetic';
    g.fillText(clockStr(CUR), pad, pad+38);
    const bar=CUR/60*TEMPO/4+1, beat=(CUR/60*TEMPO)%4+1;
    label(g,'BAR',pad,pad+58,{color:rgba(P.inkFaint,1)});
    g.fillStyle=rgba(P.ink,0.9);
    g.font='400 15px '+MONO; g.textBaseline='middle';
    g.fillText(bar.toFixed(2), pad+34, pad+58);
    label(g,'BEAT',pad+96,pad+58,{color:rgba(P.inkFaint,1)});
    g.fillStyle=rgba(P.ink,0.9);
    g.fillText(beat.toFixed(2), pad+132, pad+58);
    const by=h-pad-6;
    g.strokeStyle=rgba(P.inkFaint,0.4); g.lineWidth=1;
    g.beginPath(); g.moveTo(pad,Math.round(by)+.5);
    g.lineTo(w-pad,Math.round(by)+.5); g.stroke();
    g.strokeStyle=rgba(P.accent,0.95); g.lineWidth=2;
    g.beginPath(); g.moveTo(pad,by);
    g.lineTo(pad+(w-pad*2)*(CUR/DUR),by); g.stroke();
    label(g,DUR.toFixed(1)+'s TOTAL',pad,by-14,{color:rgba(P.inkFaint,1)});
  }
});
