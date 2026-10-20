// 严格验证：窗口 2 / 8 / 16 小节时，卷帘内容应显著不同
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
const PORT = 10051;

let pass = 0, fail = 0;
const 断言 = (名, 条件, 详情) => {
  if (条件) { pass++; console.log('  ✓ ' + 名); }
  else { fail++; console.log('  ✗ ' + 名 + (详情 ? '  → ' + 详情 : '')); }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

const 页 = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/winstrict`,
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
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
    const rr = r.result || {};
    return { v: rr.result ? rr.result.value : undefined,
             异常: rr.exceptionDetails
               ? (rr.exceptionDetails.exception?.description || '').split('\n')[0] : null };
  };

  console.log('='.repeat(74));
  console.log('窗口参数：内容应显著变化');
  console.log('='.repeat(74));
  console.log();

  // 走 绘制组件实例（预览与导出共用的那条路径）
  const r = await ev(`(() => {
    setActiveTheme(DIRECTIONS.directions.sumi, 'sumi');
    CUR = 40 * PPQ / PPQ * 60 / TEMPO;
    const W = 900, H = 300;
    const out = [];
    [2, 8, 16].forEach(function(bar){
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
      绘制组件实例(g, { id: 'pianoroll', w: W, h: H, 窗口: bar });
      const d = g.getImageData(0, 0, W, H).data;

      /* 采样整幅像素，供两两比对。
         ------------------------------------------------------------
         不用「有墨列数」：音符本来就横跨整个宽度，
         窗口变大只是把它们压扁，列数几乎不变
         （实测 2 小节 730 列、16 小节 748 列，看着没变化，
           其实内容完全不同 —— 底部文字从 30 NOTES 变成 214 NOTES）。 */
      const 样 = [];
      for (let i = 0; i < d.length; i += 4 * 7) 样.push(d[i]);
      out.push({ 窗口: bar, 像素: 样, dataURL: cv.toDataURL('image/png') });
    });
    return JSON.stringify(out);
  })()`);
  const l = JSON.parse(r.v || '[]');

  function 差异(a, b) {
    let s = 0;
    const L = Math.min(a.length, b.length);
    for (let i = 0; i < L; i++) s += Math.abs(a[i] - b[i]);
    return s / Math.max(1, L);
  }
  const d28 = 差异(l[0].像素, l[1].像素);
  const d216 = 差异(l[0].像素, l[2].像素);
  console.log('    窗口 2  vs 8  : 平均像素差 ' + d28.toFixed(2));
  console.log('    窗口 2  vs 16 : 平均像素差 ' + d216.toFixed(2));

  断言('窗口 2 vs 8 画面明显不同（差 > 3）', d28 > 3, d28.toFixed(2));
  断言('窗口 2 vs 16 画面明显不同（差 > 8）', d216 > 8, d216.toFixed(2));
  断言('窗口越大差异越大（8 与 16 递进）', d216 > d28,
       d28.toFixed(2) + ' vs ' + d216.toFixed(2));

  // 拼成对比图
  const 图 = l.map(x => x.dataURL);
  const f = process.env.TEMP + '\\roll_windows.png';
  const fs = await import('node:fs');
  // 逐张写文件
  图.forEach((d, i) => {
    writeFileSync(process.env.TEMP + '\\roll_win_' + l[i].窗口 + '.png',
                  Buffer.from(d.split(',')[1], 'base64'));
  });
  console.log();
  console.log('  图: ' + process.env.TEMP + '\\roll_win_2.png / 8 / 16');

  console.log();
  console.log('='.repeat(74));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  console.log('='.repeat(74));
} finally {
  页.kill();
}
process.exit(fail ? 1 : 0);
