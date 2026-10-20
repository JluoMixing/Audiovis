/* ============================================================
   性能剖析工具（Node + CDP）
   ------------------------------------------------------------
   对渲染链路的每个阶段独立计时，输出结构化 JSON。

   测量的阶段：
     1. stateCalc       时间戳与工程状态计算
     2. dynamicDraw     动态视觉元素绘制
     3. staticDraw      静态背景及 UI 绘制
     4. totalDraw       一次完整绘制（含上述全部）
     5. getImageData    像素读取
     6. pngEncode       PNG 编码（toDataURL）
     7. jpegEncode      JPEG 编码（对比）
     8. ipcRoundTrip    进程通信往返（CDP evaluate）
     9. diskWrite       写盘（Node 侧）
    10. base64Decode    base64 解码（Node 侧）

   用法：
     node perf_profile.mjs --page <html> --frames 60 --browser <exe>
   ============================================================ */

import { spawn } from 'node:child_process';
import http from 'node:http';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const PAGE = resolve(arg('page'));
const FRAMES = parseInt(arg('frames', '60'), 10);
const WIDTH = parseInt(arg('width', '1920'), 10);
const HEIGHT = parseInt(arg('height', '1080'), 10);
const BROWSER = arg('browser');
const OUTDIR = arg('out', join(process.env.TEMP || '/tmp', 'perf_profile'));

if (!PAGE || !BROWSER) {
  console.error('需要 --page 与 --browser');
  process.exit(2);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9900 + Math.floor(Math.random() * 90);
const USER_DIR = join(process.env.TEMP || '/tmp', 'perf_prof_' + PORT);
const PAGE_URL = 'file:///' + PAGE.replace(/\\/g, '/');

function httpGet(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

try { rmSync(USER_DIR, { recursive: true, force: true }); } catch (e) {}
mkdirSync(OUTDIR, { recursive: true });

const child = spawn(BROWSER, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-background-networking',
  '--force-device-scale-factor=1',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${USER_DIR}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  PAGE_URL,
], { stdio: 'ignore' });

function 杀进程树() {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else child.kill('SIGKILL');
  } catch (e) {}
}

let ws = null;

