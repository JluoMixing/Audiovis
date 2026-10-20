/* Vectorscope · vectorscope
   已修正静帧问题：旧版预先把整曲压成 8 张密度帧，播放时只是轮播静帧。现改为存降采样立体声（2.2kHz），渲染时按当前时刻逐帧计算密度，动画连贯。相关度同为实时计算。 */

register({ id:'vectorscope', name:'Vectorscope', w:300, h:300, group:'音频',
  desc:'<b>已修正静帧问题</b>：旧版预先把整曲压成 8 张密度帧，播放时只是轮播静帧。现改为存降采样立体声（2.2kHz），渲染时<b>按当前时刻逐帧计算密度</b>，动画连贯。相关度同为实时计算。',
  draw:function(g,w,h){
    const pad=14;
    label(g,'VECTORSCOPE · 声场',pad,pad+6);
    const R=Math.min(w,h)/2-34, cx=w/2, cy=h/2+6;
    const rate=VS.rate, win=VS.windowSec;
    const c0=Math.max(0,Math.floor(CUR*rate));
    const c1=Math.min(VS.count, c0+Math.floor(win*rate));
    const S=96;
    const grid=new Float32Array(S*S);
    let lSum=0,rSum=0,l2=0,r2=0,lr=0,cnt=0;
    let peak=1e-6;
    for(let i=c0;i<c1;i++){
      const l=VS_L[i]/32768, r=VS_R[i]/32768;
      const a=Math.abs((l-r)*0.5), b=Math.abs((l+r)*0.5);
      if(a>peak) peak=a;
      if(b>peak) peak=b;
    }
    const scale=peak*1.10;
    for(let i=c0;i<c1;i++){
      const l=VS_L[i]/32768, r=VS_R[i]/32768;
      const x=(l-r)*0.5/scale, y=(l+r)*0.5/scale;
      if(x<-1||x>1||y<-1||y>1) continue;
      const gx=Math.min(S-1,Math.max(0,Math.floor((x*0.5+0.5)*S)));
      const gy=Math.min(S-1,Math.max(0,Math.floor((0.5-y*0.5)*S)));
      grid[gy*S+gx]+=1;
      lSum+=l; rSum+=r; l2+=l*l; r2+=r*r; lr+=l*r; cnt++;
    }
    let corr=1;
    if(cnt>16){
      const ml=lSum/cnt, mr=rSum/cnt;
      const vl=l2/cnt-ml*ml, vr=r2/cnt-mr*mr, cv=lr/cnt-ml*mr;
      const d=Math.sqrt(Math.max(1e-12,vl*vr));
      corr=cv/d;
    }
    const cell=(R*2)/S;
    g.save(); g.beginPath(); g.arc(cx,cy,R,0,Math.PI*2); g.clip();
    for(let yy=0;yy<S;yy++) for(let xx=0;xx<S;xx++){
      const v=grid[yy*S+xx]; if(v<=0) continue;
      const t=Math.min(1, Math.log1p(v)/Math.log1p(24));
      const px=cx-R+xx*cell, py=cy-R+yy*cell;
      sMark(g, px, py, Math.max(0.7, cell*(0.6+t*1.7)*0.5),
            DCOL.data, 0.22+t*0.85, { seedKey: yy*S+xx });
    }
    g.restore();
    g.strokeStyle=rgba(P.inkFaint,0.5); g.lineWidth=1;
    g.beginPath(); g.arc(cx,cy,R,0,Math.PI*2); g.stroke();
    g.strokeStyle=rgba(P.inkFaint,0.24); g.lineWidth=0.7;
    g.beginPath(); g.moveTo(cx-R,cy); g.lineTo(cx+R,cy); g.stroke();
    g.beginPath(); g.moveTo(cx,cy-R); g.lineTo(cx,cy+R); g.stroke();
    g.fillStyle=rgba(P.inkFaint,0.9);
    g.font='400 9px '+MONO; g.textBaseline='bottom';
    g.fillText('CORR '+(corr>=0?'+':'')+corr.toFixed(3), pad, h-pad-2);
  }
});
