// 测试：文字组件拖拽缩放的正确性（防止指数增长）
// 关键：模拟真实的多步拖拽，验证尺寸单调、有界、可逆。
import { spawn } from 'node:child_process';
import http from 'node:http';


/* 测试用临时目录：放项目内（D 盘），避免累积撑满系统盘。
   实测：用 process.env.TEMP 时 125 次运行留下 3.77 GB profile，
   C 盘被撑到 0 字节可用，后续所有写操作 ENOSPC。 */
import { mkdirSync as _mkdir } from 'node:fs';
const TMP = 'D:/FL_VISUAL_TEST/.testtmp';
try { _mkdir(TMP, { recursive: true }); } catch (e) {}

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const PORT = 9815;
const child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/dragtest`,
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

  // 加文字
  await ev(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain','text');
    const st = document.getElementById('stage');
    const r = st.getBoundingClientRect();
    st.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt,
      clientX:r.left+400, clientY:r.top+300}));
  })()`);
  await sleep(700);

  /* 每个用例前重置到已知状态，避免用例间互相影响
     （之前没重置，导致第二个用例基于第一个的结果，误判为失败） */
  async function 重置文字(){
    await ev(`(() => {
      const p = 放置[0];
      p.样式.字号 = 0;
      p.样式.自动换行 = false;
      自适应文字框(p);
      p.x = 300; p.y = 300;
      选中 = p.uid;
      渲染画布();
    })()`);
    await sleep(300);
  }

  /* 模拟一次完整的拖拽：mousedown → 多个 mousemove → mouseup。
     这是关键 —— 必须走真实的拖拽流程，
     单独调 mousemove 测不出累乘 bug。 */
  async function 模拟拖拽(手柄, dx序列, dy序列){
    const 起点 = await ev(`(() => {
      const el = document.querySelector('.win');
      const b = el.getBoundingClientRect();
      return JSON.stringify({x: b.left, y: b.top, w: b.width, h: b.height});
    })()`);
    const b = JSON.parse(起点.result.value);

    // 手柄位置
    const 位置 = {
      se: [b.x + b.w - 4, b.y + b.h - 4],
      e:  [b.x + b.w - 4, b.y + b.h / 2],
      s:  [b.x + b.w / 2, b.y + b.h - 4],
      nw: [b.x + 4, b.y + 4],
    }[手柄];

    // mousedown 在手柄上
    await ev(`(() => {
      const el = document.querySelector('.win');
      const h = el.querySelector('.h.${手柄}');
      h.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,
        clientX:${位置[0]}, clientY:${位置[1]}}));
    })()`);
    await sleep(150);

    // 逐步 mousemove
    for (let i = 0; i < dx序列.length; i++) {
      await ev(`window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,
        clientX:${位置[0] + dx序列[i]}, clientY:${位置[1] + dy序列[i]}}))`);
      await sleep(60);
    }
    await ev(`window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))`);
    await sleep(250);
  }

  console.log('=== 拖拽前状态 ===');
  let r = await ev(`JSON.stringify({w:放置[0].w, h:放置[0].h, 字号:放置[0].样式.字号,
    实际字号: 文字实际字号(放置[0].样式)})`);
  const 初始 = JSON.parse(r.result.value);
  console.log('  ', JSON.stringify(初始));
  断言('初始框有合理尺寸', 初始.w > 20 && 初始.w < 2000 && 初始.h > 10 && 初始.h < 1000,
       JSON.stringify(初始));

  console.log('');
  await 重置文字();
  console.log('=== 关键测试：向右下拖 100px（分 10 步）===');
  await 模拟拖拽('se', [10,20,30,40,50,60,70,80,90,100], [10,20,30,40,50,60,70,80,90,100]);
  r = await ev(`JSON.stringify({w:放置[0].w, h:放置[0].h, 字号:放置[0].样式.字号})`);
  const 放大 = JSON.parse(r.result.value);
  console.log('  ', JSON.stringify(放大));

  断言('拖拽后尺寸有界（< 5000）', 放大.w < 5000 && 放大.h < 5000,
       'w=' + 放大.w + ' h=' + 放大.h);
  断言('字号有界（< 600）', 放大.字号 < 600, String(放大.字号));
  断言('确实变大了', 放大.h > 初始.h, 初始.h + ' → ' + 放大.h);

  /* 预期倍率要换算坐标系：
     测试里拖的是**屏幕**像素，而处理逻辑用画布坐标（÷ 缩放）。
     故 100px 屏幕拖拽 = 100/缩放 画布像素。 */
  const 缩放值 = (await ev(`缩放`)).result.value;
  const 画布位移 = 100 / 缩放值;
  const 预期倍率 = (初始.h + 画布位移) / 初始.h;
  const 放大倍率 = 放大.字号 / Math.max(1, 初始.实际字号);
  断言('放大倍率符合预期（' + 预期倍率.toFixed(2) + '×）',
       Math.abs(放大倍率 - 预期倍率) < 0.3,
       '实际 ' + 放大倍率.toFixed(2) + '× vs 预期 ' + 预期倍率.toFixed(2) +
       '×（基准字号 ' + 初始.实际字号 + '，画布位移 ' + Math.round(画布位移) + 'px）');

  console.log('');
  console.log('=== 往返拖拽（+50 再 -50，应回到接近初始）===');
  /* 注意：往返必须在**同一个** mousedown 会话内完成，
     否则第二次拖拽的基准是第一次的结果，语义不同。
     且位移不能超过原尺寸 —— 超过会被下限钳制，那是正确行为。 */
  await 重置文字();
  const 往返前 = JSON.parse((await ev(
    `JSON.stringify({w:放置[0].w, h:放置[0].h, 实际字号:文字实际字号(放置[0].样式)})`
  )).result.value);

  const 屏起 = JSON.parse((await ev(`(() => {
    const b = document.querySelector('.win').getBoundingClientRect();
    return JSON.stringify({x: b.right - 4, y: b.bottom - 4});
  })()`)).result.value);

  await ev(`(() => {
    const h = document.querySelector('.win .h.se');
    h.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,
      clientX: ${屏起.x}, clientY: ${屏起.y}}));
  })()`);
  await sleep(150);
  for (let i = 1; i <= 5; i++) {          // 拖出 +50
    await ev(`window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,
      clientX:${屏起.x + i * 10}, clientY:${屏起.y + i * 10}}))`);
    await sleep(50);
  }
  for (let i = 5; i >= 0; i--) {          // 拖回
    await ev(`window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,
      clientX:${屏起.x + i * 10}, clientY:${屏起.y + i * 10}}))`);
    await sleep(50);
  }
  await ev(`window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))`);
  await sleep(300);

  const 往返后 = JSON.parse((await ev(
    `JSON.stringify({w:放置[0].w, h:放置[0].h, 实际字号:文字实际字号(放置[0].样式)})`
  )).result.value);
  console.log('  前:', JSON.stringify(往返前));
  console.log('  后:', JSON.stringify(往返后));
  断言('往返后回到初始尺寸（±3px）',
       Math.abs(往返后.h - 往返前.h) <= 3,
       '初始 ' + 往返前.h + ' → 往返 ' + 往返后.h);
  断言('往返后字号回到初始（±2）',
       Math.abs(往返后.实际字号 - 往返前.实际字号) <= 2,
       '初始 ' + 往返前.实际字号 + ' → 往返 ' + 往返后.实际字号);

  console.log('');
  console.log('=== 过冲拖拽应被下限钳制（正确行为，非 bug）===');
  await 重置文字();
  await 模拟拖拽('se', [-20,-40,-60,-80,-100,-120], [-20,-40,-60,-80,-100,-120]);
  r = await ev(`JSON.stringify({w:放置[0].w, h:放置[0].h, 字号:放置[0].样式.字号})`);
  const 过冲 = JSON.parse(r.result.value);
  console.log('  ', JSON.stringify(过冲));
  断言('过冲后尺寸为正且有下限', 过冲.w > 0 && 过冲.h > 0 && 过冲.字号 >= 8,
       JSON.stringify(过冲));

  console.log('');
  await 重置文字();
  console.log('=== 长距离连续拖拽（200 步，检测累乘）===');
  await 模拟拖拽('se', Array.from({length:200},(_,i)=>i+1),
                       Array.from({length:200},(_,i)=>i+1));
  r = await ev(`JSON.stringify({w:放置[0].w, h:放置[0].h, 字号:放置[0].样式.字号})`);
  const 长拖 = JSON.parse(r.result.value);
  console.log('  ', JSON.stringify(长拖));
  断言('长距离拖拽后仍有界', 长拖.w < 20000 && 长拖.h < 20000 && 长拖.字号 < 600,
       JSON.stringify(长拖));
  /* 若累乘，200 步会得到天文数字 */
  断言('无指数增长', 长拖.字号 <= 600, '字号 ' + 长拖.字号);

  console.log('');
  await 重置文字();
  console.log('=== 负方向长拖（不应出现负尺寸/NaN）===');
  await 模拟拖拽('se', Array.from({length:150},(_,i)=>-(i+1)*3),
                       Array.from({length:150},(_,i)=>-(i+1)*3));
  r = await ev(`JSON.stringify({w:放置[0].w, h:放置[0].h, 字号:放置[0].样式.字号})`);
  const 缩小 = JSON.parse(r.result.value);
  console.log('  ', JSON.stringify(缩小));
  断言('尺寸为正', 缩小.w > 0 && 缩小.h > 0, JSON.stringify(缩小));
  断言('字号 >= 下限 8', 缩小.字号 >= 8, String(缩小.字号));
  断言('无 NaN', !isNaN(缩小.w) && !isNaN(缩小.h) && !isNaN(缩小.字号));

  console.log('');
  await 重置文字();
  console.log('=== 其它手柄 ===');
  for (const 手 of ['e','s','nw']) {
    await 模拟拖拽(手, [5,10,15,20], [5,10,15,20]);
    r = await ev(`JSON.stringify({w:放置[0].w, h:放置[0].h, x:放置[0].x, y:放置[0].y, 字号:放置[0].样式.字号})`);
    const d = JSON.parse(r.result.value);
    const 正常 = d.w > 0 && d.h > 0 && d.w < 20000 && d.h < 20000 && !isNaN(d.x);
    断言('手柄 ' + 手 + ' 结果正常', 正常, JSON.stringify(d));
  }

  console.log('');
  await 重置文字();
  console.log('=== 固定换行模式：拖拽改框不改字号 ===');
  await ev(`(() => {
    const c = document.getElementById('tWrap');
    c.checked = true;
    c.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await sleep(500);
  const 前字号 = await ev(`放置[0].样式.字号`);
  await 模拟拖拽('se', [20,40,60], [20,40,60]);
  r = await ev(`JSON.stringify({字号:放置[0].样式.字号, w:放置[0].w})`);
  const 固定 = JSON.parse(r.result.value);
  断言('固定换行模式下字号不变', 固定.字号 === 前字号.result.value,
       '前 ' + 前字号.result.value + ' 后 ' + 固定.字号);

  console.log('');
  console.log('=== 页面错误 ===');
  断言('无 JS 错误', errs.length === 0, errs.slice(0,3).join(' | '));

  console.log('');
  console.log('='.repeat(56));
  console.log('通过 ' + pass + ' / ' + (pass+fail));
} finally { child.kill(); }
process.exit(fail ? 1 : 0);
