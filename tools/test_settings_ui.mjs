// G1 验证：设置面板（服务端）
import { spawn } from 'node:child_process';
import http from 'node:http';


/* 测试用临时目录：放项目内（D 盘），避免累积撑满系统盘。
   实测：用 process.env.TEMP 时 125 次运行留下 3.77 GB profile，
   C 盘被撑到 0 字节可用，后续所有写操作 ENOSPC。 */
import { mkdirSync as _mkdir } from 'node:fs';
const TMP = 'D:/FL_VISUAL_TEST/.testtmp';
try { _mkdir(TMP, { recursive: true }); } catch (e) {}

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const 端口 = parseInt(process.argv[2] || '9000', 10);
const PORT = 10090;

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
      headers: body ? {
        'Content-Type': 'application/json',
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
  `--user-data-dir=${TMP}/sett`,
  '--window-size=1600,1000',
  `http://127.0.0.1:${端口}/`], { stdio: 'ignore' });

const get = q => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: q }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej);
});

const 超时 = setTimeout(() => { console.log('!! 超时'); process.exit(2); }, 180000);

try {
  console.log('='.repeat(72));
  console.log('G1 验证：设置面板');
  console.log('='.repeat(72));
  console.log();

  // ---- 1) 接口 ----
  console.log('【1】设置接口');
  let d = await api('/api/settings');
  断言('GET /api/settings 返回设置', !!d['设置'], Object.keys(d));
  断言('含生效语言', d['生效语言'] === 'zh' || d['生效语言'] === 'en',
       d['生效语言']);
  断言('含系统语言', d['系统语言'] === 'zh' || d['系统语言'] === 'en',
       d['系统语言']);
  断言('含解析后路径', !!d['路径'] && !!d['路径']['缓存目录'],
       d['路径']);
  断言('含配置文件路径', !!d['配置文件'], d['配置文件']);
  console.log('    生效语言=' + d['生效语言'] + ' 系统语言=' + d['系统语言']);
  console.log();

  console.log('【2】目录状态');
  d = await api('/api/settings/dirs');
  断言('返回三个目录', Object.keys(d).length === 3, Object.keys(d));
  for (const [k, v] of Object.entries(d)) {
    断言(k + ' 含存在/可写/字节', '存在' in v && '可写' in v && '字节' in v,
         Object.keys(v));
  }
  console.log('    ' + JSON.stringify(d).slice(0, 160));
  console.log();

  console.log('【3】改设置');
  d = await api('/api/settings', { 补丁: { '导出': { '帧率': 24 } } });
  断言('保存成功', d.ok === true, d);
  断言('帧率已改', d['设置']['设置']['导出']['帧率'] === 24,
       d['设置']['设置']['导出']['帧率']);
  // 读回确认持久化
  d = await api('/api/settings');
  断言('读回仍是 24', d['设置']['导出']['帧率'] === 24,
       d['设置']['导出']['帧率']);
  console.log();

  console.log('【4】改语言');
  d = await api('/api/settings', { 补丁: { '常规': { '语言': 'en' } } });
  断言('保存成功', d.ok === true, d);
  断言('生效语言变 en', d['设置']['生效语言'] === 'en',
       d['设置']['生效语言']);
  d = await api('/api/settings', { 补丁: { '常规': { '语言': 'zh' } } });
  断言('切回 zh', d['设置']['生效语言'] === 'zh', d['设置']['生效语言']);
  console.log();

  console.log('【5】恢复默认');
  d = await api('/api/settings/reset', {});
  断言('重置成功', d.ok === true, d);
  断言('帧率回到 30', d['设置']['设置']['导出']['帧率'] === 30,
       d['设置']['设置']['导出']['帧率']);
  console.log();

  // ---- 6) 界面 ----
  console.log('【6】设置面板 UI');
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
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const rr = r.result || {};
    return { v: rr.result ? rr.result.value : undefined,
             异常: rr.exceptionDetails
               ? (rr.exceptionDetails.exception?.description || '').split('\n')[0] : null };
  };

  let r = await ev(`JSON.stringify({
    有按钮: !!document.getElementById('btnSettings'),
    有面板: !!document.getElementById('setModal'),
    有语言选择: !!document.getElementById('setLang'),
    有保存: !!document.getElementById('setSave'),
  })`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('设置按钮存在', d.有按钮 === true);
  断言('设置面板存在', d.有面板 === true);
  断言('语言选择存在', d.有语言选择 === true);
  断言('保存按钮存在', d.有保存 === true);
  console.log();

  console.log('【7】打开面板并载入设置');
  r = await ev(`(async () => {
    document.getElementById('btnSettings').click();
    await new Promise(res => setTimeout(res, 800));
    return JSON.stringify({
      面板显示: document.getElementById('setModal').classList.contains('on'),
      语言值: document.getElementById('setLang').value,
      帧率值: document.getElementById('setFps').value,
      配置路径: document.getElementById('setConfigPath').textContent,
      缓存提示: document.getElementById('setCacheSize').textContent,
    });
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('面板已打开', d.面板显示 === true);
  断言('语言已填入', d.语言值 === 'auto' || d.语言值 === 'zh' || d.语言值 === 'en',
       d.语言值);
  断言('帧率已填入', d.帧率值 === '30', d.帧率值);
  断言('配置路径已显示', (d.配置路径 || '').indexOf('settings.json') >= 0,
       d.配置路径);
  断言('缓存大小已显示', !!d.缓存提示, d.缓存提示);
  console.log();

  console.log('【8】在界面里改语言 → 立即生效');
  r = await ev(`(async () => {
    const sel = document.getElementById('setLang');
    const 前 = document.querySelector('[data-i18n="start.heading"]').textContent;
    sel.value = 'en';
    sel.dispatchEvent(new Event('change'));
    await new Promise(res => setTimeout(res, 400));
    const 后 = document.querySelector('[data-i18n="start.heading"]').textContent;
    sel.value = 'zh';
    sel.dispatchEvent(new Event('change'));
    await new Promise(res => setTimeout(res, 400));
    return JSON.stringify({ 前, 后 });
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('切换语言界面即时变化', d.前 !== d.后, d.前 + ' → ' + d.后);
  断言('英文显示正确', d.后 === 'Import Project', d.后);
  console.log();

  console.log('='.repeat(72));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  console.log('='.repeat(72));
} finally {
  clearTimeout(超时);
  页.kill();
}
process.exit(fail ? 1 : 0);
