/* ============================================================
   GPU 光栅化对比测试
   ------------------------------------------------------------
   我们启动浏览器时带了 --disable-gpu，强制软件光栅化。
   本测试对比启用 GPU 后的绘制速度。

   注意：无头模式下 GPU 加速的收益不稳定，需实测。
   ============================================================ */

import { spawn } from 'node:child_process';
import http from 'node:http';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const PAGE = resolve(arg('page'));
const BROWSER = arg('browser');
const MODE = arg('mode', 'nogpu');   // nogpu | gpu | swiftshader
const WIDTH = 1920, HEIGHT = 1080;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9300 + Math.floor(Math.random() * 400);
const USER_DIR = join(process.env.TEMP || '/tmp', 'gputest_' + PORT);
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

const 基础参数 = [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--hide-scrollbars', '--no-first-run', '--force-device-scale-factor=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DIR}`,
  `--window-size=${WIDTH},${HEIGHT}`,
];

let GPU参数;
if (MODE === 'gpu') {
  GPU参数 = ['--enable-gpu', '--use-angle=d3d11', '--enable-gpu-rasterization',
             '--ignore-gpu-blocklist'];
} else if (MODE === 'swiftshader') {
  GPU参数 = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];
} else {
  GPU参数 = ['--disable-gpu'];
}

const child = spawn(BROWSER, [...基础参数, ...GPU参数, PAGE_URL], { stdio: 'ignore' });

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
  for (let i = 0; i < 100; i++) {
    try { targets = await httpGet('/json/list'); if (targets && targets.length) break; } catch (e) {}
    await sleep(250);
  }
  const page = targets.find(t => t.type === 'page' &&
    t.url.endsWith(PAGE.split(/[\\/]/).pop()));
  if (!page) throw new Error('未找到目标页面');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res); ws.addEventListener('error', rej);
  });

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

  for (let i = 0; i < 80; i++) {
    const r = await send('Runtime.evaluate', {
      expression: `typeof COMPONENTS !== 'undefined' && COMPONENTS.length > 0`,
      returnByValue: true,
    });
    if (r.result.value === true) break;
    await sleep(250);
  }

  /* 检查实际的 GPU 状态 */
  const gpuInfo = await send('Runtime.evaluate', {
    expression: `(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return JSON.stringify({ webgl: false });
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return JSON.stringify({
        webgl: true,
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : 'unknown',
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
      });
    })()`, returnByValue: true,
  });

  /* 安装渲染函数 */
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.__layout = window.__layout || [
        { id:'playlist', x:40,   y:60,  w:1200, h:960 },
        { id:'stepper',  x:1270, y:60,  w:610,  h:320 },
        { id:'spectrum', x:1270, y:400, w:610,  h:300 },
        { id:'waveform', x:1270, y:720, w:610,  h:300 },
      ];
      window.__c = Object.assign(document.createElement('canvas'),
                                 { width: ${WIDTH}, height: ${HEIGHT} });
      window.__drawOnly = function (sec) {
        CUR = sec;
        const cv = window.__c;
        const g = cv.getContext('2d');
        g.fillStyle = P.bg; g.fillRect(0, 0, ${WIDTH}, ${HEIGHT});
        window.__layout.forEach(function (item) {
          const c = COMPONENTS.filter(function (x) { return x.id === item.id; })[0];
          if (!c) return;
          g.save(); g.translate(item.x, item.y);
          g.scale(item.w / c.w, item.h / c.h);
          try { c.draw(g, c.w, c.h); } catch (e) {}
          g.restore();
        });
        return cv;
      };
      return 'ok';
    })()`, returnByValue: true,
  });

  const DUR = (await send('Runtime.evaluate', {
    expression: `DATA.audio.duration`, returnByValue: true,
  })).result.value;

  const 时刻 = [];
  for (let i = 0; i < 40; i++) 时刻.push(DUR * (0.2 + 0.6 * i / 40));

  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      for (let i = 0; i < 5; i++) window.__drawOnly(${时刻[0]});
      const t = [];
      for (const s of ${JSON.stringify(时刻)}) {
        const t0 = performance.now();
        window.__drawOnly(s);
        t.push(performance.now() - t0);
      }
      // 同时测 PNG 编码
      const et = [];
      const cv = window.__c;
      for (let i = 0; i < 12; i++) {
        const t0 = performance.now();
        cv.toDataURL('image/png');
        et.push(performance.now() - t0);
      }
      t.sort((a,b)=>a-b); et.sort((a,b)=>a-b);
      return JSON.stringify({
        drawMedian: Number(t[Math.floor(t.length*0.5)].toFixed(2)),
        drawP95: Number(t[Math.floor(t.length*0.95)].toFixed(2)),
        pngMedian: Number(et[Math.floor(et.length*0.5)].toFixed(2)),
      });
    })()`, returnByValue: true,
  });

  console.log('GPUTEST=' + JSON.stringify({
    mode: MODE,
    gpu: JSON.parse(gpuInfo.result.value),
    结果: JSON.parse(r.result.value),
  }));

} catch (err) {
  console.error('失败(' + MODE + ')：' + (err && err.message ? err.message : String(err)));
  process.exitCode = 1;
} finally {
  try { if (ws) ws.close(); } catch (e) {}
  杀进程树();
  await sleep(400);
  try { rmSync(USER_DIR, { recursive: true, force: true }); } catch (e) {}
}
