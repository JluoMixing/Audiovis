// G2 验证：工程保存/打开/最近列表
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;

/* 测试临时目录：放项目盘，避免撑满系统盘 */
const TMP = 'D:/FL_VISUAL_TEST/.testtmp';
mkdirSync(TMP, { recursive: true });

const 端口 = parseInt(process.argv[2] || '9110', 10);
const PORT = 10100;

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

const 页 = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/proj`,
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
  console.log('G2 验证：工程管理');
  console.log('='.repeat(72));
  console.log();

  // ---- 1) 接口存在 ----
  console.log('【1】工程接口');
  let d = await api('/api/project/recent');
  断言('最近列表可读', Array.isArray(d.工程), Object.keys(d));
  console.log('    当前最近工程数: ' + (d.工程 || []).length);
  console.log();

  // ---- 1.5) 先导入真实工程（保存需要真实的 FLP/音频引用）----
  console.log('【1.5】导入真实工程');
  const 工程源 = String.raw`E:\FL_Project\amapiano`;
  let d导入 = await api('/api/import', {
    flp: 工程源 + '\\amapiano.flp',
    audio: 工程源 + '\\amapiano.mp3',
  });
  断言('导入已受理', !!d导入.id, d导入);
  for (let i = 0; i < 200; i++) {
    await sleep(1200);
    const t2 = await api('/api/job?id=' + d导入.id);
    if (t2.状态 !== '运行中') {
      断言('导入完成', t2.状态 === '完成', t2.错误);
      break;
    }
  }
  console.log();

  // ---- 2) 保存工程 ----
  console.log('【2】保存工程');
  const 工程目录 = 'D:/FL_VISUAL_TEST/out/projects';
  const 测试路径 = 工程目录 + '/自动测试工程.flvproj';
  d = await api('/api/project/save', {
    名称: '自动测试工程',
    路径: 测试路径,
    布局: {
      画布: { w: 1920, h: 1080 },
      主题: 'sumi',
      组件: [
        { id: 'playlist', x: 10, y: 20, w: 400, h: 300, z: 1 },
        { id: 'text', x: 50, y: 400, w: 200, h: 40, z: 2,
          样式: { 内容: '{title}', 字号: 30 } },
      ],
    },
    主题: 'sumi',
    静帧秒: 12.5,
    导出设置: { 帧率: 60 },
  });
  断言('保存成功', d.ok === true, d);
  断言('返回路径', !!d.路径, d.路径);
  断言('文件已生成', d.大小字节 > 0, d.大小字节);
  console.log('    ' + d.路径 + '  ' + d.大小字节 + ' 字节');
  断言('含分析缓存', d.含分析 === true || d.含分析 === false,
       d.含分析);
  console.log();

  // ---- 3) 最近列表包含它 ----
  console.log('【3】最近列表');
  d = await api('/api/project/recent');
  const 列表 = d.工程 || [];
  const 找到 = 列表.find(x => (x.路径 || '').indexOf('自动测试工程') >= 0);
  断言('最近列表包含刚保存的工程', !!找到, 列表.map(x => x.名称));
  if (找到) {
    console.log('    ' + JSON.stringify({
      名称: 找到.名称, 组件数: 找到.组件数, 引用有效: 找到.引用有效,
    }));
    断言('组件数正确', 找到.组件数 === 2, 找到.组件数);
  }
  console.log();

  // ---- 4) 打开工程 ----
  console.log('【4】打开工程');
  d = await api('/api/project/open', { 路径: 测试路径 });
  断言('打开成功', d.ok === true, d.错误 || d);
  断言('返回组件数', d.组件数 === 2, d.组件数);
  断言('返回主题', d.主题 === 'sumi', d.主题);
  console.log('    ' + JSON.stringify({
    名称: d.名称, 组件数: d.组件数, 主题: d.主题, 有分析: d.有分析,
  }));
  console.log();

  // ---- 5) 异常：引用失效 ----
  console.log('【5】异常：引用失效');

  // 5a) 保存时引用缺失 → 应被拒绝（不能存出一个必然打不开的工程）
  d = await api('/api/project/save', {
    名称: '缺引用',
    路径: 工程目录 + '/缺引用.flvproj',
    布局: { 组件: [{ id: 'playlist', x: 0, y: 0, w: 100, h: 100 }] },
    flp: 'E:/不存在的工程.flp',
    audio: 'E:/不存在的音频.mp3',
  });
  断言('保存时拒绝不存在的引用', d.ok !== true, JSON.stringify(d).slice(0, 80));
  console.log('    错误: ' + (d.错误 || '').split('\n')[0].slice(0, 66));
  断言('错误信息提到 FLP', (d.错误 || '').indexOf('FLP') >= 0, d.错误);
  console.log();

  // 5b) 直接构造「引用失效」的工程（模拟存好后原始文件被移走）
  const { execFileSync } = await import('node:child_process');
  const 缺引用路径 = 工程目录 + '/引用失效.flvproj';
  execFileSync('python', ['-c', `