try {
  let targets = null;
  for (let i = 0; i < 80; i++) {
    try { targets = await httpGet('/json/list'); if (targets && targets.length) break; } catch (e) {}
    await sleep(250);
  }
  if (!targets || !targets.length) throw new Error('CDP 未就绪');

  const page = targets.find(t => t.type === 'page' &&
    t.url.endsWith(PAGE.split(/[\\/]/).pop()));
  if (!page) throw new Error('连到的不是目标页面（端口可能被占用）');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

  let msgId = 0;
  const send = (method, params) => new Promise((resolve, reject) => {
    const myId = ++msgId;
    const handler = ev => {
      const m = JSON.parse(ev.data);
      if (m.id === myId) {
        ws.removeEventListener('message', handler);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('HeapProfiler.enable').catch(() => {});

  /* 等待页面就绪 */
  let ok = false;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await send('Runtime.evaluate', {
        expression: `typeof COMPONENTS !== 'undefined' && COMPONENTS.length > 0`,
        returnByValue: true,
      });
      if (r.result.value === true) { ok = true; break; }
    } catch (e) {}
    await sleep(250);
  }
  if (!ok) throw new Error('页面未就绪');

  /* 注入剖析探针 */
  const profSrc = (await import('node:fs')).readFileSync(
    join(resolve(arg('probe', '.')), 'profiler.js'), 'utf-8');
  await send('Runtime.evaluate', { expression: profSrc });
  const 已装 = await send('Runtime.evaluate', {
    expression: `JSON.stringify(window.__PROF安装())`, returnByValue: true,
  });

  /* 安装页面内的渲染函数（与 capture.mjs 相同布局） */
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.__layout = window.__layout || [
        { id:'playlist', x:40,   y:60,  w:1200, h:960 },
        { id:'stepper',  x:1270, y:60,  w:610,  h:320 },
        { id:'spectrum', x:1270, y:400, w:610,  h:300 },
        { id:'waveform', x:1270, y:720, w:610,  h:300 },
      ];
      window.__drawOnly = function (sec) {
        CUR = sec;
        const cv = window.__profCanvas || (window.__profCanvas =
          Object.assign(document.createElement('canvas'),
                        { width: ${WIDTH}, height: ${HEIGHT} }));
        const g = cv.getContext('2d');
        g.fillStyle = P.bg; g.fillRect(0, 0, ${WIDTH}, ${HEIGHT});
        window.__layout.forEach(function (item) {
          const c = COMPONENTS.filter(function (x) { return x.id === item.id; })[0];
          if (!c) return;
          g.save();
          g.translate(item.x, item.y);
          g.scale(item.w / c.w, item.h / c.h);
          try { c.draw(g, c.w, c.h); } catch (e) {}
          g.restore();
        });
        return cv;
      };
      return 'ok';
    })()`,
    returnByValue: true,
  });

  /* ---- 包装开销基线 ---- */
  const 开销 = await send('Runtime.evaluate', {
    expression: `JSON.stringify(window.__PROF.测开销(20000))`, returnByValue: true,
  });

  /* ---- 固定代表性帧：均匀采样整曲 ---- */
  const 总时长 = await send('Runtime.evaluate', {
    expression: `DATA.audio.duration`, returnByValue: true,
  });
  const DUR = 总时长.result.value;
  const 帧时刻 = [];
  for (let i = 0; i < FRAMES; i++) 帧时刻.push(DUR * i / FRAMES);

  /* ---- 逐阶段测量 ---- */
  const 结果 = {};

  // 1) 完整绘制（含状态计算 + 动态 + 静态）
  let r = await send('Runtime.evaluate', {
    expression: `(() => {
      const P = window.__PROF;
      P.重置(); P.enabled = false;
      // 预热
      for (let i = 0; i < 5; i++) window.__drawOnly(${帧时刻[0]});
      const times = [];
      for (const sec of ${JSON.stringify(帧时刻)}) {
        const t0 = performance.now();
        window.__drawOnly(sec);
        times.push(performance.now() - t0);
      }
      times.sort((a,b)=>a-b);
      return JSON.stringify({
        mean: times.reduce((a,b)=>a+b,0)/times.length,
        median: times[Math.floor(times.length*0.5)],
        p95: times[Math.floor(times.length*0.95)],
        max: times[times.length-1],
        min: times[0],
        samples: times.map(t=>Number(t.toFixed(3))),
      });
    })()`, returnByValue: true,
  });
  结果.totalDraw = JSON.parse(r.result.value);

  // 2) 分阶段（开启探针）
  r = await send('Runtime.evaluate', {
    expression: `(() => {
      const P = window.__PROF;
      P.重置(); P.enabled = true;
      for (const sec of ${JSON.stringify(帧时刻)}) window.__drawOnly(sec);
      P.enabled = false;
      return JSON.stringify(P.报告());
    })()`, returnByValue: true,
  });
  结果.分阶段 = JSON.parse(r.result.value);

  // 3) getImageData
  r = await send('Runtime.evaluate', {
    expression: `(() => {
      const cv = window.__drawOnly(${帧时刻[0]});
      const g = cv.getContext('2d');
      const times = [];
      for (let i = 0; i < 20; i++) {
        const t0 = performance.now();
        g.getImageData(0, 0, ${WIDTH}, ${HEIGHT});
        times.push(performance.now() - t0);
      }
      times.sort((a,b)=>a-b);
      return JSON.stringify({
        mean: times.reduce((a,b)=>a+b,0)/times.length,
        median: times[Math.floor(times.length*0.5)],
        p95: times[Math.floor(times.length*0.95)],
      });
    })()`, returnByValue: true,
  });
  结果.getImageData = JSON.parse(r.result.value);

  // 4) PNG 编码
  r = await send('Runtime.evaluate', {
    expression: `(() => {
      const cv = window.__drawOnly(${帧时刻[0]});
      const times = [];
      for (let i = 0; i < 12; i++) {
        const t0 = performance.now();
        cv.toDataURL('image/png');
        times.push(performance.now() - t0);
      }
      times.sort((a,b)=>a-b);
      return JSON.stringify({
        mean: times.reduce((a,b)=>a+b,0)/times.length,
        median: times[Math.floor(times.length*0.5)],
        p95: times[Math.floor(times.length*0.95)],
      });
    })()`, returnByValue: true,
  });
  结果.pngEncode = JSON.parse(r.result.value);

  // 5) JPEG 编码（对比）
  r = await send('Runtime.evaluate', {
    expression: `(() => {
      const cv = window.__drawOnly(${帧时刻[0]});
      const out = {};
      for (const q of [0.98, 0.92, 0.85]) {
        const times = [];
        for (let i = 0; i < 12; i++) {
          const t0 = performance.now();
          cv.toDataURL('image/jpeg', q);
          times.push(performance.now() - t0);
        }
        out['q'+q] = times.reduce((a,b)=>a+b,0)/times.length;
      }
      return JSON.stringify(out);
    })()`, returnByValue: true,
  });
  结果.jpegEncode = JSON.parse(r.result.value);

  // 6) toBlob（异步，不经 base64）
  r = await send('Runtime.evaluate', {
    expression: `(async () => {
      const cv = window.__drawOnly(${帧时刻[0]});
      const times = [];
      for (let i = 0; i < 12; i++) {
        const t0 = performance.now();
        await new Promise(res => cv.toBlob(res, 'image/png'));
        times.push(performance.now() - t0);
      }
      return JSON.stringify({
        mean: times.reduce((a,b)=>a+b,0)/times.length,
        median: times[Math.floor(times.length*0.5)],
      });
    })()`, returnByValue: true, awaitPromise: true,
  });
  结果.pngToBlob = JSON.parse(r.result.value);

  // 7) IPC 往返（空调用）
  {
    const times = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      await send('Runtime.evaluate', { expression: `1+1`, returnByValue: true });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    结果.ipc空往返 = {
      mean: times.reduce((a, b) => a + b, 0) / times.length,
      median: times[Math.floor(times.length * 0.5)],
    };
  }

  // 8) 完整帧链路（绘制 → PNG → 取回 → 解码 → 写盘）
  {
    const times = { draw: [], encode: [], transfer: [], decode: [], write: [] };
    const { writeFileSync } = await import('node:fs');
    for (let i = 0; i < Math.min(30, FRAMES); i++) {
      const sec = 帧时刻[i % 帧时刻.length];

      let t0 = performance.now();
      await send('Runtime.evaluate', {
        expression: `window.__drawOnly(${sec})`, returnByValue: false,
      });
      times.draw.push(performance.now() - t0);

      t0 = performance.now();
      const r2 = await send('Runtime.evaluate', {
        expression: `window.__profCanvas.toDataURL('image/png')`,
        returnByValue: true,
      });
      times.encode.push(performance.now() - t0);

      const dataUrl = r2.result.value;
      t0 = performance.now();
      const b64 = dataUrl.split(',')[1];
      times.transfer.push(performance.now() - t0);

      t0 = performance.now();
      const buf = Buffer.from(b64, 'base64');
      times.decode.push(performance.now() - t0);

      t0 = performance.now();
      writeFileSync(join(OUTDIR, 'p' + String(i).padStart(5, '0') + '.png'), buf);
      times.write.push(performance.now() - t0);
    }
    const 汇总 = {};
    for (const k of Object.keys(times)) {
      const a = times[k].slice().sort((x, y) => x - y);
      汇总[k] = {
        mean: Number((times[k].reduce((x, y) => x + y, 0) / times[k].length).toFixed(3)),
        median: Number(a[Math.floor(a.length * 0.5)].toFixed(3)),
        p95: Number(a[Math.floor(a.length * 0.95)].toFixed(3)),
      };
    }
    结果.完整链路 = 汇总;
  }

  // 9) 内存与页面指标
  r = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      heapUsedMB: performance.memory ? Number((performance.memory.usedJSHeapSize/1048576).toFixed(1)) : null,
      heapTotalMB: performance.memory ? Number((performance.memory.totalJSHeapSize/1048576).toFixed(1)) : null,
      canvasCount: document.querySelectorAll('canvas').length,
      devicePixelRatio: window.devicePixelRatio,
    })`, returnByValue: true,
  });
  结果.内存 = JSON.parse(r.result.value);

  // 输出
  const 最终 = {
    参数: { 页面: PAGE, 帧数: FRAMES, 分辨率: `${WIDTH}x${HEIGHT}`, 时长秒: DUR },
    包装开销: JSON.parse(开销.result.value),
    已安装探针: JSON.parse(已装.result.value),
    结果,
  };
  console.log('PERF=' + JSON.stringify(最终));
  writeFileSync(join(OUTDIR, 'profile.json'),
                JSON.stringify(最终, null, 1), 'utf-8');

} catch (err) {
  console.error('剖析失败：' + (err && err.message ? err.message : String(err)));
  process.exitCode = 1;
} finally {
  try { if (ws) ws.close(); } catch (e) {}
  杀进程树();
  await sleep(400);
  try { rmSync(USER_DIR, { recursive: true, force: true }); } catch (e) {}
}
