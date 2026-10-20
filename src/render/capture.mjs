/* ============================================================
   帧渲染器（Node + CDP）
   ------------------------------------------------------------
   驱动无头浏览器，按帧号渲染画面并保存为 PNG 序列。

   为什么用帧号而不是实际时间：
     离线渲染必须**确定性**——第 N 帧永远对应 N/fps 秒，
     与渲染快慢无关。这样输出的视频不会有累积漂移。

   为什么用二进制 PNG 而不是 base64：
     base64 有 33% 体积膨胀且需字符串解析。
     通过 CDP 的 Page.captureScreenshot 直接取 base64 是协议限制，
     但落盘时直接写二进制，避免额外的字符串拼接开销。

   用法（由 render.py 调用）：
     node capture.mjs --page <html> --out <dir> --frames N --fps F
                      --width W --height H --browser <exe>
   ============================================================ */

import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

/* ---- 参数解析 ---- */
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const PAGE = arg('page');
const OUT = arg('out');
const FRAMES = parseInt(arg('frames', '0'), 10);
const FPS = parseFloat(arg('fps', '30'));
const WIDTH = parseInt(arg('width', '1920'), 10);
const HEIGHT = parseInt(arg('height', '1080'), 10);
const START = parseFloat(arg('start', '0'));
const BROWSER = arg('browser');

if (!PAGE || !OUT || !FRAMES || !BROWSER) {
  console.error('参数缺失：需要 --page --out --frames --browser');
  process.exit(2);
}

/* 页面路径必须转为**绝对路径**再构造 file:// URL。
   相对路径会生成 file:///out/... 这样的无效 URL（缺盘符），
   浏览器将显示错误页，表现为「页面未就绪：no-COMPONENTS」。 */
const PAGE_ABS = resolve(PAGE);

/* ---- 工具 ---- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9600 + Math.floor(Math.random() * 300);
const USER_DIR = join(process.env.TEMP || '/tmp', 'flv_render_' + PORT);

function httpGet(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

/* ---- 启动浏览器 ---- */
try { rmSync(USER_DIR, { recursive: true, force: true }); } catch (e) {}
mkdirSync(OUT, { recursive: true });

const PAGE_URL = 'file:///' + PAGE_ABS.replace(/\\/g, '/');

const child = spawn(BROWSER, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--force-device-scale-factor=1',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${USER_DIR}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  PAGE_URL,
], { stdio: 'ignore' });

let ws = null;
let send = null;

/* 确保浏览器进程树被彻底清理。
   只 kill 父进程不够 —— 浏览器会派生多个子进程，
   残留进程会占住调试端口，导致后续运行连接到**旧的**浏览器
   （表现为「页面未就绪：no-COMPONENTS」这类看似随机的失败）。 */
function 杀进程树() {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'],
            { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  } catch (e) { /* 忽略 */ }
}