import sys, pathlib
sys.path.insert(0, r'D:/FL_VISUAL_TEST')
from src import project as P
m = P.新建元数据('引用已失效', r'E:/已移走的工程.flp', r'E:/已移走的音频.mp3',
                {'组件': [{'id': 'playlist', 'x': 0, 'y': 0, 'w': 100, 'h': 100}]})
P.打包(r'${缺引用路径.replace(/'/g, "")}', m, None, None)
`], { cwd: 'D:/FL_VISUAL_TEST' });
  断言('已构造引用失效的工程', true);

  d = await api('/api/project/open', { 路径: 缺引用路径 });
  断言('打开被拒绝并给出原因', d.ok !== true && !!d.错误, JSON.stringify(d).slice(0, 90));
  console.log('    错误: ' + (d.错误 || '').split('\n')[0].slice(0, 66));
  断言('错误信息提到 FLP', (d.错误 || '').indexOf('FLP') >= 0, d.错误);
  console.log();

  // ---- 6) 打开损坏文件 ----
  console.log('【6】异常：文件损坏');
  const fs = await import('node:fs');
  const 坏 = 工程目录 + '/损坏.flvproj';
  fs.writeFileSync(坏, 'this is not a zip');
  d = await api('/api/project/open', { 路径: 坏 });
  断言('损坏文件被拒绝', d.ok !== true && !!d.错误, d);
  console.log('    错误信息: ' + (d.错误 || '').slice(0, 60));
  console.log();

  // ---- 7) 界面 ----
  console.log('【7】界面元素');
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
    保存按钮: !!document.getElementById('btnProjSave'),
    打开按钮: !!document.getElementById('btnProjOpen'),
    脏标记: !!document.getElementById('tbDirty'),
    最近框: !!document.getElementById('recentBox'),
    记录历史可用: typeof 记录历史 === 'function',
    取布局可用: typeof 取布局 === 'function',
  })`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('保存按钮存在', d.保存按钮 === true);
  断言('打开按钮存在', d.打开按钮 === true);
  断言('脏标记元素存在', d.脏标记 === true);
  断言('最近工程区存在', d.最近框 === true);
  console.log();

  console.log('【8】脏标记机制');
  r = await ev(`(() => {
    const 前 = document.getElementById('tbDirty').style.display;
    记录历史();
    const 后 = document.getElementById('tbDirty').style.display;
    return JSON.stringify({ 前, 后 });
  })()`);
  d = JSON.parse(r.v || '{}');
  console.log('    ' + JSON.stringify(d));
  断言('调用记录历史后显示未保存标记', d.后 !== 'none', d.后);
  console.log();

  console.log('='.repeat(72));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  console.log('='.repeat(72));
} finally {
  clearTimeout(超时);
  页.kill();
}
process.exit(fail ? 1 : 0);
