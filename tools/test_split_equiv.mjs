// 拆分等价性：旧单体模板 vs 新模块化，同数据构建后逐像素比对
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

let pass = 0, fail = 0;
const 断言 = (名, 条件, 详情) => {
  if (条件) { pass++; console.log('  ✓ ' + 名); }
  else { fail++; console.log('  ✗ ' + 名 + (详情 ? '  → ' + 详情 : '')); }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function 取画面(页面, 端口) {
  const p = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${端口}`,
    `--user-data-dir=${TMP}/eq${端口}`,
    '--window-size=1600,1000', 页面], { stdio: 'ignore' });
  try {
    let t = null;
    for (let i = 0; i < 60; i++) {
      try {
        t = await new Promise((res, rej) => {
          http.get({ host: '127.0.0.1', port: 端口, path: '/json/list' }, r => {
            let d = ''; r.on('data', c => d += c);
            r.on('end', () => res(JSON.parse(d)));
          }).on('error', rej);
        });
        if (t && t.length) break;
      } catch {}
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
    await send('Page.enable');
    await sleep(5000);

    const ev = async e => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
      const rr = r.result || {};
      return rr.result ? rr.result.value : undefined;
    };

    /* btnDemo 已删除（任务1）。直接进入编辑器；
   多数测试随后会自己 套用模板 填充画布。 */
  await ev(`进入编辑器()`);
    await sleep(400);
    await ev(`document.getElementById('btnEnter').click()`);
    await sleep(1500);
    await ev(`套用模板(TEMPLATES[1])`);
    await sleep(2200);

    const 指纹 = await ev(`JSON.stringify({
      ids: [...document.querySelectorAll('[id]')].map(e => e.id).sort().join(','),
      wins: document.querySelectorAll('.win').length,
      canvases: document.querySelectorAll('canvas').length,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      stageBg: getComputedStyle(document.getElementById('stage')).backgroundColor,
      winRects: [...document.querySelectorAll('.win')].map(w =>
        w.style.left + '/' + w.style.top + '/' + w.style.width + '/' + w.style.height).join('|'),
    })`);

    // 直接取画布合成图（比整页截图更纯净，不含浏览器 UI）
    const 画布 = await ev(`(() => {
      const W = 画布.w, H = 画布.h;
      const cv = document.createElement('canvas');
      cv.width = 480; cv.height = Math.round(480 * H / W);
      const g = cv.getContext('2d');
      g.fillStyle = P.bg; g.fillRect(0, 0, cv.width, cv.height);
      const s = cv.width / W;
      放置.forEach(function(p){
        if (p.hidden) return;
        const el = stage.querySelector('.win[data-uid="' + p.uid + '"]');
        const c = el && el.querySelector('canvas');
        if (c) g.drawImage(c, p.x * s, p.y * s, p.w * s, p.h * s);
      });
      return cv.toDataURL('image/png');
    })()`);

    return { 指纹: JSON.parse(指纹 || '{}'), 画布 };
  } finally {
    p.kill();
  }
}

try {
  console.log('='.repeat(74));
  console.log('拆分等价性：旧单体模板 vs 新模块化结构');
  console.log('='.repeat(74));
  console.log();

  const 旧 = await 取画面('file:///D:/FL_VISUAL_TEST/preview/gui_legacy.html', 10070);
  console.log('  旧（单体）: wins=' + 旧.指纹.wins +
              ' canvas=' + 旧.指纹.canvases +
              ' bodyBg=' + 旧.指纹.bodyBg);
  const 新 = await 取画面('file:///D:/FL_VISUAL_TEST/preview/gui_prototype.html', 10071);
  console.log('  新（模块）: wins=' + 新.指纹.wins +
              ' canvas=' + 新.指纹.canvases +
              ' bodyBg=' + 新.指纹.bodyBg);
  console.log();

  /* 断言「没有丢失 id」而不是「完全一致」。
     ------------------------------------------------------------
     本测试原本验证 G0-2「拆分不改结构」，那时要求 id 完全一致。
     之后 G1 新增了设置面板（16 个新 id），新页面**有意**多出元素，
     再用「完全一致」会误报。
     真正要守住的是：**旧的 id 一个都不能少**
     （少了说明拆分或后续改动碰坏了既有结构）。 */
  /* 有意删除的元素白名单。
     ------------------------------------------------------------
     这些 id 是**功能变更**删掉的，不是拆分事故。
     加白名单时要写明原因与提交，否则白名单会变成藏污纳垢的地方。 */
  const 有意删除 = new Set([
    'btnDemo',   // 任务1：取消示例工程，正式版不再内置
  ]);

  const 旧ids = new Set((旧.指纹.ids || '').split(',').filter(Boolean));
  const 新ids = new Set((新.指纹.ids || '').split(',').filter(Boolean));
  const 丢失 = [...旧ids].filter(x => !新ids.has(x) && !有意删除.has(x));
  const 新增 = [...新ids].filter(x => !旧ids.has(x));
  断言('没有丢失任何既有 id', 丢失.length === 0,
       丢失.length ? '丢失: ' + 丢失.slice(0, 8).join(', ') : '');
  if (新增.length) {
    console.log('    （新增 ' + 新增.length + ' 个 id，属预期：' +
                新增.slice(0, 6).join(', ') + (新增.length > 6 ? ' …' : '') + '）');
  }
  断言('组件数一致', 旧.指纹.wins === 新.指纹.wins,
       旧.指纹.wins + ' vs ' + 新.指纹.wins);
  断言('canvas 数一致', 旧.指纹.canvases === 新.指纹.canvases,
       旧.指纹.canvases + ' vs ' + 新.指纹.canvases);
  断言('body 背景色一致', 旧.指纹.bodyBg === 新.指纹.bodyBg,
       旧.指纹.bodyBg + ' vs ' + 新.指纹.bodyBg);
  断言('stage 背景色一致', 旧.指纹.stageBg === 新.指纹.stageBg,
       旧.指纹.stageBg + ' vs ' + 新.指纹.stageBg);
  /* 组件位置不再要求完全一致 —— 任务1/3 改动了模板
   （删示例按钮、文本改左对齐），位置随之变化属预期。
   组件数量一致由上面的断言覆盖。 */
  if (旧.指纹.winRects !== 新.指纹.winRects) {
    console.log('    （组件位置有变化，属预期：模板已改）');
  }
  console.log();

  // 逐像素比对
  const fs = await import('node:fs');
  const 旧f = process.env.TEMP + '\\eq_old.png';
  const 新f = process.env.TEMP + '\\eq_new.png';
  writeFileSync(旧f, Buffer.from(旧.画布.split(',')[1], 'base64'));
  writeFileSync(新f, Buffer.from(新.画布.split(',')[1], 'base64'));

  // 用 Python 比像素（已有 PIL）
  const { execSync } = await import('node:child_process');
  const 结果 = execSync(
    `python -c "` +
    `from PIL import Image; import numpy as np; ` +
    `a=np.asarray(Image.open(r'${旧f}').convert('RGB')).astype(float); ` +
    `b=np.asarray(Image.open(r'${新f}').convert('RGB')).astype(float); ` +
    `d=abs(a-b); ` +
    `print('mean=%.4f max=%.1f' % (d.mean(), d.max()))"`,
    { cwd: 'D:\\FL_VISUAL_TEST', encoding: 'utf8' });

  console.log('  画布逐像素: ' + (结果 || '').trim());
  const m = /mean=([\d.]+) max=([\d.]+)/.exec(结果 || '');
  if (m) {
    const mean = parseFloat(m[1]);
    const max = parseFloat(m[2]);
    /* 画布差异的容忍度说明：
   ------------------------------------------------------------
   旧页面有「使用示例工程」按钮、新页面没有（任务1 删除），
   按钮占据布局空间，会让画布内容整体位移。
   故不再要求逐像素一致 —— 真正要守的是
   「没有意外的大面积结构变化」，由 id 与组件数断言覆盖。 */
  断言('画布平均像素差 < 3', mean < 3, mean);
    /* 最大差不再断言：模板改动后局部差异必然存在 */
  } else {
    断言('能比出像素差', false, 结果);
  }
  console.log();
  console.log('  对照图: ' + 旧f + ' / ' + 新f);

  console.log();
  console.log('='.repeat(74));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  console.log('='.repeat(74));
} finally {
}
process.exit(fail ? 1 : 0);
