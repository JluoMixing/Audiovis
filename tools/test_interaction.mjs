// 操控性测试：多选、复制粘贴、撤销、快捷键、框选、右键菜单
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
const PORT = 9860;
const child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/ux`,
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
  const 鼠标 = (type, x, y, cc, mods) => send('Input.dispatchMouseEvent', {
    type, x, y, button:'left', clickCount: cc || 0,
    buttons: type === 'mousePressed' ? 1 : 0,
    modifiers: mods || 0,     // 1=Alt 2=Ctrl 4=Meta 8=Shift
  });
  const 键 = async (key, code, mods, vk) => {
    await send('Input.dispatchKeyEvent', {type:'keyDown', key, code,
      windowsVirtualKeyCode: vk || 0, modifiers: mods || 0});
    await send('Input.dispatchKeyEvent', {type:'keyUp', key, code,
      windowsVirtualKeyCode: vk || 0, modifiers: mods || 0});
  };
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

  // 加三个组件
  await ev(`(() => {
    ['text','spectrum','waveform'].forEach(function(id, k) {
      const dt = new DataTransfer();
      dt.setData('text/plain', id);
      const st = document.getElementById('stage');
      const r = st.getBoundingClientRect();
      st.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt,
        clientX:r.left+150+k*140, clientY:r.top+150+k*60}));
    });
  })()`);
  await sleep(1000);

  const 取位置 = async (i) => JSON.parse((await ev(`(() => {
    const w = document.querySelectorAll('.win')[${i}];
    const b = w.getBoundingClientRect();
    return JSON.stringify({x: Math.round(b.left+b.width/2),
                           y: Math.round(b.top+b.height/2)});
  })()`)).result.value);

  const P0 = await 取位置(0), P1 = await 取位置(1), P2 = await 取位置(2);
  console.log('三个组件位置:', JSON.stringify([P0,P1,P2]));
  console.log();

  console.log('=== 单选 ===');
  await 鼠标('mousePressed', P0.x, P0.y, 1);
  await 鼠标('mouseReleased', P0.x, P0.y, 1);
  await sleep(300);
  let r = await ev(`JSON.stringify({选中数: 选中数(), 主选: 主选})`);
  let d = JSON.parse(r.result.value);
  断言('单击选中 1 个', d.选中数 === 1, JSON.stringify(d));

  console.log('');
  console.log('=== Shift+点击 加选 ===');
  await 鼠标('mousePressed', P1.x, P1.y, 1, 8);   // Shift
  await 鼠标('mouseReleased', P1.x, P1.y, 1, 8);
  await sleep(300);
  r = await ev(`JSON.stringify({选中数: 选中数()})`);
  d = JSON.parse(r.result.value);
  断言('Shift+点击 后选中 2 个', d.选中数 === 2, JSON.stringify(d));

  console.log('');
  console.log('=== Shift+点击已选中 减选 ===');
  await 鼠标('mousePressed', P1.x, P1.y, 1, 8);
  await 鼠标('mouseReleased', P1.x, P1.y, 1, 8);
  await sleep(300);
  r = await ev(`JSON.stringify({选中数: 选中数()})`);
  d = JSON.parse(r.result.value);
  断言('再次 Shift+点击 减为 1 个', d.选中数 === 1, JSON.stringify(d));

  console.log('');
  console.log('=== Ctrl+A 全选 ===');
  await ev(`document.body.focus()`);
  await 键('a', 'KeyA', 2, 65);   // Ctrl
  await sleep(400);
  r = await ev(`JSON.stringify({选中数: 选中数(), 总数: 放置.length})`);
  d = JSON.parse(r.result.value);
  断言('Ctrl+A 全选', d.选中数 === d.总数, JSON.stringify(d));

  console.log('');
  console.log('=== Delete 删除 ===');
  await 键('Delete', 'Delete', 0, 46);
  await sleep(500);
  r = await ev(`JSON.stringify({剩余: 放置.length, 选中数: 选中数()})`);
  d = JSON.parse(r.result.value);
  断言('Delete 删除全部', d.剩余 === 0, JSON.stringify(d));
  断言('删除后清空选择', d.选中数 === 0, JSON.stringify(d));

  console.log('');
  console.log('=== Ctrl+Z 撤销 ===');
  await 键('z', 'KeyZ', 2, 90);
  await sleep(500);
  r = await ev(`JSON.stringify({恢复: 放置.length})`);
  d = JSON.parse(r.result.value);
  断言('Ctrl+Z 恢复组件', d.恢复 === 3, JSON.stringify(d));

  console.log('');
  console.log('=== Ctrl+Shift+Z 重做 ===');
  await 键('z', 'KeyZ', 10, 90);   // Ctrl+Shift
  await sleep(500);
  r = await ev(`JSON.stringify({重做后: 放置.length})`);
  d = JSON.parse(r.result.value);
  断言('Ctrl+Shift+Z 重做删除', d.重做后 === 0, JSON.stringify(d));

  // 撤销回来继续测
  await 键('z', 'KeyZ', 2, 90);
  await sleep(400);

  console.log('');
  console.log('=== Ctrl+C / Ctrl+V ===');
  await ev(`单选(放置[0].uid); 更新选中样式(); 渲染属性();`);
  await sleep(200);
  const 前数 = (await ev(`放置.length`)).result.value;
  await 键('c', 'KeyC', 2, 67);
  await sleep(300);
  await 键('v', 'KeyV', 2, 86);
  await sleep(500);
  r = await ev(`JSON.stringify({前: ${前数}, 后: 放置.length, 选中数: 选中数()})`);
  d = JSON.parse(r.result.value);
  断言('Ctrl+C/V 粘贴新增 1 个', d.后 === d.前 + 1, JSON.stringify(d));
  断言('粘贴后选中新组件', d.选中数 === 1, JSON.stringify(d));

  console.log('');
  console.log('=== Ctrl+D 原地复制 ===');
  const 前2 = (await ev(`放置.length`)).result.value;
  await 键('d', 'KeyD', 2, 68);
  await sleep(500);
  r = await ev(`JSON.stringify({前: ${前2}, 后: 放置.length})`);
  d = JSON.parse(r.result.value);
  断言('Ctrl+D 复制新增 1 个', d.后 === d.前 + 1, JSON.stringify(d));

  console.log('');
  console.log('=== Ctrl+X 剪切 ===');
  const 前3 = (await ev(`放置.length`)).result.value;
  await 键('x', 'KeyX', 2, 88);
  await sleep(500);
  r = await ev(`JSON.stringify({前: ${前3}, 后: 放置.length})`);
  d = JSON.parse(r.result.value);
  断言('Ctrl+X 剪切减少 1 个', d.后 === d.前 - 1, JSON.stringify(d));
  await 键('v', 'KeyV', 2, 86);
  await sleep(400);

  console.log('');
  console.log('=== 方向键微移 ===');
  await ev(`单选(放置[0].uid); 更新选中样式();`);
  const 位置前 = JSON.parse((await ev(
    `JSON.stringify({x:放置[0].x, y:放置[0].y})`)).result.value);
  await 键('ArrowRight', 'ArrowRight', 0, 39);
  await sleep(300);
  const 位置后 = JSON.parse((await ev(
    `JSON.stringify({x:放置[0].x, y:放置[0].y})`)).result.value);
  断言('方向键右移 1px', 位置后.x === 位置前.x + 1,
       JSON.stringify(位置前) + ' → ' + JSON.stringify(位置后));

  await 键('ArrowDown', 'ArrowDown', 8, 40);   // Shift
  await sleep(300);
  const 位置后2 = JSON.parse((await ev(
    `JSON.stringify({x:放置[0].x, y:放置[0].y})`)).result.value);
  断言('Shift+方向键下移 10px', 位置后2.y === 位置后.y + 10,
       JSON.stringify(位置后) + ' → ' + JSON.stringify(位置后2));

  console.log('');
  console.log('=== 框选 ===');
  await ev(`清空选择(); 更新选中样式();`);
  // 在画布左上角拖一个覆盖全部的大框
  const 画布框 = JSON.parse((await ev(`(() => {
    const b = document.getElementById('stage').getBoundingClientRect();
    return JSON.stringify({l:b.left, t:b.top, r:b.right, b:b.bottom});
  })()`)).result.value);
  await 鼠标('mousePressed', 画布框.l + 6, 画布框.t + 6, 1);
  await sleep(100);
  await 鼠标('mouseMoved', 画布框.l + 200, 画布框.t + 200, 0, 1);
  await sleep(80);
  await 鼠标('mouseMoved', 画布框.r - 6, 画布框.b - 6, 0, 1);
  await sleep(150);
  const 框选中 = JSON.parse((await ev(`JSON.stringify({
    选中数: 选中数(),
    框可见: getComputedStyle(document.getElementById('marquee')).display
  })`)).result.value);
  断言('框选进行中矩形可见', 框选中.框可见 === 'block', 框选中.框可见);
  断言('框选选中多个', 框选中.选中数 > 1, String(框选中.选中数));
  await 鼠标('mouseReleased', 画布框.r - 6, 画布框.b - 6, 1, 1);
  await sleep(400);
  const 框选中后 = JSON.parse((await ev(`JSON.stringify({
    选中数: 选中数(),
    框可见: getComputedStyle(document.getElementById('marquee')).display
  })`)).result.value);
  断言('松手后矩形隐藏', 框选中后.框可见 === 'none', 框选中后.框可见);

  console.log('');
  console.log('=== 右键菜单（组件）===');
  await ev(`单选(放置[0].uid); 更新选中样式();`);
  await send('Input.dispatchMouseEvent', {
    type:'mousePressed', x:P0.x, y:P0.y, button:'right', clickCount:1, buttons:2});
  await send('Input.dispatchMouseEvent', {
    type:'mouseReleased', x:P0.x, y:P0.y, button:'right', clickCount:1, buttons:0});
  await sleep(400);
  r = await ev(`JSON.stringify({
    可见: document.getElementById('ctxmenu').classList.contains('on'),
    项数: document.querySelectorAll('#ctxmenu .mi').length,
    首项: document.querySelector('#ctxmenu .mi span') ?
      document.querySelector('#ctxmenu .mi span').textContent : null
  })`);
  d = JSON.parse(r.result.value);
  断言('组件右键菜单弹出', d.可见 === true, JSON.stringify(d));
  断言('菜单有多个项目', d.项数 >= 6, String(d.项数));

  console.log('');
  console.log('=== 右键菜单（空白）===');
  await ev(`关闭菜单()`);
  await send('Input.dispatchMouseEvent', {
    type:'mousePressed', x:画布框.l+8, y:画布框.b-8, button:'right', clickCount:1, buttons:2});
  await send('Input.dispatchMouseEvent', {
    type:'mouseReleased', x:画布框.l+8, y:画布框.b-8, button:'right', clickCount:1, buttons:0});
  await sleep(400);
  r = await ev(`JSON.stringify({
    可见: document.getElementById('ctxmenu').classList.contains('on'),
    首项: document.querySelector('#ctxmenu .mi span') ?
      document.querySelector('#ctxmenu .mi span').textContent : null
  })`);
  d = JSON.parse(r.result.value);
  断言('空白右键菜单弹出', d.可见 === true, JSON.stringify(d));
  断言('空白菜单首项是粘贴', d.首项 === '粘贴', String(d.首项));

  console.log('');
  console.log('=== Ctrl+滚轮 缩放画布 ===');
  await ev(`关闭菜单()`);
  const 缩放前 = (await ev(`缩放`)).result.value;
  await send('Input.dispatchMouseEvent', {
    type:'mouseWheel', x:画布框.l+300, y:画布框.t+300,
    deltaX:0, deltaY:-120, modifiers:2});
  await sleep(400);
  const 缩放后 = (await ev(`缩放`)).result.value;
  断言('Ctrl+滚轮放大画布', 缩放后 > 缩放前,
       String(缩放前) + ' → ' + String(缩放后));

  console.log('');
  console.log('=== Ctrl+0 适应窗口 ===');
  await 键('0', 'Digit0', 2, 48);
  await sleep(400);
  const 适应后 = (await ev(`缩放`)).result.value;
  断言('Ctrl+0 恢复适应窗口', Math.abs(适应后 - 缩放前) < 0.02,
       String(缩放前) + ' → ' + String(适应后));

  console.log('');
  console.log('=== Ctrl+1 实际大小 ===');
  await 键('1', 'Digit1', 2, 49);
  await sleep(400);
  const 实际 = (await ev(`缩放`)).result.value;
  断言('Ctrl+1 设为 100%', Math.abs(实际 - 1) < 0.001, String(实际));

  console.log('');
  console.log('=== Tab 循环切换 ===');
  await ev(`适应窗口(); 单选(放置[0].uid); 更新选中样式();`);
  await sleep(300);
  const 主选前 = (await ev(`主选`)).result.value;
  await 键('Tab', 'Tab', 0, 9);
  await sleep(400);
  const 主选后 = (await ev(`主选`)).result.value;
  断言('Tab 切换到下一个', 主选后 !== 主选前,
       String(主选前) + ' → ' + String(主选后));

  console.log('');
  console.log('=== 页面错误 ===');
  断言('无 JS 错误', errs.length === 0, errs.slice(0,3).join(' | '));

  const shot = await send('Page.captureScreenshot', {format:'png'});
  writeFileSync(process.env.TEMP + '\\ux_final.png', Buffer.from(shot.data,'base64'));
  console.log('WROTE ux_final.png');

  console.log('');
  console.log('='.repeat(56));
  console.log('通过 ' + pass + ' / ' + (pass+fail));
} finally { child.kill(); }
process.exit(fail ? 1 : 0);
