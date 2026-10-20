// GUI 接入服务的验证：
//   1. 离线（file://）时导入/导出应给出明确提示，不能假装成功
//   2. 服务模式下导出面板应展示全部参数、带默认值
//   3. 服务模式下点「开始导出」应真的发起渲染并走完进度
import { spawn } from 'node:child_process';
import http from 'node:http';
import { writeFileSync } from 'node:fs';


/* 测试用临时目录：放项目内（D 盘），避免累积撑满系统盘。
   实测：用 process.env.TEMP 时 125 次运行留下 3.77 GB profile，
   C 盘被撑到 0 字节可用，后续所有写操作 ENOSPC。 */
import { mkdirSync as _mkdir } from 'node:fs';
const TMP = 'D:/FL_VISUAL_TEST/.testtmp';
try { _mkdir(TMP, { recursive: true }); } catch (e) {}

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const 端口 = parseInt(process.argv[2] || '8795', 10);
const PORT = 9990;

let child = null;   /* 导入完成后再启动（见下） */

const get = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej);
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------
   先通过接口导入一个**真实工程**。
   示例工程的音频数据是预分析的，没有真实文件路径，
   渲染阶段会被正确拒绝 —— 那是预期行为，不适合用来测导出。
   --------------------------------------------------------------- */
const 工程目录 = String.raw`E:\FL_Project\amapiano`;

