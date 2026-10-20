/* 钢琴卷帘 · pianoroll
   已按反馈重做：① 收窄为 2 小节滚动窗（可调）；② 取消可见指针，改为隐指针——画面不显示但实际存在，经过的音符仍有动画；③ Pattern 按人工优先级选择，当前无 Pattern 时顺延到最近的一个，永不空置；④ 无 Pattern 时显示默认空网格而非文字提示；⑤ 音符呈现与主时间轴略加区分 */

register({ id:'pianoroll', name:'钢琴卷帘', w:900, h:300, group:'内容',
  desc:'<b>已按反馈重做</b>：① 收窄为 2 小节滚动窗（可调）；② <b>取消可见指针</b>，改为隐指针——画面不显示但实际存在，经过的音符仍有动画；③ Pattern 按<b>人工优先级</b>选择，当前无 Pattern 时顺延到最近的一个，<b>永不空置</b>；④ 无 Pattern 时显示默认空网格而非文字提示；⑤ 音符呈现与主时间轴略加区分（圆角矩形 + 强调描边）。',
  draw:function(g,w,h){
    const pad=14;
    const nt=nowTick();
    const resolved=resolvePattern(RANK,'melodic');
    if(!resolved){
      label(g,'PIANO ROLL · 钢琴卷帘',pad,pad+6);
      const top=pad+26, bottom=h-pad-16;
      const gx=pad+40, gw=w-gx-pad;
      for(let i=0;i<=8;i++){
        const y=top+(bottom-top)*i/8;
        g.strokeStyle=rgba(P.inkFaint, i%2?0.10:0.16); g.lineWidth=0.7;
        g.beginPath(); g.moveTo(gx,Math.round(y)+.5);
        g.lineTo(gx+gw,Math.round(y)+.5); g.stroke();
      }
      for(let i=0;i<=8;i++){
        const x=gx+gw*i/8;
        g.strokeStyle=rgba(P.inkFaint, i%2?0.10:0.16); g.lineWidth=0.7;
        g.beginPath(); g.moveTo(Math.round(x)+.5,top);
        g.lineTo(Math.round(x)+.5,bottom); g.stroke();
      }
      return;
    }
    const sh=SHAPES[resolved.patternId];
    const clip=resolved.clip;
    const isPerc=sh.kind==='percussive';
    const chName=(sh.channels[0]&&sh.channels[0].name)?' · '+sh.channels[0].name.slice(0,22):'';
    label(g,(isPerc?'STEP GRID · 步进':'PIANO ROLL · 卷帘')+
          '   P'+resolved.patternId+chName+
          '', pad, pad+6);

    const top=pad+26, bottom=h-pad-16;
    const gx=pad+40, gw=w-gx-pad;
    const 窗 = 窗口小节(WIN_BARS);
    const winTicks=窗*PPQ*4;
    const absNow=nt;
    const wStart=absNow-winTicks*0.38;
    const toX=function(absTk){ return gx+((absTk-wStart)/winTicks)*gw; };

    /* 边缘渐隐
       ------------------------------------------------------------
       用户反馈：音符在最右侧刚进来、最左侧要出去时都很突兀 ——
       左边是一整根捅出画布，中心点一越过左边界就整个消失。

       根因（实测才发现）：这些 pattern 的音符是**长音符**（持续的和弦）。
       若按「中心点」算权重，长音符中心还在画面里，
       但它的身体早已伸到边缘之外，于是整根以全不透明度画出去 ——
       渐隐看起来完全没生效（实测右端最大暗度 197，
       而左端只有 49.65，因为另一端恰好没有长音符压边）。

       正确做法：按音符**两端**分别判断
         · 判左边用它的**右端**（xR）→ 尾巴滑到左边界才淡出
         · 判右边用它的**左端**（xL）→ 头刚进右边界时淡入
       短音符（len≈0）退化成中心点判断，与原来一致。

       另外配合裁剪，音符不会画到可动区之外。 */
    const EDGE_FADE = Math.min(gw * 0.20, 96);

    /* 边缘渐隐渐变
       ------------------------------------------------------------
       最初按「音符中心」算 alpha → 长音符整根捅出去（实测右端
       最大暗度 197 vs 左端 49.65）。
       再改成按「音符两端」算 → 两端都变成全黑（230），
       因为长音符的身体本来就横跨整个可视区，
       任何「整根一个透明度」的方案都不可能让边缘淡下去。

       最终方案：一条横向渐变，边缘 alpha=0、中段 alpha=1，
       所有音符共用（fillStyle 可复用）；每个音符自己的
       力度/强调用 globalAlpha 叠乘。
       渐变按像素求值，长音符的中间浓、两端自然淡出。 */
    const 边缘渐变 = g.createLinearGradient(gx, 0, gx + gw, 0);
    const f0 = Math.max(0.001, EDGE_FADE / gw);
    边缘渐变.addColorStop(0, rgba(DCOL.data, 0));
    边缘渐变.addColorStop(f0, rgba(DCOL.data, 1));
    边缘渐变.addColorStop(1 - f0, rgba(DCOL.data, 1));
    边缘渐变.addColorStop(1, rgba(DCOL.data, 0));
    /* 音符是否还该画：起点在窗口内，或「尾巴」仍伸进视野。
       原来只判起点，导致长音符尾巴还在画面里就被整个丢掉。 */
    function 在视野内(abs, len) {
      const 尾 = abs + (len || 0);
      return 尾 >= wStart - 8 && abs <= wStart + winTicks + 8;
    }
    /* 窗口内所有 pattern clip —— 连续滚动的基础。
       原来只取 resolved 那一个，pattern 一换就整体位移，
       画面跳回开头（用户反馈的突兀感）。 */
    const clipsInWin=collectClipsInWindow(RANK, isPerc?'percussive':'melodic',
                                          wStart, wStart+winTicks);
    /* 窗口内实际画出的音符（两个分支共用，供底部统计） */
    let 全部音符 = [];
    const vlo=sh.velRange[0], vhi=sh.velRange[1], vspan=Math.max(1,vhi-vlo);

    if(isPerc){
      const STEP=PPQ/4;
      const chs=sh.channels.length?sh.channels:[{id:null,name:'',count:sh.notes.length}];
      const rowH=(bottom-top)/chs.length;
      /* 连续滚动：窗口内所有 clip 的音符，按通道归并 */
      const byCh={};
      全部音符 = [];
      clipsInWin.forEach(function (it) {
        const sh2 = SHAPES[it.patternId];
        if (!sh2 || !sh2.notes) return;
        sh2.notes.forEach(function (n) {
          const abs = it.clip.start + n.t;
          if (!在视野内(abs, n.len)) return;
          const nn = { abs: abs, ch: n.ch, vel: n.vel, len: n.len };
          (byCh[n.ch] = byCh[n.ch] || []).push(nn);
          全部音符.push(nn);
        });
      });
      const s0=Math.floor(wStart/STEP), s1=Math.ceil((wStart+winTicks)/STEP);
      chs.forEach(function(ch,ci){
        const y=top+ci*rowH;
        g.fillStyle=rgba(DCOL.data3,0.14);
        g.fillRect(gx,y+2,gw,rowH-4);
        for(let s=s0;s<=s1;s++){
          const x=toX(s*STEP);
          if(x<gx||x>gx+gw) continue;
          g.strokeStyle=rgba(P.inkFaint, s%4===0?0.26:0.10);
          g.lineWidth= s%4===0?1:0.7;
          g.beginPath(); g.moveTo(Math.round(x)+.5,y+2);
          g.lineTo(Math.round(x)+.5,y+rowH-2); g.stroke();
        }
        /* 音符裁剪到本行区域内 + 边缘渐隐，
           避免音符画到行外或越界后突然消失 */
        g.save();
        g.beginPath(); g.rect(gx, y + 1, gw, rowH - 2); g.clip();
        (byCh[ch.id]||[]).forEach(function(n){
          const abs=n.abs;      /* 连续滚动：已是绝对 tick */
          const x=toX(abs);
          const vv=n.vel===null?0.6:(n.vel-vlo)/vspan;
          const em=emphasis(abs, n.len, nt);
          const sz=Math.min(rowH*0.42, 2.6+vv*3.4);
          inkNoteFade(g,x,y+rowH/2, sz, sz, 0.34+vv*0.60, em,
                      Math.floor(abs)+Math.round(x), 边缘渐变);
        });
        g.restore();
        if(ch.name){
          g.fillStyle=rgba(P.inkFaint,0.9);
          g.font='400 8px '+MONO; g.textAlign='right'; g.textBaseline='middle';
          g.fillText(ch.name.slice(0,10), gx-6, y+rowH/2);
          g.textAlign='left';
        }
      });
    } else {
      const innerH=bottom-top;
      const yOf=function(m){ return top+innerH-((m-PITCH_LO)/PITCH_SPAN)*innerH; };
      for(let m=PITCH_LO;m<=PITCH_HI;m++){
        if(m%12!==0) continue;
        const y=yOf(m);
        g.strokeStyle=rgba(P.inkFaint,0.16); g.lineWidth=0.7;
        g.beginPath(); g.moveTo(gx,Math.round(y)+.5);
        g.lineTo(gx+gw,Math.round(y)+.5); g.stroke();
        g.fillStyle=rgba(P.inkFaint,0.9);
        g.font='400 8px '+MONO; g.textAlign='right'; g.textBaseline='middle';
        g.fillText('C'+(m/12-1), gx-5, y);
        g.textAlign='left';
      }
      const s0=Math.floor(wStart/(PPQ/4)), s1=Math.ceil((wStart+winTicks)/(PPQ/4));
      for(let s=s0;s<=s1;s++){
        if(s%4!==0) continue;
        const x=toX(s*PPQ/4);
        if(x<gx||x>gx+gw) continue;
        g.strokeStyle=rgba(P.inkFaint, s%16===0?0.26:0.12);
        g.lineWidth= s%16===0?1:0.7;
        g.beginPath(); g.moveTo(Math.round(x)+.5,top);
        g.lineTo(Math.round(x)+.5,bottom); g.stroke();
      }
      /* 连续滚动：窗口内**所有** clip 的音符都画。
         ------------------------------------------------
         每个音符用自己 clip 的 start 映射到绝对时间轴，
         于是 pattern 是流过去的；不再因为「当前 pattern 变了」
         而整体位移（那会造成跳回开头的突兀感）。
         连线也跨 clip 连接 —— 相邻 pattern 的音符自然接上。 */
      全部音符 = [];
      clipsInWin.forEach(function (it) {
        const sh2 = SHAPES[it.patternId];
        if (!sh2 || !sh2.notes) return;
        const c0 = it.clip;
        sh2.notes.forEach(function (n) {
          if (n.midi === null || n.midi === undefined) return;
          const abs = c0.start + n.t;
          if (!在视野内(abs, n.len)) return;
          全部音符.push({ abs: abs, midi: n.midi, vel: n.vel,
                          len: n.len, pid: it.patternId });
        });
      });
      全部音符.sort(function (p, q) { return p.abs - q.abs; });

      /* 音符与连线都裁剪在网格区内 + 边缘渐隐，
         让音符从右侧渐显滚入、左侧渐隐滚出 */
      g.save();
      g.beginPath(); g.rect(gx, top, gw, innerH); g.clip();

      const pts = 全部音符.map(function (n) {
        return { x: toX(n.abs), y: yOf(n.midi), t: n.abs };
      });
      if (pts.length > 1) {
        g.strokeStyle = rgba(P.accent, 0.38); g.lineWidth = 1;
        g.beginPath();
        pts.forEach(function (p, i) {
          if (i === 0) { g.moveTo(p.x, p.y); return; }
          const pv = pts[i - 1], mx = (pv.x + p.x) / 2;
          g.bezierCurveTo(mx, pv.y, mx, p.y, p.x, p.y);
        });
        g.stroke();
      }
      全部音符.forEach(function (n) {
        const x = toX(n.abs), y = yOf(n.midi);
        const vv = n.vel === null ? 0.6 : (n.vel - vlo) / vspan;
        const em = emphasis(n.abs, n.len, nt);
        const len = Math.max(3, (n.len / winTicks) * gw * 0.92);
        const nh = Math.max(3, 3.2 + vv * 2.6);
        inkNoteFade(g, x, y, len, nh, 0.50 + vv * 0.48, em,
                    Math.floor(n.abs) + Math.round(x), 边缘渐变);
      });

      g.restore();
    }

    g.fillStyle=rgba(P.inkFaint,0.85);
    g.font='400 9px '+MONO; g.textBaseline='bottom';
    /* 统计改为「窗口内实际画出的音符数」。
       原来统计的是单个 pattern 的音符（inWin），
       现在画的是多个 pattern 的合成，两者已不同。
       「順延顯示」这个标记也失去意义了 —— 连续滚动下窗口里
       本来就同时有多个 pattern，不存在「当前无 pattern 而顺延」。 */
    g.fillText(窗+' BARS · '+clipsInWin.length+' PATTERNS · '+
               全部音符.length+' NOTES', gx, h-pad-4);
    g.textAlign='right';
    g.fillText('HIDDEN PLAYHEAD', gx+gw, h-pad-4);
    g.textAlign='left';
  }
});
