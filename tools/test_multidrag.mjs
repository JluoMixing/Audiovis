// 验证：多选拖拽时其余组件应实时跟随（而非松手后才跳）
import { spawn } from 'node:child_process';
import http from 'node:http';


/* 测试用临时目录：放项目内（D 盘），避免累积撑满系统盘。
   实测：用 process.env.TEMP 时 125 次运行留下 3.77 GB profile，
   C 盘被撑到 0 字节可用，后续所有写操作 ENOSPC。 */
import { mkdirSync as _mkdir } from 'node:fs';
const TMP = 'D:/FL_VISUAL_TEST/.testtmp';
try { _mkdir(TMP, { recursive: true }); } catch (e) {}

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const PORT = 9930;
const child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/multidrag`,
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
    buttons: type === 'mousePressed' ? 1 : 0, modifiers: mods || 0,
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
  await ev(`套用模板(TEMPLATES[1])`);     // 基础
  await sleep(1000);

  console.log('=== 准备：全选所有组件 ===');
  await ev(`全选(); 更新选中样式(); 渲染属性();`);
  await sleep(300);
  const 初始 = JSON.parse((await ev(`JSON.stringify(
    放置.map(p => ({uid:p.uid, x:p.x, y:p.y})))`)).result.value);
  console.log('   ' + JSON.stringify(初始));
  断言('已选中全部组件', 初始.length >= 4, String(初始.length));
  断言('坐标都是整数', 初始.every(p => Number.isInteger(p.x) &&
       Number.isInteger(p.y)),
       JSON.stringify(初始.filter(p => !Number.isInteger(p.x) ||
         !Number.isInteger(p.y))));

  // 取第一个组件的中心屏幕坐标
  const 起 = JSON.parse((await ev(`(() => {
    const el = document.querySelector('.win[data-uid="' + 放置[0].uid + '"]');
    const b = el.getBoundingClientRect();
    return JSON.stringify({x: Math.round(b.left + b.width/2),
                           y: Math.round(b.top + b.height/2)});
  })()`)).result.value);

  console.log('');
  console.log('=== 拖动 120px，逐步检查 DOM 位置 ===');
  await 鼠标('mousePressed', 起.x, 起.y, 1);
  await sleep(120);

  const 拖动记录 = [];
  for (let i = 1; i <= 6; i++) {
    await 鼠标('mouseMoved', 起.x + i * 20, 起.y + i * 20, 0, 0);
    await sleep(90);
    /* 同时读「数据位置」与「DOM 位置」——
       两者不一致就是用户看到的 bug（数据动了、画面没动） */
    const r = await ev(`(() => {
      const 结果 = [];
      放置.forEach(function (p) {
        const el = stage.querySelector('.win[data-uid="' + p.uid + '"]');
        结果.push({
          uid: p.uid,
          数据: p.x + ',' + p.y,
          DOM: el ? (parseInt(el.style.left) + ',' +
                     parseInt(el.style.top)) : '无',
        });
      });
      return JSON.stringify(结果);
    })()`);
    拖动记录.push(JSON.parse(r.result.value));
  }

  console.log('   步 | ' + 拖动记录[0].map(x => ('#' + x.uid).padEnd(13)).join(' '));
  拖动记录.forEach((rec, i) => {
    console.log('   ' + (i+1) + '  | ' +
      rec.map(x => (x.数据 === x.DOM ? '✓ ' : '✗ ') + x.数据.padEnd(11)).join(' '));
  });

  const 末 = 拖动记录[拖动记录.length - 1];
  const 一致 = 末.every(x => x.数据 === x.DOM);
  const 整数 = 末.every(x => /^-?\d+,-?\d+$/.test(x.数据));
  断言('拖动中坐标保持整数', 整数,
       JSON.stringify(末.filter(x => !/^-?\d+,-?\d+$/.test(x.数据))));
  断言('拖动中所有组件的 DOM 位置 = 数据位置', 一致,
       JSON.stringify(末.filter(x => x.数据 !== x.DOM)));

  // 检查是否真的都移动了
  const 末数据 = JSON.parse((await ev(`JSON.stringify(
    放置.map(p => ({uid:p.uid, x:p.x, y:p.y})))`)).result.value);
  const 位移 = 末数据.map((p, i) => ({
    uid: p.uid, dx: p.x - 初始[i].x, dy: p.y - 初始[i].y }));
  console.log('');
  console.log('   各组件位移: ' + JSON.stringify(位移));
  const 都动了 = 位移.every(d => d.dx !== 0 || d.dy !== 0);
  const 位移一致 = 位移.every(d => d.dx === 位移[0].dx && d.dy === 位移[0].dy);
  断言('所有组件都移动了', 都动了,
       JSON.stringify(位移.filter(d => d.dx === 0 && d.dy === 0)));
  断言('所有组件位移相同', 位移一致, JSON.stringify(位移));

  await 鼠标('mouseReleased', 起.x + 120, 起.y + 120, 1, 0);
  await sleep(400);
  const 松手 = JSON.parse((await ev(`JSON.stringify(
    放置.map(p => ({uid:p.uid, x:p.x, y:p.y})))`)).result.value);
  const 未跳 = 松手.every((p, i) => p.x === 末数据[i].x && p.y === 末数据[i].y);
  断言('松手后位置不变（拖动中已到位）', 未跳,
       JSON.stringify({松手: 松手, 拖动末: 末数据}));

  console.log('');
  console.log('=== 单选拖拽仍应只动一个 ===');
  await ev(`单选(放置[0].uid); 更新选中样式();`);
  await sleep(250);
  const 前 = JSON.parse((await ev(`JSON.stringify(
    放置.map(p => ({uid:p.uid, x:p.x, y:p.y})))`)).result.value);
  const 起2 = JSON.parse((await ev(`(() => {
    const el = document.querySelector('.win[data-uid="' + 放置[0].uid + '"]');
    const b = el.getBoundingClientRect();
    return JSON.stringify({x: Math.round(b.left + b.width/2),
                           y: Math.round(b.top + b.height/2)});
  })()`)).result.value);
  await 鼠标('mousePressed', 起2.x, 起2.y, 1);
  await sleep(100);
  await 鼠标('mouseMoved', 起2.x + 60, 起2.y + 40, 0, 0);
  await sleep(150);
  await 鼠标('mouseReleased', 起2.x + 60, 起2.y + 40, 1, 0);
  await sleep(350);
  const 后 = JSON.parse((await ev(`JSON.stringify(
    放置.map(p => ({uid:p.uid, x:p.x, y:p.y})))`)).result.value);
  const 动了 = 后.filter((p, i) => p.x !== 前[i].x || p.y !== 前[i].y);
  console.log('   移动的组件: ' + 动了.length + ' 个');
  断言('单选拖拽只动 1 个', 动了.length === 1, String(动了.length));

  console.log('');
  console.log('=== 页面错误 ===');
  断言('无 JS 错误', errs.length === 0, errs.slice(0,3).join(' | '));

  console.log('');
  console.log('='.repeat(56));
  console.log('通过 ' + pass + ' / ' + (pass+fail));
} finally { child.kill(); }
process.exit(fail ? 1 : 0);
