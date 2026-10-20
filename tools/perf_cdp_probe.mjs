/* ============================================================
   瓶颈定位：CDP 大负载传输成本
   ------------------------------------------------------------
   发现：完整链路中「PNG 编码 + 取回」= 51 ms，
        但单独测 toDataURL PNG 只有 15.3 ms。
   差额 35 ms 去哪了？假设是 CDP 的 JSON 序列化 + WebSocket 传输。

   本测试通过对比不同负载大小的 CDP 往返耗时来验证。
   ============================================================ */

import { spawn } from 'node:child_process';
import http from 'node:http';
import { rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const PAGE = resolve(arg('page'));
const BROWSER = arg('browser');
const WIDTH = parseInt(arg('width', '1920'), 10);
const HEIGHT = parseInt(arg('height', '1080'), 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9800 + Math.floor(Math.random() * 90);
const USER_DIR = join(process.env.TEMP || '/tmp', 'cdp_probe_' + PORT);
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

const child = spawn(BROWSER, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  '--hide-scrollbars', '--no-first-run', '--force-device-scale-factor=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DIR}`,
  `--window-size=${WIDTH},${HEIGHT}`, PAGE_URL,
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

  /* 安装渲染函数 */
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
        const cv = window.__c || (window.__c = Object.assign(
          document.createElement('canvas'), { width: ${WIDTH}, height: ${HEIGHT} }));
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

  const 结果 = {};

  /* ---- 1. 基准：绘制 + toDataURL（浏览器内） ---- */
  {
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        window.__drawOnly(30);
        const cv = window.__c;
        const t = [];
        for (let i = 0; i < 12; i++) {
          const t0 = performance.now();
          cv.toDataURL('image/png');
          t.push(performance.now() - t0);
        }
        const u = cv.toDataURL('image/png');
        return JSON.stringify({
          median: t.sort((a,b)=>a-b)[Math.floor(t.length/2)],
          b64len: u.length,
        });
      })()`, returnByValue: true,
    });
    const d = JSON.parse(r.result.value);
    结果.浏览器内PNG = { 中位ms: Number(d.median.toFixed(2)), base64长度: d.b64len };
  }

  /* ---- 2. CDP 往返：小负载（不返回图像） ---- */
  {
    const t = [];
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      await send('Runtime.evaluate', {
        expression: `window.__drawOnly(30); 'ok'`, returnByValue: true,
      });
      t.push(performance.now() - t0);
    }
    t.sort((a, b) => a - b);
    结果.CDP_仅绘制 = { 中位ms: Number(t[Math.floor(t.length / 2)].toFixed(2)) };
  }

  /* ---- 3. CDP 往返：返回完整 PNG base64 ---- */
  {
    const t = [];
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      const r = await send('Runtime.evaluate', {
        expression: `window.__drawOnly(30).toDataURL('image/png')`,
        returnByValue: true,
      });
      t.push(performance.now() - t0);
      if (i === 0) 结果.实测base64长度 = r.result.value.length;
    }
    t.sort((a, b) => a - b);
    结果.CDP_绘制加PNG取回 = { 中位ms: Number(t[Math.floor(t.length / 2)].toFixed(2)) };
  }

  /* ---- 4. CDP 往返：返回等长的假字符串（隔离传输成本） ---- */
  {
    const len = 结果.实测base64长度 || 3000000;
    const t = [];
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      await send('Runtime.evaluate', {
        expression: `'x'.repeat(${len})`, returnByValue: true,
      });
      t.push(performance.now() - t0);
    }
    t.sort((a, b) => a - b);
    结果.CDP_等长假串 = {
      中位ms: Number(t[Math.floor(t.length / 2)].toFixed(2)),
      长度: len,
    };
  }

  /* ---- 5. CDP 往返：返回小字符串（隔离固定开销） ---- */
  {
    const t = [];
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      await send('Runtime.evaluate', {
        expression: `'x'.repeat(1000)`, returnByValue: true,
      });
      t.push(performance.now() - t0);
    }
    t.sort((a, b) => a - b);
    结果.CDP_小负载 = { 中位ms: Number(t[Math.floor(t.length / 2)].toFixed(2)) };
  }

  /* ---- 6. 用 Blob + 分块传输（替代方案验证） ---- */
  {
    const t = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      /* 用 toBlob 后取 arrayBuffer 长度，验证浏览器侧成本 */
      await send('Runtime.evaluate', {
        expression: `(async () => {
          const cv = window.__drawOnly(30);
          const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
          return blob.size;
        })()`, returnByValue: true, awaitPromise: true,
      });
      t.push(performance.now() - t0);
    }
    t.sort((a, b) => a - b);
    结果.CDP_toBlob仅取大小 = { 中位ms: Number(t[Math.floor(t.length / 2)].toFixed(2)) };
  }

  /* ---- 7. 本地 HTTP 直传（模拟优化后的架构） ---- */
  {
    /* 在 Node 侧起一个极简 HTTP 服务，浏览器 POST 二进制过来 */
    const http = await import('node:http');
    let 收到字节 = 0;
    let 收到次数 = 0;
    const srv = http.createServer((req, res) => {
      if (req.method === 'POST') {
        let n = 0;
        req.on('data', c => { n += c.length; });
        req.on('end', () => {
          收到字节 += n; 收到次数++;
          res.writeHead(200); res.end('ok');
        });
      } else { res.writeHead(404); res.end(); }
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const srvPort = srv.address().port;

    /* 让浏览器 POST 若干帧 */
    const t = [];
    const N = 10;
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      await send('Runtime.evaluate', {
        expression: `(async () => {
          const cv = window.__drawOnly(${30 + i});
          const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
          const buf = await blob.arrayBuffer();
          const resp = await fetch('http://127.0.0.1:${srvPort}/frame', {
            method: 'POST', body: buf,
          });
          return await resp.text();
        })()`, returnByValue: true, awaitPromise: true,
      });
      t.push(performance.now() - t0);
    }
    t.sort((a, b) => a - b);
    结果.HTTP直传 = {
      中位ms: Number(t[Math.floor(t.length / 2)].toFixed(2)),
      收到字节: 收到字节,
      收到次数: 收到次数,
      平均KB: Math.round(收到字节 / Math.max(1, 收到次数) / 1024),
    };
    await new Promise(r => srv.close(r));
  }

  /* ---- 汇总 ---- */
  console.log('PROBE=' + JSON.stringify(结果, null, 1));
  writeFileSync(join(process.env.TEMP || '/tmp', 'cdp_probe.json'),
                JSON.stringify(结果, null, 1), 'utf-8');

} catch (err) {
  console.error('失败：' + (err && err.message ? err.message : String(err)));
  process.exitCode = 1;
} finally {
  try { if (ws) ws.close(); } catch (e) {}
  杀进程树();
  await sleep(300);
  try { rmSync(USER_DIR, { recursive: true, force: true }); } catch (e) {}
}
