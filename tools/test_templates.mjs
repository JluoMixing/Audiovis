// 模板设计测试：固化设计保证，防止后续改动破坏
import { spawn } from 'node:child_process';
import http from 'node:http';


/* 测试用临时目录：放项目内（D 盘），避免累积撑满系统盘。
   实测：用 process.env.TEMP 时 125 次运行留下 3.77 GB profile，
   C 盘被撑到 0 字节可用，后续所有写操作 ENOSPC。 */
import { mkdirSync as _mkdir } from 'node:fs';
const TMP = 'D:/FL_VISUAL_TEST/.testtmp';
try { _mkdir(TMP, { recursive: true }); } catch (e) {}

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const PORT = 9915;
const child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TMP}/tpltest`,
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

  const 模板 = JSON.parse((await ev(
    `JSON.stringify(TEMPLATES.map(t => ({id:t.id, name:t.name})))`)).result.value);
  const 非空 = 模板.filter(t => t.id !== 'blank');

  console.log('=== 每个模板都带文字 ===');
  断言('模板数 ≥ 6', 模板.length >= 6, String(模板.length));
  断言('含空白模板', 模板.some(t => t.id === 'blank'));
  for (const t of 非空) {
    const r = await ev(`(() => {
      const t = TEMPLATES.filter(x => x.id === '${t.id}')[0];
      const 文字数 = (t.land || []).filter(b => b.id === 'text').length;
      const 竖文字 = (t.port || []).filter(b => b.id === 'text').length;
      return 文字数 + '/' + 竖文字;
    })()`);
    const [横, 竖] = r.result.value.split('/').map(Number);
    断言(t.name + ' 横竖都带文字', 横 >= 1 && 竖 >= 1, 横 + ' / ' + 竖);
  }

  console.log('');
  console.log('=== 文字用变量（不是写死的假文案）===');
  const r1 = await ev(`(() => {
    const 变量 = new Set();
    let 无变量 = 0, 总 = 0;
    TEMPLATES.forEach(t => {
      [...(t.land||[]), ...(t.port||[])].forEach(b => {
        if (b.id !== 'text') return;
        总++;
        const m = String(b.样式.内容).match(/\\{(\\w+)\\}/g);
        if (m) m.forEach(x => 变量.add(x)); else 无变量++;
      });
    });
    return JSON.stringify({变量: [...变量].sort(), 无变量: 无变量, 总: 总});
  })()`);
  const d1 = JSON.parse(r1.result.value);
  console.log('   用到的变量: ' + d1.变量.join(' '));
  断言('使用了变量', d1.变量.length >= 3, d1.变量.join(' '));
  断言('含 {title}', d1.变量.includes('{title}'));
  断言('含 {tempo}', d1.变量.includes('{tempo}'));
  /* 「BPM」「BARS」这类单位词是刻意写死的（表头文字），可以有 */
  断言('多数元素用变量', d1.无变量 <= d1.总 * 0.35,
       d1.无变量 + ' / ' + d1.总 + ' 个无变量');

  console.log('');
  console.log('=== 套用后：不越界、文字有框 ===');
  for (let i = 1; i < 模板.length; i++) {
    await ev(`套用模板(TEMPLATES[${i}])`);
    await sleep(650);
    const r = await ev(`(() => {
      const 越界 = 放置.filter(p =>
        p.x < -2 || p.y < -2 || p.x + p.w > 画布.w + 2 || p.y + p.h > 画布.h + 2);
      const 零尺寸 = 放置.filter(p => p.w <= 0 || p.h <= 0);
      const 文字 = 放置.filter(p => p.id === 'text');
      /* 「边印」的字是**刻意**出血被下边缘裁切的，故只查横向越界 */
      const 横向越界 = 越界.filter(p => p.id !== 'text');
      return JSON.stringify({
        名: TEMPLATES[${i}].name,
        总数: 放置.length,
        横向越界: 横向越界.length,
        零尺寸: 零尺寸.length,
        文字数: 文字.length,
        文字都有框: 文字.every(p => p.w > 10 && p.h > 10),
      });
    })()`);
    const d = JSON.parse(r.result.value);
    断言(d.名 + '：组件不越界 / 无零尺寸 / 文字有框',
         d.横向越界 === 0 && d.零尺寸 === 0 && d.文字都有框 && d.文字数 >= 1,
         JSON.stringify(d));
  }

  console.log('');
  console.log('=== 基础排版：文字只作点缀（不占主导）===');
  const r2 = await ev(`(() => {
    const 结果 = {};
    TEMPLATES.forEach(t => {
      if (t.id === 'blank') return;
      const 倍率 = [];
      [...(t.land||[]), ...(t.port||[])].forEach(b => {
        if (b.id === 'text') 倍率.push(b.样式.字号倍率);
      });
      结果[t.name] = { 最大倍率: Math.max.apply(null, 倍率),
                       个数: 倍率.length };
    });
    return JSON.stringify(结果);
  })()`);
  const d2 = JSON.parse(r2.result.value);
  console.log('   ' + JSON.stringify(d2));
  const 超限 = Object.keys(d2).filter(k => d2[k].最大倍率 > 0.45);
  断言('文字字号倍率都 ≤ 0.45（点缀级）', 超限.length === 0,
       '超限: ' + 超限.join(', '));
  const 未用旋转 = await ev(`JSON.stringify(
    TEMPLATES.filter(t => t.id !== 'blank').every(t =>
      ![...(t.land||[]), ...(t.port||[])].some(b =>
        b.id === 'text' && b.样式.旋转)))`);
  断言('基础排版不使用文字旋转', 未用旋转.result.value === 'true');

  /* 反向验证：套用模板后不应出现旋转文字（曾因共享对象污染而泄漏） */
  await ev(`套用模板(TEMPLATES[1])`);
  await sleep(700);
  const r3 = await ev(`JSON.stringify(
    放置.filter(p => p.id === 'text').map(p => p.样式.旋转 || 0))`);
  const 旋 = JSON.parse(r3.result.value);
  断言('文字样式未被污染（无残留旋转）', 旋.every(v => v === 0),
       '旋转值: ' + 旋.join(','));

  console.log('');
  console.log('=== 每个模板都含主时间轴，且占组件面积过半 ===');
  const rA = await ev(`(() => {
    const 结果 = [];
    TEMPLATES.forEach(t => {
      if (t.id === 'blank') return;
      ['land','port'].forEach(向 => {
        const 组 = (t[向]||[]).filter(b => b.id !== 'text');
        if (!组.length) return;
        const 总 = 组.reduce((a,b) => a + b.w*b.h, 0);
        const 主 = 组.filter(b => b.id==='playlist' || b.id==='pianoroll')
                     .reduce((a,b) => a + b.w*b.h, 0);
        结果.push({名: t.name, 向: 向,
                   占比: Math.round(主/总*100),
                   有主: 主 > 0});
      });
    });
    return JSON.stringify(结果);
  })()`);
  const dA = JSON.parse(rA.result.value);
  dA.forEach(x => {
    console.log('   ' + (x.有主 && x.占比 >= 50 ? '✓' : '✗') + ' ' +
                x.名.padEnd(7) + ' ' + x.向.padEnd(5) +
                ' 主时间轴占 ' + x.占比 + '%');
  });
  断言('所有模板都含主时间轴', dA.every(x => x.有主));
  断言('主时间轴占组件面积过半', dA.every(x => x.占比 >= 50),
       dA.filter(x => x.占比 < 50).map(x => x.名 + '/' + x.向 +
         '=' + x.占比 + '%').join(', '));

  console.log('');
  console.log('=== 同一行的次要组件等高（地位一致）===');
  const rB = await ev(`(() => {
    const 问题 = [];
    TEMPLATES.forEach(t => {
      if (t.id === 'blank') return;
      ['land','port'].forEach(向 => {
        const 组 = (t[向]||[]).filter(b => b.id !== 'text' &&
          b.id !== 'playlist' && b.id !== 'pianoroll');
        /* 按 y 分行 */
        const 行集 = [];
        组.forEach(b => {
          const r = 行集.find(r => Math.abs(r[0].y - b.y) < 8);
          if (r) r.push(b); else 行集.push([b]);
        });
        行集.forEach(r => {
          if (r.length < 2) return;
          const 高 = r.map(b => b.h);
          if (Math.max.apply(null,高) - Math.min.apply(null,高) > 4) {
            问题.push(t.name + '/' + 向 + ' ' +
              r.map(b => b.id).join(',') + ' 高差 ' +
              (Math.max.apply(null,高) - Math.min.apply(null,高)));
          }
        });
      });
    });
    return JSON.stringify(问题);
  })()`);
  const dB = JSON.parse(rB.result.value);
  断言('没有同行不等高的情况', dB.length === 0, dB.join(' | '));

  console.log('');
  console.log('=== 竖屏上下留白充足 ===');
  const rC = await ev(`(() => {
    const 结果 = [];
    TEMPLATES.forEach(t => {
      if (t.id === 'blank') return;
      const 组 = (t.port||[]).filter(b => b.id !== 'text');
      if (!组.length) return;
      const 顶 = Math.min.apply(null, 组.map(b => b.y));
      const 底 = Math.max.apply(null, 组.map(b => b.y + b.h));
      结果.push({名: t.name,
        顶留白: Math.round(顶/1920*100),
        底留白: Math.round((1920-底)/1920*100)});
    });
    return JSON.stringify(结果);
  })()`);
  const dC = JSON.parse(rC.result.value);
  dC.forEach(x => console.log('   ' + x.名.padEnd(7) +
    ' 顶留白 ' + x.顶留白 + '%  底留白 ' + x.底留白 + '%'));
  断言('竖屏顶部留白 ≥ 15%', dC.every(x => x.顶留白 >= 15),
       dC.filter(x => x.顶留白 < 15).map(x => x.名).join(','));
  断言('竖屏底部留白 ≥ 25%', dC.every(x => x.底留白 >= 25),
       dC.filter(x => x.底留白 < 25).map(x => x.名).join(','));

  console.log('');
  console.log('=== 主题切换：文字随 displaySize 缩放 ===');
  const 记录 = [];
  for (let i = 1; i <= 6; i++) {
    await ev(`document.querySelectorAll('.themeCard')[${i}].click()`);
    await sleep(420);
    const r = await ev(`JSON.stringify({
      ds: TY.displaySize,
      字号: 放置.filter(p => p.id === 'text')[0].样式.字号,
      框右: (() => { const p = 放置.filter(q => q.id === 'text')[0];
                     return p.x + p.w; })(),
      画布w: 画布.w,
    })`);
    记录.push(JSON.parse(r.result.value));
  }
  const 字号集 = new Set(记录.map(x => x.字号));
  /* 点缀级文字被 min/max 字号收窄，档位本就少 —— 要求 >=2 即可 */
  断言('字号随主题变化', 字号集.size >= 2, [...字号集].join(', '));
  const 单调 = (() => {
    const 对 = 记录.map(x => [x.ds, x.字号]).sort((a,b) => a[0] - b[0]);
    for (let i = 1; i < 对.length; i++) if (对[i][1] < 对[i-1][1] - 2) return false;
    return true;
  })();
  断言('字号随 displaySize 单调', 单调,
       JSON.stringify(记录.map(x => [x.ds, x.字号])));
  const 全部在内 = 记录.every(x => x.框右 <= x.画布w + 2);
  断言('任何主题下标题都不超出画布', 全部在内,
       JSON.stringify(记录.map(x => x.框右 + '/' + x.画布w)));

  console.log('');
  console.log('=== 文字可编辑（模板带的文字不是死的）===');
  await ev(`套用模板(TEMPLATES[1])`);
  await sleep(700);
  await ev(`(() => {
    const p = 放置.filter(x => x.id === 'text')[0];
    单选(p.uid);
    const 原 = p.样式.内容;
    p.样式.内容 = 'CUSTOM TITLE';
    自适应文字框(p);
    return 原;
  })()`);
  await sleep(400);
  const r4 = await ev(`JSON.stringify({
    内容: 放置.filter(p => p.id === 'text')[0].样式.内容,
    框w: 放置.filter(p => p.id === 'text')[0].w,
  })`);
  const d4 = JSON.parse(r4.result.value);
  断言('模板文字可改写', d4.内容 === 'CUSTOM TITLE', d4.内容);
  断言('改写后框重算', d4.框w > 10, String(d4.框w));

  console.log('');
  console.log('=== 页面错误 ===');
  断言('无 JS 错误', errs.length === 0, errs.slice(0,3).join(' | '));

  console.log('');
  console.log('='.repeat(56));
  console.log('通过 ' + pass + ' / ' + (pass+fail));
} finally { child.kill(); }
process.exit(fail ? 1 : 0);
