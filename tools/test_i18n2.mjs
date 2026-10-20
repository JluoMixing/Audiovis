// 精简版 i18n 验证：只测核心行为，避免卡住
import { spawn } from 'node:child_process';
import http from 'node:http';


/* 测试用临时目录：放项目内（D 盘），避免累积撑满系统盘。
   实测：用 process.env.TEMP 时 125 次运行留下 3.77 GB profile，
   C 盘被撑到 0 字节可用，后续所有写操作 ENOSPC。 */
import { mkdirSync as _mkdir } from 'node:fs';
const TMP = 'D:/FL_VISUAL_TEST/.testtmp';
try { _mkdir(TMP, { recursive: true }); } catch (e) {}

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const PORT = 10082;

let pass = 0, fail = 0;
const 断言 = (名, 条件, 详情) => {
  if (条件) { pass++; console.log('  ✓ ' + 名); }
  else { fail++; console.log('  ✗ ' + 名 + (详情 ? '  → ' + 详情 : '')); }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

const 页 = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/i18nc`,
  '--window-size=1600,1000',
  'file:///D:/FL_VISUAL_TEST/preview/gui_prototype.html'], { stdio: 'ignore' });

const get = q => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: q }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej);
});

const 超时 = setTimeout(() => {
  console.log('\n!! 超时退出');
  process.exit(2);
}, 120000);

try {
  let t = null;
  for (let i = 0; i < 40; i++) {
    try { t = await get('/json/list'); if (t && t.length) break; } catch {}
    await sleep(500);
  }
  const page = t.filter(x => x.type === 'page')[0];
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
  await sleep(4000);

  const ev = async e => {
    const r = await send('Runtime.evaluate', {
      expression: e, returnByValue: true, awaitPromise: false });
    const rr = r.result || {};
    return { v: rr.result ? rr.result.value : undefined,
             异常: rr.exceptionDetails
               ? (rr.exceptionDetails.exception?.description || '').split('\n')[0] : null };
  };

  console.log('='.repeat(70));
  console.log('G1 验证：i18n（精简）');
  console.log('='.repeat(70));
  console.log();

  console.log('【1】语言包');
  let r = await ev(`JSON.stringify([有语言('zh'), 有语言('en'), 取语言()])`);
  let d = JSON.parse(r.v);
  console.log('    有中文/有英文/当前 = ' + JSON.stringify(d));
  断言('中英语言包都已加载', d[0] === true && d[1] === true);

  r = await ev(`JSON.stringify(Object.keys(语言包).map(k => [k, Object.keys(语言包[k]).length]))`);
  console.log('    各语言条数: ' + r.v);
  const 条数 = JSON.parse(r.v);
  断言('中文条数 > 200', 条数[0][1] > 200, 条数[0][1]);
  断言('英文条数 = 中文条数', 条数[0][1] === 条数[1][1], 条数);
  console.log();

  console.log('【2】t() 取值');
  r = await ev(`JSON.stringify({
    zh: 译('start.heading', null, 'zh'),
    en: 译('start.heading', null, 'en'),
    param: 译('canvas.components', {n: 5}, 'en'),
    paramZh: 译('canvas.components', {n: 5}, 'zh'),
    unknown: 译('no.such', null, 'zh'),
  })`);
  d = JSON.parse(r.v);
  console.log('    ' + JSON.stringify(d));
  断言('中文正确', d.zh === '导入工程', d.zh);
  断言('英文正确', d.en === 'Import Project', d.en);
  断言('占位符（英）', d.param === '5 components', d.param);
  断言('占位符（中）', d.paramZh === '5 个组件', d.paramZh);
  断言('未知 key 回显', d.unknown === 'no.such', d.unknown);
  console.log();

  console.log('【3】data-i18n 标记');
  r = await ev(`JSON.stringify({
    文本: document.querySelectorAll('[data-i18n]').length,
    ph: document.querySelectorAll('[data-i18n-placeholder]').length,
    html: document.querySelectorAll('[data-i18n-html]').length,
  })`);
  d = JSON.parse(r.v);
  console.log('    ' + JSON.stringify(d));
  断言('文本标记 > 50', d.文本 > 50, d.文本);
  断言('有 placeholder', d.ph > 0, d.ph);
  断言('有 html 标记', d.html > 0, d.html);
  console.log();

  console.log('【4】切换语言 → 界面变化');
  r = await ev(`(function(){
    var el = document.querySelector('[data-i18n="start.heading"]');
    var a = el.textContent;
    切换语言('en');
    var b = el.textContent;
    切换语言('zh');
    var c = el.textContent;
    return JSON.stringify({a:a, b:b, c:c});
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('英文时 Import Project', d.b === 'Import Project', d.b);
  断言('切回 导入工程', d.c === '导入工程', d.c);
  console.log();

  console.log('【5】批量切换');
  r = await ev(`(function(){
    /* 元素可能不存在（界面改版），用 ?. 与默认值避免整个求值崩掉 */
    function txt(sel, attr){
      var el = document.querySelector(sel);
      if (!el) return null;
      return attr ? el.getAttribute(attr) : el.textContent;
    }
    切换语言('en');
    var out = {
      标题: txt('[data-i18n="start.heading"]'),
      按钮: txt('[data-i18n="start.enter"]'),
      页脚: txt('[data-i18n-html="foot.line1"]'),
      lang: document.documentElement.lang
    };
    切换语言('zh');
    out.切回 = txt('[data-i18n="start.heading"]');
    return JSON.stringify(out);
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('标题切换', d.标题 === 'Import Project', d.标题);
  断言('按钮切换', d.按钮 === 'Enter Editor', d.按钮);
  断言('页脚切换', (d.页脚 || '').indexOf('UI design preview') >= 0,
       (d.页脚 || '').slice(0, 40));
  断言('html lang = en', d.lang === 'en', d.lang);
  断言('切回中文', d.切回 === '导入工程', d.切回);
  console.log();

  console.log('='.repeat(70));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  console.log('='.repeat(70));
} finally {
  clearTimeout(超时);
  页.kill();
}
process.exit(fail ? 1 : 0);
