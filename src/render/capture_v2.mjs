/* ============================================================
   帧渲染器 v2（HTTP 二进制传输 + 分片支持）
   ------------------------------------------------------------
   相比 v1（CDP + base64）的改动，均基于实测：

   1. **HTTP 直传二进制**（实测省约 21 ms/帧）
      v1 走 CDP 的 Runtime.evaluate 返回 base64 字符串，
      需经 JSON 序列化 + 33% 体积膨胀。
      v2 让页面把 PNG Blob 直接 POST 到本地 HTTP 服务，
      二进制流不经编码转换。

   2. **分片渲染**（--range a:b）支持多进程并行
      每个 worker 负责一个帧区间，写各自的文件。

   3. **保留 CDP**（--transport cdp）用于对比与回退

   实测依据（tools/perf_cdp_probe.mjs）：
     CDP + base64 PNG      54.55 ms/帧
     HTTP 直传二进制        33.35 ms/帧
     其中 PNG 编码 16.6 ms、绘制约 16 ms 是不可省的下限。

   用法：
     node capture_v2.mjs --page <html> --out <dir> --frames N
        --range 0:100 --transport http --browser <exe>
   ============================================================ */

import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const PAGE = resolve(arg('page'));
const OUT = arg('out');
const FRAMES = parseInt(arg('frames', '0'), 10);
const FPS = parseFloat(arg('fps', '30'));
const WIDTH = parseInt(arg('width', '1920'), 10);
const HEIGHT = parseInt(arg('height', '1080'), 10);
const START = parseFloat(arg('start', '0'));
const TRANSPORT = arg('transport', 'http');
const BROWSER = arg('browser');
const RANGE = arg('range', '');
const GPU = arg('gpu', 'off');   /* off | on —— 是否启用 GPU 光栅化 */
/* 主题键（与 GUI 选中的主题一致）。空则用页面默认。 */
const THEME = arg('theme', '');

/* 布局文件（GUI 导出的 layout.json）。
   为空时用页面内置的兜底布局（仅用于自检）。 */
const LAYOUT_PATH = arg('layout', '');
let LAYOUT = null;
if (LAYOUT_PATH) {
  try {
    const 原始 = readFileSync(resolve(LAYOUT_PATH), 'utf8');
    const d = JSON.parse(原始);
    /* 兼容两种形态：裸数组，或 { 组件: [...] } */
    LAYOUT = Array.isArray(d) ? d : (d.组件 || d.components || []);
    if (!Array.isArray(LAYOUT)) throw new Error('布局不是数组');
    console.error('[layout] 已载入 ' + LAYOUT.length + ' 项：' +
                  (LAYOUT_PATH || ''));
  } catch (e) {
    console.error('[layout] 载入失败：' + e.message);
    process.exit(3);
  }
}

if (!PAGE || !OUT || !FRAMES || !BROWSER) {
  console.error('参数缺失：需要 --page --out --frames --browser');
  process.exit(2);
}

/* 帧区间：支持分片并行 */
let 帧起点 = 0, 帧终点 = FRAMES;
if (RANGE) {
  const parts = RANGE.split(':').map(Number);
  帧起点 = parts[0] || 0;
  帧终点 = parts.length > 1 && !isNaN(parts[1]) ? parts[1] : FRAMES;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const CDP_PORT = 9200 + Math.floor(Math.random() * 500);
const USER_DIR = join(process.env.TEMP || '/tmp', 'flv2_' + CDP_PORT);
const PAGE_URL = 'file:///' + PAGE.replace(/\\/g, '/');

function httpGetJson(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

try { rmSync(USER_DIR, { recursive: true, force: true }); } catch (e) {}
mkdirSync(OUT, { recursive: true });

/* ---- 帧接收服务（HTTP 二进制） ---- */
let 收到帧数 = 0;
let 收到字节 = 0;
let 服务错误 = null;

const 服务 = http.createServer((req, res) => {
  /* CORS：页面以 file:// 加载，向 http://127.0.0.1 发请求属于跨源。
     必须显式允许，否则浏览器以 "Failed to fetch" 拒绝。
     （file:// 的 Origin 是 "null"，故用 * 通配。） */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-Frame, Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(404); res.end(); return; }

  const 帧号 = parseInt(req.headers['x-frame'] || '-1', 10);
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try {
      const buf = Buffer.concat(chunks);
      if (帧号 < 0) { res.writeHead(400); res.end('bad frame'); return; }
      writeFileSync(join(OUT, 'frame_' + String(帧号).padStart(6, '0') + '.png'), buf);
      收到帧数++;
      收到字节 += buf.length;
      res.writeHead(200); res.end('ok');
    } catch (e) {
      服务错误 = String(e && e.message ? e.message : e);
      res.writeHead(500); res.end('err');
    }
  });
});

