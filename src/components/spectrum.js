/* 频谱 · spectrum
   已改为滚动窗口（默认 2 小节，可调），随指针推进快速滚动，不再展示全曲。窗口内约 50 帧，分辨率足够看清鼓点与音色变化。 */

register({ id:'spectrum', name:'频谱', w:640, h:200, group:'音频',
  desc:'<b>已改为滚动窗口</b>（默认 2 小节，可调），随指针推进快速滚动，不再展示全曲。窗口内约 50 帧，分辨率足够看清鼓点与音色变化。',
  draw:function(g,w,h){
    const pad=14;
    label(g,'SPECTRUM · 频谱',pad,pad+6);
    const x0=pad, y0=pad+24, ww=w-pad*2, hh=h-y0-pad-18;
    const 窗 = 窗口小节(WIN_BARS);
  const winTicks=窗*PPQ*4;
    const nt=nowTick();
    const wStart=nt-winTicks*0.72;
    const s0=secOfTick(wStart), s1=secOfTick(wStart+winTicks);
    const f0=Math.max(0,Math.floor(s0*SPEC.fps));
    const f1=Math.min(SPEC.frames, Math.ceil(s1*SPEC.fps));
    const nf=Math.max(1,f1-f0);
    const B=SPEC.bands;
    const off=document.createElement('canvas'); off.width=nf; off.height=B;
    const o=off.getContext('2d'), img=o.createImageData(nf,B);
    for(let b=0;b<B;b++){
      const sy=B-1-b;
      for(let f=0;f<nf;f++){
        const v=SPEC_BYTES[(f0+f)*B+b]/255;
        /* 数据色：从 bg 混到 DCOL.data（主题色），不是混到 ink（灰阶）。
           这是频谱看起来「有色」的关键 —— 原来混 ink 必然是灰的。 */
        const col=hex2rgb(mixHex(P.bg,DCOL.data,Math.pow(v,1.3)));
        const k=(sy*nf+f)*4;
        img.data[k]=col[0]; img.data[k+1]=col[1]; img.data[k+2]=col[2];
        img.data[k+3]= v<0.10?0:255;
      }
    }
    o.putImageData(img,0,0);
    g.save(); g.imageSmoothingEnabled=false;
    g.drawImage(off,x0,y0,ww,hh); g.restore();
    g.fillStyle=rgba(P.inkFaint,0.9);
    g.font='400 8px '+MONO; g.textBaseline='middle';
    [100,1000,10000].forEach(function(fq){
      const t=Math.log(fq/SPEC.fmin)/Math.log(SPEC.fmax/SPEC.fmin);
      g.fillText(fq>=1000?(fq/1000)+'k':String(fq), x0+3, y0+hh-t*hh);
    });
    const px=x0+((nt-wStart)/winTicks)*ww;
    if(px>=x0&&px<=x0+ww){
      g.strokeStyle=rgba(P.accent,0.9); g.lineWidth=1.2;
      g.beginPath(); g.moveTo(Math.round(px)+.5,y0);
      g.lineTo(Math.round(px)+.5,y0+hh); g.stroke();
    }
    g.fillStyle=rgba(P.inkFaint,0.85);
    g.font='400 9px '+MONO; g.textBaseline='bottom';
    g.fillText(窗+' BARS WINDOW · '+nf+' FRAMES', x0, h-pad-2);
  }
});
