// 验证两个 bug 修复：
//   1. 导出起点被忽略（后半段静止）
//   2. 打开工程丢失画布
//
// 跑法：python tools/run_tests.py test_export_start_restore
//   需要服务：--server 端口

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import http from 'node:http';

const TMP = 'D:/FL_VISUAL_TEST/.testtmp';
try { mkdirSync(TMP, { recursive: true }); } catch (e) {}

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
// 10080 在 Node 的禁用端口列表里（undici bad port），
// WebSocket 会静默连不上。用 10090。
const CDP_PORT = 10090;
const SRV = Number(process.argv[2]) || 11000;
const 根 = 'D:/FL_VISUAL_TEST';

let pass = 0, fail = 0;
const 断言 = (名, 条件, 详情) => {
  if (条件) { pass++; console.log('  ✓ ' + 名); }
  else { fail++; console.log('  ✗ ' + 名 + (详情 ? '  → ' + 详情 : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function 请求(path, body) {
  return new Promise((res, rej) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: SRV, path,
      method: data ? 'POST' : 'GET',
      headers: data ? { 'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(data) } : {},
      timeout: 600000,
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    req.on('error', rej);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

async function 等任务(id, 最多次 = 900) {
  for (let i = 0; i < 最多次; i++) {
    await sleep(700);
    const t = await 请求('/api/job?id=' + id);
    if (t.状态 !== '运行中') return t;
  }
  return { 状态: '超时' };
}

console.log('='.repeat(74));
console.log('两个 bug 修复验证');
console.log('='.repeat(74));
console.log();

// ============================================================ 准备
let 会话 = await 请求('/api/session');
if (!会话.已导入) {
  console.log('导入测试工程…');
  const r = await 请求('/api/import', {
    flp: 'E:\\FL_Project\\amapiano\\amapiano.flp',
    audio: 'E:\\FL_Project\\amapiano\\amapiano.mp3',
  });
  const t = await 等任务(r.id);
  console.log('  导入:', t.状态);
  会话 = await 请求('/api/session');
}
const 总长 = 会话.projectDuration || 会话.duration;
console.log('工程时长:', 总长, '秒（音频', 会话.duration, '秒）');
console.log();

const 模板 = JSON.parse(
  (await import('node:fs')).readFileSync(根 + '/preview/templates.json', 'utf8'));
const 组件 = 模板.find(x => x.name === '基础').land;

// ============================================================ Bug 1
console.log('【1】导出：起点 + 时长必须落在工程总长内');
console.log();

// 起点设在末尾前 2 秒，时长填 120（远超剩余）
const 起点 = Math.max(0, Math.round((总长 - 2) * 100) / 100);
const 输出 = 'D:\\FL_VISUAL_TEST\\out\\_bug1_clamp.mp4';
const r1 = await 请求('/api/render', {
  flp: 会话.flp, audio: 会话.audio,
  主题: 'sumi', 画布: { w: 1280, h: 720 },
  帧率: 6, 时长: 120, 起点: 起点,
  输出, 预设: 'ultrafast', 并行度: 2, 组件,
});
const t1 = await 等任务(r1.id);
console.log('  请求: 起点 ' + 起点 + 's, 时长 120s');
console.log('  结果:', t1.状态);

断言('渲染完成', t1.状态 === '完成', (t1.错误 || '').slice(0, 260));

if (t1.状态 === '完成') {
  /* 时长/帧数在任务的「结果」里（render.py 的返回结构），
     不是「产物」—— 产物只有 视频/存在/耗时。 */
  const 产 = t1.产物 || {};
  const 果 = t1.结果 || {};
  const 期望 = 总长 - 起点;
  console.log('  视频:', 产.视频);
  console.log('  渲染时长:', 果.时长秒, '秒（期望 ≈', 期望.toFixed(2), '秒）',
              '| 帧数', 果.总帧数);
  断言('时长被收窄到剩余长度（不是 120 秒）',
       Math.abs((果.时长秒 || 0) - 期望) < 0.5,
       '得到 ' + 果.时长秒 + '，期望 ' + 期望.toFixed(2));
  断言('总帧数符合收窄后的时长',
       Math.abs((果.总帧数 || 0) - Math.round(期望 * 6)) <= 2,
       '帧数 ' + 果.总帧数);

  /* 视频输出路径也要对得上请求 */
  断言('产物路径 = 请求的输出路径', 产.视频 === 输出,
       产.视频 + ' vs ' + 输出);

  // 用 ffprobe 独立核对容器时长
  try {
    const { spawnSync } = await import('node:child_process');
    const { existsSync } = await import('node:fs');
    const ff = 'D:/FL_VISUAL_TEST/dist/FLVisualizer/imageio_ffmpeg/binaries/'
      + 'ffmpeg-win-x86_64-v7.1.exe';
    if (existsSync(ff)) {
      // ffmpeg 把元信息打到 stderr，且无输出文件时退出码非 0 —— 忽略退出码
      const r = spawnSync(ff, ['-i', 输出], { encoding: 'utf8' });
      const out = String(r.stderr || '') + String(r.stdout || '');
      const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(out);
      if (m) {
        const 秒 = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
        console.log('  ffmpeg 报告容器时长:', 秒.toFixed(2), '秒');
        断言('容器时长正确（不是 120 秒）', Math.abs(秒 - 期望) < 0.6,
             '得到 ' + 秒.toFixed(2));
      } else {
        console.log('  （未能从 ffmpeg 输出解析 Duration）');
      }
    } else {
      console.log('  （ffmpeg 不存在，跳过容器时长核对）');
    }
  } catch (e) {
    console.log('  （ffprobe 跳过：' + String(e.message).slice(0, 60) + '）');
  }
}

// 起点超出总长应报错
const r1b = await 请求('/api/render', {
  flp: 会话.flp, audio: 会话.audio,
  主题: 'sumi', 画布: { w: 640, h: 360 },
  帧率: 6, 时长: 5, 起点: 总长 + 10,
  输出: 'D:\\FL_VISUAL_TEST\\out\\_bug1_bad.mp4',
  预设: 'ultrafast', 并行度: 1, 组件,
});
const t1b = await 等任务(r1b.id).catch(e => ({ 状态: '异常' }));
console.log();
console.log('  起点超界测试:', t1b.状态,
            '—', String(t1b.错误 || '').split('\n')[0].slice(0, 80));
断言('起点超出工程长度被拒绝', t1b.状态 === '失败',
     t1b.状态);
console.log();

// ============================================================ Bug 2
console.log('【2】保存 / 打开工程：必须恢复画布');
console.log();

// 先保存一个已知布局（3 个组件，主题 blueprint）
const 测试布局 = {
  版本: 1,
  画布: { w: 1920, h: 1080 },
  主题: 'blueprint',
  帧率: 30,
  组件: [
    { id: 'playlist', x: 40, y: 60, w: 900, h: 500, z: 1 },
    { id: 'spectrum', x: 980, y: 60, w: 500, h: 260, z: 2 },
    { id: 'text', x: 980, y: 360, w: 500, h: 140, z: 3,
      样式: { 内容: 'SAVED BY TEST', 字号: 44 } },
  ],
};

const 保存 = await 请求('/api/project/save', {
  名称: 'bug2_测试工程',
  布局: 测试布局,
  主题: 'blueprint',
  静帧秒: 33,
  导出设置: { 帧率: 30, 宽度: 1920, 高度: 1080 },
});
console.log('  保存:', 保存.ok ? 保存.名称 : (保存.错误 || '失败'));
断言('保存成功', 保存.ok === true, 保存.错误);

const 打开 = await 请求('/api/project/open', { 路径: 保存.路径 });
console.log('  打开:', 打开.ok ? 打开.名称 : (打开.错误 || '失败'),
            '组件数:', 打开.组件数);
断言('打开成功', 打开.ok === true, 打开.错误);
断言('服务端记下的组件数 = 3', 打开.组件数 === 3, 打开.组件数);

// 用浏览器加载页面，看前端是否真的把布局画到画布上
/* 走真实的 #enter 路径（与「打开工程」后的自动进入一致）。
   注意：这依赖 检查自动保存 不再用阻塞式 confirm() ——
   换成应用内 询问() 之后 #enter 才可用。 */
const { renameSync, existsSync } = await import('node:fs');

/* 用户的自动保存文件：测试期间临时移开
   （否则页面会弹「检测到未保存的工作」询问框，挡住还原流程）。
   结束时会移回来，绝不删除用户数据。 */
const 缓存根 = (process.env.LOCALAPPDATA || '')
  + '\\FLVisualizer\\cache\\autosave\\recovery.json';
let 移开过 = false;
try {
  if (existsSync(缓存根)) {
    renameSync(缓存根, 缓存根 + '.testbak');
    移开过 = true;
    console.log('  （临时移开用户的自动保存文件）');
  }
} catch (e) { console.log('  （自动保存文件移开失败：' + e.message + '）'); }

const 页 = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${TMP}/bug2_${Date.now().toString(36)}`,
  '--window-size=1600,1000',
  `http://127.0.0.1:${SRV}/#enter`], { stdio: 'ignore' });

const get = q => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: q }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej);
});

try {
  let 列表 = null;
  for (let i = 0; i < 80; i++) {
    try { 列表 = await get('/json/list'); if (列表 && 列表.length) break; } catch {}
    await sleep(500);
  }
  if (!列表 || !列表.length) throw new Error('CDP 无目标');

  /* 必须按 URL 选目标 —— 默认可能拿到 edge://newtab
     （踩过：连到 newtab 后所有全局变量都是 undefined）。 */
  let page = null;
  for (let i = 0; i < 60; i++) {
    const l = await get('/json/list').catch(() => []);
    page = (l || []).filter(x => x.type === 'page' &&
      x.url.startsWith('http://127.0.0.1:' + SRV))[0];
    if (page) break;
    await sleep(400);
  }
  if (!page) throw new Error('没找到目标页面');
  console.log('  CDP 目标:', page.url);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const 连上 = await Promise.race([
    new Promise(r => ws.addEventListener('open', () => r(true))),
    new Promise(r => ws.addEventListener('error', () => r(false))),
    new Promise(r => setTimeout(() => r(false), 10000)),
  ]);
  if (!连上) throw new Error('CDP WebSocket 连接失败（端口 ' + CDP_PORT + '）');

  let id = 0;
  const 待 = new Map();
  ws.addEventListener('message', e => {
    const x = JSON.parse(e.data);
    if (x.id && 待.has(x.id)) { const f = 待.get(x.id); 待.delete(x.id); f(x); }
  });
  const send = (m, q, 超时 = 20000) => new Promise((res, rej) => {
    const my = ++id;
    待.set(my, res);
    ws.send(JSON.stringify({ id: my, method: m, params: q }));
    setTimeout(() => {
      if (待.has(my)) { 待.delete(my); rej(new Error('CDP 超时: ' + m)); }
    }, 超时);
  });

  await send('Runtime.enable');

  const ev = async (表达式, 超时) => {
    const r = await send('Runtime.evaluate',
      { expression: 表达式, returnByValue: true }, 超时);
    const rr = r.result || {};
    return { v: rr.result ? rr.result.value : undefined,
             异常: rr.exceptionDetails
               ? (rr.exceptionDetails.exception?.description || '')
                 .split('\n')[0] : null };
  };

  // 页面自己会 #enter 进编辑器；轮询等 放置 有内容
  console.log();
  console.log('  等待页面自动进入编辑器并还原…');
  let 状态 = {};
  for (let i = 0; i < 40; i++) {
    await sleep(700);
    let r;
    try { r = await ev(`JSON.stringify({
      放置: typeof 放置 !== 'undefined' ? 放置.length : -1,
      主题: typeof 主题键 !== 'undefined' ? 主题键 : null,
      帧率: typeof 帧率 !== 'undefined' ? 帧率 : -1,
      dom组件: document.querySelectorAll('.win[data-uid]').length,
      未保存: typeof 未保存 !== 'undefined' ? 未保存 : null,
      询问框: !!document.querySelector('.askMask'),
      有RESTORE: !!window.__RESTORE__,
    })`, 8000); } catch (e) { continue; }
    状态 = JSON.parse(r.v || '{}');
    断言('页面不卡死（能响应 CDP）', r.异常 === null,
         r.异常 || '');
    断言('没有阻塞式询问框', 状态.询问框 !== true, '出现了 .askMask');
    if (状态.放置 > 0) break;
  }
  console.log('   ', JSON.stringify(状态));

  断言('服务端注入了 __RESTORE__', 状态.有RESTORE === true);
  断言('前端画布上有 3 个组件（说明真的还原了）',
       状态.放置 === 3, '放置=' + 状态.放置);
  断言('DOM 里渲染出 3 个窗口', 状态.dom组件 === 3, 'DOM=' + 状态.dom组件);
  断言('主题还原为 blueprint', 状态.主题 === 'blueprint', 状态.主题);
  断言('帧率还原为 30', 状态.帧率 === 30, 状态.帧率);
  断言('还原后不显示「未保存」', 状态.未保存 === false, 状态.未保存);

  // ============================================================ 前端时长联动
  console.log();
  console.log('【3】导出面板：起点改动 -> 时长自动收窄');
  const 联 = JSON.parse((await ev(`(() => {
    打开导出面板();
    const 总 = 导出总长();
    const 起0 = document.getElementById('exStart');
    const 时0 = document.getElementById('exDur');
    起0.value = '60';
    起0.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({
      总: Math.round(总 * 100) / 100,
      改后时长: Math.round((parseFloat(时0.value) || 0) * 100) / 100,
      期望: Math.round(Math.max(0.1, 总 - 60) * 100) / 100,
    });
  })()`)).v || '{}');
  console.log('   ', JSON.stringify(联));
  断言('起点改 60 秒后，时长自动变为「总长-60」',
       Math.abs(联.改后时长 - 联.期望) < 0.05,
       '得到 ' + 联.改后时长 + '，期望 ' + 联.期望);

  ws.close();
} catch (e) {
  console.log('  ✗ 浏览器验证异常：' + e.message);
  fail++;
} finally {
  try { 页.kill(); } catch {}
  if (移开过) {
    try { renameSync(缓存根 + '.testbak', 缓存根); }
    catch (e) { console.log('  ⚠ 自动保存文件移回失败：' + e.message); }
  }
}

// ============================================================
console.log();
console.log('='.repeat(74));
console.log('通过 ' + pass + ' / ' + (pass + fail));
console.log('='.repeat(74));
process.exit(fail ? 1 : 0);
