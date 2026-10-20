// 验证钢琴卷帘的边缘渐隐：左右边缘的墨迹应逐渐减弱
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
const PORT = 10030;

let pass = 0, fail = 0;
const 断言 = (名, 条件, 详情) => {
  if (条件) { pass++; console.log('  ✓ ' + 名); }
  else { fail++; console.log('  ✗ ' + 名 + (详情 ? '  → ' + 详情 : '')); }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

const 页 = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/rollfade`,
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
  console.log('钢琴卷帘：边缘渐隐');
  console.log('='.repeat(74));
  console.log();

  // 量化：沿 x 轴统计每列的墨迹，看左右两端是否递减
  const r = await ev(`(() => {
    setActiveTheme(DIRECTIONS.directions.sumi, 'sumi');
    const W = 900, H = 300;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    CUR = 40 * PPQ / PPQ * 60 / TEMPO;
    const comp = COMPONENTS.filter(c => c.id === 'pianoroll')[0];
    comp.draw(g, W, H);

    const pad = 14;
    const gx = pad + 40, gw = W - gx - pad;
    const top = pad + 26, bottom = H - pad - 16;
    const d = g.getImageData(0, 0, W, H).data;

    /* 每列的**最大暗度**。
       ------------------------------------------------------------
       为什么不用「平均暗度」：网格线（竖直细线，暗度约 23）
       铺满整个宽度且**不参与渐隐**，会把平均值主导掉。
       实测：中部平均暗度 22.88、右端 19.97，看着像没渐隐，
       其实测的几乎全是网格线。

       音符的墨是满深度（暗度约 213），把每列取最大值后：
         未淡化 → 接近 213
         淡化到 13% → 约 28
         只剩网格线 → 约 23
       这样就能干净地区分「音符」与「网格线」。 */
    const col = [];
    for (let x = gx; x < gx + gw; x++) {
      let mx = 0;
      for (let y = top; y < bottom; y++) {
        const i = (y * W + x) * 4;
        const lum = 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
        const 暗 = 255 - lum;
        if (暗 > mx) mx = 暗;
      }
      col.push(mx);
    }
    const N = col.length;
    const 段 = (a, b) => {
      const s = col.slice(Math.floor(N*a), Math.floor(N*b));
      return s.length ? s.reduce((p, c) => p + c, 0) / s.length : 0;
    };
    return JSON.stringify({
      网格宽: N,
      左端0_3pct: +段(0.00, 0.03).toFixed(2),
      左端8_14pct: +段(0.08, 0.14).toFixed(2),
      中部40_60pct: +段(0.40, 0.60).toFixed(2),
      右端86_92pct: +段(0.86, 0.92).toFixed(2),
      右端97_100pct: +段(0.97, 1.00).toFixed(2),
    });
  })()`);
  const d = JSON.parse(r.v || '{}');
  console.log('  各区段的**最大暗度**（音符墨约 213，网格线约 23）:');
  console.log('    左端 0–3%     ' + d.左端0_3pct);
  console.log('    左端 8–14%    ' + d.左端8_14pct);
  console.log('    中部 40–60%   ' + d.中部40_60pct);
  console.log('    右端 86–92%   ' + d.右端86_92pct);
  console.log('    右端 97–100%  ' + d.右端97_100pct);
  console.log();

  /* 判据：**极边缘**要比「刚进入渐变区」明显淡。
     不拿中部做基准 —— 中部（40–60%）恰好在播放头之后，
     音符密度与右侧完全不同，比较没有意义（实测中部 22.88
     而右端 19.97，看着像没渐隐，其实只是密度不同）。 */
  /* 判据：极边缘的音符应已淡到接近网格线水平（≤ 90 暗度），
     而渐变区起点仍能看到实音符（> 120）。 */
  断言('左端极边缘音符已淡出（≤ 90）', d.左端0_3pct <= 90,
       '0–3% ' + d.左端0_3pct);
  断言('左端渐变区起点仍有实音符（> 120）', d.左端8_14pct > 120,
       '8–14% ' + d.左端8_14pct);
  断言('右端极边缘音符已淡出（≤ 90）', d.右端97_100pct <= 90,
       '97–100% ' + d.右端97_100pct);
  断言('右端渐变区起点仍有实音符（> 120）', d.右端86_92pct > 120,
       '86–92% ' + d.右端86_92pct);
  console.log();

  // 存图
  const img = await ev(`(() => {
    setActiveTheme(DIRECTIONS.directions.sumi, 'sumi');
    const W = 900, H = 300;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    CUR = 40 * PPQ / PPQ * 60 / TEMPO;
    const comp = COMPONENTS.filter(c => c.id === 'pianoroll')[0];
    comp.draw(g, W, H);
    return cv.toDataURL('image/png');
  })()`);
  if (img.v && img.v.indexOf('data:image') === 0) {
    const f = process.env.TEMP + '\\roll_fade.png';
    writeFileSync(f, Buffer.from(img.v.split(',')[1], 'base64'));
    console.log('  图: ' + f);
  }

  console.log();
  console.log('='.repeat(74));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  console.log('='.repeat(74));
} finally {
  页.kill();
}
process.exit(fail ? 1 : 0);
