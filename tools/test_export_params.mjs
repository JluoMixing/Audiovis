// G4 验证：导出预设 / 参数记忆 / 时长口径提示
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdirSync } from 'node:fs';

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const TMP = 'D:/FL_VISUAL_TEST/.testtmp';
mkdirSync(TMP, { recursive: true });

const 端口 = parseInt(process.argv[2] || '9700', 10);
const PORT = 10130;

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

/* 导入必须在 spawn 之前 —— 浏览器加载页面时要拿到的就是导入后的数据。
   （同一类 bug 第二次：test_gui_service 也是这个问题） */
{
  const 会话 = await api('/api/session');
  if (!会话 || !会话.已导入) {
    console.log('  导入 amapiano（时长提示需要真实数据）…');
    const 工程目录 = String.raw`E:\FL_Project\amapiano`;
    const 导入 = await api('/api/import', {
      flp: 工程目录 + '\\amapiano.flp',
      audio: 工程目录 + '\\amapiano.mp3',
    });
    if (!导入.id) throw new Error('导入未受理: ' + JSON.stringify(导入));
    for (let i = 0; i < 300; i++) {
      await sleep(1500);
      const t = await api('/api/job?id=' + 导入.id);
      if (t.状态 !== '运行中') {
        if (t.状态 !== '完成') throw new Error('导入失败: ' + t.错误);
        console.log('  导入完成');
        break;
      }
    }
  } else {
    console.log('  已有工程：' + 会话.name);
  }
}

