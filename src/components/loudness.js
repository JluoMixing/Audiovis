/* 响度 · loudness
   ------------------------------------------------------------
   与「瞬态」的区别（两者曾雷同，用户指出后重新设计）：

   瞬态 = 离散事件的冲击 → 从中心向外扩散的**涟漪环**
   响度 = 持续的能量的水平 → **横向累积的沉积层**

   设计：把响度表达为"沉积"。每一帧的能量在画面右侧留下一道
   横向条带，随时间向左推移并逐渐沉降；条带的高度与浓度
   代表当时的响度。于是画面成为一条**响度的时间地层**——
   读得出"刚才那一段有多响"，而不是只有一个瞬时读数。

   这既保留了"当下响度"的可读性，又避免了与瞬态的形状重复。

   依赖：core/*
   ============================================================ */

/* 沉积层的历史长度（秒）。越长越像地层，越短越聚焦当下。 */
const LOUDNESS_HISTORY = 6.0;

/* 沉积层的条数（决定纵向分辨率） */
const LOUDNESS_LAYERS = 26;

register({ id:'loudness', name:'响度', w:420, h:300, group:'音频',
  desc:'<b>已重新设计</b>，与瞬态明确区分：瞬态是<b>涟漪</b>（离散事件的冲击），响度是<b>沉积</b>（持续能量的水平）。<br>每帧能量在右侧留下一道横向条带，随时间向左推移并沉降；条带高度与浓度代表当时的响度。画面因此成为一条可读的<b>响度地层</b>，而非单一瞬时读数。',
  draw:function(g,w,h){
    const pad=14;
    label(g,'LOUDNESS · 响度',pad,pad+6);
    const fi=featAt(CUR);

    const x0=pad, y0=pad+28, ww=w-pad*2, hh=h-y0-pad-24;
    const mid=y0+hh*0.5;

    /* 采集历史：从当前时刻往回取 LOUDNESS_HISTORY 秒 */
    const spanFrames=Math.max(2, Math.round(LOUDNESS_HISTORY*FEAT.fps));
    const layers=Math.min(LOUDNESS_LAYERS, spanFrames);

    /* 参考线：静音基线 */
    g.strokeStyle=rgba(P.inkFaint,0.16); g.lineWidth=0.7;
    g.beginPath(); g.moveTo(x0,Math.round(mid)+.5);
    g.lineTo(x0+ww,Math.round(mid)+.5); g.stroke();

    /* 从旧到新绘制沉积层：越旧越淡、越沉、越扁 */
    for(let k=layers-1;k>=0;k--){
      const j=fi-k;                       /* 该层对应的特征帧 */
      if(j<0) continue;
      const age=k/Math.max(1,layers-1);   /* 0=最新, 1=最旧 */
      const v=FEAT.rmsNorm[j];

      /* 横向位置：最新在右，越旧越靠左 */
      const lx=x0+ww*(1-age);
      const lw=ww/Math.max(1,layers)*1.35;

      /* 高度：响度越大越高；随时间轻微沉降（变扁） */
      const amp=(0.10+v*0.86)*(1-age*0.35);
      const lh=Math.max(1, amp*hh*0.5);

      /* 浓度：越旧越淡 */
      const alpha=(0.16+v*0.62)*(1-age*0.72);

      /* 用主题表面原语绘制，自动获得该主题的质感 */
      sFill(g, lx, mid-lh, lw, lh*2, DCOL.data, alpha, { seedKey:j });

      /* 上缘强调线：标示该时刻的峰值（仅较新的层） */
      if(age<0.35){
        g.strokeStyle=rgba(DCOL.data2, alpha*0.95);
        g.lineWidth=1;
        g.beginPath();
        g.moveTo(lx, mid-lh); g.lineTo(lx+lw, mid-lh);
        g.stroke();
      }
    }

    /* 当下读数：右侧的小字，不喧宾夺主 */
    const vNow=FEAT.rmsNorm[fi];
    g.fillStyle=rgba(P.ink,0.9);
    g.font='600 13px '+MONO; g.textAlign='right'; g.textBaseline='top';
    g.fillText(FEAT.rmsDb[fi].toFixed(1)+' dBFS', x0+ww, y0-20);
    g.textAlign='left';

    /* 时间刻度：说明沉积层覆盖的时间跨度 */
    g.fillStyle=rgba(P.inkFaint,0.8);
    g.font='400 8px '+MONO; g.textBaseline='bottom';
    g.fillText('−'+LOUDNESS_HISTORY.toFixed(1)+'s', x0, h-pad-2);
    g.textAlign='right';
    g.fillText('NOW', x0+ww, h-pad-2);
    g.textAlign='left';
  }
});
