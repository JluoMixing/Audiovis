// 回归测试：导入工程 → 进入编辑器 的完整流程
//
// 用户实测卡在这里：选好 FLP + 音频 → 点「解析并进入编辑器」
// → 看到解析信息 → 然后什么都没发生，进不了画布。
//
// 根因：导入完成后 reload；重载后按钮仍是「解析并进入编辑器」，
// 再点又解析一遍 → 无限循环，永远进不去。
//
// 这个测试走**真实浏览器流程**：选文件（注入路径）→ 点按钮 →
// 等导入 → 等 reload → 再点 → 必须进入编辑器。
import { spawn } from 'node:child_process';
import http from 'node:http';


/* 测试用临时目录：放项目内（D 盘），避免累积撑满系统盘。
   实测：用 process.env.TEMP 时 125 次运行留下 3.77 GB profile，
   C 盘被撑到 0 字节可用，后续所有写操作 ENOSPC。 */
import { mkdirSync as _mkdir } from 'node:fs';
const TMP = 'D:/FL_VISUAL_TEST/.testtmp';
try { _mkdir(TMP, { recursive: true }); } catch (e) {}

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const 端口 = parseInt(process.argv[2] || '8801', 10);
const PORT = 9995;
const 工程 = String.raw`E:\FL_Project\nujabes`;
const FLP = 工程 + String.raw`\nujabes.flp`;
const 音频 = 工程 + String.raw`\nujabes.mp3`;

let pass = 0, fail = 0;
function 断言(名, 条件, 详情) {
  if (条件) { pass++; console.log('  ✓ ' + 名); }
  else { fail++; console.log('  ✗ ' + 名 + (详情 ? '  → ' + 详情 : '')); }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 先导入**另一个**工程，保证「已载入」与「本次要导入」不同。
   否则若注入的文件恰好就是已载入的，按钮会正确地显示
   「进入编辑器」，断言「解析并进入编辑器」就误报（实测踩到）。 */
const 前置工程 = String.raw`E:\FL_Project\amapiano`;
async function 前置导入() {
  const post = (路径, 数据) => new Promise((res, rej) => {
    const body = JSON.stringify(数据);
    const req = http.request({
      host: '127.0.0.1', port: 端口, path: 路径, method: 'POST',
      headers: { 'Content-Type': 'application/json',
                 'Content-Length': Buffer.byteLength(body) },
    }, r => { let d = ''; r.on('data', c => d += c);
              r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); });
    req.on('error', rej); req.write(body); req.end();
  });
  const r = await post('/api/import', {
    flp: 前置工程 + '\\amapiano.flp',
    audio: 前置工程 + '\\amapiano.mp3' });
  if (!r.id) throw new Error('前置导入未被受理：' + JSON.stringify(r));
  for (let i = 0; i < 200; i++) {
    await sleep(1500);
    const t = await new Promise((res, rej) => {
      http.get({ host: '127.0.0.1', port: 端口, path: '/api/job?id=' + r.id },
        rr => { let d = ''; rr.on('data', c => d += c);
                rr.on('end', () => res(JSON.parse(d))); }).on('error', rej);
    });
    if (t.状态 !== '运行中') {
      if (t.状态 !== '完成') throw new Error('前置导入失败：' + t.错误);
      return t;
    }
  }
  throw new Error('前置导入超时');
}

/* 前置导入必须在启动浏览器**之前**完成 ——
   spawn 在模块顶层执行，若把它放在前面的 try 块里，
   浏览器会先加载完页面，前置导入才跑，页面读到的仍是上一轮状态
   （实测踩到：断言「解析并进入编辑器」误报）。 */
console.log('先导入前置工程 amapiano（保证与本次要导入的不同）');
await 前置导入();
console.log('前置导入完成');
console.log();

const 页 = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/impflow`,
  '--window-size=1600,1000',
  `http://127.0.0.1:${端口}/`], { stdio: 'ignore' });

const get = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej);
});

