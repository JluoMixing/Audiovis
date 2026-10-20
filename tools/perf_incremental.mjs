/* ============================================================
   增量渲染验证：静态图层缓存
   ------------------------------------------------------------
   假设：主时间轴每帧变化很小（指针移动 + 少量音符强调），
        若把"不随时刻变化的部分"缓存为图层，可省去重复绘制。

   实测方法：
     方案 A：每帧完整重绘（当前做法）
     方案 B：预渲染静态背景到离屏画布，每帧只 drawImage + 画动态部分

   注意：本测试只测**可行性**，不直接改产品代码。
        若收益不足，就不值得引入复杂度。
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
const PORT = 9100 + Math.floor(Math.random() * 90);
const USER_DIR = join(process.env.TEMP || '/tmp', 'incr_' + PORT);
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

  /* 建立两套渲染函数 */
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.__layout = window.__layout || [
        { id:'playlist', x:40,   y:60,  w:1200, h:960 },
        { id:'stepper',  x:1270, y:60,  w:610,  h:320 },
        { id:'spectrum', x:1270, y:400, w:610,  h:300 },
        { id:'waveform', x:1270, y:720, w:610,  h:300 },
      ];

      /* 方案 A：完整重绘 */
      window.__drawFull = function (sec, cv) {
        CUR = sec;
        cv = cv || (window.__cA || (window.__cA = Object.assign(
          document.createElement('canvas'), { width: ${WIDTH}, height: ${HEIGHT} })));
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

      /* 方案 B：静态层缓存
         静态层 = 背景 + 各组件底板。
         动态层 = 组件内容（仍需逐帧绘制）。 */
      window.__buildStatic = function () {
        const sc = window.__cS || (window.__cS = Object.assign(
          document.createElement('canvas'), { width: ${WIDTH}, height: ${HEIGHT} }));
        const g = sc.getContext('2d');
        g.fillStyle = P.bg; g.fillRect(0, 0, ${WIDTH}, ${HEIGHT});
        window.__layout.forEach(function (item) {
          g.save();
          g.translate(item.x, item.y);
          g.scale(item.w / item.w, item.h / item.h);
          panelBackground(g, item.w, item.h);
          g.restore();
        });
        return sc;
      };

      window.__drawIncr = function (sec) {
        const cv = window.__cB || (window.__cB = Object.assign(
          document.createElement('canvas'), { width: ${WIDTH}, height: ${HEIGHT} }));
        const g = cv.getContext('2d');
        /* 贴静态层 */
        g.drawImage(window.__cS, 0, 0);
        /* 画动态部分 */
        CUR = sec;
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

      /* 方案 C：只重绘"变化区域"——把主时间轴以外的组件缓存
         假设：主时间轴变化大，音频类组件变化也大，无法缓存。
         故此方案仅缓存"完全静止"的部分，等价于方案 B。
         这里改为测试：主时间轴缓存 + 仅指针重绘（激进方案） */
      window.__drawAggressive = function (sec) {
        const cv = window.__cC || (window.__cC = Object.assign(
          document.createElement('canvas'), { width: ${WIDTH}, height: ${HEIGHT} }));
        const g = cv.getContext('2d');
        g.drawImage(window.__cS, 0, 0);
        CUR = sec;
        /* 只有音频类组件重绘（playlist 与 stepper 用缓存） */
        ['spectrum', 'waveform'].forEach(function (id) {
          const item = window.__layout.filter(function (x) { return x.id === id; })[0];
          const c = COMPONENTS.filter(function (x) { return x.id === id; })[0];
          if (!item || !c) return;
          g.save(); g.translate(item.x, item.y);
          g.scale(item.w / c.w, item.h / c.h);
          try { c.draw(g, c.w, c.h); } catch (e) {}
          g.restore();
        });
        return cv;
      };

      window.__buildStatic();
      return 'ok';
    })()`, returnByValue: true,
  });

  /* 采样时刻 */
  const DUR = (await send('Runtime.evaluate', {
    expression: `DATA.audio.duration`, returnByValue: true,
  })).result.value;

  const 时刻 = [];
  for (let i = 0; i < 40; i++) 时刻.push(DUR * (0.2 + 0.6 * i / 40));

  const 结果 = {};

  for (const [名, 函数] of [['完整重绘', '__drawFull'],
                            ['静态层缓存', '__drawIncr'],
                            ['激进缓存', '__drawAggressive']]) {
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        // 预热
        for (let i = 0; i < 5; i++) window.${函数}(${时刻[0]});
        const t = [];
        for (const s of ${JSON.stringify(时刻)}) {
          const t0 = performance.now();
          window.${函数}(s);
          t.push(performance.now() - t0);
        }
        t.sort((a,b)=>a-b);
        return JSON.stringify({
          median: Number(t[Math.floor(t.length*0.5)].toFixed(3)),
          mean: Number((t.reduce((a,b)=>a+b,0)/t.length).toFixed(3)),
          p95: Number(t[Math.floor(t.length*0.95)].toFixed(3)),
        });
      })()`, returnByValue: true,
    });
    结果[名] = JSON.parse(r.result.value);
  }

  /* 视觉一致性检查：方案 B 与 A 的输出是否一致 */
  const 视觉 = await send('Runtime.evaluate', {
    expression: `(() => {
      const sec = ${时刻[5]};
      const a = window.__drawFull(sec);
      const b = window.__drawIncr(sec);
      const ga = a.getContext('2d').getImageData(0,0,${WIDTH},${HEIGHT}).data;
      const gb = b.getContext('2d').getImageData(0,0,${WIDTH},${HEIGHT}).data;
      let 不同 = 0, 最大 = 0;
      for (let i = 0; i < ga.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(ga[i+k] - gb[i+k]);
          if (d > 0) { 不同++; if (d > 最大) 最大 = d; }
        }
      }
      return JSON.stringify({
        不同通道数: 不同,
        总通道数: ga.length / 4 * 3,
        最大差: 最大,
      });
    })()`, returnByValue: true,
  });

  console.log('INCR=' + JSON.stringify({
    结果,
    视觉一致性: JSON.parse(视觉.result.value),
  }, null, 1));

} catch (err) {
  console.error('失败：' + (err && err.message ? err.message : String(err)));
  process.exitCode = 1;
} finally {
  try { if (ws) ws.close(); } catch (e) {}
  杀进程树();
  await sleep(300);
  try { rmSync(USER_DIR, { recursive: true, force: true }); } catch (e) {}
}
