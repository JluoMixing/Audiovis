// 验证 G3 自动配对 + G2 自动保存（补完部分）
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const TMP = 'D:/FL_VISUAL_TEST/.testtmp';
mkdirSync(TMP, { recursive: true });

const 端口 = parseInt(process.argv[2] || '10000', 10);
const PORT = 10150;

let pass = 0, fail = 0;
const 断言 = (名, 条件, 详情) => {
  if (条件) { pass++; console.log('  ✓ ' + 名); }
  else { fail++; console.log('  ✗ ' + 名 + (详情 ? '  → ' + 详情 : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function api(路径, 数据) {
  return new Promise((res, rej) => {
    const body = 数据 ? JSON.stringify(数据) : null;
    const req = http.request({
      host: '127.0.0.1', port: 端口, path: 路径,
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body) } : {},
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    req.on('error', rej);
    if (body) req.write(body);
    req.end();
  });
}

const 页 = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/pairauto`,
  '--window-size=1600,1000',
  `http://127.0.0.1:${端口}/`], { stdio: 'ignore' });

const get = q => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: q }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej);
});

const 超时 = setTimeout(() => { console.log('!! 超时'); process.exit(2); }, 240000);

try {
  console.log('='.repeat(72));
  console.log('验证：自动配对音频 / 自动保存');
  console.log('='.repeat(72));
  console.log();

  // ---- 1) 自动配对：同名 ----
  console.log('【1】自动配对（同名优先）');
  // amapiano 目录里应该有 amapiano.flp + amapiano.mp3
  let d = await api('/api/pair/audio',
    { flp: String.raw`E:\FL_Project\amapiano\amapiano.flp` });
  断言('接口返回 ok', d.ok === true, d.错误 || d);
  断言('找到同名音频', !!d.音频, JSON.stringify(d).slice(0, 120));
  if (d.音频) {
    console.log('    ' + d.音频.名称 + '  （依据: ' + (d.依据 || '') + '）');
    断言('是 amapiano.mp3',
        d.音频.名称.toLowerCase().indexOf('amapiano') >= 0, d.音频.名称);
  }
  console.log();

  // ---- 2) 自动配对：无音频 ----
  console.log('【2】自动配对（目录无音频）');
  const 空目录 = 'D:/FL_VISUAL_TEST/out/pairempty';
  mkdirSync(空目录, { recursive: true });
  const 空flp = join(空目录, 'nosound.flp');
  writeFileSync(空flp, 'dummy');
  d = await api('/api/pair/audio', { flp: 空flp });
  断言('返回 ok 但无音频', d.ok === true && d.音频 === null,
      JSON.stringify(d).slice(0, 100));
  console.log();

  // ---- 3) 自动配对：多候选 ----
  console.log('【3】自动配对（多候选不猜）');
  const 多目录 = 'D:/FL_VISUAL_TEST/out/pairmany';
  mkdirSync(多目录, { recursive: true });
  const 多flp = join(多目录, 'multi.flp');
  writeFileSync(多flp, 'dummy');
  writeFileSync(join(多目录, 'a.mp3'), 'a');
  writeFileSync(join(多目录, 'b.mp3'), 'b');
  d = await api('/api/pair/audio', { flp: 多flp });
  断言('不自动选', d.音频 === null, JSON.stringify(d.音频));
  断言('给出候选列表', (d.候选 || []).length === 2, (d.候选 || []).length);
  console.log('    候选: ' + (d.候选 || []).map(x => x.名称).join(', '));
  console.log();

  // ---- 4) 自动配对：唯一音频 ----
  console.log('【4】自动配对（目录唯一音频）');
  const 单目录 = 'D:/FL_VISUAL_TEST/out/pairsingle';
  mkdirSync(单目录, { recursive: true });
  const 单flp = join(单目录, 'single.flp');
  writeFileSync(单flp, 'dummy');
  writeFileSync(join(单目录, 'only.wav'), 'w');
  d = await api('/api/pair/audio', { flp: 单flp });
  断言('找到唯一音频', !!d.音频, JSON.stringify(d).slice(0, 90));
  if (d.音频) 断言('是 only.wav', d.音频.名称 === 'only.wav', d.音频.名称);
  console.log();

  // ---- 5) 自动保存接口 ----
  console.log('【5】自动保存');
  await api('/api/autosave/clear', {});
  d = await api('/api/autosave');
  断言('初始无恢复内容', d.有 === false, JSON.stringify(d));

  d = await api('/api/autosave', {
    名称: '恢复测试',
    布局: { 组件: [{ id: 'playlist', x: 1, y: 2, w: 100, h: 80 }] },
    主题: 'sumi',
  });
  断言('写入成功', d.ok === true, d.错误 || d);
  断言('返回组件数', d.组件数 === 1, d.组件数);

  d = await api('/api/autosave');
  断言('现在有恢复内容', d.有 === true, JSON.stringify(d));
  断言('名称正确', d.名称 === '恢复测试', d.名称);
  断言('组件数正确', d.组件数 === 1, d.组件数);

  d = await api('/api/autosave/restore', {});
  断言('恢复成功', d.ok === true, d.错误 || d);
  断言('恢复组件数', d.组件数 === 1, d.组件数);

  d = await api('/api/autosave/clear', {});
  断言('清除成功', d.ok === true);
  d = await api('/api/autosave');
  断言('清除后无内容', d.有 === false, JSON.stringify(d));
  console.log();

  // ---- 6) 前端函数存在 ----
  console.log('【6】前端函数');
  let t = null;
  for (let i = 0; i < 60; i++) {
    try { t = await get('/json/list'); if (t && t.length) break; } catch {}
    await sleep(500);
  }
  const page = t.filter(x => x.type === 'page')
    .filter(x => (x.url || '').indexOf('127.0.0.1') >= 0)[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0;
  const send = (m, q) => new Promise(res => {
    const my = ++id;
    const h = e => { const x = JSON.parse(e.data); if (x.id === my) { ws.removeEventListener('message', h); res(x); } };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: my, method: m, params: q }));
  });
  await send('Runtime.enable');
  await sleep(5000);

  const ev = async e => {
    const r = await send('Runtime.evaluate',
      { expression: e, returnByValue: true, awaitPromise: true });
    const rr = r.result || {};
    return { v: rr.result ? rr.result.value : undefined,
             异常: rr.exceptionDetails
               ? (rr.exceptionDetails.exception?.description || '').split('\n')[0] : null };
  };

  let r = await ev(`JSON.stringify({
    配对函数: typeof 尝试自动配对,
    自动保存函数: typeof 写自动保存,
    清除函数: typeof 清自动保存,
    检查函数: typeof 检查自动保存,
  })`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('尝试自动配对 已定义', d.配对函数 === 'function', d.配对函数);
  断言('写自动保存 已定义', d.自动保存函数 === 'function', d.自动保存函数);
  断言('清自动保存 已定义', d.清除函数 === 'function', d.清除函数);
  断言('检查自动保存 已定义', d.检查函数 === 'function', d.检查函数);
  console.log();

  console.log('='.repeat(72));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  console.log('='.repeat(72));
} finally {
  clearTimeout(超时);
  页.kill();
}
process.exit(fail ? 1 : 0);
