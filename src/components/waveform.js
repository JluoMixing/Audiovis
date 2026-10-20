/* 波形 · waveform
   ------------------------------------------------------------
   滚动窗口（默认 2 小节，可调）。峰值 + RMS 双包络。

   主题自适应：包络条通过 sFill 绘制，自动获得各主题的质感
   （墨·紙的不规则边缘、図面的斜线、織的经纬、孔版的套印等）。
   为避免每根条都做重纹理导致过密，纹理按**分段**应用：
   每 6 根条合并为一段，段内共用一个纹理种子。
*/

register({ id:'waveform', name:'波形', w:640, h:160, group:'音频',
  desc:'滚动窗口（默认 2 小节，可调）。峰值 + RMS 双包络。<b>主题自适应</b>：包络条经主题表面原语绘制，各主题呈现自己的质感（墨·紙不规则边缘 / 図面斜线 / 織经纬 / 孔版套印）。',
  draw:function(g,w,h){
    const pad=14;
    label(g,'WAVEFORM · 波形',pad,pad+6);
    const x0=pad, y0=pad+24, ww=w-pad*2, hh=h-y0-pad-18;
    const mid=y0+hh/2;
    const 窗 = 窗口小节(WIN_BARS);
  const winTicks=窗*PPQ*4;
    const nt=nowTick();
    const wStart=nt-winTicks*0.72;
    const t0=secOfTick(wStart)/DUR, t1=secOfTick(wStart+winTicks)/DUR;
    const pk=WAVE.peak, rm=WAVE.rms, N=pk.length;
    const i0=Math.max(0,Math.floor(t0*N)), i1=Math.min(N,Math.ceil(t1*N));
    const n=Math.max(1,i1-i0);
    const bw=ww/n;

    /* 分段：每 SEG 根条共用一个纹理种子，兼顾质感与性能 */
    const SEG=6;
    for(let i=0;i<n;i+=SEG){
      const segEnd=Math.min(n,i+SEG);
      const sx=x0+i*bw, sw=Math.max(0.8,(segEnd-i)*bw);
      /* 峰值外廓 */
      let pa=0;
      for(let k=i;k<segEnd;k++) pa=Math.max(pa, pk[i0+k]);
      if(pa>0.004){
        const a=pa*(hh/2)*0.95;
        sFill(g, sx, mid-a, sw, a*2, DCOL.data3, 0.55, { seedKey:i });
      }
      /* RMS 主体 */
      let ra=0;
      for(let k=i;k<segEnd;k++) ra=Math.max(ra, rm[i0+k]);
      if(ra>0.012){
        const a=ra*(hh/2)*0.95;
        sFill(g, sx, mid-a, sw, a*2, DCOL.data, 0.92, { seedKey:i+9999 });
      }
    }

    /* 中线 */
    g.strokeStyle=rgba(P.inkFaint,0.35); g.lineWidth=0.7;
    g.beginPath(); g.moveTo(x0,Math.round(mid)+.5);
    g.lineTo(x0+ww,Math.round(mid)+.5); g.stroke();

    /* 播放位置 */
    const px=x0+((nt-wStart)/winTicks)*ww;
    if(px>=x0&&px<=x0+ww){
      g.strokeStyle=rgba(P.accent,0.9); g.lineWidth=1.2;
      g.beginPath(); g.moveTo(Math.round(px)+.5,y0);
      g.lineTo(Math.round(px)+.5,y0+hh); g.stroke();
    }

    g.fillStyle=rgba(P.inkFaint,0.85);
    g.font='400 9px '+MONO; g.textBaseline='bottom';
    g.fillText(窗+' BARS WINDOW', x0, h-pad-2);
  }
});
