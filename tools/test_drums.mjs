// 鼓组识别与绘制 —— 按新方案重写
//
// 新方案（用户敲定）：
//   · 数据层不再输出 group / name —— 行按「频率 + 节奏」自动排序
//   · 行序：分数小者在前（越像底鼓越靠前）
//   · 绘制层按**行序**配色，不按鼓件名
//   · 不显示行名
//
// 所以旧测试里「kick 覆盖率」「军鼓带强调色」这类断言已不适用，
// 改为验证新语义：
//   1) 行确实存在，且按分数升序
//   2) 相邻行的分数有足够间隔（不会挤成一样）
//   3) 绘制出的颜色按行序区分
//   4) 画面上不出现行名文字
import { spawn } from 'node:child_process';
import http from 'node:http';


/* 测试用临时目录：放项目内（D 盘），避免累积撑满系统盘。
   实测：用 process.env.TEMP 时 125 次运行留下 3.77 GB profile，
   C 盘被撑到 0 字节可用，后续所有写操作 ENOSPC。 */
import { mkdirSync as _mkdir } from 'node:fs';
const TMP = 'D:/FL_VISUAL_TEST/.testtmp';
try { _mkdir(TMP, { recursive: true }); } catch (e) {}

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const PORT = 10016;

let pass = 0, fail = 0;
const 断言 = (名, 条件, 详情) => {
  if (条件) { pass++; console.log('  ✓ ' + 名); }
  else { fail++; console.log('  ✗ ' + 名 + (详情 ? '  → ' + 详情 : '')); }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

const 页 = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/drumnew`,
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
  console.log('鼓组：按新方案（无行名、按行序配色）');
  console.log('='.repeat(74));
  console.log();

  console.log('【1】数据结构不再带行名');
  const r1 = await ev(`(() => {
    const g = (DATA.drumGroups || [])[0];
    if (!g) return JSON.stringify({ err: '没有鼓组' });
    const row = (g.rows || [])[0];
    return JSON.stringify({
      组键: Object.keys(g),
      行键: row ? Object.keys(row) : [],
      有name: row ? ('name' in row) : null,
      有group: row ? ('group' in row) : null,
      有score: row ? ('score' in row) : null,
    });
  })()`);
  const d1 = JSON.parse(r1.v || '{}');
  console.log('   ' + JSON.stringify(d1));
  断言('行数据有 score', d1.有score === true, JSON.stringify(d1));
  断言('行数据不再有 name', d1.有name === false, String(d1.有name));
  断言('行数据不再有 group', d1.有group === false, String(d1.有group));
  console.log();

  console.log('【2】行按分数升序（越像底鼓越靠前）');
  const r2 = await ev(`(() => {
    const out = [];
    (DATA.drumGroups || []).slice(0, 4).forEach(function(g){
      out.push({
        id: g.id,
        行数: (g.rows || []).length,
        scores: (g.rows || []).map(function(r){ return r.score; }),
      });
    });
    return JSON.stringify(out);
  })()`);
  const l2 = JSON.parse(r2.v || '[]');
  let 全升序 = true;
  l2.forEach(g => {
    console.log('   P' + g.id + ': ' + g.行数 + ' 行  scores=' +
                JSON.stringify(g.scores));
    for (let i = 1; i < g.scores.length; i++) {
      if (g.scores[i] < g.scores[i - 1] - 1e-6) 全升序 = false;
    }
  });
  断言('每个 pattern 的行按分数升序', 全升序);
  console.log();

  console.log('【3】collectDrums 返回按分数排序的全局行');
  const r3 = await ev(`(() => {
    const out = [];
    [8, 40, 96].forEach(function(beat){
      const D = collectDrums(beat * PPQ);
      out.push({ beat: beat, 行数: D.groups.length,
                 scores: (D.scores || []).map(function(s){ return +s.toFixed(3); }) });
    });
    return JSON.stringify(out);
  })()`);
  const l3 = JSON.parse(r3.v || '[]');
  let 全局升序 = true;
  l3.forEach(x => {
    console.log('   第 ' + String(x.beat).padStart(3) + ' 拍: ' + x.行数 +
                ' 行  scores=' + JSON.stringify(x.scores));
    for (let i = 1; i < x.scores.length; i++) {
      if (x.scores[i] < x.scores[i - 1] - 1e-6) 全局升序 = false;
    }
  });
  断言('全局行按分数升序', 全局升序);
  断言('有行可画', l3.every(x => x.行数 > 0), JSON.stringify(l3.map(x => x.行数)));
  console.log();

  console.log('【4】绘制：各行颜色应不同');
  const r4 = await ev(`(() => {
    setActiveTheme(DIRECTIONS.directions.sumi, 'sumi');
    const W = 960, H = 360;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    const nt = 40 * PPQ;
    drawStepper(g, currentTheme(), 'sumi', W, H, nt);
    const D = collectDrums(nt);
    const d = g.getImageData(0, 0, W, H).data;
    const top = 14 + 28, bottom = H - 14 - 22;
    const n = D.groups.length || 1;
    const out = [];
    for (let ri = 0; ri < n; ri++) {
      const y0 = Math.round(top + (bottom - top) * ri / n);
      const y1 = Math.round(top + (bottom - top) * (ri + 1) / n);
      let 最暗 = 999, RGB = null;
      for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const lum = 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
        if (lum < 最暗) { 最暗 = lum; RGB = [d[i], d[i+1], d[i+2]]; }
      }
      out.push({ 行: ri, lum: +最暗.toFixed(1), rgb: RGB });
    }
    return JSON.stringify(out);
  })()`);
  const l4 = JSON.parse(r4.v || '[]');
  l4.forEach(x => console.log('   行 ' + x.行 + ': 亮度 ' + x.lum +
                              '  rgb' + JSON.stringify(x.rgb)));
  断言('至少 2 行', l4.length >= 2, l4.length);
  if (l4.length >= 2) {
    断言('各行亮度不同（颜色可区分）', l4[0].lum !== l4[1].lum,
         l4.map(x => x.lum).join('/'));
  }
  console.log();

  console.log('【5】行区内不出现文字（行名已去掉）');
  /* 只在**行区**（top..bottom）内检查，不含底部状态栏。
     底部那行状态（N PATTERNS · N VOICES · …）是正常信息，
     它从 gx=32 起排，若把它算进来会误判成「行名文字」。
     实测踩到：色条在 x=23~25（138px 高，贯穿整个行区），
     底部状态文字从 x=32 起（每列仅几个像素）。 */
  const r5 = await ev(`(() => {
    setActiveTheme(DIRECTIONS.directions.sumi, 'sumi');
    const W = 960, H = 360;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    drawStepper(g, currentTheme(), 'sumi', W, H, 40 * PPQ);
    const d = g.getImageData(0, 0, W, H).data;
    const top = 14 + 28, bottom = H - 14 - 22;   /* 行区上下界 */
    let 最右 = 0;
    for (let y = top; y < bottom; y++) {
      for (let x = 0; x < 80; x++) {
        const i = (y * W + x) * 4;
        const lum = 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
        if (lum < 240) { if (x > 最右) 最右 = x; }
      }
    }
    return JSON.stringify({ 行区内最右墨迹x: 最右 });
  })()`);
  const d5 = JSON.parse(r5.v || '{}');
  console.log('   行区内（y ' + '42..324' + '）最右墨迹 x = ' + d5.行区内最右墨迹x);
  /* 色条固定在 gx-9 = 23（宽 3px → 到 25）。
     若还有行名文字，右端会到 x≈60~80。 */
  断言('行区内只有色条、没有行名文字（最右 < 30）',
       d5.行区内最右墨迹x < 30, String(d5.行区内最右墨迹x));
  console.log();

  console.log('='.repeat(74));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  console.log('='.repeat(74));
} finally {
  页.kill();
}
process.exit(fail ? 1 : 0);
