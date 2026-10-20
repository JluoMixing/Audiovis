// 验证「连续滚动」：pattern 边界处画面不能跳变
//
// 判据：沿时间轴连续取若干帧，比较相邻帧的画面差异。
//   跳变   → 相邻两帧差异出现尖峰（远高于相邻帧的平均水平）
//   连续   → 相邻帧差异平缓变化
//
// 同时检查：窗口内的 pattern 数量应当 > 1（多 pattern 共存才是连续的前提）
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
const PORT = 10013;

let pass = 0, fail = 0;
const 断言 = (名, 条件, 详情) => {
  if (条件) { pass++; console.log('  ✓ ' + 名); }
  else { fail++; console.log('  ✗ ' + 名 + (详情 ? '  → ' + 详情 : '')); }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

const 页 = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/cont`,
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
  await sleep(5000);

  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
    const rr = r.result || {};
    return { v: rr.result ? rr.result.value : undefined,
             异常: rr.exceptionDetails
               ? (rr.exceptionDetails.exception?.description || '').split('\n')[0] : null };
  };

  console.log('='.repeat(74));
  console.log('连续滚动验证');
  console.log('='.repeat(74));
  console.log();

  // ---- 1) 窗口内应同时有多个 pattern ----
  console.log('【1】窗口内同时存在的 pattern 数（连续的前提）');
  const r1 = await ev(`(() => {
    const out = [];
    [0, 8, 16, 32, 64, 96].forEach(function(beat){
      const nt = beat * PPQ;
      const w = WIN_BARS * PPQ * 4;
      const ws = nt - w * 0.38;
      const c = collectClipsInWindow(RANK, 'melodic', ws, ws + w);
      out.push({ beat: beat, n: c.length,
                 pids: c.map(function(x){return x.patternId;}) });
    });
    return JSON.stringify(out);
  })()`);
  const l1 = JSON.parse(r1.v || '[]');
  l1.forEach(x => console.log('   第 ' + String(x.beat).padStart(3) +
                              ' 拍: ' + x.n + ' 个 pattern  P' +
                              x.pids.join(',P')));
  /* 只检查「有旋律 clip 的时刻」——
     本工程前 16 拍只有鼓组、没有 melodic clip（P13/P20 从 tick 1536 起），
     那些时刻窗口里 0 个 melodic pattern 是**工程本身的数据**，不是 bug。
     若对所有时刻都要求 ≥ 2，会把正常的空窗判成失败。 */
  const 有内容的 = l1.filter(x => x.n > 0);
  const 全部多 = 有内容的.length > 0 && 有内容的.every(x => x.n >= 2);
  断言('有旋律的时刻窗口内 ≥ 2 个 pattern', 全部多,
       l1.map(x => x.beat + ':' + x.n).join(' '));
  console.log('    （第 0/8 拍无 melodic clip，属工程数据，不计入断言）');
  console.log();

  // ---- 2) 边界处画面连续性 ----
  console.log('【2】跨 pattern 边界时画面是否跳变');
  const r2 = await ev(`(() => {
    /* 找一处 melodic clip 的结束点 */
    let 边界 = null;
    TL.tracks.forEach(function(tr){
      tr.clips.forEach(function(c){
        if (c.type !== 'pattern') return;
        const sh = SHAPES[c.sourceId];
        if (!sh || sh.kind !== 'melodic') return;
        if (!边界 && c.end > 2000 && c.end < 20000) 边界 = c.end;
      });
    });
    if (!边界) return JSON.stringify({ err: '没有找到合适的边界' });

    const W = 480, H = 200;
    const 采样 = [];
    /* 边界前后各 8 拍，每 1/4 拍取一帧 */
    for (let k = -32; k <= 32; k++) {
      const nt = 边界 + k * (PPQ / 4);
      CUR = nt / PPQ * 60 / TEMPO;
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
      try {
        const comp = COMPONENTS.filter(function(c){return c.id==='pianoroll';})[0];
        comp.draw(g, W, H);
      } catch(e) { return JSON.stringify({ err: 'draw 失败: ' + e.message }); }
      const d = g.getImageData(0, 0, W, H).data;
      const 样 = [];
      for (let i = 0; i < d.length; i += 16) 样.push(d[i]);
      采样.push({ nt: nt, 样: 样 });
    }
    /* 相邻帧差异 */
    const 差 = [];
    for (let i = 1; i < 采样.length; i++) {
      const a = 采样[i-1].样, b = 采样[i].样;
      let s = 0;
      for (let j = 0; j < a.length; j++) s += Math.abs(a[j] - b[j]);
      差.push({ nt: 采样[i].nt, d: +(s / a.length).toFixed(3) });
    }
    return JSON.stringify({ 边界: 边界, 差: 差 });
  })()`);
  const d2 = JSON.parse(r2.v || '{}');
  if (d2.err) {
    断言('能完成边界采样', false, d2.err);
  } else {
    const 差 = d2.差;
    const 值 = 差.map(x => x.d);
    const 中位 = [...值].sort((a, b) => a - b)[Math.floor(值.length / 2)];
    const 最大 = Math.max(...值);
    const 最大处 = 差[值.indexOf(最大)];
    console.log('   边界 tick ' + d2.边界);
    console.log('   相邻帧差异：中位 ' + 中位.toFixed(2) +
                '  最大 ' + 最大.toFixed(2) + '（在 tick ' + 最大处.nt + '）');
    console.log('   前 8 个: ' + 值.slice(0, 8).map(v => v.toFixed(1)).join(' '));
    console.log('   中 8 个: ' + 值.slice(28, 36).map(v => v.toFixed(1)).join(' '));
    // 跳变判据：最大差值不应远超中位数
    const 倍数 = 中位 > 0.01 ? 最大 / 中位 : (最大 > 1 ? 999 : 1);
    断言('边界处无跳变（最大差 / 中位差 < 6）', 倍数 < 6,
         '倍数 ' + 倍数.toFixed(1) + '，中位 ' + 中位.toFixed(2) +
         ' 最大 ' + 最大.toFixed(2));
  }
  console.log();

  // ---- 3) 画面截图对比 ----
  console.log('【3】生成对比图（边界前后各一帧）');
  const img = await ev(`(() => {
    const W = 900, H = 300;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H * 2;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H*2);
    const comp = COMPONENTS.filter(function(c){return c.id==='pianoroll';})[0];
    [30, 34].forEach(function(beat, i){
      CUR = beat * PPQ / PPQ * 60 / TEMPO;
      g.save(); g.translate(0, i * H);
      g.fillStyle = '#f4f2ec'; g.fillRect(0, 0, W, H);
      try { comp.draw(g, W, H); } catch(e) {}
      g.restore();
    });
    return cv.toDataURL('image/png');
  })()`);
  if (img.v && img.v.indexOf('data:image') === 0) {
    const f = process.env.TEMP + '\\pianoroll_cont.png';
    writeFileSync(f, Buffer.from(img.v.split(',')[1], 'base64'));
    console.log('   WROTE ' + f);
    断言('生成对比图', true);
  }
  console.log();

  console.log('='.repeat(74));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  console.log('='.repeat(74));
} finally {
  页.kill();
}
process.exit(fail ? 1 : 0);