let ws = null, id = 0;
const 连 = async () => {
  let t = null;
  for (let i = 0; i < 80; i++) {
    try { t = await get('/json/list'); if (t && t.length) break; } catch {}
    await sleep(500);
  }
  const page = t.find(x => x.type === 'page') || t[0];
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  id = 0;
  await send('Runtime.enable');
  await send('Page.enable');
};
const send = (m, p) => new Promise(res => {
  const my = ++id;
  const h = ev => { const x = JSON.parse(ev.data); if (x.id === my) { ws.removeEventListener('message', h); res(x); } };
  ws.addEventListener('message', h);
  ws.send(JSON.stringify({ id: my, method: m, params: p }));
});
const ev = async (e) => {
  const r = await send('Runtime.evaluate',
    { expression: e, returnByValue: true, awaitPromise: true });
  const rr = r.result || {};
  return { v: rr.result ? rr.result.value : undefined,
           异常: rr.exceptionDetails
             ? (rr.exceptionDetails.exception?.description || '').split('\n')[0] : null };
};

try {
  console.log('='.repeat(74));
  console.log('导入 → 进入编辑器 流程回归');
  
  console.log('  工程 ' + 工程);
  console.log('='.repeat(74));
  console.log();

  await 连();
  await sleep(5000);

  console.log('【1】初始状态（示例工程）');
  let r = await ev(`JSON.stringify({
    服务模式: 服务模式,
    文案: document.getElementById('btnEnter').textContent,
    禁用: document.getElementById('btnEnter').disabled,
    状态: document.getElementById('importStatus').textContent,
    已导入: (window.__PROJECT__||{}).已导入 === true,
  })`);
  let d = JSON.parse(r.v);
  console.log('   ' + JSON.stringify(d));
  断言('服务模式', d.服务模式 === true);
  /* 不假设初始状态（服务可能已被别的测试导入过工程） */
  断言('能读到工程信息', typeof d.已导入 === 'boolean', String(d.已导入));
  console.log();

  console.log('【2】选择 FLP 与音频（注入路径，跳过系统对话框）');
  await ev(`(() => {
    已选FLP = ${JSON.stringify(FLP)};
    已选音频 = ${JSON.stringify(音频)};
    document.getElementById('dropFlp').classList.add('filled');
    document.getElementById('dropAudio').classList.add('filled');
    document.getElementById('flpMeta').textContent = 'nujabes.flp';
    document.getElementById('audioMeta').textContent = 'nujabes.mp3';
    检查导入();
  })()`);
  await sleep(400);
  r = await ev(`JSON.stringify({
    文案: document.getElementById('btnEnter').textContent,
    禁用: document.getElementById('btnEnter').disabled,
    状态: document.getElementById('importStatus').textContent,
    /* 诊断：注入是否生效、当前载入的是哪个工程 */
    已选FLP: 已选FLP,
    已选音频: 已选音频,
    载入的FLP: (window.__PROJECT__||{}).flp,
    载入的音频: (window.__PROJECT__||{}).audio,
    已导入: (window.__PROJECT__||{}).已导入,
    已载入所选: 已载入所选(),
  })`);
  d = JSON.parse(r.v);
  console.log('   ' + JSON.stringify(d, null, 0));
  if (r.异常) console.log('   evaluate 异常: ' + r.异常);
  断言('按钮文案为「解析并进入编辑器」', d.文案.indexOf('解析') >= 0, d.文案);
  断言('按钮可点', d.禁用 === false);
  console.log();

  console.log('【3】点击 → 解析 → 应自动 reload 并进入编辑器');
  // 点击后页面会 reload，WebSocket 会断开 —— 需要重新连接
  await ev(`document.getElementById('btnEnter').click()`);

  // 轮询：等页面 reload（连接断开后重连）
  let 已进入 = false, 尝试 = 0, 最终状态 = null;
  while (尝试 < 60 && !已进入) {
    尝试++;
    await sleep(3000);
    try {
      const rr = await ev(`JSON.stringify({
        应用可见: document.getElementById('app').classList.contains('active'),
        欢迎页隐藏: document.getElementById('welcome').classList.contains('hidden'),
        文案: document.getElementById('btnEnter').textContent,
        状态: document.getElementById('importStatus').textContent,
        已导入: (window.__PROJECT__||{}).已导入 === true,
        工程名: (window.__PROJECT__||{}).name || null,
        组件数: (typeof 放置 !== 'undefined' && 放置) ? 放置.length : -1,
      })`);
      if (!rr.v) { continue; }
      最终状态 = JSON.parse(rr.v);
      if (最终状态.应用可见) { 已进入 = true; break; }
      if (尝试 % 4 === 0) {
        console.log('    ' + 尝试 * 3 + 's  ' + JSON.stringify(最终状态));
      }
    } catch (e) {
      // 页面 reload 期间 WebSocket 断开：重连
      try { await 连(); } catch {}
    }
  }

  console.log();
  console.log('   最终: ' + JSON.stringify(最终状态));
  断言('工程已导入', 最终状态 && 最终状态.已导入 === true,
       最终状态 ? String(最终状态.已导入) : '无状态');
  断言('自动进入了编辑器（应用可见）', 已进入,
       '停在欢迎页：' + JSON.stringify(最终状态));
  断言('欢迎页已隐藏', 最终状态 && 最终状态.欢迎页隐藏 === true,
       String(最终状态 && 最终状态.欢迎页隐藏));
  console.log();

  console.log('【4】若未自动进入，手动再点一次也必须能进（不能死循环）');
  if (!已进入) {
    await ev(`document.getElementById('btnEnter').click()`);
    await sleep(3000);
    const rr = await ev(`JSON.stringify({
      应用可见: document.getElementById('app').classList.contains('active'),
      文案: document.getElementById('btnEnter').textContent,
      状态: document.getElementById('importStatus').textContent,
    })`);
    const s2 = JSON.parse(rr.v || '{}');
    console.log('   ' + JSON.stringify(s2));
    断言('手动点击可进入（且文案已变为「进入编辑器」）',
         s2.应用可见 === true || s2.文案 === '进入编辑器',
         JSON.stringify(s2));
  } else {
    console.log('   （已自动进入，无需手动）');
    断言('自动进入成功', true);
  }
  console.log();

  console.log('【5】进入后画布可用');
  r = await ev(`JSON.stringify({
    画布: typeof 画布 !== 'undefined' ? (画布.w + 'x' + 画布.h) : null,
    组件数: typeof 放置 !== 'undefined' ? 放置.length : -1,
    模板数: typeof TEMPLATES !== 'undefined' ? TEMPLATES.length : -1,
    主题数: typeof THEMES !== 'undefined' ? THEMES.length : -1,
  })`);
  d = JSON.parse(r.v || '{}');
  console.log('   ' + JSON.stringify(d));
  断言('画布已初始化', d.画布 && /x/.test(d.画布), String(d.画布));
  断言('模板库可用', d.模板数 > 0, String(d.模板数));
  断言('主题库可用', d.主题数 > 0, String(d.主题数));

  // 实际套个模板，确认画布真能用。
  // 用轮询而不是固定等待 —— 页面刚初始化完时，固定等待可能撞上
  // 它自己的渲染节奏，读到 0 个元素而误判（实测踩到）。
  await ev(`套用模板(TEMPLATES[1])`);
  let 画布元素 = 0, 组件数 = 0;
  for (let i = 0; i < 20; i++) {
    await sleep(400);
    const rr = await ev(`JSON.stringify({
      组件数: 放置.length,
      画布元素: document.querySelectorAll('.win').length,
    })`);
    const s2 = JSON.parse(rr.v || '{}');
    组件数 = s2.组件数 || 0;
    画布元素 = s2.画布元素 || 0;
    if (画布元素 > 0) break;
  }
  console.log('   组件数 ' + 组件数 + ' · 画布元素 ' + 画布元素);
  断言('能套用模板并渲染出组件', 组件数 > 0 && 画布元素 > 0,
       '组件 ' + 组件数 + ' / 元素 ' + 画布元素);

  console.log();
  console.log('='.repeat(74));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  console.log('='.repeat(74));
} finally {
  页.kill();
}
process.exit(fail ? 1 : 0);
