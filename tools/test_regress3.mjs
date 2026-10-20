// 回归测试：用户报告的三个 bug
//   1. 框选松手后选中丢失
//   2. 放大后无法滚动到画布上部
//   3. 切换方向后模板不重新套用
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
const PORT = 9920;
const child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/regress`,
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

  // ---------------------------------------------------------------
  console.log('=== Bug 1：框选松手后选中应保持 ===');
  // ---------------------------------------------------------------
  await ev(`套用模板(TEMPLATES[1])`);      // 母带（3 组件 + 4 文字）
  await sleep(900);

  /* 用 stage 的矩形，而非 canvasWrap ——
     stage 外是留白区，mousedown 不会触发框选。 */
  const 框 = JSON.parse((await ev(`(() => {
    const b = document.getElementById('stage').getBoundingClientRect();
    return JSON.stringify({l:b.left, t:b.top, r:b.right, b:b.bottom});
  })()`)).result.value);

  // 从画布内部左上拖到右下（覆盖全部组件）
  await 鼠标('mousePressed', 框.l + 40, 框.t + 40, 1);
  await sleep(80);
  await 鼠标('mouseMoved', 框.l + 200, 框.t + 200, 0, 1);
  await sleep(60);
  await 鼠标('mouseMoved', 框.r - 40, 框.b - 40, 0, 1);
  await sleep(120);
  const 拖动中 = JSON.parse((await ev(`JSON.stringify({
    选中数: 选中数(), 移动过: 框选 ? !!框选.移动过 : null })`)).result.value);
  await 鼠标('mouseReleased', 框.r - 40, 框.b - 40, 1, 1);
  await sleep(400);
  const 松手后 = JSON.parse((await ev(`JSON.stringify({
    选中数: 选中数(), 主选: 主选, 总数: 放置.length })`)).result.value);

  console.log('   拖动中: ' + JSON.stringify(拖动中));
  console.log('   松手后: ' + JSON.stringify(松手后));
  断言('拖动中已标记 移动过', 拖动中.移动过 === true, String(拖动中.移动过));
  断言('拖动中选中了全部', 拖动中.选中数 === 松手后.总数,
       '选中 ' + 拖动中.选中数 + ' / 总 ' + 松手后.总数);
  断言('松手后仍保持选中', 松手后.选中数 === 松手后.总数,
       '选中 ' + 松手后.选中数 + ' / 总 ' + 松手后.总数);

  // 松手后 Del 应能删除
  await send('Input.dispatchKeyEvent', {type:'keyDown', key:'Delete',
    code:'Delete', windowsVirtualKeyCode:46});
  await send('Input.dispatchKeyEvent', {type:'keyUp', key:'Delete',
    code:'Delete', windowsVirtualKeyCode:46});
  await sleep(500);
  const 删除后 = JSON.parse((await ev(
    `JSON.stringify({剩余: 放置.length})`)).result.value);
  断言('松手后 Del 可删除全部', 删除后.剩余 === 0, String(删除后.剩余));

  // 单纯点空白（不拖动）仍应取消选择
  await ev(`套用模板(TEMPLATES[1])`);
  await sleep(800);
  await ev(`全选(); 更新选中样式();`);
  await sleep(200);
  await 鼠标('mousePressed', 框.l + 30, 框.b - 30, 1);
  await 鼠标('mouseReleased', 框.l + 30, 框.b - 30, 1);
  await sleep(350);
  const 点空白 = JSON.parse((await ev(`JSON.stringify({选中数: 选中数()})`)).result.value);
  断言('单纯点空白仍取消选择', 点空白.选中数 === 0, String(点空白.选中数));

  // ---------------------------------------------------------------
  console.log('');
  console.log('=== Bug 2：放大后可滚动到画布上部/左侧 ===');
  // ---------------------------------------------------------------
  await ev(`适应窗口()`);
  await sleep(300);
  const 初始 = JSON.parse((await ev(`(() => {
    const w = document.getElementById('canvasWrap');
    return JSON.stringify({缩放: 缩放, 可滚w: w.scrollWidth, 可滚h: w.scrollHeight,
      视口w: w.clientWidth, 视口h: w.clientHeight});
  })()`)).result.value);
  console.log('   适应窗口: ' + JSON.stringify(初始));

  // 放大到 200%
  await ev(`缩放 = 2; 应用缩放();`);
  await sleep(400);
  const 放大 = JSON.parse((await ev(`(() => {
    const w = document.getElementById('canvasWrap');
    return JSON.stringify({
      缩放: 缩放,
      可滚w: w.scrollWidth, 可滚h: w.scrollHeight,
      视口w: w.clientWidth, 视口h: w.clientHeight,
      期望可滚h: Math.round(画布.h * 缩放 + 52),
      期望可滚w: Math.round(画布.w * 缩放 + 52),
    });
  })()`)).result.value);
  console.log('   放大到 200%: ' + JSON.stringify(放大));

  const 高度够 = 放大.可滚h >= 放大.期望可滚h - 3;
  const 宽度够 = 放大.可滚w >= 放大.期望可滚w - 3;
  断言('滚动区高度 = 缩放后画布高 + 内边距', 高度够,
       '可滚 ' + 放大.可滚h + ' vs 期望 ' + 放大.期望可滚h);
  断言('滚动区宽度 = 缩放后画布宽 + 内边距', 宽度够,
       '可滚 ' + 放大.可滚w + ' vs 期望 ' + 放大.期望可滚w);

  // 关键：滚到最顶/最左，画布左上角应可见
  const 顶点 = JSON.parse((await ev(`(() => {
    const w = document.getElementById('canvasWrap');
    w.scrollTop = 0; w.scrollLeft = 0;
    const st = document.getElementById('stage').getBoundingClientRect();
    const wb = w.getBoundingClientRect();
    return JSON.stringify({
      scrollTop: w.scrollTop, scrollLeft: w.scrollLeft,
      画布左上相对视口: Math.round(st.left - wb.left) + ',' +
                        Math.round(st.top - wb.top),
      画布左上可见: st.left >= wb.left - 1 && st.top >= wb.top - 1,
    });
  })()`)).result.value);
  console.log('   滚到原点: ' + JSON.stringify(顶点));
  断言('滚到原点后画布左上角可见（未被裁掉）', 顶点.画布左上可见 === true,
       JSON.stringify(顶点));

  // 滚到底部应能看到画布下边缘
  const 底点 = JSON.parse((await ev(`(() => {
    const w = document.getElementById('canvasWrap');
    w.scrollTop = w.scrollHeight;
    const st = document.getElementById('stage').getBoundingClientRect();
    const wb = w.getBoundingClientRect();
    return JSON.stringify({
      scrollTop: w.scrollTop,
      画布下边超出视口: Math.round(st.bottom - wb.bottom),
    });
  })()`)).result.value);
  console.log('   滚到底部: ' + JSON.stringify(底点));
  断言('可滚到画布下边缘（下边不高于视口底 30px 以上）',
       底点.画布下边超出视口 <= 30, JSON.stringify(底点));

  // ---------------------------------------------------------------
  console.log('');
  console.log('=== Bug 3：切换方向后模板重新套用 ===');
  // ---------------------------------------------------------------
  await ev(`适应窗口(); 主题键 = 'sumi'; 渲染主题(); 套用模板(TEMPLATES[1]); 渲染画布();`);
  await sleep(900);
  const 横 = JSON.parse((await ev(`JSON.stringify({
    方向: 方向, 画布: 画布.w + 'x' + 画布.h,
    当前模板: 当前模板, 总数: 放置.length,
    越界: 放置.filter(p => p.x + p.w > 画布.w + 2 || p.y + p.h > 画布.h + 2).length,
    文字旋转: 放置.filter(p => p.id === 'text').map(p => p.样式.旋转 || 0),
  })`)).result.value);
  console.log('   横屏: ' + JSON.stringify(横));

  // 点「竖屏」按钮
  await ev(`(() => {
    const b = [...document.getElementById('segOrient').children]
      .find(x => x.dataset.o === 'port');
    b.click();
  })()`);
  await sleep(1100);
  const 竖 = JSON.parse((await ev(`JSON.stringify({
    方向: 方向, 画布: 画布.w + 'x' + 画布.h,
    当前模板: 当前模板, 总数: 放置.length,
    越界: 放置.filter(p => p.x + p.w > 画布.w + 2 || p.y + p.h > 画布.h + 2).length,
    组件越界: 放置.filter(p => p.id !== 'text' &&
      (p.x + p.w > 画布.w + 2 || p.y + p.h > 画布.h + 2)).length,
  })`)).result.value);
  console.log('   竖屏: ' + JSON.stringify(竖));

  断言('方向已切到竖屏', 竖.方向 === 'port', 竖.方向);
  断言('画布尺寸已换', 竖.画布 === '1080x1920', 竖.画布);
  断言('模板仍为同一模板', 竖.当前模板 === 横.当前模板, String(竖.当前模板));
  断言('组件不越界（竖屏布局已套用）', 竖.组件越界 === 0,
       '越界 ' + 竖.组件越界);
  断言('组件数非零', 竖.总数 > 0, String(竖.总数));

  // 切回横屏
  await ev(`(() => {
    const b = [...document.getElementById('segOrient').children]
      .find(x => x.dataset.o === 'land');
    b.click();
  })()`);
  await sleep(1100);
  const 回横 = JSON.parse((await ev(`JSON.stringify({
    方向: 方向, 画布: 画布.w + 'x' + 画布.h,
    组件越界: 放置.filter(p => p.id !== 'text' &&
      (p.x + p.w > 画布.w + 2 || p.y + p.h > 画布.h + 2)).length,
  })`)).result.value);
  断言('切回横屏布局正确', 回横.方向 === 'land' && 回横.组件越界 === 0,
       JSON.stringify(回横));

  // 所有模板都测一遍方向切换
  console.log('');
  console.log('   全部模板方向切换检查：');
  let 全部OK = true;
  /* 上界用实际模板数，别写死 —— 模板数会变（初版写死 7，加过一次模板后就崩） */
  const 模板数 = (await ev(`TEMPLATES.length`)).result.value;
  for (let i = 1; i < 模板数; i++) {
    await ev(`方向 = 'land'; 画布 = {w:1920,h:1080};
              套用模板(TEMPLATES[${i}]); 渲染画布();`);
    await sleep(700);
    await ev(`(() => {
      const b = [...document.getElementById('segOrient').children]
        .find(x => x.dataset.o === 'port');
      b.click();
    })()`);
    await sleep(950);
    const d = JSON.parse((await ev(`JSON.stringify({
      名: TEMPLATES[${i}].name,
      越界: 放置.filter(p => p.id !== 'text' &&
        (p.x + p.w > 画布.w + 2 || p.y + p.h > 画布.h + 2)).length,
      总数: 放置.length,
    })`)).result.value);
    const ok = d.越界 === 0 && d.总数 > 0;
    if (!ok) 全部OK = false;
    console.log('     ' + (ok ? '✓' : '✗') + ' ' + d.名.padEnd(8) +
                ' 竖屏组件 ' + d.总数 + ' · 越界 ' + d.越界);
  }
  断言('所有模板切竖屏后都不越界', 全部OK);

  console.log('');
  console.log('=== 页面错误 ===');
  断言('无 JS 错误', errs.length === 0, errs.slice(0,3).join(' | '));

  await ev(`方向 = 'land'; 画布 = {w:1920,h:1080};
            适应窗口(); 套用模板(TEMPLATES[2]); 渲染画布();`);
  await sleep(900);
  const shot = await send('Page.captureScreenshot', {format:'png'});
  writeFileSync(process.env.TEMP + '\\fix3.png', Buffer.from(shot.data,'base64'));
  console.log('WROTE fix3.png');

  console.log('');
  console.log('='.repeat(56));
  console.log('通过 ' + pass + ' / ' + (pass+fail));
} finally { child.kill(); }
process.exit(fail ? 1 : 0);