try {
  /* ---- 连接 CDP ---- */
  let targets = null;
  for (let i = 0; i < 80; i++) {
    try {
      targets = await httpGet('/json/list');
      if (targets && targets.length) break;
    } catch (e) { /* 浏览器尚未就绪 */ }
    await sleep(250);
  }
  if (!targets || !targets.length) throw new Error('无法连接浏览器（CDP 未就绪）');

  /* ---- 关键：确认连到的是**我们刚启动的**浏览器 ----
     若端口被残留进程占用，/json/list 会返回旧浏览器的页面列表。
     校验页面 URL 可立即发现这种情况，避免后续出现难解的随机失败。 */
  const 目标 = targets.filter(t => t.type === 'page' &&
    (t.url === PAGE_URL || decodeURIComponent(t.url) === PAGE_URL ||
     t.url.endsWith(PAGE_ABS.replace(/\\/g, '/').split('/').pop())));
  if (!目标.length) {
    const 实际 = targets.filter(t => t.type === 'page').map(t => t.url).slice(0, 3);
    throw new Error(
      '调试端口 %d 被其它浏览器占用（连到了非目标页面）。\n' +
      '  期望: %s\n  实际: %s\n' +
      '  请关闭残留的浏览器进程后重试。'.replace(/%d/, PORT)
        .replace(/%s/, PAGE_URL).replace(/%s/, 实际.join(', ')));
  }
  const page = 目标[0];

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });

  let msgId = 0;
  send = (method, params) => new Promise((resolve, reject) => {
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

  /* 收集页面内的异常与 console 错误，便于诊断「页面未就绪」类失败 */
  const 页面错误 = [];
  ws.addEventListener('message', ev => {
    try {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        页面错误.push('EXC: ' + (d.exception && d.exception.description
          ? d.exception.description.split('\n')[0] : d.text));
      } else if (m.method === 'Runtime.consoleAPICalled' &&
                 m.params.type === 'error') {
        页面错误.push('ERR: ' + (m.params.args || [])
          .map(a => a.value || a.description || '').join(' ').slice(0, 160));
      }
    } catch (e) { /* 忽略 */ }
  });

  /* ---- 等待页面就绪 ----
     页面含约 1MB 内联 JS（全部组件代码），解析需要时间。
     固定 sleep 不可靠，故改为轮询直到就绪或超时。 */
  let readyValue = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await send('Runtime.evaluate', {
        expression: `(() => {
          if (typeof COMPONENTS === 'undefined') return 'no-COMPONENTS';
          if (typeof setActiveTheme !== 'function') return 'no-setActiveTheme';
          if (typeof window.__renderFrame !== 'function') return 'no-renderFrame';
          if (COMPONENTS.length === 0) return 'empty-COMPONENTS';
          return 'ok:' + COMPONENTS.length;
        })()`,
        returnByValue: true,
      });
      readyValue = String(r.result.value);
      if (readyValue.startsWith('ok:')) break;
    } catch (e) {
      readyValue = 'eval-error: ' + e.message;
    }
    await sleep(250);
  }
  if (!readyValue || !readyValue.startsWith('ok:')) {
    /* 附上诊断信息，避免只有一句无用的「未就绪」 */
    let 诊断 = '';
    try {
      const d = await send('Runtime.evaluate', {
        expression: `JSON.stringify({
          url: location.href,
          readyState: document.readyState,
          bodyLen: document.body ? document.body.innerHTML.length : -1,
          hasData: typeof DATA !== 'undefined',
          dataKeys: typeof DATA !== 'undefined' ? Object.keys(DATA).length : -1,
          hasRegister: typeof register === 'function',
          hasTheme: typeof window.__THEME__ !== 'undefined',
          hasRender: typeof window.__renderFrame,
          hasLayout: typeof window.__layout
        })`,
        returnByValue: true,
      });
      诊断 = '\n  页面状态: ' + d.result.value;
    } catch (e) { /* 忽略 */ }
    if (页面错误.length) {
      诊断 += '\n  页面错误:\n    ' + 页面错误.slice(0, 5).join('\n    ');
    }
    throw new Error('页面未就绪（等待 15 秒后仍失败）：' + readyValue +
                    '\n  期望 URL: ' + PAGE_URL + 诊断);
  }

  /* ---- 安装渲染器：把逐帧绘制逻辑注入页面 ----
     页面本身是预览台（有 DOM 卡片），这里替换为纯离屏渲染，
     避免预览台的布局影响输出。 */
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.__renderFrame = function (frameIndex) {
        const sec = ${START} + frameIndex / ${FPS};
        CUR = sec;
        const cv = document.createElement('canvas');
        cv.width = ${WIDTH};
        cv.height = ${HEIGHT};
        const g = cv.getContext('2d');
        g.fillStyle = P.bg;
        g.fillRect(0, 0, ${WIDTH}, ${HEIGHT});
        /* 布局：主时间轴占左侧，其余在右列堆叠。
           阶段 B 用固定布局；阶段 C 会改为可配置。 */
        const L = window.__layout || [
          { id: 'playlist', x: 40,  y: 60,  w: 1200, h: 960 },
          { id: 'stepper',  x: 1270, y: 60, w: 610,  h: 320 },
          { id: 'spectrum', x: 1270, y: 400, w: 610, h: 300 },
          { id: 'waveform', x: 1270, y: 720, w: 610, h: 300 },
        ];
        L.forEach(function (item) {
          const c = COMPONENTS.filter(function (x) { return x.id === item.id; })[0];
          if (!c) return;
          g.save();
          g.translate(item.x, item.y);
          g.scale(item.w / c.w, item.h / c.h);
          try { c.draw(g, c.w, c.h); } catch (e) { /* 单组件失败不中断 */ }
          g.restore();
        });
        return cv;
      };
      return 'installed';
    })()`,
    returnByValue: true,
  });

  /* ---- 逐帧渲染并落盘 ----
     直接调用页面内的 __renderFrame 并导出 PNG。
     不使用 Page.captureScreenshot —— 那会截取整个页面（含预览台的
     DOM 卡片），而我们只要离屏 canvas 的内容。 */
  const t0 = Date.now();
  for (let i = 0; i < FRAMES; i++) {
    const dataUrl = await send('Runtime.evaluate', {
      expression: `window.__renderFrame(${i}).toDataURL('image/png')`,
      returnByValue: true,
    });
    const b64 = dataUrl.result.value.split(',')[1];
    const name = 'frame_' + String(i).padStart(6, '0') + '.png';
    writeFileSync(join(OUT, name), Buffer.from(b64, 'base64'));

    if (i % 30 === 0 || i === FRAMES - 1) {
      const pct = ((i + 1) / FRAMES * 100).toFixed(1);
      console.log(`进度 ${i + 1}/${FRAMES} (${pct}%)`);
    }
  }
  const elapsed = (Date.now() - t0) / 1000;

  console.log('RESULT=' + JSON.stringify({
    frames: FRAMES,
    seconds: Number(elapsed.toFixed(2)),
    msPerFrame: Number((elapsed / FRAMES * 1000).toFixed(2)),
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
  }));

} catch (err) {
  console.error('渲染失败：' + (err && err.message ? err.message : String(err)));
  process.exitCode = 1;
} finally {
  try { if (ws) ws.close(); } catch (e) {}
  杀进程树();
  await sleep(400);
  try { rmSync(USER_DIR, { recursive: true, force: true }); } catch (e) {}
}
