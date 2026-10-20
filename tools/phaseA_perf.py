"""阶段 A-4：渲染测速。

目的：回答「生成一条 4 分钟视频要多久」——这决定产品是否可用。

方法：用真实组件与主题，逐帧渲染到离屏 canvas，
      测单帧耗时，再外推整曲。

注意：浏览器内的 canvas 渲染 ≠ 视频编码。
      本测试只测**渲染**部分（编码是另一段可预测的开销）。
"""
import json
import pathlib
import subprocess
import sys

工具 = pathlib.Path(r"D:\FL_VISUAL_TEST\tools")
页面 = pathlib.Path(r"D:\FL_VISUAL_TEST\dist\components.html")

if not 页面.is_file():
    sys.exit("找不到构建产物：%s（请先运行 src/build/build.py）" % 页面)

脚本 = r'''
import { spawn } from 'node:child_process';
import http from 'node:http';

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const PORT = 9500;
const child = spawn(EDGE, ['--headless','--disable-gpu','--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${process.env.TEMP}\\perf_test`,
  '--window-size=1920,1080',
  'file:///D:/FL_VISUAL_TEST/dist/components.html'], { stdio:'ignore' });

const get = p => new Promise((res,rej)=>{ http.get({host:'127.0.0.1',port:PORT,path:p},r=>{
  let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }).on('error',rej); });
const sleep = ms => new Promise(r=>setTimeout(r,ms));

try {
  let t=null;
  for(let i=0;i<50;i++){ try{ t=await get('/json/list'); if(t?.length) break; }catch{} await sleep(400); }
  const page=t.find(x=>x.type==='page')||t[0];
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r));
  let id=0;
  const send=(m,p)=>new Promise(res=>{ const my=++id;
    const h=ev=>{ const x=JSON.parse(ev.data); if(x.id===my){ ws.removeEventListener('message',h); res(x.result); } };
    ws.addEventListener('message',h); ws.send(JSON.stringify({id:my,method:m,params:p})); });
  await send('Page.enable'); await sleep(3500);

  // 1) 单帧渲染耗时（全部 11 个组件）
  const r1 = await send('Runtime.evaluate', {
    expression: `(() => {
      const N=60;
      const t0=performance.now();
      for(let i=0;i<N;i++){ CUR=20+i*0.5; redraw(); }
      const dt=(performance.now()-t0)/N;
      CUR=DATA.previewTime;
      return JSON.stringify({ perFrameMs: Number(dt.toFixed(3)), frames:N });
    })()`, returnByValue: true
  });

  // 2) 单组件耗时排行
  const r2 = await send('Runtime.evaluate', {
    expression: `(() => {
      const out=[];
      ITEMS.forEach(function(it){
        const N=40;
        const t0=performance.now();
        for(let i=0;i<N;i++){
          const g=it.g;
          g.save(); g.setTransform(it.DPR,0,0,it.DPR,0,0);
          panelBackground(g,it.c.w,it.c.h);
          g.restore();
          try{ it.c.draw(g,it.c.w,it.c.h); }catch(e){}
        }
        const dt=(performance.now()-t0)/N;
        out.push({id:it.c.id, ms:Number(dt.toFixed(3))});
      });
      out.sort(function(a,b){return b.ms-a.ms;});
      return JSON.stringify(out);
    })()`, returnByValue: true
  });

  // 3) 1920x1080 全画布渲染耗时（模拟最终输出尺寸）
  const r3 = await send('Runtime.evaluate', {
    expression: `(() => {
      const cv=document.createElement('canvas');
      cv.width=1920; cv.height=1080;
      const g=cv.getContext('2d');
      const N=30;
      const t0=performance.now();
      for(let i=0;i<N;i++){
        CUR=20+i*0.5;
        g.fillStyle=P.bg; g.fillRect(0,0,1920,1080);
        // 按最终布局比例摆放若干组件
        ITEMS.slice(0,4).forEach(function(it,k){
          g.save();
          g.translate((k%2)*960, Math.floor(k/2)*540);
          g.scale(960/it.c.w, 540/it.c.h);
          try{ it.c.draw(g,it.c.w,it.c.h); }catch(e){}
          g.restore();
        });
      }
      const dt=(performance.now()-t0)/N;
      CUR=DATA.previewTime;
      return JSON.stringify({ fullFrameMs: Number(dt.toFixed(3)), frames:N });
    })()`, returnByValue: true
  });

  console.log(JSON.stringify({
    allComponents: JSON.parse(r1.result.value),
    perComponent: JSON.parse(r2.result.value),
    fullFrame: JSON.parse(r3.result.value)
  }));
} finally { child.kill(); }
'''

临时 = 工具 / "_perf_tmp.mjs"
临时.write_text(脚本, encoding="utf-8")
try:
    进程 = subprocess.run(["node", str(临时)], capture_output=True, timeout=300)
    输出 = 进程.stdout.decode("utf-8", "replace").strip()
    if not 输出:
        print("无输出；stderr:")
        print(进程.stderr.decode("utf-8", "replace")[:800])
        sys.exit(1)
    数据 = json.loads(输出.splitlines()[-1])
finally:
    临时.unlink(missing_ok=True)

全组件 = 数据["allComponents"]
整帧 = 数据["fullFrame"]
单组件 = 数据["perComponent"]

print("=" * 72)
print("阶段 A：渲染测速")
print("=" * 72)
print()
print("【1】全部 11 个组件一起渲染")
print("     单帧耗时: %.2f ms   → 理论上限 %.0f fps" % (
    全组件["perFrameMs"], 1000 / 全组件["perFrameMs"]))
print()
print("【2】单组件耗时排行（前 6）")
print("     %-16s %10s" % ("组件", "ms/帧"))
for x in 单组件[:6]:
    print("     %-16s %10.2f" % (x["id"], x["ms"]))
print("     ...")
print("     合计: %.2f ms" % sum(x["ms"] for x in 单组件))
print()
print("【3】1920×1080 整帧渲染（模拟最终输出尺寸，含 4 个组件）")
print("     单帧耗时: %.2f ms" % 整帧["fullFrameMs"])
print()

# ---- 外推 ----
时长秒 = 266.0   # nujabes
print("=" * 72)
print("外推：生成一条 %.0f 秒（4分26秒）的视频" % 时长秒)
print("=" * 72)
print()
print("%-12s %14s %14s %14s" % ("帧率", "总帧数", "纯渲染耗时", "含编码估算*"))
print("-" * 60)
for fps in (24, 30, 60):
    总帧 = 时长秒 * fps
    渲染分 = 总帧 * 整帧["fullFrameMs"] / 1000 / 60
    # 编码开销按每帧 15ms 估算（H.264 1080p 中等预设的经验值）
    编码分 = 总帧 * 15 / 1000 / 60
    print("%-12s %14d %13.1f 分 %13.1f 分" % (
        "%d fps" % fps, 总帧, 渲染分, 渲染分 + 编码分))
print()
print("* 编码开销按每帧 15ms 估算，是经验值，实际取决于编码器与预设。")
print()
print("说明：")
print("  · 上述为**单线程浏览器渲染**的实测值")
print("  · 离线渲染可并行（多进程/多标签页），实际耗时可按核数下降")
print("  · 编码可硬件加速（NVENC/QSV），通常比软件编码快数倍")