const 页 = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/exparams`,
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
  console.log('G4 验证：导出预设 / 参数记忆 / 时长提示');
  console.log('='.repeat(72));
  console.log();

  /* 先重置设置 —— 其他测试会改 settings.json，
     不重置会让「初值」不确定，导致偶发失败。 */
  try {
    await api('/api/settings/reset', {});
    console.log('  已重置设置');
  } catch (e) {
    console.log('  重置设置失败（继续）: ' + e.message);
  }

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

  // ---- 1) 元素存在 ----
  console.log('【1】界面元素');
  let r = await ev(`JSON.stringify({
    预设下拉: !!document.getElementById('exPresetPick'),
    时长提示: !!document.getElementById('exDurHint'),
    预设函数: typeof 套用导出预设,
    提示函数: typeof 填充时长提示,
  })`);
  let d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('预设下拉存在', d.预设下拉 === true);
  断言('时长提示元素存在', d.时长提示 === true);
  断言('预设函数已定义', d.预设函数 === 'function', d.预设函数);
  断言('时长提示函数已定义', d.提示函数 === 'function', d.提示函数);
  console.log();

  // ---- 2) 预设套用 ----
  console.log('【2】预设套用');
  r = await ev(`(function(){
    打开导出面板();
    const out = {};
    for (const k of ['quality','standard','fast']) {
      套用导出预设(k);
      out[k] = {
        码率: document.getElementById('exBitrate').value,
        编码: document.getElementById('exPreset').value,
        并行: document.getElementById('exParallel').value,
      };
    }
    return JSON.stringify(out);
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('质量优先 → slow 4', d.quality && d.quality.编码 === 'slow' &&
       d.quality.并行 === '4', JSON.stringify(d.quality));
  断言('标准 → medium 4', d.standard && d.standard.编码 === 'medium' &&
       d.standard.并行 === '4', JSON.stringify(d.standard));
  断言('快速预览 → ultrafast 6',
       d.fast && d.fast.编码 === 'ultrafast' && d.fast.并行 === '6',
       JSON.stringify(d.fast));
  console.log();

  // ---- 3) 手改变自定义 ----
  console.log('【3】手改参数 → 预设变自定义');
  r = await ev(`(function(){
    document.getElementById('exPresetPick').value = 'standard';
    套用导出预设('standard');
    const 前 = document.getElementById('exPresetPick').value;
    const el = document.getElementById('exBitrate');
    el.value = '20M';
    el.dispatchEvent(new Event('input'));
    const 后 = document.getElementById('exPresetPick').value;
    return JSON.stringify({ 前, 后 });
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('改动前为 standard', d.前 === 'standard', d.前);
  断言('改动后变 custom', d.后 === 'custom', d.后);
  console.log();

  // ---- 4) 时长提示 ----
  console.log('【4】时长口径提示');
  r = await ev(`(function(){
    填充时长提示();
    const el = document.getElementById('exDurHint');
    return JSON.stringify({
      文本: el.textContent,
      颜色: el.style.color,
      工程时长: (window.__PROJECT__||{}).projectDuration,
      音频时长: (window.__PROJECT__||{}).duration,
    });
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('提示有内容', (d.文本 || '').length > 0, d.文本);
  断言('含工程与音频时长', /\d/.test(d.文本 || ''), d.文本);
  console.log();

  // ---- 5) 参数记忆：保存 ----
  console.log('【5】参数记忆（保存）');
  // 先重置设置，避免受前面测试影响
  await api('/api/settings/reset', {});
  r = await ev(`(async function(){
    document.getElementById('exPresetPick').value = 'quality';
    套用导出预设('quality');
    document.getElementById('exBitrate').value = '15M';
    document.getElementById('exParallel').value = '3';
    await 保存导出参数();
    return JSON.stringify({ ok: true });
  })()`);
  await sleep(600);
  let 设置 = await api('/api/settings');
  const 导出设置 = (设置.设置 || {})['导出'] || {};
  console.log('    服务端: ' + JSON.stringify({
    码率: 导出设置['码率'], 编码预设: 导出设置['编码预设'],
    并行度: 导出设置['并行度'] }));
  断言('码率已存', 导出设置['码率'] === '15M', 导出设置['码率']);
  断言('编码预设已存', 导出设置['编码预设'] === 'slow',
       导出设置['编码预设']);
  断言('并行度已存', 导出设置['并行度'] === 3, 导出设置['并行度']);
  console.log();

  // ---- 6) 参数记忆：重新打开面板时带出 ----
  console.log('【6】参数记忆（带出偏离预设的参数）');
  r = await ev(`(async function(){
    /* 先把面板字段清成别的值，再打开面板，看是否被上次的参数覆盖 */
    document.getElementById('exBitrate').value = '';
    document.getElementById('exPreset').value = 'medium';
    document.getElementById('exParallel').value = '';
    打开导出面板();
    await new Promise(r => setTimeout(r, 1200));
    return JSON.stringify({
      码率: document.getElementById('exBitrate').value,
      编码: document.getElementById('exPreset').value,
      并行: document.getElementById('exParallel').value,
      预设名: document.getElementById('exPresetPick').value,
    });
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('码率被带出', d.码率 === '15M', d.码率);
  断言('编码预设被带出', d.编码 === 'slow', d.编码);
  断言('并行度被带出', d.并行 === '3', d.并行);
  /* 15M/slow/3 不匹配任何预设（quality 是 ''/slow/4），
     故应识别为「自定义」—— 这是正确行为。 */
  断言('参数偏离预设 → 识别为 custom', d.预设名 === 'custom', d.预设名);
  console.log();

  // ---- 6b) 精确等于预设时应识别出预设名 ----
  console.log('【6b】精确等于预设 → 识别出预设名');
  r = await ev(`(async function(){
    document.getElementById('exBitrate').value = '';
    document.getElementById('exPreset').value = 'medium';
    document.getElementById('exParallel').value = '4';
    await 保存导出参数();
    打开导出面板();
    await new Promise(r => setTimeout(r, 1200));
    return JSON.stringify({
      码率: document.getElementById('exBitrate').value,
      编码: document.getElementById('exPreset').value,
      并行: document.getElementById('exParallel').value,
      预设名: document.getElementById('exPresetPick').value,
    });
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('参数被带出', d.编码 === 'medium' && d.并行 === '4',
       JSON.stringify(d));
  断言('识别为 standard', d.预设名 === 'standard', d.预设名);
  console.log();

  console.log('='.repeat(72));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  console.log('='.repeat(72));
} finally {
  clearTimeout(超时);
  页.kill();
}
process.exit(fail ? 1 : 0);
