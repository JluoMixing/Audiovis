/* 音级轮 · pitchwheel
   12 音级环形，仅统计旋律性 Pattern。采用与钢琴卷帘相同的优先级机制：显示当前优先级最高且正在播放的 Pattern 的音级，无则顺延。实测本工程为 D# 小调。指针经过音符时对应音级会脉动。 */

register({ id:'pitchwheel', name:'音级轮', w:360, h:360, group:'内容',
  desc:'12 音级环形，仅统计旋律性 Pattern。<b>采用与钢琴卷帘相同的优先级机制</b>：显示当前优先级最高且正在播放的 Pattern 的音级，无则顺延。实测本工程为 D# 小调。指针经过音符时对应音级会脉动。',
  draw:function(g,w,h){
    const pad=14;
    const nt=nowTick();
    const resolved=resolvePattern(RANK,'melodic');
    label(g,'PITCH WHEEL · 调性',pad,pad+6);
    const cx=w/2, cy=h/2+8;
    const R=Math.min(w,h)/2-52;
    const maxV=Math.max(1,Math.max.apply(null,HIST));

    const curPC={}, pulse={};
    if(resolved){
      const clip=resolved.clip;
      SHAPES[resolved.patternId].notes.forEach(function(n){
        if(n.midi===null) return;
        const k=n.midi%12;
        curPC[k]=(curPC[k]||0)+1;
        const em=emphasis(clip.start+n.t, n.len, nt);
        if(em>0) pulse[k]=Math.max(pulse[k]||0, em);
      });
    }

    for(let i=0;i<12;i++){
      const a=-Math.PI/2 + i/12*Math.PI*2;
      const v=HIST[i]/maxV;
      const em=pulse[i]||0;
      const r0=R*0.42, r1=r0+v*R*0.58*(1+em*0.22);
      const x0=cx+Math.cos(a)*r0, y0=cy+Math.sin(a)*r0;
      const x1=cx+Math.cos(a)*r1, y1=cy+Math.sin(a)*r1;
      /* 音级柱：用主题表面原语，各主题获得自己的柱体质感 */
      g.save();
      g.translate(x0, y0);
      g.rotate(a + Math.PI/2);
      sFill(g, -Math.max(2,w/34)*(1+em*0.35)/2, 0,
            Math.max(2,w/34)*(1+em*0.35), Math.max(2, r1-r0),
            P.ink, Math.min(1,0.18+v*0.72+em*0.3), { seedKey: i });
      g.restore();
      const lx=cx+Math.cos(a)*(R+18), ly=cy+Math.sin(a)*(R+18);
      const isCur=(curPC[i]||0)>0;
      g.fillStyle=isCur? rgba(P.accent,Math.min(1,0.75+em*0.25)) : rgba(P.inkMid,0.85);
      g.font=(isCur?'600 ':'400 ')+'10px '+MONO;
      g.textAlign='center'; g.textBaseline='middle';
      g.fillText(NOTE_NAMES[i], lx, ly);
      if(isCur){
        g.fillStyle=rgba(P.accent,0.9);
        g.beginPath();
        g.arc(cx+Math.cos(a)*(R+34), cy+Math.sin(a)*(R+34), 2.4+em*2.2, 0, Math.PI*2);
        g.fill();
      }
    }
    const root=HIST.indexOf(Math.max.apply(null,HIST));
    g.fillStyle=rgba(P.ink,0.95);
    g.font='600 20px '+MONO; g.textAlign='center'; g.textBaseline='middle';
    g.fillText(NOTE_NAMES[root], cx, cy-8);
    g.fillStyle=rgba(P.inkFaint,0.95);
    g.font='400 9px '+FONT;
    g.fillText('ROOT', cx, cy+11);
    g.textAlign='left';
  }
});
