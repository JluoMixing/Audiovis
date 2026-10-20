// 复现：选中文字组件后，其它组件的宽高输入是否被永久禁用
import { spawn } from 'node:child_process';
import http from 'node:http';


/* 测试用临时目录：放项目内（D 盘），避免累积撑满系统盘。
   实测：用 process.env.TEMP 时 125 次运行留下 3.77 GB profile，
   C 盘被撑到 0 字节可用，后续所有写操作 ENOSPC。 */
import { mkdirSync as _mkdir } from 'node:fs';
const TMP = 'D:/FL_VISUAL_TEST/.testtmp';
try { _mkdir(TMP, { recursive: true }); } catch (e) {}

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const PORT = 9999;

const 页 = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/propedit`,
  '--window-size=1600,1000',
  'file:///D:/FL_VISUAL_TEST/preview/gui_prototype.html'], { stdio: 'ignore' });

const get = q => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: q }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej);
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const 断言 = (名, 条件, 详情) => {
  if (条件) { pass++; console.log('  ✓ ' + 名); }
  else { fail++; console.log('  ✗ ' + 名 + (详情 ? '  → ' + 详情 : '')); }
};

try {
  let t = null;
  for (let i = 0; i < 60; i++) {
    try { t = await get('/json/list'); if (t && t.length) break; } catch {}
    await sleep(500);
  }
  const page = t.find(x => x.type === 'page') || t[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0;
  const send = (m, q) => new Promise(res => {
    const my = ++id;
    const h = e => { const x = JSON.parse(e.data); if (x.id === my) { ws.removeEventListener('message', h); res(x); } };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: my, method: m, params: q }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await sleep(4000);
  /* btnDemo 已删除（任务1）。直接进入编辑器；
   多数测试随后会自己 套用模板 填充画布。 */
  await ev(`进入编辑器()`);
  await sleep(300);
  await ev(`document.getElementById('btnEnter').click()`);
  await sleep(1200);
  await ev(`套用模板(TEMPLATES[1])`);
  await sleep(1500);

  console.log('='.repeat(70));
  console.log('属性面板宽高可编辑性');
  console.log('='.repeat(70));
  console.log();

  // 1) 先选中一个非文字组件
  let r = await ev(`(() => {
    const p = 放置.filter(x => x.id === 'playlist')[0];
    if (!p) return 'no playlist';
    选中 = p.uid; 渲染属性();
    return JSON.stringify({
      w禁用: document.getElementById('pW').disabled,
      h禁用: document.getElementById('pH').disabled,
      w值: document.getElementById('pW').value,
    });
  })()`);
  let d = JSON.parse(r);
  console.log('【1】选中 playlist（非文字）');
  console.log('   ' + JSON.stringify(d));
  断言('宽可编辑', d.w禁用 === false, '被禁用');
  断言('高可编辑', d.h禁用 === false, '被禁用');
  console.log();

  // 2) 尝试改宽高
  r = await ev(`(() => {
    const p = 放置.filter(x => x.id === 'playlist')[0];
    const 原w = p.w;
    const el = document.getElementById('pW');
    el.value = String(原w + 100);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({ 原w: 原w, 现w: p.w, 改成功: p.w !== 原w });
  })()`);
  d = JSON.parse(r);
  console.log('【2】改宽 +100');
  console.log('   ' + JSON.stringify(d));
  断言('宽度实际生效', d.改成功 === true, JSON.stringify(d));
  console.log();

  // 3) 选中文字组件，再切回非文字组件
  r = await ev(`(() => {
    const txt = 放置.filter(x => x.id === 'text')[0];
    if (!txt) return 'no text';
    选中 = txt.uid; 渲染属性();
    return JSON.stringify({
      w禁用: document.getElementById('pW').disabled,
      文字面板: document.getElementById('textPanel').style.display,
    });
  })()`);
  d = JSON.parse(r);
  console.log('【3】选中文字组件');
  console.log('   ' + JSON.stringify(d));
  console.log('     （文字组件自适应时禁用宽高是设计意图）');
  console.log();

  r = await ev(`(() => {
    const p = 放置.filter(x => x.id === 'spectrum')[0];
    if (!p) return 'no spectrum';
    选中 = p.uid; 渲染属性();
    return JSON.stringify({
      w禁用: document.getElementById('pW').disabled,
      h禁用: document.getElementById('pH').disabled,
      w值: document.getElementById('pW').value,
    });
  })()`);
  d = JSON.parse(r);
  console.log('【4】再选中 spectrum（非文字）—— 这里应恢复可编辑');
  console.log('   ' + JSON.stringify(d));
  断言('切回非文字组件后宽恢复可编辑', d.w禁用 === false, '仍是禁用状态 ← BUG');
  断言('切回非文字组件后高恢复可编辑', d.h禁用 === false, '仍是禁用状态 ← BUG');
  console.log();

  console.log('='.repeat(70));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  console.log('='.repeat(70));
} finally {
  页.kill();
}
process.exit(fail ? 1 : 0);
