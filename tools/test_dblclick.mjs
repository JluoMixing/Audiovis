// 验证：正常点击路径不再重建 DOM + 双击编辑可用
import { spawn } from 'node:child_process';
import http from 'node:http';


/* 测试用临时目录：放项目内（D 盘），避免累积撑满系统盘。
   实测：用 process.env.TEMP 时 125 次运行留下 3.77 GB profile，
   C 盘被撑到 0 字节可用，后续所有写操作 ENOSPC。 */
import { mkdirSync as _mkdir } from 'node:fs';
const TMP = 'D:/FL_VISUAL_TEST/.testtmp';
try { _mkdir(TMP, { recursive: true }); } catch (e) {}

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const PORT = 9852;
const child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/dbl3`,
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
  const 鼠标 = (type, x, y, cc) => send('Input.dispatchMouseEvent', {
    type, x, y, button:'left', clickCount: cc,
    buttons: type === 'mousePressed' ? 1 : 0,
  });
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

  // 加文字和频谱
  await ev(`(() => {
    ['text','spectrum'].forEach(function(id, k) {
      const dt = new DataTransfer();
      dt.setData('text/plain', id);
      const st = document.getElementById('stage');
      const r = st.getBoundingClientRect();
      st.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt,
        clientX:r.left+250+k*260, clientY:r.top+250}));
    });
  })()`);
  await sleep(900);

  const 取位置 = async (idx) => JSON.parse((await ev(`(() => {
    const w = document.querySelectorAll('.win')[${idx}];
    const b = w.getBoundingClientRect();
    return JSON.stringify({x: Math.round(b.left+b.width/2),
                           y: Math.round(b.top+b.height/2)});
  })()`)).result.value);

  const P0 = await 取位置(0);   // text
  const P1 = await 取位置(1);   // spectrum

  console.log('=== 单击不重建 DOM ===');
  const 引用前 = (await ev(`(() => {
    window.__ref = document.querySelectorAll('.win')[0];
    return 'ok';
  })()`)).result.value;
  await 鼠标('mouseMoved', P0.x, P0.y, 0);
  await 鼠标('mousePressed', P0.x, P0.y, 1);
  await 鼠标('mouseReleased', P0.x, P0.y, 1);
  await sleep(300);
  const r1 = await ev(`JSON.stringify({
    DOM未重建: window.__ref === document.querySelectorAll('.win')[0],
    已选中: 选中 === 放置[0].uid,
    编辑中: 编辑中,
  })`);
  const d1 = JSON.parse(r1.result.value);
  console.log('  ', JSON.stringify(d1));
  断言('单击不重建 DOM', d1.DOM未重建 === true);
  断言('单击后已选中', d1.已选中 === true);
  断言('单击不进入编辑', d1.编辑中 === null);

  console.log('');
  console.log('=== 双击进入编辑（真实鼠标序列）===');
  await 鼠标('mousePressed', P0.x, P0.y, 1);
  await 鼠标('mouseReleased', P0.x, P0.y, 1);
  await sleep(80);
  await 鼠标('mousePressed', P0.x, P0.y, 2);
  await 鼠标('mouseReleased', P0.x, P0.y, 2);
  await sleep(500);
  const r2 = await ev(`JSON.stringify({
    编辑中: 编辑中,
    editing类: document.querySelectorAll('.win')[0].classList.contains('editing'),
    ta显示: getComputedStyle(document.querySelector('.win .inlineEdit')).display,
    聚焦: document.activeElement.className,
  })`);
  const d2 = JSON.parse(r2.result.value);
  console.log('  ', JSON.stringify(d2));
  断言('双击进入编辑', d2.编辑中 !== null);
  断言('textarea 已显示', d2.ta显示 === 'block');
  断言('textarea 已聚焦', d2.聚焦 === 'inlineEdit');

  console.log('');
  console.log('=== 编辑中可打字 ===');
  await send('Input.insertText', {text: 'HELLO'});
  await sleep(300);
  const r3 = await ev(`document.querySelector('.win .inlineEdit').value`);
  断言('文字已输入', r3.result.value.includes('HELLO'), r3.result.value);

  console.log('');
  console.log('=== Esc 退出编辑 ===');
  await send('Input.dispatchKeyEvent', {type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent', {type:'keyUp', key:'Escape', code:'Escape', windowsVirtualKeyCode:27});
  await sleep(500);
  const r4 = await ev(`JSON.stringify({编辑中:编辑中, 内容:放置[0].样式.内容})`);
  const d4 = JSON.parse(r4.result.value);
  console.log('  ', JSON.stringify(d4));
  断言('Esc 退出编辑', d4.编辑中 === null);
  断言('内容已提交', d4.内容.includes('HELLO'), d4.内容);

  console.log('');
  console.log('=== 点空白退出 ===');
  await 鼠标('mousePressed', P0.x, P0.y, 1);
  await 鼠标('mouseReleased', P0.x, P0.y, 1);
  await sleep(80);
  await 鼠标('mousePressed', P0.x, P0.y, 2);
  await 鼠标('mouseReleased', P0.x, P0.y, 2);
  await sleep(400);
  await 鼠标('mousePressed', 900, 700, 1);
  await 鼠标('mouseReleased', 900, 700, 1);
  await sleep(400);
  const r5 = await ev(`JSON.stringify({编辑中:编辑中, 选中:选中})`);
  const d5 = JSON.parse(r5.result.value);
  断言('点空白退出编辑', d5.编辑中 === null);
  断言('点空白取消选中', d5.选中 === null);

  console.log('');
  console.log('=== 双击非文字组件不应进入编辑 ===');
  await 鼠标('mousePressed', P1.x, P1.y, 1);
  await 鼠标('mouseReleased', P1.x, P1.y, 1);
  await sleep(80);
  await 鼠标('mousePressed', P1.x, P1.y, 2);
  await 鼠标('mouseReleased', P1.x, P1.y, 2);
  await sleep(400);
  const r6 = await ev(`JSON.stringify({编辑中:编辑中})`);
  断言('频谱双击不进入编辑', JSON.parse(r6.result.value).编辑中 === null);

  console.log('');
  console.log('=== 页面错误 ===');
  断言('无 JS 错误', errs.length === 0, errs.slice(0,3).join(' | '));

  console.log('');
  console.log('='.repeat(56));
  console.log('通过 ' + pass + ' / ' + (pass+fail));
} finally { child.kill(); }
process.exit(fail ? 1 : 0);
