// 测试：文字框自适应 + 就地编辑
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
const PORT = 9805;
const child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/autofit`,
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

  console.log('=== 拖入文字：框自适应文本 ===');
  await ev(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain','text');
    const st = document.getElementById('stage');
    const r = st.getBoundingClientRect();
    st.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt,
      clientX:r.left+400, clientY:r.top+300}));
  })()`);
  await sleep(800);

  let r = await ev(`JSON.stringify({
    w: 放置[0].w, h: 放置[0].h,
    默认尺寸: (() => { const c = COMPS.flatMap(g=>g.items).find(x=>x.id==='text'); return c.w+'x'+c.h; })(),
    测量: COMPONENTS.find(c=>c.id==='text').测量(放置[0].样式, 0)
  })`);
  const d1 = JSON.parse(r.result.value);
  console.log('  拖入后尺寸:', d1.w + 'x' + d1.h);
  console.log('  组件默认尺寸:', d1.默认尺寸);
  console.log('  测量结果:', d1.测量.w + 'x' + d1.测量.h);

  断言('框已自适应（不等于默认 620x200）', d1.w !== 620 || d1.h !== 200,
       d1.w + 'x' + d1.h);
  断言('框尺寸 = 测量尺寸', Math.abs(d1.w - d1.测量.w) <= 1 && Math.abs(d1.h - d1.测量.h) <= 1,
       '框 ' + d1.w + 'x' + d1.h + ' vs 测量 ' + d1.测量.w + 'x' + d1.测量.h);

  console.log('');
  console.log('=== 改内容 → 框跟随 ===');
  const 前W = d1.w, 前H = d1.h;
  await ev(`(() => {
    const ta = document.getElementById('tContent');
    ta.value = 'A MUCH LONGER TITLE HERE';
    ta.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await sleep(700);
  r = await ev(`JSON.stringify({w:放置[0].w, h:放置[0].h})`);
  const d2 = JSON.parse(r.result.value);
  console.log('  改内容后:', d2.w + 'x' + d2.h, '（原 ' + 前W + 'x' + 前H + '）');
  断言('内容变长后框变宽', d2.w > 前W, 前W + ' → ' + d2.w);

  console.log('');
  console.log('=== 改字号 → 框跟随 ===');
  const 前W2 = d2.w, 前H2 = d2.h;
  await ev(`(() => {
    const i = document.getElementById('tSize');
    i.value = '120';
    i.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await sleep(700);
  r = await ev(`JSON.stringify({w:放置[0].w, h:放置[0].h, 字号:放置[0].样式.字号})`);
  const d3 = JSON.parse(r.result.value);
  console.log('  字号 120 后:', d3.w + 'x' + d3.h);
  断言('字号变大后框变大', d3.h > 前H2, 前H2 + ' → ' + d3.h);
  断言('字号已保存', d3.字号 === 120, String(d3.字号));

  console.log('');
  console.log('=== 自适应模式下宽高输入被锁定 ===');
  r = await ev(`JSON.stringify({
    w锁定: document.getElementById('pW').disabled,
    h锁定: document.getElementById('pH').disabled
  })`);
  const d4 = JSON.parse(r.result.value);
  断言('宽输入已锁定', d4.w锁定 === true);
  断言('高输入已锁定', d4.h锁定 === true);

  console.log('');
  console.log('=== 开启固定换行 → 解锁 ===');
  await ev(`(() => {
    const c = document.getElementById('tWrap');
    c.checked = true;
    c.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await sleep(700);
  r = await ev(`JSON.stringify({
    w锁定: document.getElementById('pW').disabled,
    自动换行: 放置[0].样式.自动换行
  })`);
  const d5 = JSON.parse(r.result.value);
  断言('固定换行已开启', d5.自动换行 === true);
  断言('宽高输入已解锁', d5.w锁定 === false);

  console.log('');
  console.log('=== 就地编辑：双击进入 ===');
  /* 双击现在由 mousedown 自行计时识别（因为 渲染画布 会重建 DOM，
     原生 dblclick 不可靠）。故测试也要走 mousedown 序列。 */
  await ev(`(() => {
    const w = document.querySelectorAll('.win')[0];
    const b = w.getBoundingClientRect();
    const x = b.left + b.width/2, y = b.top + b.height/2;
    for (let i = 1; i <= 2; i++) {
      w.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:x,clientY:y}));
      window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:x,clientY:y}));
    }
  })()`);
  await sleep(600);
  r = await ev(`JSON.stringify({
    编辑中: 编辑中,
    editing类: document.querySelectorAll('.win')[0].classList.contains('editing'),
    textarea存在: !!document.querySelector('.win .inlineEdit'),
    textarea值: document.querySelector('.win .inlineEdit') ? document.querySelector('.win .inlineEdit').value : null,
    textarea字体: document.querySelector('.win .inlineEdit') ? document.querySelector('.win .inlineEdit').style.font : null,
  })`);
  const d6 = JSON.parse(r.result.value);
  断言('已进入编辑态', d6.编辑中 !== null, String(d6.编辑中));
  断言('editing 类已加', d6.editing类 === true);
  断言('textarea 存在', d6.textarea存在 === true);
  断言('textarea 值 = 当前内容', d6.textarea值 === 'A MUCH LONGER TITLE HERE', d6.textarea值);
  断言('textarea 字体已同步', !!d6.textarea字体 && d6.textarea字体.includes('120px'),
       d6.textarea字体);

  console.log('');
  console.log('=== 就地编辑：改内容 → 退出 → 生效 ===');
  await ev(`(() => {
    const ta = document.querySelector('.win .inlineEdit');
    ta.value = 'EDITED INLINE';
  })()`);
  await ev(`document.getElementById('stage').dispatchEvent(
    new MouseEvent('mousedown',{bubbles:true,clientX:10,clientY:10}))`);
  await sleep(800);
  r = await ev(`JSON.stringify({
    编辑中: 编辑中,
    内容: 放置[0].样式.内容,
    宽: 放置[0].w,
    textarea值: document.querySelector('.win .inlineEdit').value
  })`);
  const d7 = JSON.parse(r.result.value);
  断言('已退出编辑', d7.编辑中 === null);
  断言('内容已提交', d7.内容 === 'EDITED INLINE', d7.内容);
  断言('框已随新内容重算', d7.宽 > 0, String(d7.宽));

  console.log('');
  console.log('=== 页面错误 ===');
  断言('无 JS 错误', errs.length === 0, errs.slice(0,3).join(' | '));

  // 截图
  await ev(`(() => {
    const p = 放置[0];
    p.样式.自动换行 = false;
    p.样式.字号 = 0;
    p.样式.内容 = '{title}';
    自适应文字框(p);
    p.x = 120; p.y = 200;
    渲染画布();
  })()`);
  await sleep(900);
  const shot = await send('Page.captureScreenshot', {format:'png'});
  writeFileSync(process.env.TEMP + '\\autofit_test.png', Buffer.from(shot.data,'base64'));
  console.log('WROTE autofit_test.png');

  console.log('');
  console.log('='.repeat(56));
  console.log('通过 ' + pass + ' / ' + (pass+fail));
} finally { child.kill(); }
process.exit(fail ? 1 : 0);
