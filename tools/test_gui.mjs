// 功能测试：验证交互真的能用（不只是加载成功）
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
const PORT = 9970;
const child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/guitest`,
  '--window-size=1600,1000',
  'file:///D:/FL_VISUAL_TEST/preview/gui_prototype.html'], { stdio:'ignore' });
const get = p => new Promise((res,rej)=>{ http.get({host:'127.0.0.1',port:PORT,path:p},r=>{
  let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }).on('error',rej); });

const sleep = ms => new Promise(r=>setTimeout(r,ms));

let pass=0, fail=0;
function 断言(name, cond, detail){
  if(cond){ pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail?'  → '+detail:'')); }
}

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
  const ev = expr => send('Runtime.evaluate',{expression:expr, returnByValue:true});
  await send('Page.enable');
  await send('Runtime.enable');

  // 收集页面错误
  const errs=[];
  ws.addEventListener('message', e=>{
    const m=JSON.parse(e.data);
    if(m.method==='Runtime.exceptionThrown'){
      errs.push(m.params.exceptionDetails.exception?.description?.split('\n')[0]||m.params.exceptionDetails.text);
    }
    if(m.method==='Runtime.consoleAPICalled' && m.params.type==='error'){
      errs.push('console.error: '+(m.params.args||[]).map(a=>a.value||'').join(' ').slice(0,120));
    }
  });

  await sleep(2500);

  console.log('=== 进入主界面 ===');
  /* btnDemo 已删除（任务1）。直接进入编辑器；
   多数测试随后会自己 套用模板 填充画布。 */
  await ev(`进入编辑器()`);
  await sleep(300);
  await ev(`document.getElementById('btnEnter').click()`);
  await sleep(1200);
  let r = await ev(`document.getElementById('app').classList.contains('active')`);
  断言('主界面已激活', r.result.value === true);

  console.log('');
  console.log('=== 模板库 ===');
  r = await ev(`document.querySelectorAll('.tplCard').length`);
  const 模板数 = r.result.value;
  断言('模板数量 ≥ 6', 模板数 >= 6, '实际 ' + 模板数);

  r = await ev(`document.querySelector('.tplCard .tn').textContent`);
  断言('首个模板是「空白」', r.result.value === '空白', '实际 ' + r.result.value);

  // 关键：模板之间必须有结构差异（用户报告「看不出差别」）
  r = await ev(`(() => {
    function 特征(布局){
      const 主 = 布局.reduce((a,b)=> (a.w*a.h > b.w*b.h ? a : b));
      const W=1920, H=1080;
      const cx = 布局.map(b=>(b.x+b.w/2)/W), cy = 布局.map(b=>(b.y+b.h/2)/H);
      return [布局.length,
              sum(布局.map(b=>b.w*b.h))/(W*H),
              主.w*主.h/(W*H), 主.w/W, 主.h/H,
              Math.max(...cx)-Math.min(...cx),
              Math.max(...cy)-Math.min(...cy)];
    }
    function sum(a){ return a.reduce((x,y)=>x+y,0); }
    const 表 = TEMPLATES.filter(t=>t.land.length).map(t=>({
      名: t.name, f: 特征(t.land)
    }));
    let 最小 = 1e9, 对 = '';
    for(let i=0;i<表.length;i++) for(let j=i+1;j<表.length;j++){
      let d=0;
      for(let k=0;k<表[i].f.length;k++) d += Math.pow(表[i].f[k]-表[j].f[k],2);
      d = Math.sqrt(d);
      if(d<最小){ 最小=d; 对 = 表[i].名+' ↔ '+表[j].名; }
    }
    return JSON.stringify({最小: Number(最小.toFixed(4)), 对: 对, 模板数: 表.length});
  })()`);
  const 差异 = JSON.parse(r.result.value);
  断言('模板结构差异度 ≥ 0.25（最相似：' + 差异.对 + '）',
       差异.最小 >= 0.25, '最小差异 ' + 差异.最小);

  // 套用「经典」模板（第 2 个）
  await ev(`document.querySelectorAll('.tplCard')[1].click()`);
  await sleep(1000);
  r = await ev(`document.querySelectorAll('.win').length`);
  const 模板组件数 = r.result.value;
  断言('套用模板后组件已放置', 模板组件数 > 0, '实际 ' + 模板组件数);

  r = await ev(`放置.length`);
  断言('状态中组件数一致', r.result.value === 模板组件数,
       'state=' + r.result.value + ' dom=' + 模板组件数);

  console.log('');
  console.log('=== 关键：模板组件可选中（用户报告的 bug）===');
  r = await ev(`document.querySelectorAll('.win')[0].dataset.uid`);
  const uid0 = r.result.value;
  断言('DOM 有 uid', uid0 !== undefined && uid0 !== 'undefined' && uid0 !== '',
       '实际 ' + JSON.stringify(uid0));

  await ev(`document.querySelectorAll('.win')[0].dispatchEvent(
    new MouseEvent('mousedown',{bubbles:true,clientX:400,clientY:300}))`);
  await sleep(400);
  r = await ev(`选中`);
  断言('点击后已选中', r.result.value !== null, '选中=' + r.result.value);

  r = await ev(`document.getElementById('propBadge').textContent`);
  断言('属性栏显示组件名', r.result.value !== '未选中', '实际 ' + r.result.value);

  r = await ev(`document.getElementById('propForm').style.display`);
  断言('属性表单已显示', r.result.value === 'block', '实际 ' + r.result.value);

  console.log('');
  console.log('=== 取消选中后可再次选中 ===');
  await ev(`document.getElementById('stage').dispatchEvent(
    new MouseEvent('mousedown',{bubbles:true,clientX:10,clientY:10}))`);
  await sleep(300);
  r = await ev(`选中`);
  断言('点空白处取消选中', r.result.value === null, '选中=' + r.result.value);

  await ev(`document.querySelectorAll('.win')[0].dispatchEvent(
    new MouseEvent('mousedown',{bubbles:true,clientX:400,clientY:300}))`);
  await sleep(400);
  r = await ev(`选中`);
  断言('可再次选中', r.result.value !== null, '选中=' + r.result.value);

  console.log('');
  console.log('=== 鼠标拖动改变位置 ===');
  const before = await ev(`JSON.stringify(放置.find(p=>p.uid===选中))`);
  const p0 = JSON.parse(before.result.value);
  // 模拟拖动
  await ev(`window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:500,clientY:400}))`);
  await sleep(200);
  await ev(`window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))`);
  await sleep(500);
  const after = await ev(`JSON.stringify(放置.find(p=>p.uid===选中))`);
  const p1 = JSON.parse(after.result.value);
  断言('拖动后位置已改变', p1.x !== p0.x || p1.y !== p0.y,
       'before=(' + p0.x + ',' + p0.y + ') after=(' + p1.x + ',' + p1.y + ')');

  console.log('');
  console.log('=== 空白模板清空 ===');
  await ev(`document.querySelectorAll('.tplCard')[0].click()`);
  await sleep(800);
  r = await ev(`document.querySelectorAll('.win').length`);
  断言('空白模板已清空画布', r.result.value === 0, '实际 ' + r.result.value);
  r = await ev(`document.getElementById('emptyHint').style.display`);
  断言('空提示已显示', r.result.value === 'flex', '实际 ' + r.result.value);

  console.log('');
  console.log('=== 拖拽添加组件 ===');
  await ev(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain','spectrum');
    const st = document.getElementById('stage');
    const r = st.getBoundingClientRect();
    st.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt,
      clientX:r.left+300, clientY:r.top+200}));
  })()`);
  await sleep(700);
  r = await ev(`放置.length`);
  断言('拖拽后已添加组件', r.result.value === 1, '实际 ' + r.result.value);
  r = await ev(`放置[0].id`);
  断言('添加的是 spectrum', r.result.value === 'spectrum', '实际 ' + r.result.value);

  console.log('');
  console.log('=== 主题切换重绘组件 ===');
  await ev(`document.querySelectorAll('.themeCard')[1].click()`);   // 墨·紙
  await sleep(800);
  r = await ev(`主题键`);
  断言('主题已切换', r.result.value === 'sumi', '实际 ' + r.result.value);
  r = await ev(`document.querySelectorAll('.win canvas').length`);
  断言('组件已重绘（canvas 存在）', r.result.value === 1, '实际 ' + r.result.value);

  console.log('');
  console.log('=== 组件画面静态（连续两次渲染像素一致）===');
  r = await ev(`(() => {
    function snap(){
      const cv = document.querySelector('.win canvas');
      const g = cv.getContext('2d');
      const d = g.getImageData(0,0,cv.width,cv.height).data;
      let h = 2166136261;
      for (let i=0;i<d.length;i+=16){ h ^= d[i]; h = Math.imul(h,16777619); }
      return h>>>0;
    }
    const a = snap();
    渲染画布();
    const b = snap();
    return JSON.stringify({a:a,b:b});
  })()`);
  const snap = JSON.parse(r.result.value);
  断言('两次渲染像素一致（无随机闪烁）', snap.a === snap.b,
       snap.a + ' vs ' + snap.b);

  console.log('');
  console.log('=== 页面错误 ===');
  断言('无 JS 错误', errs.length === 0, errs.slice(0,3).join(' | '));

  console.log('');
  console.log('='.repeat(56));
  console.log('通过 ' + pass + ' / ' + (pass+fail));
  if(fail) console.log('失败 ' + fail + ' 项');

} finally { child.kill(); }
process.exit(fail ? 1 : 0);