const 服务端口 = await new Promise(r => {
  服务.listen(0, '127.0.0.1', () => r(服务.address().port));
});

/* ---- 启动浏览器 ----
   GPU 参数说明（实测依据见 docs/PERF_AUDIT.md 的 GPU 附录）：
     off（默认）：--disable-gpu，软件光栅化。
                  绘制中位 10.3 ms，但 P95 高达 163 ms（尖峰）。
     on         ：启用硬件光栅化。
                  绘制中位 9.8 ms（略快），P95 降到 23 ms（尖峰消失），
                  但 PNG 编码变慢约 4 ms（画布需从 GPU 回读）。
   净效果需端到端实测，故默认保持 off，可显式开启对比。 */
const GPU参数 = GPU === 'on'
  ? ['--enable-gpu', '--use-angle=d3d11', '--enable-gpu-rasterization',
     '--ignore-gpu-blocklist']
  : ['--disable-gpu'];

const child = spawn(BROWSER, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-background-networking',
  '--force-device-scale-factor=1',
  ...GPU参数,
  `--remote-debugging-port=${CDP_PORT}`,
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
  /* ---- 连接 CDP ---- */
  let targets = null;
  for (let i = 0; i < 100; i++) {
    try {
      targets = await httpGetJson(CDP_PORT, '/json/list');
      if (targets && targets.length) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!targets || !targets.length) throw new Error('CDP 未就绪');

  const page = targets.find(t => t.type === 'page' &&
    t.url.endsWith(PAGE.split(/[\\/]/).pop()));
  if (!page) throw new Error('连到的不是目标页面（端口可能被占用）');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
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

  /* ---- 等待就绪 ---- */
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

  /* ---- 安装渲染器 ----
     ## 这里曾经是**第二份**渲染实现（重要教训）
     本文件原先自己写了一份 __renderFrame，直接 c.draw(g, c.w, c.h)：
       · 覆盖了 page.html 里的同名函数
       · 不含逐组件柔化、不含文字样式、不含隐藏文字开关
     于是「统一渲染路径」只改了 page.html 根本没生效 ——
     导出画面与 GUI 预览依旧不一致。

     现改为：**只负责把布局与主题塞进去，绘制全部交给
     page.html 里的 绘制布局()**（它又调 core/paint.js 的
     绘制组件实例()，与 GUI 预览同一个函数）。
     这样「只有一处实现」才真正成立。 */
  const 布局JSON = LAYOUT ? JSON.stringify(LAYOUT) : 'null';
  const 主题JSON = THEME ? JSON.stringify(THEME) : 'null';
  await send('Runtime.evaluate', {
    expression: `(() => {
      /* 主题：与 GUI 选中的一致，否则导出配色会不同 */
      const 主题键 = ${主题JSON};
      if (主题键 && typeof setActiveTheme === 'function') {
        const t = (typeof THEMES !== 'undefined' && THEMES[主题键]) || null;
        if (t) setActiveTheme(t, 主题键);
      }

      /* 布局：优先用传入的；没有则退回页面内置的兜底 */
      const 传入 = ${布局JSON};
      if (传入 && 传入.length) {
        if (typeof window.__setLayout === 'function') window.__setLayout(传入);
        else window.__layout = 传入;
      } else if (!window.__layout || !window.__layout.length) {
        window.__layout = [
          { id:'playlist', x:40,   y:60,  w:1200, h:960 },
          { id:'stepper',  x:1270, y:60,  w:610,  h:320 },
          { id:'spectrum', x:1270, y:400, w:610,  h:300 },
          { id:'waveform', x:1270, y:720, w:610,  h:300 },
        ];
      }

      window.__c = Object.assign(document.createElement('canvas'),
                                 { width: ${WIDTH}, height: ${HEIGHT} });
      window.__renderFrame = function (frameIndex) {
        CUR = ${START} + frameIndex / ${FPS};
        const cv = window.__c;
        const g = cv.getContext('2d');
        /* 共用实现 —— 与 GUI 预览逐像素一致（见 tools/test_parity.mjs） */
        绘制布局(g, window.__layout,
                { w: ${WIDTH}, h: ${HEIGHT}, 背景: true });
        return cv;
      };
      return 'ok:' + (window.__layout || []).length;
    })()`, returnByValue: true,
  });

  /* ---- 逐帧渲染 ---- */
  const t0 = Date.now();

  if (TRANSPORT === 'http') {
    /* 页面内循环：渲染 → toBlob → POST。
       整个循环在浏览器内完成，避免每帧一次 CDP 往返。
       这是关键优化：CDP 往返本身约 0.5 ms，但每帧一次
       仍会累积；批量执行把控制开销摊薄。 */
    const 批次 = 12;   /* 每批帧数：平衡进度可见性与开销 */
    for (let i = 帧起点; i < 帧终点; i += 批次) {
      const 到 = Math.min(i + 批次, 帧终点);
      const r = await send('Runtime.evaluate', {
        expression: `(async () => {
          const 结果 = [];
          for (let f = ${i}; f < ${到}; f++) {
            try {
              const cv = window.__renderFrame(f);
              const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
              const resp = await fetch('http://127.0.0.1:${服务端口}/f', {
                method: 'POST',
                headers: { 'X-Frame': String(f) },
                body: blob,
              });
              if (!resp.ok) 结果.push('HTTP ' + resp.status + ' @' + f);
            } catch (e) {
              结果.push('ERR ' + String(e && e.message ? e.message : e) + ' @' + f);
            }
          }
          return 结果.length ? 结果.slice(0, 3).join(' | ') : 'ok';
        })()`,
        returnByValue: true,
        awaitPromise: true,
        timeout: 600000,
      });
      const 批次结果 = r.result.value;
      if (批次结果 !== 'ok') {
        console.error('批次 ' + i + ' 出错: ' + 批次结果);
      }
      if (i % 60 === 0 || 到 >= 帧终点) {
        console.log(`进度 ${到 - 帧起点}/${帧终点 - 帧起点} 已收 ${收到帧数}`);
      }
    }
  } else {
    /* CDP 回退路径（用于对比） */
    for (let i = 帧起点; i < 帧终点; i++) {
      const r = await send('Runtime.evaluate', {
        expression: `window.__renderFrame(${i}).toDataURL('image/png')`,
        returnByValue: true,
      });
      const b64 = r.result.value.split(',')[1];
      writeFileSync(join(OUT, 'frame_' + String(i).padStart(6, '0') + '.png'),
                    Buffer.from(b64, 'base64'));
      if (i % 30 === 0) console.log(`进度 ${i - 帧起点}/${帧终点 - 帧起点}`);
    }
  }

  const elapsed = (Date.now() - t0) / 1000;
  const 应渲帧数 = 帧终点 - 帧起点;

  console.log('RESULT=' + JSON.stringify({
    transport: TRANSPORT,
    rangeStart: 帧起点,
    rangeEnd: 帧终点,
    expected: 应渲帧数,
    received: 收到帧数,
    receivedBytes: 收到字节,
    avgKB: 收到帧数 ? Math.round(收到字节 / 收到帧数 / 1024) : 0,
    seconds: Number(elapsed.toFixed(2)),
    msPerFrame: Number((elapsed / Math.max(1, 应渲帧数) * 1000).toFixed(2)),
    serverError: 服务错误,
  }));

} catch (err) {
  console.error('渲染失败：' + (err && err.message ? err.message : String(err)));
  process.exitCode = 1;
} finally {
  try { if (ws) ws.close(); } catch (e) {}
  杀进程树();
  try { 服务.close(); } catch (e) {}
  await sleep(300);
  try { rmSync(USER_DIR, { recursive: true, force: true }); } catch (e) {}
}