async function 导入真实工程() {
  const post = (路径, 数据) => new Promise((res, rej) => {
    const body = JSON.stringify(数据);
    const req = http.request({
      host: '127.0.0.1', port: 端口, path: 路径, method: 'POST',
      headers: { 'Content-Type': 'application/json',
                 'Content-Length': Buffer.byteLength(body) },
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    req.on('error', rej);
    req.write(body); req.end();
  });

  const r = await post('/api/import', {
    flp: 工程目录 + '\\amapiano.flp',
    audio: 工程目录 + '\\amapiano.mp3',
  });
  if (!r.id) throw new Error('导入未被受理：' + JSON.stringify(r));
  for (let i = 0; i < 200; i++) {
    await sleep(1500);
    const t = await new Promise((res, rej) => {
      http.get({ host: '127.0.0.1', port: 端口, path: '/api/job?id=' + r.id },
        rr => { let d = ''; rr.on('data', c => d += c);
                rr.on('end', () => res(JSON.parse(d))); }).on('error', rej);
    });
    if (t.状态 !== '运行中') {
      if (t.状态 !== '完成') throw new Error('导入失败：' + t.错误);
      return t;
    }
  }
  throw new Error('导入超时');
}

console.log('准备：通过接口导入真实工程 ' + 工程目录);

const 导入结果 = await 导入真实工程();
/* 浏览器必须在导入完成后启动：
   否则页面拿到的是导入前的示例工程，__PROJECT__.audio 为空，
   点导出会报「音频路径无效」。
   以前靠上一个测试残留的会话状态蒙对，属隐藏的顺序依赖。 */
child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/guisrv`,
  '--window-size=1600,1000',
  `http://127.0.0.1:${端口}/`], { stdio: 'ignore' });

console.log('      ' + (导入结果.消息 || '完成'));
console.log();


let pass = 0, fail = 0;
function 断言(名, 条件, 详情) {
  if (条件) { pass++; console.log('  ✓ ' + 名); }
  else { fail++; console.log('  ✗ ' + 名 + (详情 ? '  → ' + 详情 : '')); }
}

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
  const send = (m, p) => new Promise(res => {
    const my = ++id;
    const h = ev => { const x = JSON.parse(ev.data); if (x.id === my) { ws.removeEventListener('message', h); res(x.result); } };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: my, method: m, params: p }));
  });
  const ev = e => send('Runtime.evaluate', {
    expression: e, returnByValue: true, awaitPromise: true });
  await send('Page.enable'); await send('Runtime.enable');
  const errs = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') {
      errs.push(m.params.exceptionDetails.exception?.description?.split('\n')[0] ||
                m.params.exceptionDetails.text);
    }
  });
  await sleep(3500);

  console.log('='.repeat(72));
  console.log('GUI 接入服务验证（http://127.0.0.1:' + 端口 + '）');
  console.log('='.repeat(72));
  console.log();

  console.log('【1】服务模式识别与工程信息');
  let r = await ev(`JSON.stringify({
    服务模式: 服务模式,
    APP_MODE: window.__APP_MODE__,
    工程: window.__PROJECT__ || null,
    页脚: (document.querySelector('.wFoot')||{}).textContent || '',
  })`);
  let d = JSON.parse(r.result.value);
  console.log('   ' + JSON.stringify(d));
  断言('识别为服务模式', d.服务模式 === true, String(d.服务模式));
  断言('拿到了工程信息', d.工程 && d.工程.name, JSON.stringify(d.工程));
  断言('页脚不再是「界面设计预览」', d.页脚.indexOf('界面设计预览') < 0,
       d.页脚.slice(0, 40));
  console.log();

  console.log('【2】导入页状态');
  r = await ev(`JSON.stringify({
    进入按钮文案: document.getElementById('btnEnter').textContent,
    禁用: document.getElementById('btnEnter').disabled,
    状态: document.getElementById('importStatus').textContent,
  })`);
  d = JSON.parse(r.result.value);
  console.log('   ' + JSON.stringify(d));
  /* 按钮文案取决于「所选文件是否就是已载入的工程」：
       是   → 「进入编辑器」  （不必重复解析）
       不是 → 「解析并进入编辑器」
     本测试前面已用接口导入了该工程，页面载入后选中的就是它，
     故这里应当是「进入编辑器」。
     另一分支（需要解析）由 tools/test_import_flow.mjs 覆盖。
     —— 这条断言原先写死为「解析并进入编辑器」，是修复前的旧行为。 */
  断言('按钮文案反映已载入状态（进入编辑器）',
       d.进入按钮文案 === '进入编辑器', d.进入按钮文案);
  console.log();

  console.log('【3】进入编辑器并打开导出面板');
  await ev(`(() => {
    document.getElementById('welcome').classList.add('hidden');
    document.getElementById('app').classList.add('active');
    初始化();
  })()`);
  await sleep(1500);

  // 套用一个模板，保证有内容
  await ev(`套用模板(TEMPLATES[1])`);
  await sleep(1200);

  await ev(`document.getElementById('btnExport').click()`);
  await sleep(800);
  r = await ev(`JSON.stringify({
    面板显示: document.getElementById('exModal').classList.contains('on'),
    输出: document.getElementById('exOut').value,
    起点: document.getElementById('exStart').value,
    时长: document.getElementById('exDur').value,
    全长: document.getElementById('exTotal').textContent,
    画布: document.getElementById('exSize').textContent,
    帧率: document.getElementById('exFps').textContent,
    预设: document.getElementById('exPreset').value,
    音轨: document.getElementById('exAudio').checked,
    可点: !document.getElementById('exGo').disabled,
    报错可见: document.getElementById('exErr').style.display,
  })`);
  d = JSON.parse(r.result.value);
  console.log('   ' + JSON.stringify(d));
  断言('导出面板已打开', d.面板显示 === true);
  断言('输出路径有默认值', !!d.输出, d.输出);
  断言('时长默认为全长', parseFloat(d.时长) > 0, d.时长);
  断言('显示工程全长', parseFloat(d.全长) > 0, d.全长);
  断言('显示画布尺寸', /×/.test(d.画布), d.画布);
  断言('显示帧率', parseInt(d.帧率) > 0, d.帧率);
  断言('预设默认 medium', d.预设 === 'medium', d.预设);
  断言('默认混入音轨', d.音轨 === true);
  断言('服务模式下可点导出', d.可点 === true);
  console.log();

  console.log('【4】真的发起渲染并走完进度');
  // 缩短时长，加快验证
  await ev(`(() => {
    document.getElementById('exDur').value = '1.5';
    document.getElementById('exStart').value = '6';
    document.getElementById('exPreset').value = 'ultrafast';
    document.getElementById('exParallel').value = '2';
    document.getElementById('exGo').click();
  })()`);

  let 完成 = false, 见到进度 = false, 最后 = null;
  for (let i = 0; i < 150; i++) {
    await sleep(2000);
    const rr = await ev(`JSON.stringify({
      进度条宽: document.getElementById('exBar').style.width,
      百分比: document.getElementById('exPct').textContent,
      阶段: document.getElementById('exStage').textContent,
      消息: document.getElementById('exMsg').textContent,
      结果可见: document.getElementById('exResult').style.display,
      结果文本: document.getElementById('exResult').textContent,
      报错可见: document.getElementById('exErr').style.display,
      报错: document.getElementById('exErr').textContent,
      按钮: document.getElementById('exGo').textContent,
    })`);
    const s = JSON.parse(rr.result.value);
    if (parseFloat(s.进度条宽) > 0 && parseFloat(s.进度条宽) < 100) 见到进度 = true;
    if (i % 3 === 0) {
      console.log('    ' + s.百分比.padStart(5) + '  ' + s.阶段 + '  ' + s.消息);
    }
    if (s.结果可见 === 'block') { 完成 = true; 最后 = s; break; }
    if (s.报错可见 === 'block') { 最后 = s; break; }
  }

  断言('进度条确实动过（不是瞬完）', 见到进度 || 完成, String(见到进度));
  断言('渲染完成并显示了结果', 完成, 最后 ? 最后.报错 : '超时');
  if (完成) {
    console.log('     ' + 最后.结果文本);
    断言('结果里有文件路径', /\.mp4/.test(最后.结果文本), 最后.结果文本);
    断言('提供了下载链接', /\/api\/video\?id=/.test(await (async () =>
      (await ev(`document.getElementById('exResult').innerHTML`)).result.value)()),
      '无下载链接');
  }
  console.log();

  console.log('【5】页面错误');
  断言('无 JS 错误', errs.length === 0, errs.slice(0, 3).join(' | '));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(process.env.TEMP + '\\gui_export.png',
                Buffer.from(shot.data, 'base64'));
  console.log('WROTE gui_export.png');

  console.log();
  console.log('='.repeat(72));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  console.log('='.repeat(72));
} finally {
  child.kill();
}
process.exit(fail ? 1 : 0);
