// 阶段 1 验证：预览与导出逐像素比对
//
// 做法：同一布局分别用两条路径画到 1920×1080 画布上
//   预览：把 DOM 里各组件 canvas 按位置合成
//   导出：调 绘制布局()（渲染管线用的同一函数）
// 然后逐像素比对。
//
// 允许微小差异：预览 canvas 是超采样后降采样显示的，
// 与直接渲染的抗锯齿不同。但平均差应极小，且**结构必须一致**
// （差异不能集中在某个组件或某个特性上 —— 那说明某条路径漏了东西）。
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
const PORT = 9960;
const child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/parity`,
  '--window-size=1600,1000',
  'file:///D:/FL_VISUAL_TEST/preview/gui_prototype.html'], { stdio:'ignore' });
const get = p => new Promise((res,rej)=>{ http.get({host:'127.0.0.1',port:PORT,path:p},r=>{
  let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }).on('error',rej); });

const sleep = ms => new Promise(r=>setTimeout(r,ms));

let pass=0, fail=0;
function 断言(n,c,d){ if(c){pass++;console.log('  ✓ '+n);} else {fail++;console.log('  ✗ '+n+(d?'  → '+d:''));} }

try {
  let t=null;
  for(let i=0;i<50;i++){ try{ t=await get('/json/list'); if(t?.length) break; }catch{} await sleep(400); }
  const page=t.find(x=>x.type==='page')||t[0];
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r));
  let id=0;
  const send=(m,p)=>new Promise(res=>{ const my=++id;
    const h=ev=>{ const x=JSON.parse(ev.data); if(x.id===my){ ws.removeEventListener('message',h); res(x.result); } };
    ws.addEventListener('message',h); ws.send(JSON.stringify({id:my,method:m,params:p})); });
  const ev = e => send('Runtime.evaluate',{expression:e, returnByValue:true});
  await send('Page.enable'); await send('Runtime.enable');
  const errs=[];
  ws.addEventListener('message', e=>{
    const m=JSON.parse(e.data);
    if(m.method==='Runtime.exceptionThrown') errs.push(
      m.params.exceptionDetails.exception?.description?.split('\n')[0]);
  });
  await sleep(2500);

  /* btnDemo 已删除（任务1）。直接进入编辑器；
   多数测试随后会自己 套用模板 填充画布。 */
  await ev(`进入编辑器()`);
  await sleep(200);
  await ev(`document.getElementById('btnEnter').click()`);
  await sleep(800);

  console.log('='.repeat(84));
  console.log('预览 vs 导出：逐像素比对');
  console.log('='.repeat(84));

  const N = (await ev(`TEMPLATES.length`)).result.value;
  let 全部通过 = true;

  for (let i = 1; i < N; i++) {
    await ev(`套用模板(TEMPLATES[${i}])`);
    await sleep(1000);
    const 名 = (await ev(`TEMPLATES[${i}].name`)).result.value;

    const r = await ev(`(() => { try {
      const W = 画布.w, H = 画布.h;

      /* ---- 路径 A：预览（把 DOM 里各组件 canvas 合成） ---- */
      const A = document.createElement('canvas');
      A.width = W; A.height = H;
      const ga = A.getContext('2d');
      ga.fillStyle = P.bg; ga.fillRect(0, 0, W, H);
      放置.forEach(function (p) {
        if (p.hidden) return;
        const el = stage.querySelector('.win[data-uid="' + p.uid + '"]');
        if (!el) return;
        const cv = el.querySelector('canvas');
        if (!cv) return;
        ga.drawImage(cv, p.x, p.y, p.w, p.h);
      });

      /* ---- 路径 B：导出（渲染管线用的同一函数） ---- */
      const 布局 = 放置.filter(p => !p.hidden).map(function (p) {
        return { id:p.id, x:p.x, y:p.y, w:p.w, h:p.h,
                 柔化:p.柔化, 隐藏文字:p.隐藏文字, 样式:p.样式 };
      });
      CUR = 静帧秒;
      const B = document.createElement('canvas');
      B.width = W; B.height = H;
      绘制布局(B.getContext('2d'), 布局, { w: W, h: H, 背景: true });

      /* ---- 路径 C：导出但按 2× 渲染再降采样 ----
         预览的组件 canvas 是超采样后降采样的显示，
         与 1:1 直出的抗锯齿必然不同。
         若把导出也做同样的超采样，差异应塌缩到接近 0 ——
         那就证明两条路径**结构完全相同**，残余差异只是采样。
         这是区分「实现不一致」与「抗锯齿不同」的关键对照。 */
      const SS = 2;
      const C = document.createElement('canvas');
      C.width = W * SS; C.height = H * SS;
      const gc = C.getContext('2d');
      gc.scale(SS, SS);
      绘制布局(gc, 布局, { w: W, h: H, 背景: true });
      const C2 = document.createElement('canvas');
      C2.width = W; C2.height = H;
      const gc2 = C2.getContext('2d');
      gc2.imageSmoothingEnabled = true;
      gc2.imageSmoothingQuality = 'high';
      gc2.drawImage(C, 0, 0, W, H);

      /* ---- 比对 ---- */
      const da = ga.getImageData(0, 0, W, H).data;
      const db = B.getContext('2d').getImageData(0, 0, W, H).data;
      const dc = gc2.getImageData(0, 0, W, H).data;
      /* 超采样对照的平均差 */
      let 和C = 0;
      for (let k = 0; k < da.length; k += 4) {
        和C += (Math.abs(da[k]-dc[k]) + Math.abs(da[k+1]-dc[k+1]) +
                Math.abs(da[k+2]-dc[k+2])) / 3;
      }
      let 和 = 0, 最大 = 0, 超阈 = 0, n = 0;
      /* 按组件分区统计，定位差异来源 */
      const 分区 = 布局.map(function (it) {
        return { id: it.id, x: it.x, y: it.y, w: it.w, h: it.h,
                 和: 0, 超阈: 0, n: 0, 和SS: 0 };
      });
      分区.push({ id: '(背景)', x: 0, y: 0, w: W, h: H,
                  和: 0, 超阈: 0, n: 0, 和SS: 0 });

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const k = (y * W + x) * 4;
          const d = (Math.abs(da[k]-db[k]) + Math.abs(da[k+1]-db[k+1]) +
                     Math.abs(da[k+2]-db[k+2])) / 3;
          和 += d; n++;
          if (d > 最大) 最大 = d;
          if (d > 12) 超阈++;
          /* 归到第一个命中的组件，否则算背景 */
          let 归 = 分区[分区.length - 1];
          for (let j = 0; j < 布局.length; j++) {
            const it = 布局[j];
            if (x >= it.x && x < it.x + it.w && y >= it.y && y < it.y + it.h) {
              归 = 分区[j]; break;
            }
          }
          const dSS = (Math.abs(da[k]-dc[k]) + Math.abs(da[k+1]-dc[k+1]) +
                       Math.abs(da[k+2]-dc[k+2])) / 3;
          归.和 += d; 归.和SS += dSS; 归.n++;
          if (d > 12) 归.超阈++;
        }
      }
      return JSON.stringify({
        平均差: Number((和 / n).toFixed(3)),
        超采样平均差: Number((和C / n).toFixed(3)),
        最大差: Math.round(最大),
        超阈占比: Number((超阈 / n * 100).toFixed(3)),
        分区: 分区.filter(function (z) { return z.n > 0; }).map(function (z) {
          return { id: z.id,
                   平均差: Number((z.和 / z.n).toFixed(2)),
                   超采样差: Number((z.和SS / z.n).toFixed(2)),
                   超阈占比: Number((z.超阈 / z.n * 100).toFixed(2)) };
        }),
      });
      } catch (e) { return JSON.stringify({ 错误: String(e),
        栈: String(e.stack || '').split('\\n').slice(0, 4) }); }
    })()`);
    const d = JSON.parse(r.result.value);
    if (d.错误) {
      console.log('   ✗ 页面内抛错: ' + d.错误);
      d.栈.forEach(function (l) { console.log('      ' + l.trim()); });
      fail++;
      continue;
    }

    const ok = d.平均差 < 2.0 && d.超阈占比 < 2.0;
    if (!ok) 全部通过 = false;
    console.log();
    console.log('── ' + 名 + ' ── ' + (ok ? '✓ 一致' : '✗ 不一致'));
    console.log('   平均差 ' + d.平均差 + '   最大差 ' + d.最大差 +
                '   超阈像素占比 ' + d.超阈占比 + '%');
    console.log('   对照：导出按 2× 渲染再降采样 → 平均差 ' +
                d.超采样平均差 +
                (d.超采样平均差 < 1.0 ? '  ← 残余差异确实来自采样' : '  ← 仍有结构差异'));
    d.分区.forEach(z => {
      /* 1:1 差大、超采样差小 → 说明该区差异纯粹是抗锯齿，
         而非实现不一致。这是区分二者的判据。 */
      const 采样性 = z.平均差 > 0.5 && z.超采样差 < z.平均差 * 0.5;
      const 标志 = 采样性 ? '  ← 采样差异（非实现差异）'
        : (z.超阈占比 > 4 ? ' ← 差异集中在此' : '');
      console.log('     ' + String(z.id).padEnd(12) +
                  ' 平均差 ' + String(z.平均差).padStart(6) +
                  '  超采样 ' + String(z.超采样差).padStart(6) +
                  '  超阈 ' + String(z.超阈占比).padStart(6) + '%' + 标志);
    });
    断言('「' + 名 + '」预览与导出一致（平均差 < 2，超阈 < 2%）', ok,
         '平均差 ' + d.平均差 + ' 超阈 ' + d.超阈占比 + '%');
    /* 关键：做了同样的超采样后，差异应塌缩 —— 证明结构一致 */
    断言('「' + 名 + '」超采样对照平均差 < 1.0（证明无结构差异）',
         d.超采样平均差 < 1.0, String(d.超采样平均差));
    /* 逐组件区判据。
       ## 为什么不能要求逐位相等
       预览的组件 canvas 按 2.02× 光栅化后由浏览器降采样显示；
       导出按 1:1 直出。**同一份绘制代码在不同光栅化尺度下，
       边缘像素必然不同** —— 细笔画组件（频谱的竖条、字形）
       边缘占比高，所以差异集中在那里。这是物理限制，不是实现差异。

       实测：整体平均差 0.48/255（0.19%，远低于可感知），
             背景区 0.03（证明布局/缩放/定位逻辑完全一致），
             匹配超采样后进一步降到 0.33。

       ## 阈值怎么定
       定在「能抓住真回归」的水平，而不是追求不可能达到的 0：
         · 某组件在一条路径里缺失 / 画错 → 该区差 30+
         · 底色画法不一致（真实踩过）→ 整体差 3.07，背景区 3.07
         · 柔化/隐藏文字未同步 → 该区差 10+
       故：整体 < 2.0、单区 < 6.0，且超采样后不得变大。 */
    /* ## 超采样对照的局限（实测踩到）
       对照用的是**固定 2×**，而预览每个组件的超采样倍率是
       `max(DPR, DPR/画布缩放)`（上限 3），小组件可能取到 3×。
       两者不一致时，对照反而可能比 1:1 更差
       （实测「分栏」的频谱 1.14 → 2.53）。
       故对照只用于**整体**判断趋势，不用作逐区的硬判据。 */
    const 顽固 = d.分区.filter(function (z) {
      if (z.id === '(背景)') return z.平均差 > 0.5;
      return z.平均差 > 6.0;
    });
    断言('「' + 名 + '」每个组件区都无结构性差异（差 < 6）',
         顽固.length === 0,
         JSON.stringify(顽固.map(function (z) {
           return z.id + ' 1:1=' + z.平均差 + ' 超采样=' + z.超采样差;
         })));
    断言('「' + 名 + '」背景区完全一致（差 < 0.5）',
         d.分区.filter(function (z) { return z.id === '(背景)'; })
           .every(function (z) { return z.平均差 < 0.5; }),
         JSON.stringify(d.分区.filter(function (z) {
           return z.id === '(背景)'; })));
  }

  console.log();
  console.log('=== 特性专项：逐组件柔化 / 文字 / 隐藏组件内文字 ===');
  await ev(`套用模板(TEMPLATES[1])`);
  await sleep(900);

  /* 逐组件柔化：把某个组件柔化设成 0，两条路径都应跟着变 */
  for (const 用例 of [
    { 名: '统一柔化=0', 改: `放置.forEach(p => p.柔化 = 0)` },
    { 名: '统一柔化=0.45', 改: `放置.forEach(p => p.柔化 = 0.45)` },
    { 名: '逐组件不同柔化', 改: `放置.forEach((p,i) => p.柔化 = [0,0.2,0.45,0.1,0.3,0.15][i%6])` },
    { 名: '隐藏组件内文字', 改: `放置.forEach(p => p.隐藏文字 = true)` },
    { 名: '显示组件内文字', 改: `放置.forEach(p => p.隐藏文字 = false)` },
  ]) {    await ev(`(() => { ${用例.改}; 渲染画布(); })()`);
    await sleep(900);
    const r = await ev(`(() => {
      const W = 画布.w, H = 画布.h;
      const A = document.createElement('canvas'); A.width = W; A.height = H;
      const ga = A.getContext('2d');
      ga.fillStyle = P.bg; ga.fillRect(0, 0, W, H);
      放置.forEach(function (p) {
        if (p.hidden) return;
        const el = stage.querySelector('.win[data-uid="' + p.uid + '"]');
        const cv = el && el.querySelector('canvas');
        if (cv) ga.drawImage(cv, p.x, p.y, p.w, p.h);
      });
      const B = document.createElement('canvas'); B.width = W; B.height = H;
      const gb = B.getContext('2d');
      const 布局 = 放置.filter(p => !p.hidden).map(function (p) {
        return { id:p.id, x:p.x, y:p.y, w:p.w, h:p.h,
                 柔化:p.柔化, 隐藏文字:p.隐藏文字, 样式:p.样式 };
      });
      CUR = 静帧秒;
      绘制布局(gb, 布局, { w: W, h: H, 背景: true });
      const da = ga.getImageData(0,0,W,H).data;
      const db = gb.getImageData(0,0,W,H).data;
      let 和 = 0, 超 = 0, n = 0;
      for (let k = 0; k < da.length; k += 4) {
        const d = (Math.abs(da[k]-db[k]) + Math.abs(da[k+1]-db[k+1]) +
                   Math.abs(da[k+2]-db[k+2])) / 3;
        和 += d; n++; if (d > 12) 超++;
      }

      /* ---- 边缘带差 ----
         柔化的视觉影响全部集中在组件外缘（底板向内淡出到画布色），
         全图平均差对它不敏感 —— 实测「导出侧忽略柔化」时
         全图平均差只从 0.388/0.531 变成 0.477（默认值），
         低于任何合理阈值。
         故对柔化类用例额外统计**外侧 18% 边带**的差。 */
      let 带和 = 0, 带n = 0;
      布局.forEach(function (it) {
        const 带宽 = Math.round(Math.min(it.w, it.h) * 0.18);
        const y0 = Math.max(0, it.y), y1 = Math.min(H, it.y + it.h);
        const x0 = Math.max(0, it.x), x1 = Math.min(W, it.x + it.w);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const 距边 = Math.min(x - it.x, it.x + it.w - 1 - x,
                                  y - it.y, it.y + it.h - 1 - y);
            if (距边 > 带宽) continue;
            const k = (y * W + x) * 4;
            带和 += (Math.abs(da[k]-db[k]) + Math.abs(da[k+1]-db[k+1]) +
                     Math.abs(da[k+2]-db[k+2])) / 3;
            带n++;
          }
        }
      });

      return JSON.stringify({ 平均差: Number((和/n).toFixed(3)),
                              超阈占比: Number((超/n*100).toFixed(3)),
                              边带平均差: Number((带和/Math.max(1,带n)).toFixed(3)),
                              边带像素: 带n });
    })()`);
    const d = JSON.parse(r.result.value);
    const ok = d.平均差 < 2.0 && d.超阈占比 < 2.0;
    if (!ok) 全部通过 = false;
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + 用例.名.padEnd(18) +
                ' 平均差 ' + String(d.平均差).padStart(6) +
                '  超阈 ' + String(d.超阈占比).padStart(6) + '%' +
                '  边带差 ' + String(d.边带平均差).padStart(6));
    断言(用例.名 + ' 两条路径一致', ok, JSON.stringify(d));
    断言(用例.名 + ' 边缘带也一致（柔化的作用区）',
         d.边带平均差 < 1.5, '边带差 ' + d.边带平均差);
  }

  /* ---- 重叠布局专项 ----
     实测（tools/probe_fade_signal.mjs）：柔化 0 → 0.45 的画面变化，
       不重叠布局 1.149/255（最大差 39）
       重叠布局   1.369/255（最大差 176）
     柔化的视觉作用几乎全在**组件相互重叠**处（露出下层内容）。
     不重叠时底板淡出到与画布同色，看不出差别 ——
     所以上面对不重叠布局的柔化一致性只能作为弱判据。
     这里用重叠布局把信号放大，才能真正锁住柔化的一致性。 */
  console.log();
  console.log('  重叠布局专项（柔化信号最强处）：');
  for (const 用例 of [
    { 名: '重叠柔化=0',
      改: `放置.forEach((p,i) => { p.柔化 = 0; p.x = 260 + i*70; p.y = 220 + i*70; })` },
    { 名: '重叠柔化=0.45',
      改: `放置.forEach((p,i) => { p.柔化 = 0.45; p.x = 260 + i*70; p.y = 220 + i*70; })` },
  ]) {
    await ev(`(() => { 套用模板(TEMPLATES[1]); ${用例.改}; 渲染画布(); })()`);
    await sleep(1000);
    const r = await ev(`(() => {
      const W = 画布.w, H = 画布.h;
      const A = document.createElement('canvas'); A.width = W; A.height = H;
      const ga = A.getContext('2d');
      ga.fillStyle = P.bg; ga.fillRect(0, 0, W, H);
      放置.forEach(function (p) {
        if (p.hidden) return;
        const el = stage.querySelector('.win[data-uid="' + p.uid + '"]');
        const cv = el && el.querySelector('canvas');
        if (cv) ga.drawImage(cv, p.x, p.y, p.w, p.h);
      });
      const B = document.createElement('canvas'); B.width = W; B.height = H;
      const 布局 = 放置.filter(p => !p.hidden).map(function (p) {
        return { id:p.id, x:p.x, y:p.y, w:p.w, h:p.h,
                 柔化:p.柔化, 隐藏文字:p.隐藏文字, 样式:p.样式 };
      });
      CUR = 静帧秒;
      绘制布局(B.getContext('2d'), 布局, { w: W, h: H, 背景: true });
      const da = ga.getImageData(0,0,W,H).data;
      const db = B.getContext('2d').getImageData(0,0,W,H).data;
      let 和 = 0, n = 0, 最大 = 0;
      for (let k = 0; k < da.length; k += 4) {
        const d = (Math.abs(da[k]-db[k]) + Math.abs(da[k+1]-db[k+1]) +
                   Math.abs(da[k+2]-db[k+2])) / 3;
        和 += d; n++; if (d > 最大) 最大 = d;
      }
      return JSON.stringify({ 平均差: Number((和/n).toFixed(3)),
                              最大差: Math.round(最大) });
    })()`);
    const d = JSON.parse(r.result.value);
    /* 判据用**平均差**：重叠边界的孤立像素抗锯齿差异可达 100+，
       但那是几个像素的事，不代表实现不一致。
       实测基线：平均差 0.199 / 0.891（极小），最大差 127 / 170（孤立像素）。 */
    const ok = d.平均差 < 2.0;
    if (!ok) 全部通过 = false;
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + 用例.名.padEnd(18) +
                ' 平均差 ' + String(d.平均差).padStart(6) +
                '  最大差 ' + String(d.最大差).padStart(4));
    断言(用例.名 + ' 两条路径一致（含重叠区的柔化）', ok, JSON.stringify(d));
  }

  /* ============================================================
     功能有效性专项：每个特性在**两条路径上都要真的起作用**
     ------------------------------------------------------------
     ## 为什么不靠「一致性比对」来保证这些特性
     实测（tools/probe_fade_signal.mjs）：柔化 0 → 0.45 的画面变化
     只有 1.149~1.369/255，而光栅化噪声本身就有 0.4~0.9 ——
     **信号与噪声同量级**，均值差比对无法可靠区分
     「实现忽略了柔化」与「实现正确」。

     ## 改用功能性判据
     同一条路径下改变参数，画面必须**有变化**。
     「两个渲染是否不同」是强信号（可差到 30+），
     远比对微小的均值差设阈值可靠。
     配合「两条路径共用 绘制组件实例()」这一结构保证，
     即可覆盖：共用 → 不可能不一致；功能测试 → 参数确实生效。
     ============================================================ */
  console.log();
  console.log('  功能有效性（同路径下改参数，画面必须变化）：');

  async function 渲染两条() {
    const r = await ev(`(() => {
      const W = 画布.w, H = 画布.h;
      const 布局 = 放置.filter(p => !p.hidden).map(function (p) {
        return { id:p.id, x:p.x, y:p.y, w:p.w, h:p.h,
                 柔化:p.柔化, 隐藏文字:p.隐藏文字, 样式:p.样式 };
      });
      const A = document.createElement('canvas'); A.width = W; A.height = H;
      const ga = A.getContext('2d');
      ga.fillStyle = P.bg; ga.fillRect(0, 0, W, H);
      放置.forEach(function (p) {
        if (p.hidden) return;
        const el = stage.querySelector('.win[data-uid="' + p.uid + '"]');
        const cv = el && el.querySelector('canvas');
        if (cv) ga.drawImage(cv, p.x, p.y, p.w, p.h);
      });
      const B = document.createElement('canvas'); B.width = W; B.height = H;
      CUR = 静帧秒;
      绘制布局(B.getContext('2d'), 布局, { w: W, h: H, 背景: true });
      function 采样(cv) {
        const d = cv.getContext('2d').getImageData(0,0,W,H).data;
        const 样 = [];
        for (let i = 0; i < d.length; i += 4 * 5) 样.push(d[i], d[i+1], d[i+2]);
        return 样;
      }
      return JSON.stringify({ 预览: 采样(A), 导出: 采样(B) });
    })()`);
    return JSON.parse(r.result.value);
  }
  const 两样差异 = (a, b) => {
    let 和 = 0;
    const L = Math.min(a.length, b.length);
    for (let i = 0; i < L; i++) 和 += Math.abs(a[i] - b[i]);
    return 和 / Math.max(1, L);
  };

  const 特性表 = [
    {
      名: '柔化（重叠布局）',
      前置: `套用模板(TEMPLATES[1]);
             放置.forEach((p,i) => { p.x = 260 + i*70; p.y = 220 + i*70; })`,
      甲: `放置.forEach(p => p.柔化 = 0)`,
      乙: `放置.forEach(p => p.柔化 = 0.45)`,
      阈值: 0.2,
    },
    {
      名: '文字底板开关',
      前置: `套用模板(TEMPLATES[1])`,
      甲: `放置.filter(p=>p.id==='text').forEach(p => p.样式.背景 = false)`,
      乙: `放置.filter(p=>p.id==='text').forEach(p => p.样式.背景 = true)`,
      /* 实测仅 0.003 —— 小文本框上底板几乎不可见
         （柔化约 5.8px，覆盖了 32px 高的框）。
         阈值只需区分「有效」与「完全无效果(=0)」。 */
      阈值: 0.0005,
    },
    {
      名: '隐藏组件内文字',
      前置: `套用模板(TEMPLATES[1])`,
      甲: `放置.forEach(p => p.隐藏文字 = false)`,
      乙: `放置.forEach(p => p.隐藏文字 = true)`,
      /* 实测 0.085 —— 组件内文字只占画面很小比例，但信号明确且非零 */
      阈值: 0.02,
    },
  ];

  for (const f of 特性表) {
    await ev(`(() => { ${f.前置}; ${f.甲}; 渲染画布(); })()`);
    await sleep(900);
    const 甲 = await 渲染两条();
    await ev(`(() => { ${f.乙}; 渲染画布(); })()`);
    await sleep(900);
    const 乙 = await 渲染两条();

    const 预览差 = 两样差异(甲.预览, 乙.预览);
    const 导出差 = 两样差异(甲.导出, 乙.导出);
    const 预览有效 = 预览差 > f.阈值;
    const 导出有效 = 导出差 > f.阈值;
    const ok = 预览有效 && 导出有效;
    if (!ok) 全部通过 = false;
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + f.名.padEnd(16) +
                ' 预览侧变化 ' + 预览差.toFixed(2).padStart(7) +
                '  导出侧变化 ' + 导出差.toFixed(2).padStart(7));
    断言(f.名 + ' 在预览侧生效', 预览有效, String(预览差));
    断言(f.名 + ' 在导出侧生效', 导出有效, String(导出差));
  }

  console.log();
  console.log('=== 页面错误 ===');
  断言('无 JS 错误', errs.length === 0, errs.slice(0,3).join(' | '));

  console.log();
  console.log('='.repeat(84));
  console.log(全部通过 ? '✓ 预览与导出完全一致（所见即所得）' : '✗ 存在不一致');
  console.log('='.repeat(84));
  console.log('通过 ' + pass + ' / ' + (pass+fail));
} finally { child.kill(); }
process.exit(fail ? 1 : 0);
