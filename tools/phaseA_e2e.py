"""阶段 A-7：用**真实组件画面**做端到端测速。

前一个测试用的是合成渐变帧（过于简单，码率不具参考性）。
本测试渲染真实的 11 个组件画面，逐帧喂给编码器，
得到可信的「渲染 + 编码」端到端耗时。
"""
import json
import pathlib
import subprocess
import sys
import time

import imageio_ffmpeg
import numpy as np

工具 = pathlib.Path(r"D:\FL_VISUAL_TEST\tools")
页面 = pathlib.Path(r"D:\FL_VISUAL_TEST\dist\components.html")

# 复用之前的浏览器渲染脚本，改为导出 PNG 序列（限帧数以便快速验证）
帧数 = 60          # 2 秒 @30fps
宽, 高 = 1920, 1080

脚本 = r'''
import { spawn } from 'node:child_process';
import http from 'node:http';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const PORT = 9510;
const OUT = process.env.TEMP + '\\phaseA_frames';
const N = %d;

try { rmSync(OUT, {recursive:true, force:true}); } catch(e){}
mkdirSync(OUT, {recursive:true});

const child = spawn(EDGE, ['--headless','--disable-gpu','--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${process.env.TEMP}\\frame_export`,
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

  // 逐帧渲染真实的 1920x1080 画面（主时间轴 + 步进器 + 频谱 + 波形）
  const t0 = Date.now();
  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const cv=document.createElement('canvas');
      cv.width=1920; cv.height=1080;
      const g=cv.getContext('2d');
      const out=[];
      const ids=['playlist','stepper','spectrum','waveform'];
      for(let i=0;i<${N};i++){
        CUR = 20 + i/30;
        g.fillStyle=P.bg; g.fillRect(0,0,1920,1080);
        // 简易布局：主时间轴占左 2/3，其余右侧堆叠
        const layout=[
          {id:'playlist', x:40, y:60, w:1200, h:960},
          {id:'stepper',  x:1270, y:60, w:610, h:320},
          {id:'spectrum', x:1270, y:400, w:610, h:300},
          {id:'waveform', x:1270, y:720, w:610, h:300}
        ];
        layout.forEach(function(L){
          const c=COMPONENTS.filter(function(x){return x.id===L.id;})[0];
          if(!c) return;
          g.save();
          g.translate(L.x, L.y);
          g.scale(L.w/c.w, L.h/c.h);
          try{ c.draw(g, c.w, c.h); }catch(e){}
          g.restore();
        });
        out.push(cv.toDataURL('image/png'));
      }
      CUR=DATA.previewTime;
      return JSON.stringify(out);
    })()`, returnByValue: true
  });
  const renderMs = Date.now() - t0;

  const arr = JSON.parse(r.result.value);
  arr.forEach(function(d, i){
    const b64 = d.split(',')[1];
    writeFileSync(`${OUT}\\\\f${String(i).padStart(5,'0')}.png`, Buffer.from(b64,'base64'));
  });
  console.log(JSON.stringify({frames: arr.length, renderMs: renderMs,
                              renderPerFrameMs: renderMs/arr.length, dir: OUT}));
} finally { child.kill(); }
''' % 帧数

临时 = 工具 / "_frames_tmp.mjs"
临时.write_text(脚本, encoding="utf-8")

try:
    print("=" * 74)
    print("阶段 A：端到端测速（真实组件画面 → 视频）")
    print("=" * 74)
    print()
    print("【1】渲染 %d 帧真实画面（1920×1080，含 4 个组件）" % 帧数)
    起 = time.perf_counter()
    进程 = subprocess.run(["node", str(临时)], capture_output=True, timeout=600)
    渲染墙钟 = time.perf_counter() - 起
    输出 = 进程.stdout.decode("utf-8", "replace").strip()
    if not 输出:
        print("   失败：", 进程.stderr.decode("utf-8", "replace")[:400])
        sys.exit(1)
    信息 = json.loads(输出.splitlines()[-1])
    print("   帧数: %d" % 信息["frames"])
    print("   浏览器内渲染: %.1f ms/帧" % 信息["renderPerFrameMs"])
    print("   含 PNG 编码与传输的墙钟: %.1f ms/帧" % (渲染墙钟 / 帧数 * 1000))
    print("   （PNG 传输是导出开销，实际产品中可用更快的通道）")
finally:
    临时.unlink(missing_ok=True)

帧目录 = pathlib.Path(信息["dir"])
帧文件 = sorted(帧目录.glob("*.png"))
print()
print("【2】编码 %d 帧为 H.264" % len(帧文件))

exe = imageio_ffmpeg.get_ffmpeg_exe()
输出视频 = pathlib.Path(r"D:\FL_VISUAL_TEST\tools\phaseA_real.mp4")
命令 = [
    exe, "-y", "-loglevel", "error",
    "-framerate", "30",
    "-i", str(帧目录 / "f%05d.png"),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    str(输出视频),
]
起 = time.perf_counter()
进程 = subprocess.run(命令, capture_output=True, timeout=600)
编码耗时 = time.perf_counter() - 起

if 输出视频.is_file():
    print("   ✓ 成功")
    print("   文件: %.2f MB" % (输出视频.stat().st_size / 1e6))
    print("   编码耗时: %.2f 秒（%.1f ms/帧）" % (编码耗时, 编码耗时 / len(帧文件) * 1000))
    print("   码率: %.2f Mbps" % (
        输出视频.stat().st_size * 8 / (len(帧文件) / 30) / 1e6))
else:
    print("   ✗ 失败:", 进程.stderr.decode("utf-8", "replace")[:300])

# 清理帧（保留视频）
import shutil
shutil.rmtree(帧目录, ignore_errors=True)

print()
print("=" * 74)
print("外推：完整 266 秒视频")
print("=" * 74)
每帧渲染 = 信息["renderPerFrameMs"]
每帧编码 = 编码耗时 / len(帧文件) * 1000
总每帧 = 每帧渲染 + 每帧编码
print()
print("单帧总耗时 = 渲染 %.1f ms + 编码 %.1f ms = %.1f ms" % (
    每帧渲染, 每帧编码, 总每帧))
print()
print("%-10s %12s %16s" % ("帧率", "总帧数", "预计总耗时"))
for fps in (30, 60):
    帧 = 266 * fps
    分 = 帧 * 总每帧 / 1000 / 60
    print("%-10s %12d %13.1f 分钟" % ("%d fps" % fps, 帧, 分))
print()
print("注：")
print("  · 编码可用硬件加速（NVENC/QSV），通常快 3~10 倍")
print("  · 渲染可多进程并行，按核数下降")
print("  · 上述为**单进程串行**的保守估计")
