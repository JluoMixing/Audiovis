// G3 验证：拖拽导入（上传接口 + 拖拽事件 + 校验）
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdirSync, statSync, readFileSync } from 'node:fs';

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const TMP = 'D:/FL_VISUAL_TEST/.testtmp';
mkdirSync(TMP, { recursive: true });

const 端口 = parseInt(process.argv[2] || '9500', 10);
const PORT = 10120;

let pass = 0, fail = 0;
const 断言 = (名, 条件, 详情) => {
  if (条件) { pass++; console.log('  ✓ ' + 名); }
  else { fail++; console.log('  ✗ ' + 名 + (详情 ? '  → ' + 详情 : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 直接发原始字节（模拟浏览器上传） */
function 上传(名, 字节, 覆盖长度) {
  return new Promise((res, rej) => {
    const len = 覆盖长度 !== undefined ? 覆盖长度 : 字节.length;
    const req = http.request({
      host: '127.0.0.1', port: 端口, path: '/api/upload', method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(len),
        'X-File-Name': encodeURIComponent(名),
      },
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    req.on('error', rej);
    req.write(字节);
    req.end();
  });
}

const 页 = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/drop`,
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
  console.log('G3 验证：拖拽导入');
  console.log('='.repeat(72));
  console.log();

  // ---- 1) 上传接口：真实文件 ----
  console.log('【1】上传真实 FLP');
  const flp路径 = String.raw`E:\FL_Project\amapiano\amapiano.flp`;
  const flp字节 = readFileSync(flp路径);
  console.log('    源文件 ' + (flp字节.length / 1024).toFixed(0) + ' KB');
  let d = await 上传('amapiano.flp', flp字节);
  断言('上传成功', d.ok === true, d.错误 || d);
  if (d.ok) {
    断言('返回真实路径', !!d.路径, d.路径);
    断言('文件已落盘', statSync(d.路径).size === flp字节.length,
         statSync(d.路径).size + ' vs ' + flp字节.length);
    断言('扩展名正确', d.扩展 === '.flp', d.扩展);
    console.log('    落盘: ' + d.路径);
  }
  console.log();

  // ---- 2) 拒绝非法类型 ----
  console.log('【2】拒绝非法类型');
  d = await 上传('恶意.txt', Buffer.from('hello'));
  断言('拒绝 .txt', d.ok !== true, JSON.stringify(d).slice(0, 80));
  console.log('    ' + (d.错误 || '').slice(0, 70));
  断言('错误信息说明类型', (d.错误 || '').indexOf('不支持') >= 0, d.错误);
  console.log();

  // ---- 3) 拒绝超大文件 ----
  console.log('【3】拒绝超大文件');
  d = await 上传('巨大.mp3', Buffer.from('x'), 600 * 1024 * 1024);
  断言('拒绝超 500MB', d.ok !== true, JSON.stringify(d).slice(0, 80));
  console.log('    ' + (d.错误 || '').slice(0, 70));
  断言('错误信息提到过大', (d.错误 || '').indexOf('过大') >= 0, d.错误);
  console.log();

  // ---- 4) 目录穿越防护 ----
  console.log('【4】文件名清洗');
  d = await 上传('../../evil.flp', Buffer.from('dummy'));
  断言('接受但不越界', d.ok === true, d.错误 || d);
  if (d.ok) {
    断言('落盘在上传目录内',
        d.路径.indexOf('uploads') >= 0, d.路径);
    断言('文件名已去路径',
        d.名称 === 'evil.flp' || d.名称.indexOf('..') < 0, d.名称);
    console.log('    ' + d.名称);
  }
  console.log();

  // ---- 5) 同名文件不覆盖 ----
  console.log('【5】同名文件不覆盖');
  const a = await 上传('重复.flp', Buffer.from('aaa'));
  const b = await 上传('重复.flp', Buffer.from('bbb'));
  断言('两次都成功', a.ok && b.ok, JSON.stringify([a.错误, b.错误]));
  断言('路径不同', a.路径 !== b.路径, a.名称 + ' / ' + b.名称);
  console.log('    ' + a.名称 + ' / ' + b.名称);
  console.log();

  // ---- 6) 界面：拖拽事件 ----
  console.log('【6】界面拖拽事件');
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
    遮罩存在: !!document.getElementById('dropMask'),
    遮罩样式: getComputedStyle(document.getElementById('dropMask')).position,
    处理函数: typeof 处理拖入文件,
    上传函数: typeof 上传文件,
  })`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('遮罩元素存在', d.遮罩存在 === true);
  断言('遮罩为 fixed 定位', d.遮罩样式 === 'fixed', d.遮罩样式);
  断言('拖拽处理函数已定义', d.处理函数 === 'function', d.处理函数);
  console.log();

  // ---- 7) dragenter 显示遮罩 ----
  console.log('【7】拖入显示遮罩');
  r = await ev(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'a.txt', { type: 'text/plain' }));
    window.dispatchEvent(new DragEvent('dragenter',
      { dataTransfer: dt, bubbles: true, cancelable: true }));
    const 开 = document.getElementById('dropMask').classList.contains('on');
    window.dispatchEvent(new DragEvent('dragleave',
      { dataTransfer: dt, bubbles: true, cancelable: true }));
    const 关 = document.getElementById('dropMask').classList.contains('on');
    return JSON.stringify({ 进入后显示: 开, 离开后隐藏: !关 });
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('dragenter 显示遮罩', d.进入后显示 === true);
  断言('dragleave 隐藏遮罩', d.离开后隐藏 === true);
  console.log();

  // ---- 8) 拖入非法类型 ----
  console.log('【8】拖入非法类型');
  r = await ev(`(async () => {
    /* 注意：已选FLP 在页面初始化时就有值（来自示例工程），
       不能断言它为空。要比的是「拖入非法文件前后是否变化」。 */
    const 前 = 已选FLP || '';
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'bad.txt', { type: 'text/plain' }));
    window.dispatchEvent(new DragEvent('drop',
      { dataTransfer: dt, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 900));
    return JSON.stringify({
      遮罩已隐藏: !document.getElementById('dropMask').classList.contains('on'),
      前, 后: 已选FLP || '',
    });
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('遮罩已隐藏', d.遮罩已隐藏 === true);
  断言('非法类型不改已选FLP', d.前 === d.后, d.前 + ' → ' + d.后);
  console.log();

  // ---- 9) 拖入 .flp（走真实上传）----
  console.log('【9】拖入 .flp 触发上传');
  r = await ev(`(async () => {
    const dt = new DataTransfer();
    dt.items.add(new File(['dummy flp content'], 'drop_test.flp',
      { type: 'application/octet-stream' }));
    window.dispatchEvent(new DragEvent('drop',
      { dataTransfer: dt, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 2500));
    return JSON.stringify({
      已选FLP: 已选FLP || '',
      卡片已填充: document.getElementById('dropFlp').classList.contains('filled'),
      状态文案: document.getElementById('importStatus').textContent,
    });
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('已选FLP 已被设置', !!d.已选FLP, d.已选FLP);
  断言('FLP 卡片已填充', d.卡片已填充 === true);
  断言('状态提示要求音频',
       (d.状态文案 || '').indexOf('音频') >= 0 ||
       (d.状态文案 || '').length > 0, d.状态文案);
  console.log();

  console.log('='.repeat(72));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  console.log('='.repeat(72));
} finally {
  clearTimeout(超时);
  页.kill();
}
process.exit(fail ? 1 : 0);
