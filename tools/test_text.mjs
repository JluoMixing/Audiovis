// 文字组件功能测试
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
const PORT = 9801;
const child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/texttest`,
  '--window-size=1600,1000',
  'file:///D:/FL_VISUAL_TEST/preview/gui_prototype.html'], { stdio:'ignore' });
const get = p => new Promise((res,rej)=>{ http.get({host:'127.0.0.1',port:PORT,path:p},r=>{
  let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }).on('error',rej); });

const sleep = ms => new Promise(r=>setTimeout(r,ms));

let pass=0, fail=0;
function 断言(n, c, d){ if(c){pass++;console.log('  ✓ '+n);} else {fail++;console.log('  ✗ '+n+(d?'  → '+d:''));} }

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
    if(m.method==='Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description?.split('\n')[0]);
  });
  await sleep(2500);

  /* btnDemo 已删除（任务1）。直接进入编辑器；
   多数测试随后会自己 套用模板 填充画布。 */
  await ev(`进入编辑器()`);
  await sleep(200);
  await ev(`document.getElementById('btnEnter').click()`);
  await sleep(800);

  console.log('=== 文字组件注册 ===');
  let r = await ev(`COMPONENTS.filter(c=>c.id==='text').length`);
  断言('text 组件已注册', r.result.value === 1);

  r = await ev(`JSON.stringify(COMPONENTS.filter(c=>c.id==='text')[0].默认)`);
  const 默认 = JSON.parse(r.result.value);
  断言('有默认样式', !!默认 && 默认.内容 !== undefined, JSON.stringify(默认).slice(0,60));
  断言('默认字体为空（跟随主题）', 默认.字体 === '');

  console.log('');
  console.log('=== 字体库 ===');
  r = await ev(`字体库.length`);
  断言('字体库有条目', r.result.value >= 15, '实际 ' + r.result.value);
  r = await ev(`JSON.stringify(Object.keys(字体分组()))`);
  断言('字体已分组', JSON.parse(r.result.value).length >= 5, r.result.value);

  console.log('');
  console.log('=== 添加文字组件 ===');
  await ev(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain','text');
    const st = document.getElementById('stage');
    const rr = st.getBoundingClientRect();
    st.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt,
      clientX:rr.left+400, clientY:rr.top+300}));
  })()`);
  await sleep(700);
  r = await ev(`放置.length`);
  断言('文字已添加', r.result.value === 1, '实际 ' + r.result.value);

  console.log('');
  console.log('=== 选中后显示文字面板 ===');
  await ev(`document.querySelectorAll('.win')[0].dispatchEvent(
    new MouseEvent('mousedown',{bubbles:true,clientX:400,clientY:300}))`);
  await sleep(500);
  r = await ev(`document.getElementById('textPanel').style.display`);
  断言('文字面板已显示', r.result.value === 'block', '实际 ' + r.result.value);

  console.log('');
  console.log('=== 修改内容 → 画布更新 ===');
  const 前 = await ev(`(() => {
    const cv = document.querySelector('.win canvas');
    const g = cv.getContext('2d');
    const d = g.getImageData(0,0,cv.width,cv.height).data;
    let h=2166136261; for(let i=0;i<d.length;i+=16){ h^=d[i]; h=Math.imul(h,16777619); }
    return h>>>0;
  })()`);
  await ev(`(() => {
    const ta = document.getElementById('tContent');
    ta.value = 'MY BEAT TITLE';
    ta.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await sleep(600);
  const 后 = await ev(`(() => {
    const cv = document.querySelector('.win canvas');
    const g = cv.getContext('2d');
    const d = g.getImageData(0,0,cv.width,cv.height).data;
    let h=2166136261; for(let i=0;i<d.length;i+=16){ h^=d[i]; h=Math.imul(h,16777619); }
    return h>>>0;
  })()`);
  断言('改内容后画布变化', 前.result.value !== 后.result.value,
       '前 ' + 前.result.value + ' 后 ' + 后.result.value);

  console.log('');
  console.log('=== 改字体 → 画布变化 ===');
  const 前2 = 后.result.value;
  await ev(`(() => {
    const s = document.getElementById('tFont');
    s.value = 'Arial Black';
    s.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await sleep(600);
  const 后2 = await ev(`(() => {
    const cv = document.querySelector('.win canvas');
    const g = cv.getContext('2d');
    const d = g.getImageData(0,0,cv.width,cv.height).data;
    let h=2166136261; for(let i=0;i<d.length;i+=16){ h^=d[i]; h=Math.imul(h,16777619); }
    return h>>>0;
  })()`);
  断言('改字体后画布变化', 前2 !== 后2.result.value);

  console.log('');
  console.log('=== 改字号 → 画布变化 ===');
  await ev(`(() => {
    const i = document.getElementById('tSize');
    i.value = '90';
    i.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await sleep(600);
  const 后3 = await ev(`(() => {
    const cv = document.querySelector('.win canvas');
    const g = cv.getContext('2d');
    const d = g.getImageData(0,0,cv.width,cv.height).data;
    let h=2166136261; for(let i=0;i<d.length;i+=16){ h^=d[i]; h=Math.imul(h,16777619); }
    return h>>>0;
  })()`);
  断言('改字号后画布变化', 后2.result.value !== 后3.result.value);

  console.log('');
  console.log('=== 变量替换 ===');
  r = await ev(`JSON.stringify({
    title: 解析文字变量('{title}', 48),
    tempo: 解析文字变量('{tempo}', 48),
    time: 解析文字变量('{time}', 48),
    bars: 解析文字变量('{bars}', 48),
  })`);
  const 变 = JSON.parse(r.result.value);
  断言('{title} 已替换', 变.title && 变.title !== '{title}', 变.title);
  断言('{tempo} 已替换', 变.tempo && !isNaN(parseFloat(变.tempo)), 变.tempo);
  断言('{time} 已替换', /^\d+:\d/.test(变.time), 变.time);
  断言('{bars} 已替换', /^\d+$/.test(变.bars), 变.bars);

  console.log('');
  console.log('=== 柔化属性 ===');
  r = await ev(`document.getElementById('pFade') ? true : false`);
  断言('柔化滑块存在', r.result.value === true);

  /* 注意：文字组件默认无底板，柔化不影响它。
     故先开启底板，再验证柔化确实生效。 */
  await ev(`(() => {
    const c = document.getElementById('tBg');
    c.checked = true;
    c.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await sleep(500);
  const 前3 = await ev(`(() => {
    const cv = document.querySelector('.win canvas');
    const g = cv.getContext('2d');
    const d = g.getImageData(0,0,cv.width,cv.height).data;
    let h=2166136261; for(let i=0;i<d.length;i+=16){ h^=d[i]; h=Math.imul(h,16777619); }
    return h>>>0;
  })()`);
  await ev(`(() => {
    const s = document.getElementById('pFade');
    s.value = '45';
    s.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await sleep(600);
  const 后4 = await ev(`(() => {
    const cv = document.querySelector('.win canvas');
    const g = cv.getContext('2d');
    const d = g.getImageData(0,0,cv.width,cv.height).data;
    let h=2166136261; for(let i=0;i<d.length;i+=16){ h^=d[i]; h=Math.imul(h,16777619); }
    return h>>>0;
  })()`);
  断言('开启底板后，改柔化画布变化', 前3.result.value !== 后4.result.value);
  r = await ev(`放置[0].柔化`);
  断言('柔化值已存到状态', r.result.value === 0.45, '实际 ' + r.result.value);

  console.log('');
  console.log('=== 主题切换 → 字体跟随 ===');
  await ev(`document.querySelectorAll('.themeCard')[1].click()`);  // 墨·紙
  await sleep(700);
  r = await ev(`JSON.stringify({
    theme: 主题键,
    主题字体: 主题字体名('display'),
    组件字体: 放置[0].样式.字体
  })`);
  const 主 = JSON.parse(r.result.value);
  断言('主题已切换', 主.theme === 'sumi');
  断言('主题字体名可取', !!主.主题字体, 主.主题字体);
  断言('文字组件字体仍为自定义（不被主题覆盖）', 主.组件字体 === 'Arial Black', 主.组件字体);

  console.log('');
  console.log('=== 页面错误 ===');
  断言('无 JS 错误', errs.length === 0, errs.slice(0,2).join(' | '));

  // 截图
  await ev(`(() => {
    const p = 放置[0];
    p.x = 100; p.y = 100; p.w = 900; p.h = 300;
    渲染画布();
  })()`);
  await sleep(800);
  const shot = await send('Page.captureScreenshot', {format:'png'});
  writeFileSync(process.env.TEMP + '\\text_test.png', Buffer.from(shot.data,'base64'));
  console.log('WROTE text_test.png');

  console.log('');
  console.log('='.repeat(56));
  console.log('通过 ' + pass + ' / ' + (pass+fail));
} finally { child.kill(); }
process.exit(fail ? 1 : 0);
