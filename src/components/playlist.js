/* 主时间轴 · playlist
   ------------------------------------------------------------
   乐器分层 + 泳道压缩。

   两处关键修正（用户反馈）：
   1. **「抽吸」效果**：音符位置原先用 `cw`（裁切后的**可见**宽度）计算，
      导致被边缘裁切的 Clip 内音符被压扁成细线——视觉上像被抽吸。
      现改用 Clip 的**完整**宽度定位音符，裁切只影响可见范围，
      不影响内部布局。这与真实时间轴的行为一致。
   2. **边缘处理**：原为硬裁切，改为左右**模糊渐隐**。
      越靠近边缘越淡，使画面没有生硬的切断感。

   强调动画：鼓组与旋律共用 emphasis()，保证动画统一。
   （绽放逻辑只适用于步进器的离散击打，不用于此处。）
*/

/* 边缘渐隐宽度（占绘图区宽度的比例） */
const PLAYLIST_EDGE_FADE = 0.055;

register({ id:'playlist', name:'主时间轴', w:1180, h:600, group:'结构',
  desc:'乐器分层 + 泳道压缩。<b>已修正「抽吸」效果</b>：音符位置原先用裁切后的可见宽度计算，导致边缘被裁切的 Clip 内音符被压扁；现改用 Clip 完整宽度定位。<b>左右改为模糊渐隐</b>，消除硬切断感。<b>主轴窗宽</b>可调（4~64 小节），窗越窄滚动越快、速度感越强。',
  draw:function(g,w,h){
    const pad=16;
    const WIN_BARS=窗口小节(MAIN_WIN_BARS);
    label(g,'PLAYLIST · 工程编排   '+WIN_BARS+' 小节窗',pad,pad+6);
    const top=pad+24, bottom=h-pad-18;
    const gx=pad+48, gw=w-gx-pad;
    const WIN=WIN_BARS*PPQ*4;
    const nt=nowTick();
    const w0=Math.max(0,Math.min(Math.max(0,MAXTICK-WIN),nt-WIN*0.30));
    /* 时间 → 屏幕 x（线性映射，不做任何非线性变换） */
    const toX=function(tk){ return gx+(tk-w0)/WIN*gw; };

    /* ---- 泳道压缩：每轨全曲固定一条泳道 ---- */
    const tracks=TL.tracks;
    const perTrack={};
    tracks.forEach(function(t){
      if(t.clips.length) perTrack[t.index]=t.clips.map(function(c){return [c.start,c.end];})
        .sort(function(a,b){return a[0]-b[0];});
    });
    const order=Object.keys(perTrack).map(Number)
      .sort(function(a,b){return perTrack[a][0][0]-perTrack[b][0][0];});
    const lanes=[], assign={};
    order.forEach(function(tid){
      const ivs=perTrack[tid]; let placed=false;
      for(let li=0;li<lanes.length;li++){
        const used=lanes[li]; let ok=true;
        for(let i=0;i<ivs.length&&ok;i++)
          for(let j=0;j<used.length;j++)
            if(ivs[i][0]<used[j][1]&&ivs[i][1]>used[j][0]){ok=false;break;}
        if(ok){ assign[tid]=li; used.push.apply(used,ivs); placed=true; break; }
      }
      if(!placed){ assign[tid]=lanes.length; lanes.push(ivs.slice()); }
    });
    const laneCount=lanes.length;
    const laneH=(bottom-top)/laneCount;

    /* ---- 拍格 ---- */
    const b0=Math.floor(w0/(PPQ*4)), b1=Math.ceil((w0+WIN)/(PPQ*4));
    for(let b=b0;b<=b1;b++){
      const x=toX(b*PPQ*4), major=b%4===0;
      g.strokeStyle=rgba(P.inkFaint, major?0.26:0.10);
      g.lineWidth= major?1:0.7;
      g.beginPath(); g.moveTo(Math.round(x)+.5,top);
      g.lineTo(Math.round(x)+.5,bottom); g.stroke();
      if(major){
        g.fillStyle=rgba(P.inkFaint,0.9);
        g.font='400 9px '+MONO; g.textBaseline='bottom';
        g.fillText(String(b+1),x+3,top-3);
      }
    }

    /* ---- 内容绘制（裁剪到绘图区） ---- */
    g.save();
    g.beginPath(); g.rect(gx,top-10,gw,bottom-top+12); g.clip();

    tracks.forEach(function(t){
      const li=assign[t.index]; if(li===undefined) return;
      const y=top+li*laneH;
      t.clips.forEach(function(c){
        /* a/b 是 Clip **完整**区间的屏幕坐标（可能超出绘图区） */
        const a=toX(c.start), b=toX(c.end);
        if(b<gx-6||a>gx+gw+6) return;

        /* 可见矩形：仅用于裁剪与底色 */
        const cx=Math.max(gx,a), cw=Math.max(2,Math.min(gx+gw,b)-cx);
        /* 完整宽度：用于内部音符定位（关键修正） */
        const fw=Math.max(1, b-a);

        const sh=SHAPES[c.sourceId];
        const isPat=c.type==='pattern';
        const base=isPat? tintOf(c.sourceId) : P.accent;

        if(!isPat||!sh||!sh.notes.length){
          /* 走主题质感（SURFACE.fill）。wh_soft 会画成描边而非填充，
             其它主题是带纹理的色块。失败则退回实心。 */
          try{
            sFill(g, cx, y+laneH*0.30, cw, laneH*0.40, base, 0.32,
                  {seedKey: Math.round(cx)});
          }catch(e){
            g.fillStyle=rgba(base,0.32);
            g.fillRect(cx,y+laneH*0.30,cw,laneH*0.40);
          }
          return;
        }

        const span=Math.max(1,c.end-c.start);
        const vlo=sh.velRange[0], vhi=sh.velRange[1], vspan=Math.max(1,vhi-vlo);
        const chs=sh.channels||[], nCh=Math.max(1,chs.length);
        const subH=(laneH-5)/nCh;
        const byCh={};
        sh.notes.forEach(function(n){ (byCh[n.ch]=byCh[n.ch]||[]).push(n); });

        chs.forEach(function(ch,ci){
          const sy=y+2.5+ci*subH;
          const notes=byCh[ch.id]||[]; if(!notes.length) return;

          g.save();
          g.beginPath(); g.rect(cx,sy,cw,subH-1.2); g.clip();
          try{
            sFill(g, cx, sy, cw, subH-1.2, base, 0.05+ci*0.022,
                  {seedKey: Math.round(cx)+ci});
          }catch(e){
            g.fillStyle=rgba(base,0.05+ci*0.022);
            g.fillRect(cx,sy,cw,subH-1.2);
          }

          if(sh.kind==='percussive'){
            const smid=sy+(subH-1.2)*0.5;
            notes.forEach(function(n){
              /* 用完整宽度 a+... 定位，再判断是否落在可见范围 */
              const px=a+(n.t/span)*fw;
              if(px<cx-6||px>cx+cw+6) return;
              const vv=n.vel===null?0.6:(n.vel-vlo)/vspan;
              const abs=c.start+n.t;
              const em=emphasis(abs, n.len, nt);
              inkDot(g,px,smid,Math.min(subH*0.34,0.9+vv*2.0),
                     0.34+vv*0.60, em, Math.floor(abs)+Math.round(px));
            });
          } else {
            const innerH=(subH-1.2)*0.78, smid=sy+(subH-1.2)*0.5;
            const yOf=function(m){ return smid+innerH*0.5-((m-PITCH_LO)/PITCH_SPAN)*innerH; };
            const pts=notes.filter(function(n){return n.midi!==null;})
              .map(function(n){ return {x:a+(n.t/span)*fw, y:yOf(n.midi), t:n.t}; })
              .sort(function(p,q){return p.t-q.t;});
            if(pts.length>1){
              g.strokeStyle=rgba(P.accent,0.42); g.lineWidth=1.0;
              g.beginPath();
              pts.forEach(function(p,i){
                if(i===0){ g.moveTo(p.x,p.y); return; }
                const pv=pts[i-1], mx=(pv.x+p.x)/2;
                g.bezierCurveTo(mx,pv.y,mx,p.y,p.x,p.y);
              });
              g.stroke();
            }
            notes.forEach(function(n){
              if(n.midi===null) return;
              const px=a+(n.t/span)*fw;
              if(px<cx-8||px>cx+cw+8) return;
              const vv=n.vel===null?0.6:(n.vel-vlo)/vspan;
              const abs=c.start+n.t;
              const em=emphasis(abs, n.len, nt);
              const len=Math.max(2,(n.len/span)*fw*0.9)*(1+em*0.30);
              const nh=Math.max(2.2,1.6+vv*1.8)*(1+em*0.42);
              const py=yOf(n.midi);
              seed(Math.floor(abs)+Math.round(px));
              g.fillStyle=rgba(P.ink,Math.min(1,0.50+vv*0.48+em*0.24));
              const edge=function(){ let v=0; for(let k=0;k<2;k++) v+=(rnd()-.5); return v*0.8; };
              g.beginPath();
              const steps=Math.max(2,Math.floor(len/7));
              for(let i=0;i<=steps;i++) g.lineTo(px-len/2+len*i/steps, py-nh/2+edge());
              for(let i=steps;i>=0;i--) g.lineTo(px-len/2+len*i/steps, py+nh/2+edge());
              g.closePath(); g.fill();
            });
          }
          g.restore();
        });
      });

      /* 泳道标号（不参与渐隐，始终清晰） */
      g.fillStyle=rgba(P.inkFaint,0.6);
      g.font='400 8px '+MONO; g.textAlign='right'; g.textBaseline='middle';
      g.fillText('L'+String(li+1).padStart(2,'0'), gx-6, y+laneH*0.5);
      g.textAlign='left';
    });

    /* ---- 边缘模糊渐隐 ----
       用与底色相同的渐变覆盖两端，使内容自然消失而非硬切断。
       渐隐宽度按绘图区比例，窄窗下自动收窄，避免吃掉过多内容。 */
    const fadeW=Math.min(gw*0.14, Math.max(24, gw*PLAYLIST_EDGE_FADE));
    const bgCol=P.bg;
    const gl=g.createLinearGradient(gx,0,gx+fadeW,0);
    gl.addColorStop(0,rgba(bgCol,1));
    gl.addColorStop(0.55,rgba(bgCol,0.72));
    gl.addColorStop(1,rgba(bgCol,0));
    g.fillStyle=gl;
    g.fillRect(gx,top-10,fadeW,bottom-top+12);

    const gr=g.createLinearGradient(gx+gw,0,gx+gw-fadeW,0);
    gr.addColorStop(0,rgba(bgCol,1));
    gr.addColorStop(0.55,rgba(bgCol,0.72));
    gr.addColorStop(1,rgba(bgCol,0));
    g.fillStyle=gr;
    g.fillRect(gx+gw-fadeW,top-10,fadeW,bottom-top+12);

    g.restore();

    /* ---- 播放指针（在渐隐之上，保持清晰） ---- */
    const px=toX(nt);
    if(px>=gx&&px<=gx+gw){
      g.strokeStyle=rgba(P.accent,0.92); g.lineWidth=1.2;
      g.beginPath(); g.moveTo(Math.round(px)+.5,top-4);
      g.lineTo(Math.round(px)+.5,bottom); g.stroke();
    }

    /* ---- 底部状态 ---- */
    g.fillStyle=rgba(P.inkFaint,0.85);
    g.font='400 9px '+MONO; g.textBaseline='bottom';
    g.fillText(Object.keys(assign).length+' TRACKS → '+laneCount+' LANES', gx, h-pad-4);
  }
});
