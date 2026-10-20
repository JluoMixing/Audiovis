// 最终验收：冷启动后的页面是否包含全部交付功能
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdirSync } from 'node:fs';

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const TMP = 'D:/FL_VISUAL_TEST/.testtmp';
mkdirSync(TMP, { recursive: true });

const 端口 = parseInt(process.argv[2] || '10100', 10);
const PORT = 10160;

let pass = 0, fail = 0;
const 断言 = (名, 条件, 详情) => {
  if (条件) { pass++; console.log('  ✓ ' + 名); }
  else { fail++; console.log('  ✗ ' + 名 + (详情 ? '  → ' + 详情 : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const 页 = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/final`,
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
  console.log('最终验收：交付功能清单');
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

  const 检查 = async (组名, 表达式, 说明) => {
    const r = await ev(表达式);
    let d;
    try { d = JSON.parse(r.v); } catch { d = { 原始: r.v, 异常: r.异常 }; }
    const 缺 = Object.entries(d).filter(([, v]) => v !== true).map(([k]) => k);
    断言(组名, 缺.length === 0, 缺.join(', '));
    if (缺.length === 0) console.log('      ' + 说明);
    return 缺.length === 0;
  };

  await 检查('G0 地基：设置与模块化',
    `JSON.stringify({
      语言包: typeof 译 === 'function',
      设置函数: typeof 载入设置 === 'function',
      模块化脚本: document.querySelectorAll('script').length >= 3,
    })`, 'i18n / 设置 / 多脚本');

  await 检查('G1 框架：双语与设置面板',
    `JSON.stringify({
      中英语言包: 有语言('zh') && 有语言('en'),
      设置按钮: !!document.getElementById('btnSettings'),
      设置面板: !!document.getElementById('setModal'),
      语言下拉: !!document.getElementById('setLang'),
      datai18n: document.querySelectorAll('[data-i18n]').length > 60,
    })`, '361 条文案 / 73 个标记');

  await 检查('G2 工程：保存/打开/最近',
    `JSON.stringify({
      保存按钮: !!document.getElementById('btnProjSave'),
      打开按钮: !!document.getElementById('btnProjOpen'),
      脏标记: !!document.getElementById('tbDirty'),
      最近列表: !!document.getElementById('recentBox'),
      自动保存: typeof 写自动保存 === 'function',
      保存工程函数: typeof 保存工程 === 'function',
    })`, '.flvproj / 最近列表 / 未保存提示 / 自动保存');

  await 检查('G3 导入：拖拽与上传',
    `JSON.stringify({
      拖拽遮罩: !!document.getElementById('dropMask'),
      处理函数: typeof 处理拖入文件 === 'function',
      上传函数: typeof 上传文件 === 'function',
      自动配对: typeof 尝试自动配对 === 'function',
    })`, '拖拽 / 流式上传 / 自动配对');

  await 检查('G4 导出：预设与记忆',
    `JSON.stringify({
      预设下拉: !!document.getElementById('exPresetPick'),
      时长提示: !!document.getElementById('exDurHint'),
      导出面板: !!document.getElementById('exModal'),
      预设函数: typeof 套用导出预设 === 'function',
      记忆函数: typeof 载入导出参数 === 'function',
    })`, '三档预设 / 参数记忆 / 时长提示');

  await 检查('G5 打磨：快捷键与状态',
    `JSON.stringify({
      快捷键面板: !!document.getElementById('keysModal'),
      渲染函数: typeof 渲染快捷键面板 === 'function',
      加载态函数: typeof 设忙碌 === 'function',
      空状态: !!document.getElementById('emptyHint'),
    })`, '20 条快捷键 / 加载态 / 空状态');

  console.log();

  // 实际交互冒烟
  console.log('【交互冒烟】');
  let r = await ev(`(async function(){
    /* 1. 套模板 */
    套用模板(TEMPLATES[1]);
    const 组件数 = 放置.length;
    /* 2. 切语言 */
    切换语言('en');
    const 英 = document.querySelector('[data-i18n="foot.settings"]')
      ? document.querySelector('[data-i18n="foot.settings"]').textContent : '';
    切换语言('zh');
    const 中 = document.querySelector('[data-i18n="foot.settings"]')
      ? document.querySelector('[data-i18n="foot.settings"]').textContent : '';
    /* 3. 快捷键面板 */
    window.dispatchEvent(new KeyboardEvent('keydown',
      { key: '?', shiftKey: true, bubbles: true, cancelable: true }));
    const 面板开 = document.getElementById('keysModal').classList.contains('on');
    window.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'Escape', bubbles: true, cancelable: true }));
    /* 4. 导出面板 */
    打开导出面板();
    await new Promise(x => setTimeout(x, 900));
    const 导出开 = document.getElementById('exModal').classList.contains('on');
    const 预设值 = document.getElementById('exPresetPick').value;
    document.getElementById('exClose').click();
    return JSON.stringify({ 组件数, 英, 中, 面板开, 导出开, 预设值 });
  })()`);
  let d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('套模板后有组件', d.组件数 > 0, d.组件数);
  断言('切英文生效', d.英 === 'Settings', d.英);
  断言('切回中文生效', d.中 === '设置', d.中);
  断言('? 打开快捷键面板', d.面板开 === true);
  断言('导出面板可打开', d.导出开 === true);
  断言('预设已初始化', ['standard', 'quality', 'fast', 'custom'].indexOf(d.预设值) >= 0,
       d.预设值);
  console.log();

  console.log('='.repeat(72));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  console.log('='.repeat(72));
} finally {
  clearTimeout(超时);
  页.kill();
}
process.exit(fail ? 1 : 0);
