// G5 验证：快捷键面板 / 工程快捷键 / 加载态 / 空状态
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdirSync } from 'node:fs';

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const TMP = 'D:/FL_VISUAL_TEST/.testtmp';
mkdirSync(TMP, { recursive: true });

const 端口 = parseInt(process.argv[2] || '9800', 10);
const PORT = 10140;

let pass = 0, fail = 0;
const 断言 = (名, 条件, 详情) => {
  if (条件) { pass++; console.log('  ✓ ' + 名); }
  else { fail++; console.log('  ✗ ' + 名 + (详情 ? '  → ' + 详情 : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const 页 = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/keys`,
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
  console.log('G5 验证：快捷键面板 / 工程快捷键 / 加载态 / 空状态');
  console.log('='.repeat(72));
  console.log();

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

  // ---- 1) 面板元素 ----
  console.log('【1】快捷键面板元素');
  let r = await ev(`JSON.stringify({
    面板: !!document.getElementById('keysModal'),
    网格: !!document.getElementById('keysGrid'),
    关闭按钮: !!document.getElementById('keysClose'),
    渲染函数: typeof 渲染快捷键面板,
  })`);
  let d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('面板存在', d.面板 === true);
  断言('网格存在', d.网格 === true);
  断言('关闭按钮存在', d.关闭按钮 === true);
  断言('渲染函数已定义', d.渲染函数 === 'function', d.渲染函数);
  console.log();

  // ---- 2) 按 ? 打开 ----
  console.log('【2】按 ? 打开');
  r = await ev(`(function(){
    document.body.focus();
    window.dispatchEvent(new KeyboardEvent('keydown',
      { key: '?', shiftKey: true, bubbles: true, cancelable: true }));
    const 开 = document.getElementById('keysModal').classList.contains('on');
    const 组数 = document.querySelectorAll('#keysGrid .keysGroup').length;
    const 行数 = document.querySelectorAll('#keysGrid .keysRow').length;
    const 首行键 = document.querySelector('#keysGrid kbd');
    return JSON.stringify({
      打开: 开, 组数, 行数,
      首键: 首行键 ? 首行键.textContent : null,
      文案: (document.querySelector('#keysGrid .keysRow span')||{}).textContent,
    });
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('面板已打开', d.打开 === true);
  断言('四组', d.组数 === 4, d.组数);
  断言('至少 15 行', d.行数 >= 15, d.行数);
  断言('首行键位为 Ctrl+Z', d.首键 === 'Ctrl + Z', d.首键);
  断言('首行说明为撤销', d.文案 === '撤销', d.文案);
  console.log();

  // ---- 3) Esc 关闭 ----
  console.log('【3】Esc 关闭');
  r = await ev(`(function(){
    window.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'Escape', bubbles: true, cancelable: true }));
    return JSON.stringify({
      关闭: !document.getElementById('keysModal').classList.contains('on'),
    });
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('Esc 已关闭面板', d.关闭 === true);
  console.log();

  // ---- 4) 快捷键表覆盖真实键位 ----
  console.log('【4】快捷键表与代码一致性');
  r = await ev(`JSON.stringify({
    表长度: 快捷键表.reduce((n, g) => n + g.项.length, 0),
    含CtrlS: JSON.stringify(快捷键表).indexOf('Ctrl + S') >= 0,
    含CtrlO: JSON.stringify(快捷键表).indexOf('Ctrl + O') >= 0,
    含Tab: JSON.stringify(快捷键表).indexOf('Tab') >= 0,
    含Esc: JSON.stringify(快捷键表).indexOf('Esc') >= 0,
  })`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('表内有 20+ 条', d.表长度 >= 20, d.表长度);
  断言('含 Ctrl+S', d.含CtrlS === true);
  断言('含 Ctrl+O', d.含CtrlO === true);
  断言('含 Tab', d.含Tab === true);
  断言('含 Esc', d.含Esc === true);
  console.log();

  // ---- 5) Ctrl+S / Ctrl+O 已绑定 ----
  console.log('【5】Ctrl+S / Ctrl+O');
  r = await ev(`(function(){
    let 保存触发 = false, 打开触发 = false;
    const 原保存 = window.保存工程;
    const 原打开 = window.打开工程;
    /* 拦截，避免真的弹对话框/保存 */
    window.保存工程 = function(){ 保存触发 = true; };
    window.打开工程 = function(){ 打开触发 = true; };
    window.dispatchEvent(new KeyboardEvent('keydown',
      { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'o', ctrlKey: true, bubbles: true, cancelable: true }));
    window.保存工程 = 原保存;
    window.打开工程 = 原打开;
    return JSON.stringify({ 保存触发, 打开触发 });
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('Ctrl+S 触发保存', d.保存触发 === true);
  断言('Ctrl+O 触发打开', d.打开触发 === true);
  console.log();

  // ---- 6) 加载态 ----
  console.log('【6】加载态');
  r = await ev(`(function(){
    const 前 = document.body.classList.contains('busy');
    设忙碌(true);
    const 中 = document.body.classList.contains('busy');
    const 指针 = getComputedStyle(document.body).cursor;
    设忙碌(false);
    const 后 = document.body.classList.contains('busy');
    return JSON.stringify({ 前, 中, 指针, 后 });
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('初始不是忙碌', d.前 === false);
  断言('设忙碌(true) 生效', d.中 === true);
  断言('指针变 progress', d.指针 === 'progress', d.指针);
  断言('设忙碌(false) 解除', d.后 === false);
  console.log();

  // ---- 7) 空状态 ----
  console.log('【7】空状态');
  r = await ev(`(function(){
    const 元素 = document.getElementById('emptyHint');
    if (!元素) return JSON.stringify({ 存在: false });

    /* 新会话的画布是空的 —— 必须先套模板造出内容，
       否则「有内容时隐藏」无从验证（这正是上一版失败的原因）。 */
    套用模板(TEMPLATES[1]);
    const 有内容时 = getComputedStyle(元素).display;
    const 组件数 = 放置.length;

    /* 清空 → 应显示 */
    const 原 = 放置.slice();
    放置.length = 0;
    渲染画布();
    const 空时 = getComputedStyle(元素).display;
    const 文案 = 元素.textContent.replace(/\\s+/g, ' ').trim().slice(0, 40);

    /* 还原 → 应再次隐藏 */
    原.forEach(function(p){ 放置.push(p); });
    渲染画布();
    const 还原后 = getComputedStyle(元素).display;

    return JSON.stringify({ 存在: true, 组件数, 有内容时, 空时, 还原后, 文案 });
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('空状态元素存在', d.存在 === true);
  断言('模板已套用（有内容）', d.组件数 > 0, d.组件数);
  断言('有内容时隐藏', d.有内容时 === 'none', d.有内容时);
  断言('空画布时显示', d.空时 === 'flex', d.空时);
  断言('还原后又隐藏', d.还原后 === 'none', d.还原后);
  断言('含引导文案', (d.文案 || '').length > 0, d.文案);
  console.log();

  // ---- 8) 语言切换后面板文案跟着变 ----
  console.log('【8】语言切换');
  r = await ev(`(function(){
    切换语言('en');
    渲染快捷键面板();
    const 英 = {
      标题: document.querySelector('#keysGrid .keysGroupTitle').textContent,
      首行: document.querySelector('#keysGrid .keysRow span').textContent,
    };
    切换语言('zh');
    渲染快捷键面板();
    const 中 = {
      标题: document.querySelector('#keysGrid .keysGroupTitle').textContent,
      首行: document.querySelector('#keysGrid .keysRow span').textContent,
    };
    return JSON.stringify({ 英, 中 });
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('英文组名', d.英 && d.英.标题 === 'Editing', d.英 && d.英.标题);
  断言('英文说明', d.英 && d.英.首行 === 'Undo', d.英 && d.英.首行);
  断言('中文组名', d.中 && d.中.标题 === '编辑', d.中 && d.中.标题);
  断言('中文说明', d.中 && d.中.首行 === '撤销', d.中 && d.中.首行);
  console.log();

  console.log('='.repeat(72));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  console.log('='.repeat(72));
} finally {
  clearTimeout(超时);
  页.kill();
}
process.exit(fail ? 1 : 0);
