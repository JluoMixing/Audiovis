// 端到端验证：拖拽后（松手）文字占比是否稳定
// 这是用户报告问题的直接复现：拖拽中正常，松手后变化。
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
const PORT = 9830;
const child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/e2e`,
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

  await ev(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain','text');
    const st = document.getElementById('stage');
    const r = st.getBoundingClientRect();
    st.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt,
      clientX:r.left+400, clientY:r.top+300}));
  })()`);
  await sleep(700);

  /* 测量组件画布上文字墨迹占框的比例。
     这是判断「文字是否合理填充框」的唯一可靠指标。 */
  async function 测墨迹占比(){
    const r = await ev(`(() => {
      const win = document.querySelector('.win');
      const cv = win.querySelector('canvas');
      const g = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      const d = g.getImageData(0, 0, W, H).data;
      let minX = W, maxX = -1, minY = H, maxY = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        // 与背景色比较（背景是主题 bg）
        if (Math.abs(d[i] - 230) > 25 || Math.abs(d[i+1] - 228) > 25 ||
            Math.abs(d[i+2] - 221) > 25) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
      const 墨W = maxX >= minX ? maxX - minX + 1 : 0;
      const 墨H = maxY >= minY ? maxY - minY + 1 : 0;
      return JSON.stringify({
        框: 放置[0].w + 'x' + 放置[0].h,
        字号: 文字实际字号(放置[0].样式),
        墨: 墨W + 'x' + 墨H,
        宽占比: Number((墨W / W).toFixed(3)),
        高占比: Number((墨H / H).toFixed(3)),
      });
    })()`);
    return JSON.parse(r.result.value);
  }

  console.log('=== 初始状态（自适应）===');
  let d = await 测墨迹占比();
  console.log('  ', JSON.stringify(d));
  断言('初始宽占比合理（0.5~1.1）', d.宽占比 > 0.5 && d.宽占比 < 1.1,
       String(d.宽占比));
  断言('初始高占比合理（0.3~1.1）', d.高占比 > 0.3 && d.高占比 < 1.1,
       String(d.高占比));

  /* 关键测试：拖拽放大后松手，占比应保持稳定 */
  console.log('');
  console.log('=== 拖拽放大（模拟真实操作：按下 → 拖动 → 松手）===');
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

  // 拖动过程中采样
  const 拖动中 = [];
  for (let i = 1; i <= 8; i++) {
    await ev(`window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,
      clientX:${屏起.x + i * 15}, clientY:${屏起.y + i * 15}}))`);
    await sleep(80);
    const s = await ev(`JSON.stringify({w:放置[0].w, h:放置[0].h, 字号:文字实际字号(放置[0].样式)})`);
    拖动中.push(JSON.parse(s.result.value));
  }
  console.log('  拖动中尺寸序列:');
  拖动中.forEach((x, i) => {
    console.log('    步%d: %dx%d 字号%d', i+1, x.w, x.h, x.字号);
  });

  await ev(`window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))`);
  await sleep(500);

  console.log('');
  console.log('=== 松手后 ===');
  d = await 测墨迹占比();
  console.log('  ', JSON.stringify(d));
  断言('放大后宽占比仍合理（0.5~1.1）', d.宽占比 > 0.5 && d.宽占比 < 1.1,
       String(d.宽占比));
  断言('放大后高占比仍合理（0.3~1.1）', d.高占比 > 0.3 && d.高占比 < 1.1,
       String(d.高占比));
  断言('放大后字号确实变大', d.字号 > 43, String(d.字号));

  /* 关键：拖拽中与松手后应当**一致**
     （用户报告：拖动中正常，松手后变化） */
  const 拖动末 = 拖动中[拖动中.length - 1];
  断言('松手后尺寸 = 拖动末尾尺寸',
       Math.abs(放置0_w(拖动末) - parseInt(d.框.split('x')[0])) <= 2,
       '拖动末 ' + 拖动末.w + ' vs 松手后 ' + d.框);

  console.log('');
  console.log('=== 再缩小 ===');
  const 屏起2 = JSON.parse((await ev(`(() => {
    const b = document.querySelector('.win').getBoundingClientRect();
    return JSON.stringify({x: b.right - 4, y: b.bottom - 4});
  })()`)).result.value);
  await ev(`(() => {
    const h = document.querySelector('.win .h.se');
    h.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,
      clientX: ${屏起2.x}, clientY: ${屏起2.y}}));
  })()`);
  await sleep(150);
  for (let i = 1; i <= 8; i++) {
    await ev(`window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,
      clientX:${屏起2.x - i * 12}, clientY:${屏起2.y - i * 12}}))`);
    await sleep(80);
  }
  await ev(`window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))`);
  await sleep(500);
  const d3 = await 测墨迹占比();
  console.log('  ', JSON.stringify(d3));
  断言('缩小后宽占比仍合理', d3.宽占比 > 0.5 && d3.宽占比 < 1.1, String(d3.宽占比));
  断言('缩小后高占比仍合理', d3.高占比 > 0.3 && d3.高占比 < 1.1, String(d3.高占比));

  console.log('');
  console.log('=== 页面错误 ===');
  断言('无 JS 错误', errs.length === 0, errs.slice(0,3).join(' | '));

  // 截图三种尺寸
  for (const [名字, 字号] of [['small', 30], ['mid', 60], ['big', 120]]) {
    await ev(`(() => {
      const p = 放置[0];
      p.样式.字号 = ${字号};
      自适应文字框(p);
      p.x = 100; p.y = 200;
      渲染画布();
    })()`);
    await sleep(700);
    const shot = await send('Page.captureScreenshot', {format:'png'});
    writeFileSync(process.env.TEMP + '\\e2e_' + 名字 + '.png',
                  Buffer.from(shot.data,'base64'));
    const dd = await 测墨迹占比();
    console.log('  字号 %d → %s  占比 %s / %s', 字号, dd.框, dd.宽占比, dd.高占比);
  }
  console.log('WROTE e2e_small/mid/big.png');

  console.log('');
  console.log('='.repeat(56));
  console.log('通过 ' + pass + ' / ' + (pass+fail));
} finally { child.kill(); }
process.exit(fail ? 1 : 0);

function 放置0_w(x){ return x.w; }
