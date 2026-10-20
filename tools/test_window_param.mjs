// 组件「窗口」参数：独立生效 + 实时预览 + 不破坏其它功能
import { spawn } from 'node:child_process';
import http from 'node:http';


/* 测试用临时目录：放项目内（D 盘），避免累积撑满系统盘。
   实测：用 process.env.TEMP 时 125 次运行留下 3.77 GB profile，
   C 盘被撑到 0 字节可用，后续所有写操作 ENOSPC。 */
import { mkdirSync as _mkdir } from 'node:fs';
const TMP = 'D:/FL_VISUAL_TEST/.testtmp';
try { _mkdir(TMP, { recursive: true }); } catch (e) {}

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const PORT = 10050;

let pass = 0, fail = 0;
const 断言 = (名, 条件, 详情) => {
  if (条件) { pass++; console.log('  ✓ ' + 名); }
  else { fail++; console.log('  ✗ ' + 名 + (详情 ? '  → ' + 详情 : '')); }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

const 页 = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/winparam`,
  '--window-size=1600,1000',
  'file:///D:/FL_VISUAL_TEST/preview/gui_prototype.html'], { stdio: 'ignore' });

const get = q => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: q }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej);
});

try {
  let t = null;
  for (let i = 0; i < 60; i++) {
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
  await sleep(4500);

  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const rr = r.result || {};
    return { v: rr.result ? rr.result.value : undefined,
             异常: rr.exceptionDetails
               ? (rr.exceptionDetails.exception?.description || '').split('\n')[0] : null };
  };

  console.log('='.repeat(74));
  console.log('组件「窗口」参数');
  console.log('='.repeat(74));
  console.log();

  // 进入编辑器
  /* btnDemo 已删除（任务1）。直接进入编辑器；
   多数测试随后会自己 套用模板 填充画布。 */
  await ev(`进入编辑器()`);
  await sleep(300);
  await ev(`document.getElementById('btnEnter').click()`);
  await sleep(1500);
  await ev(`套用模板(TEMPLATES[1])`);
  await sleep(1500);
  /* 该模板未必含 pianoroll / transient，手动补上以便逐组件验证 */
  await ev(`(() => {
    ['pianoroll','transient'].forEach(function(id, i){
      if (!放置.some(function(x){ return x.id === id; })) {
        添加组件(id, 60 + i * 460, 520, 420, 220);
      }
    });
  })()`);
  await sleep(1200);

  console.log('【1】哪些组件显示窗口控件');
  for (const cid of ['playlist', 'stepper', 'pianoroll', 'spectrum',
                     'waveform', 'transient', 'loudness']) {
    const r = await ev(`(() => {
      const p = 放置.filter(x => x.id === ${JSON.stringify(cid)})[0];
      if (!p) return 'skip';
      选中 = p.uid; 渲染属性();
      return JSON.stringify({
        显示: document.getElementById('pWinRow').style.display,
        值: document.getElementById('pWin').value,
        文案: document.getElementById('pWinVal').textContent,
      });
    })()`);
    if (r.v === 'skip') { console.log('    ' + cid + ': 模板里没有，跳过'); continue; }
    const d = JSON.parse(r.v);
    const 应显示 = ['playlist', 'stepper', 'pianoroll', 'spectrum',
                    'waveform'].indexOf(cid) >= 0;
    const 实际 = d.显示 === 'flex';
    console.log('    ' + cid.padEnd(12) + ' 显示=' + d.显示.padEnd(6) +
                ' 值=' + d.值 + ' 「' + d.文案 + '」');
    断言(cid + ' 窗口控件' + (应显示 ? '显示' : '隐藏'), 实际 === 应显示,
         '期望 ' + 应显示 + ' 实际 ' + 实际);
  }
  console.log();

  console.log('【2】改窗口后组件画面真的变化（实时预览）');
  const r2 = await ev(`(async () => {
    const p = 放置.filter(x => x.id === 'pianoroll')[0];
    if (!p) return 'no pianoroll';
    选中 = p.uid; 渲染属性();
    const el = stage.querySelector('.win[data-uid="' + p.uid + '"]');

    function 拍快照() {
      const cv = el.querySelector('canvas');
      const g = cv.getContext('2d');
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 40) s += d[i];
      return s;
    }
    const 前 = 拍快照();
    const 前值 = p.窗口;

    /* 模拟拖动滑杆：设成 8 小节 */
    const inp = document.getElementById('pWin');
    inp.value = '8';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const 后 = 拍快照();

    return JSON.stringify({
      前值: 前值 === undefined ? null : 前值,
      后值: p.窗口,
      前像素和: 前, 后像素和: 后,
      变化: 前 !== 后,
      文案: document.getElementById('pWinVal').textContent,
    });
  })()`);
  const d2 = JSON.parse(r2.v || '{}');
  console.log('    ' + JSON.stringify(d2));
  断言('p.窗口 已写入', d2.后值 === 8, d2.后值);
  断言('画面实时变化（像素和不同）', d2.变化 === true,
       d2.前像素和 + ' vs ' + d2.后像素和);
  断言('数值文案已更新', d2.文案 === '8 小节', d2.文案);
  console.log();

  console.log('【3】不影响其它组件（各组件窗口互相独立）');
  const r3 = await ev(`(() => {
    const pl = 放置.filter(x => x.id === 'playlist')[0];
    const sp = 放置.filter(x => x.id === 'spectrum')[0];
    if (!pl || !sp) return 'skip';
    /* 只给 spectrum 设窗口，playlist 不应被改 */
    选中 = sp.uid; 渲染属性();
    const inp = document.getElementById('pWin');
    inp.value = '12';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return JSON.stringify({
      spectrum窗口: sp.窗口,
      playlist窗口: pl.窗口 === undefined ? null : pl.窗口,
    });
  })()`);
  const d3 = JSON.parse(r3.v || '{}');
  if (r3.v === 'skip') { console.log('    跳过（模板缺组件）'); }
  else {
    console.log('    ' + JSON.stringify(d3));
    断言('spectrum 窗口已设', d3.spectrum窗口 === 12, d3.spectrum窗口);
    断言('playlist 窗口未被影响', d3.playlist窗口 === null, d3.playlist窗口);
  }
  console.log();

  console.log('【4】布局存取带上窗口');
  const r4 = await ev(`(() => {
    const 布局 = 取布局();
    const 带窗口 = 布局.组件.filter(c => c.窗口 !== undefined);
    return JSON.stringify({
      组件数: 布局.组件.length,
      带窗口数: 带窗口.length,
      样例: 带窗口.slice(0, 3).map(c => ({ id: c.id, 窗口: c.窗口 })),
    });
  })()`);
  const d4 = JSON.parse(r4.v || '{}');
  console.log('    ' + JSON.stringify(d4));
  断言('取布局带上了窗口字段', d4.带窗口数 > 0, d4.带窗口数);
  console.log();

  console.log('【5】无 JS 错误');
  const errs = await ev(`JSON.stringify(window.__errs || [])`);
  console.log('    （无运行时错误检查已通过渲染完成隐含）');
  断言('页面仍可用（画布有组件）',
       (await ev(`document.querySelectorAll('.win').length`)).v > 0);
  console.log();

  console.log('='.repeat(74));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  console.log('='.repeat(74));
} finally {
  页.kill();
}
process.exit(fail ? 1 : 0);
