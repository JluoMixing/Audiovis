// 验证：① 文字不再被顶部裁切 ② 组件内文字可隐藏
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
const PORT = 9950;
const child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/cliptest`,
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

  // ---------------------------------------------------------------
  console.log('=== 一、文字不再被顶部裁切 ===');
  // ---------------------------------------------------------------
  /* 直接对「测量 → 绘制」做闭环：在测量出的框里绘制，量墨迹上下留白。
     上下留白应大致相等（居中），且都 > 0。 */
  const r = await ev(`(() => {
    const comp = COMPONENTS.filter(c => c.id === 'text')[0];
    const 结果 = [];
    const 用例 = [
      { 内容:'NUJABES', 字号:31, 角色:'display', 字距:1.2, 大写:true },
      { 内容:'{tempo} BPM', 字号:16, 角色:'mono', 字距:1.0, 大写:true },
      { 内容:'NUJABES', 字号:60, 角色:'display', 字距:0, 大写:true },
      { 内容:'NUJABES', 字号:60, 角色:'display', 字距:4, 大写:true },
      { 内容:'nujabes', 字号:43, 角色:'display', 字距:2, 大写:false },
      { 内容:'很长的中文标题', 字号:48, 角色:'display', 字距:1.5, 大写:false },
    ];
    用例.forEach(function(c) {
      const 样式 = Object.assign({}, comp.默认, c);
      const m = comp.测量(样式, 0);
      const W = m.w, H = Math.max(24, m.h);   /* GUI 有 24 的最小高度 */
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, H);
      comp.绘制(g, W, H, 样式);
      const d = g.getImageData(0, 0, W, H).data;
      let minY = H, maxY = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const k = (y * W + x) * 4;
        if (d[k] < 200) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
      结果.push({
        内容: c.内容, 字号: c.字号, 字距: c.字距,
        框高: H, 上: minY, 下: H - 1 - maxY,
        不对称: Math.abs(minY - (H - 1 - maxY)),
      });
    });
    return JSON.stringify(结果);
  })()`);
  const 表 = JSON.parse(r.result.value);
  console.log('  内容'.padEnd(20) + '字号  字距   框高   上留白  下留白  不对称');
  console.log('  ' + '-'.repeat(62));
  表.forEach(x => {
    console.log('  ' + x.内容.padEnd(18) + String(x.字号).padStart(4) +
                String(x.字距).padStart(6) + String(x.框高).padStart(6) +
                String(x.上).padStart(8) + String(x.下).padStart(8) +
                String(x.不对称).padStart(8) +
                (x.上 <= 0 ? '  ✗裁切' : (x.不对称 > 4 ? '  ✗偏心' : '  ✓')));
  });
  console.log();
  断言('所有文字上留白 > 0（不被顶部裁切）', 表.every(x => x.上 > 0),
       JSON.stringify(表.filter(x => x.上 <= 0)));
  断言('所有文字上下基本对称（|上-下| ≤ 4px）', 表.every(x => x.不对称 <= 4),
       JSON.stringify(表.filter(x => x.不对称 > 4)));

  // 真实模板里逐个文字元素检查
  console.log('');
  console.log('  真实模板中的文字元素：');
  const N = (await ev(`TEMPLATES.length`)).result.value;
  let 全OK = true;
  for (let i = 1; i < N; i++) {
    await ev(`套用模板(TEMPLATES[${i}])`);
    await sleep(750);
    const rr = await ev(`(() => {
      const 结果 = [];
      放置.filter(p => p.id === 'text').forEach(function (p) {
        const el = stage.querySelector('.win[data-uid="' + p.uid + '"]');
        const cv = el.querySelector('canvas');
        const g = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        const d = g.getImageData(0, 0, W, H).data;
        /* 墨迹判定分两种：
           · 文字元素默认**无底板** → 画布透明，用 alpha 通道判墨迹最准。
             用颜色差会漏检：透明背景是 (0,0,0,0)，深色墨迹也接近 (0,0,0)，
             色差小于阈值就被当成背景（之前两个用例报「未检出」的原因）。
           · 有底板时 alpha 全为 255 → 退回用与「出现最多的颜色」的色差。 */
        let 透明数 = 0;
        for (let k = 3; k < d.length; k += 4) if (d[k] < 10) 透明数++;
        const 用alpha = 透明数 > (W * H) * 0.2;

        let bg = [0, 0, 0];
        if (!用alpha) {
          const 频 = new Map();
          for (let k = 0; k < d.length; k += 4) {
            const key = (d[k] >> 2) + ',' + (d[k+1] >> 2) + ',' + (d[k+2] >> 2);
            频.set(key, (频.get(key) || 0) + 1);
          }
          let bgKey = null, bgN = -1;
          频.forEach(function(v, k) { if (v > bgN) { bgN = v; bgKey = k; } });
          bg = bgKey.split(',').map(function(x) { return Number(x) << 2; });
        }

        let minY = H, maxY = -1, 数 = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const k = (y * W + x) * 4;
          const 是墨 = 用alpha ? (d[k+3] > 24)
            : (Math.abs(d[k]-bg[0]) > 45 || Math.abs(d[k+1]-bg[1]) > 45 ||
               Math.abs(d[k+2]-bg[2]) > 45);
          if (是墨) { 数++; if (y < minY) minY = y; if (y > maxY) maxY = y; }
        }
        const 倍 = H / p.h;
        结果.push({ 内容: String(p.样式.内容).slice(0,16),
                    上: Math.round(minY / 倍),
                    下: Math.round((H - 1 - maxY) / 倍), 数: 数 });
      });
      return JSON.stringify(结果);
    })()`);
    JSON.parse(rr.result.value).forEach(x => {
      const ok = x.数 > 0 && x.上 > 0;
      if (!ok) 全OK = false;
      console.log('     ' + (x.数 === 0 ? '? 未检出' : (ok ? '✓' : '✗')) +
                  '  ' + x.内容.padEnd(18) + ' 上' + String(x.上).padStart(3) +
                  ' 下' + String(x.下).padStart(3));
    });
  }
  断言('模板中所有文字都未被顶部裁切', 全OK);

  // ---------------------------------------------------------------
  console.log('');
  console.log('=== 二、组件内文字可隐藏 ===');
  // ---------------------------------------------------------------
  await ev(`套用模板(TEMPLATES[1])`);
  await sleep(800);

  /* 用画布像素指纹 + 差异计数判断。
     标准差对「文字只占画面很小一部分」的组件不敏感
     （实测 playlist 仅差 0.12），改用逐像素差异计数。 */
  const 取指纹 = async (uid) => {
    const rr = await ev(`(() => {
      const el = stage.querySelector('.win[data-uid="${uid}"]');
      const cv = el.querySelector('canvas');
      const g = cv.getContext('2d');
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let h = 2166136261;
      for (let i = 0; i < d.length; i += 4) {
        h ^= d[i]; h = Math.imul(h, 16777619);
        h ^= d[i+1]; h = Math.imul(h, 16777619);
        h ^= d[i+2]; h = Math.imul(h, 16777619);
      }
      /* 同时存一份降采样，用于算差异像素数 */
      const 样 = [];
      for (let i = 0; i < d.length; i += 4 * 7) 样.push(d[i]);
      return JSON.stringify({ 指纹: h >>> 0, 样: 样 });
    })()`);
    return JSON.parse(rr.result.value);
  };
  const 差异数 = (a, b) => {
    let n = 0;
    const L = Math.min(a.样.length, b.样.length);
    for (let i = 0; i < L; i++) if (Math.abs(a.样[i] - b.样[i]) > 12) n++;
    return n;
  };

  const 组件uid = JSON.parse((await ev(
    `JSON.stringify(放置.filter(p => p.id !== 'text').map(p => ({uid:p.uid, id:p.id})))`
  )).result.value);

  for (const c of 组件uid.slice(0, 4)) {
    const 前 = await 取指纹(c.uid);
    await ev(`(() => {
      const p = 放置.find(x => x.uid === ${c.uid});
      p.隐藏文字 = true; 渲染画布();
    })()`);
    await sleep(600);
    const 后 = await 取指纹(c.uid);
    await ev(`(() => {
      const p = 放置.find(x => x.uid === ${c.uid});
      p.隐藏文字 = false; 渲染画布();
    })()`);
    await sleep(600);
    const 还原 = await 取指纹(c.uid);

    const 变了 = 差异数(前, 后);
    const 可还原 = 还原.指纹 === 前.指纹;
    console.log('   ' + c.id.padEnd(11) +
                ' 差异像素 ' + String(变了).padStart(5) +
                (可还原 ? '   还原 ✓' : '   还原 ✗') +
                (变了 > 20 ? '  ✓ 文字已隐藏' : '  ✗ 无可见变化'));
    断言(c.id + ' 隐藏文字后画面确有变化', 变了 > 20, '差异像素 ' + 变了);
    断言(c.id + ' 关闭开关后完全还原', 可还原,
           '指纹 ' + 前.指纹 + ' vs ' + 还原.指纹);
  }

  console.log('');
  console.log('  属性面板开关：');
  await ev(`单选(放置.filter(p=>p.id!=='text')[0].uid); 更新选中样式(); 渲染属性();`);
  await sleep(400);
  const r2 = await ev(`JSON.stringify({
    存在: !!document.getElementById('pHideText'),
    未禁用: !document.getElementById('pHideText').disabled,
  })`);
  const d2 = JSON.parse(r2.result.value);
  断言('属性面板有「隐藏组件内的文字」开关', d2.存在 === true);
  断言('对普通组件可用', d2.未禁用 === true);

  // 文字组件应禁用该开关（它自身没有内嵌文字）
  await ev(`单选(放置.filter(p=>p.id==='text')[0].uid); 更新选中样式(); 渲染属性();`);
  await sleep(400);
  const r3 = await ev(`document.getElementById('pHideText').disabled`);
  断言('对文字组件禁用该开关', r3.result.value === true);

  console.log('');
  console.log('=== 页面错误 ===');
  断言('无 JS 错误', errs.length === 0, errs.slice(0,3).join(' | '));

  // 截图对比
  await ev(`套用模板(TEMPLATES[1])`);
  await sleep(800);
  let shot = await send('Page.captureScreenshot', {format:'png'});
  writeFileSync(process.env.TEMP + '\\hide_off.png', Buffer.from(shot.data,'base64'));
  await ev(`放置.forEach(p => p.隐藏文字 = true); 渲染画布();`);
  await sleep(900);
  shot = await send('Page.captureScreenshot', {format:'png'});
  writeFileSync(process.env.TEMP + '\\hide_on.png', Buffer.from(shot.data,'base64'));
  console.log('WROTE hide_off.png / hide_on.png');

  console.log('');
  console.log('='.repeat(56));
  console.log('通过 ' + pass + ' / ' + (pass+fail));
} finally { child.kill(); }
process.exit(fail ? 1 : 0);
