/* GUI 逻辑（由 preview/gui_v2_template.html 拆出，G0-2 步骤 1）
   ------------------------------------------------------------
   本步骤只把脚本搬成独立文件，**未做语义拆分**。
   2497 行里有大量闭包与共享可变状态（放置/选中/缩放/历史栈/拖拽），
   机械切分会引入作用域错误。语义拆分留到下一步，
   每拆一块跑一次 18 个回归测试。

   约束：不得改动任何 id / class —— 测试靠 DOM 选择器定位元素。 */

/* ============================================================
   真实组件代码与数据（由 build_gui.py 从渲染页注入）
   ============================================================ */
/*__COMPONENT_CODE__*/

/* ============================================================
   GUI 逻辑
   ============================================================ */
const $ = id => document.getElementById(id);
const stage = $('stage');
const toastEl = $('toast');

/* 静帧时刻：预览显示的固定时间点 */
let 静帧秒 = 48.0;

/* ---- 主题清单（含"默认"，即不含主题倾向的中性样式）---- */
/* 主题卡列表。
   ------------------------------------------------------------
   'default' 曾是 GUI 独有的合成主题，故这里硬编码一张卡，
   再把 DIRECTIONS.order 里的其余主题补上。
   后来把 default 也写进了 artdirections.json（否则导出会报
   「未知主题：default」），于是 order 里也含 default ——
   若不跳过就会**重复一张卡**，且 THEMES[1] 变成 default，
   使「点第二张卡切到 sumi」这类操作落到 default 上（测试抓到）。

   现改为：补卡时跳过已存在的 key，色板直接取自同一份数据。 */
const THEMES = [];
(function () {
  const 已有 = {};
  const 加卡 = (k, t, wide, note) => {
    if (已有[k]) return;
    已有[k] = true;
    const p = t.palette;
    THEMES.push({
      key: k, name: t.name,
      en: (t.subtitle || '').toUpperCase(),
      wide: !!wide, note: note || '',
      sw: [p.bg, p.surface, p.ink, p.inkMid, p.inkFaint,
           p.accent, p.accent2, p.accent3],
    });
  };
  /* default 排在最前（未套用主题的中立外观） */
  if (DIRECTIONS && DIRECTIONS.directions && DIRECTIONS.directions['default']) {
    加卡('default', DIRECTIONS.directions['default'], true, '中性灰阶 · 未套用主题');
  }
  (DIRECTIONS.order || []).forEach(k => {
    const t = DIRECTIONS.directions[k];
    if (t) 加卡(k, t);
  });
})();

/* ---- 组件清单 ---- */
/* ---- 组件库分组 ----
   **从 COMPONENTS 自动生成**，不再手写。

   原先这里是手写的 COMPS 表，与组件 register() 里的
   name/w/h/group 是重复数据 —— 实测已漂移 4 项
   （vectorscope 显示名、brightness/transient/transport 尺寸），
   导致拖进画布的组件尺寸是错的。

   现在加组件只需 register() 一次，组件库自动出现。

   分组顺序固定为 内容 / 结构 / 音频 / 信息；
   未在列表里的分组排在最后（避免新分组被静默丢弃）。 */
const COMPS = (function () {
  const 顺序 = ['内容', '结构', '音频', '信息'];
  const 表 = {};
  COMPONENTS.forEach(function (c) {
    const g = c.group || '其它';
    (表[g] = 表[g] || []).push({
      id: c.id, name: c.name, w: c.w, h: c.h,
    });
  });
  const 组名 = 顺序.filter(g => 表[g])
    .concat(Object.keys(表).filter(g => 顺序.indexOf(g) < 0));
  return 组名.map(g => ({ g: g, items: 表[g] }));
})();

/* ---- 模板库 ----
   由 preview/design_templates.py 生成，构建时注入。
   每套模板含「设计意图」说明与横竖屏两套坐标。
   blank 为空模板，用于快速清空回到初始状态。 */
const TEMPLATES = /*__TEMPLATES__*/;

/* ---- 状态 ---- */
let 方向 = 'land';
let 画布 = { w:1920, h:1080 };
let 缩放 = 0.62;
let 主题键 = 'default';
let 放置 = [];
let uidSeq = 1;
let 当前模板 = null;
/* 帧率此前只是按钮的 UI 状态（b.dataset.f），没有可读的值。
   导出需要真实数值，故补一个状态变量。 */
let 帧率 = 30;

/* ============================================================
   选择模型（多选）
   ------------------------------------------------------------
   单选与多选统一用一个集合表示：
     选中集 = Set<uid>
   「主选」= 最后点击的那个，属性面板显示它。

   为什么用集合而非单个值：
   框选、Shift 加选、Ctrl+A 全选、批量删除/移动都需要多选。
   若沿用单值，每个功能都要额外维护一套"临时多选"，必然混乱。
   ============================================================ */
let 选中集 = new Set();
let 主选 = null;          /* 属性面板显示的对象；null 表示无选中 */

/* 兼容旧代码：读「选中」= 主选；写「选中」= 单选 */
Object.defineProperty(window, '选中', {
  get: function () { return 主选; },
  set: function (v) { 单选(v); },
});

function 单选(uid){
  选中集.clear();
  if (uid !== null && uid !== undefined) {
    选中集.add(uid);
    主选 = uid;
  } else {
    主选 = null;
  }
}

function 加选(uid){
  选中集.add(uid);
  主选 = uid;
}

function 减选(uid){
  选中集.delete(uid);
  主选 = 选中集.size ? [...选中集][选中集.size - 1] : null;
}

function 全选(){
  选中集 = new Set(放置.filter(p => !p.hidden).map(p => p.uid));
  主选 = 选中集.size ? [...选中集][选中集.size - 1] : null;
}

function 清空选择(){
  选中集.clear();
  主选 = null;
}

function 已选中(uid){ return 选中集.has(uid); }
function 选中项(){ return 放置.filter(p => 选中集.has(p.uid)); }
function 选中数(){ return 选中集.size; }

/* ---- 撤销/重做（只覆盖布局操作）----

   模型：**记录变更后的状态**。
   每次布局变更完成后调用 记录历史()，把当前状态压栈。
   撤销 = 位置回退一格并恢复该快照。

   为什么不"变更前压栈"：
   那样栈里存的永远是"变更前"，最后一次变更的结果不在栈里，
   撤销会丢掉最新状态（实测确认过这个问题）。

   快照式实现：布局数据量小（几十个组件），
   每次全量序列化，简单可靠，不会有"漏记某个字段"的隐患。 */
const 历史 = { 栈: [], 位置: -1, 上限: 80 };

function 布局快照(){
  return JSON.stringify(放置.map(function (p) {
    return { uid:p.uid, id:p.id, x:p.x, y:p.y, w:p.w, h:p.h,
             z:p.z, hidden:p.hidden,
             样式: p.样式 ? JSON.parse(JSON.stringify(p.样式)) : null,
             柔化: p.柔化,
             隐藏文字: p.隐藏文字,
             窗口: p.窗口 };
  }));
}

/* 记录当前状态。所有布局变更完成后都应调用。 */
function 记录历史(){
  标记脏();   /* 任何会改变画布的操作都经这里 → 标记未保存 */

  const 快照 = 布局快照();
  if (历史.位置 >= 0 && 历史.栈[历史.位置] === 快照) return;  /* 无变化 */
  历史.栈 = 历史.栈.slice(0, 历史.位置 + 1);
  历史.栈.push(快照);
  if (历史.栈.length > 历史.上限) 历史.栈.shift();
  历史.位置 = 历史.栈.length - 1;
}

/* 兼容旧调用名（变更前调用无意义，改为空操作以免误用） */
function 压入历史(){ /* 已废弃，见 记录历史() */ }

function 恢复快照(快照){
  const 数据 = JSON.parse(快照);
  放置 = 数据.map(function (d) {
    const p = { uid:d.uid, id:d.id, x:d.x, y:d.y, w:d.w, h:d.h,
                z:d.z, hidden:d.hidden };
    if (d.样式) p.样式 = d.样式;
    if (d.柔化 !== undefined) p.柔化 = d.柔化;
    if (d.隐藏文字 !== undefined) p.隐藏文字 = d.隐藏文字;
    if (d.窗口 !== undefined && d.窗口 !== null) p.窗口 = d.窗口;
    return p;
  });
  /* uid 序号要跟上，避免新建组件时冲突 */
  放置.forEach(function (p) { if (p.uid >= uidSeq) uidSeq = p.uid + 1; });
  /* 清理已不存在的选中项 */
  const 存在 = new Set(放置.map(p => p.uid));
  [...选中集].forEach(function (u) { if (!存在.has(u)) 选中集.delete(u); });
  if (主选 !== null && !存在.has(主选)) {
    主选 = 选中集.size ? [...选中集][选中集.size - 1] : null;
  }
}

function 撤销(){
  if (历史.位置 <= 0) { toast('没有可撤销的操作'); return false; }
  历史.位置--;
  恢复快照(历史.栈[历史.位置]);
  渲染画布(); 渲染组件库();
  toast('已撤销');
  return true;
}

function 重做(){
  if (历史.位置 >= 历史.栈.length - 1) { toast('没有可重做的操作'); return false; }
  历史.位置++;
  恢复快照(历史.栈[历史.位置]);
  渲染画布(); 渲染组件库();
  toast('已重做');
  return true;
}

/* ---- 剪贴板（组件复制粘贴）---- */
let 剪贴板 = [];
let 粘贴偏移 = 0;

function 复制选中(){
  const 项 = 选中项();
  if (!项.length) return false;
  剪贴板 = 项.map(function (p) {
    return { id:p.id, x:p.x, y:p.y, w:p.w, h:p.h,
             样式: p.样式 ? JSON.parse(JSON.stringify(p.样式)) : null,
             柔化: p.柔化,
             隐藏文字: p.隐藏文字 };
  });
  粘贴偏移 = 0;
  toast('已复制 ' + 项.length + ' 个组件');
  return true;
}

function 粘贴(){
  if (!剪贴板.length) { toast('剪贴板为空'); return false; }
  粘贴偏移 += 24;                 /* 每次粘贴错开，避免完全重叠 */
  const maxZ = 放置.reduce((m, p) => Math.max(m, p.z), 0);
  const 新 = 剪贴板.map(function (c, i) {
    const p = {
      uid: uidSeq++, id: c.id,
      x: c.x + 粘贴偏移, y: c.y + 粘贴偏移,
      w: c.w, h: c.h, z: maxZ + 1 + i, hidden: false,
    };
    if (c.样式) p.样式 = JSON.parse(JSON.stringify(c.样式));
    if (c.柔化 !== undefined) p.柔化 = c.柔化;
    if (c.隐藏文字 !== undefined) p.隐藏文字 = c.隐藏文字;
    if (c.窗口 !== undefined) p.窗口 = c.窗口;
    return p;
  });
  放置.push(...新);
  选中集 = new Set(新.map(p => p.uid));
  主选 = 新.length ? 新[新.length - 1].uid : null;
  渲染画布(); 渲染组件库();
  记录历史();
  toast('已粘贴 ' + 新.length + ' 个组件');
  return true;
}

function 剪切(){
  if (!复制选中()) return false;
  删除选中();
  toast('已剪切');
  return true;
}

/* 原地复制（Ctrl+D）：不经过剪贴板 */
function 原地复制(){
  const 项 = 选中项();
  if (!项.length) return false;
  const maxZ = 放置.reduce((m, p) => Math.max(m, p.z), 0);
  const 新 = 项.map(function (p, i) {
    const q = {
      uid: uidSeq++, id: p.id,
      x: p.x + 24, y: p.y + 24, w: p.w, h: p.h,
      z: maxZ + 1 + i, hidden: false,
    };
    if (p.样式) q.样式 = JSON.parse(JSON.stringify(p.样式));
    if (p.柔化 !== undefined) q.柔化 = p.柔化;
    return q;
  });
  放置.push(...新);
  选中集 = new Set(新.map(p => p.uid));
  主选 = 新.length ? 新[新.length - 1].uid : null;
  渲染画布(); 渲染组件库();
  记录历史();
  toast('已复制 ' + 新.length + ' 个组件');
  return true;
}

function 删除选中(){
  if (!选中集.size) return false;
  const n = 选中集.size;
  放置 = 放置.filter(p => !选中集.has(p.uid));
  清空选择();
  渲染画布(); 渲染组件库();
  记录历史();
  toast('已删除 ' + n + ' 个组件');
  return true;
}

/* 微移（方向键） */
function 微移(dx, dy){
  const 项 = 选中项();
  if (!项.length) return false;
  项.forEach(function (p) {
    p.x = Math.round(p.x + dx);
    p.y = Math.round(p.y + dy);
  });
  渲染画布();
  记录历史();
  return true;
}

/* 层序操作 */
function 层序置顶(){
  const 项 = 选中项();
  if (!项.length) return false;
  let maxZ = 放置.reduce((m, p) => Math.max(m, p.z), 0);
  项.forEach(function (p) { p.z = ++maxZ; });
  渲染画布();
  记录历史();
  toast('已置顶');
  return true;
}

function 层序置底(){
  const 项 = 选中项();
  if (!项.length) return false;
  let minZ = 放置.reduce((m, p) => Math.min(m, p.z), 0);
  项.forEach(function (p) { p.z = --minZ; });
  渲染画布();
  记录历史();
  toast('已置底');
  return true;
}

function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove('on'), 1900);
}

/* ============================================================
   启动页
   ============================================================ */
/* 是否在本地服务下运行（由服务端构建页面时注入）。
   独立打开原型文件时为 false —— 那时导入是模拟的，
   按钮只做样子，方便离线调设计。 */
const 服务模式 = (typeof window.__APP_MODE__ !== 'undefined')
  ? !!window.__APP_MODE__ : false;
const 服务基址 = '';
let 已选FLP = null, 已选音频 = null;

async function 调接口(路径, 数据) {
  const r = await fetch(服务基址 + 路径, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(数据 || {}),
  });
  return await r.json();
}

/* 轮询任务，直到结束。返回最终状态。 */
async function 等任务(id, 每次){
  for (;;) {
    const t = await (await fetch(服务基址 + '/api/job?id=' + id)).json();
    if (每次) 每次(t);
    if (!t || t.状态 !== '运行中') return t;
    await new Promise(r => setTimeout(r, 700));
  }
}

/* 选文件：走系统对话框（浏览器给不了真实路径） */
async function 选文件(kind){
  if (!服务模式) return null;
  const r = await 调接口('/api/pick', { kind: kind });
  if (r.error) { toast('选择失败：' + r.error); return null; }
  return r.path || null;
}

$('dropFlp').onclick = async () => {
  if (服务模式) {
    const p = await 选文件('flp');
    if (!p) return;
    已选FLP = p;
    $('dropFlp').classList.add('filled');
    $('flpMeta').textContent = p.split(/[\\/]/).pop();
    $('tbProj').textContent = p.split(/[\\/]/).pop();
    检查导入();

    /* 自动配对同目录同名音频 —— 对话框给的是真实路径，可以做到。
       拖拽路径给不了真实路径，故那里不做配对（见 处理拖入文件 的说明）。 */
    if (!已选音频) 尝试自动配对(p);
    return;
  }
  /* 离线原型：模拟 */
  $('dropFlp').classList.add('filled');
  $('flpMeta').textContent = (DATA.projectName || 'project') + '.flp · 导入完成';
  $('tbProj').textContent = (DATA.projectName || 'project') + '.flp';
  检查导入();
};

$('dropAudio').onclick = async () => {
  if (服务模式) {
    const p = await 选文件('audio');
    if (!p) return;
    已选音频 = p;
    $('dropAudio').classList.add('filled');
    $('audioMeta').textContent = p.split(/[\\/]/).pop();
    $('tbAudio').textContent = p.split(/[\\/]/).pop();
    检查导入();
    return;
  }
  $('dropAudio').classList.add('filled');
  const d = DATA.audio.duration;
  $('audioMeta').textContent = '混音 · ' + d.toFixed(1) + 's · ' +
    (DATA.audio.sr / 1000).toFixed(1) + 'kHz';
  $('tbAudio').textContent = '混音音频';
  检查导入();
};

/* 示例工程按钮已移除（正式版不再内置示例）。
   需要对照视觉时用：python run.py --demo */

function 进入编辑器(){
  $('welcome').classList.add('hidden');
  $('app').classList.add('active');
  初始化();
}

/* 当前选中的文件是否**已经载入**。
   ------------------------------------------------------------
   这个判断是必须的：导入完成后页面会 reload，重载后选中的
   文件与已载入的工程一致 —— 此时按钮应当「直接进入」。
   若仍按「点击就解析」，会陷入：
     解析 → reload → 再解析 → 再 reload …… 永远进不去。
   （用户实测就卡在这里：看到解析信息后没有任何反应。） */
function 已载入所选(){
  const pm = window.__PROJECT__ || {};
  if (!pm.已导入) return false;
  return (已选FLP === pm.flp) && (已选音频 === pm.audio);
}

function 检查导入(){
  const a = $('dropFlp').classList.contains('filled');
  const b = $('dropAudio').classList.contains('filled');
  if (服务模式) {
    const 已载入 = 已载入所选();
    $('btnEnter').disabled = 已载入 ? false : !(已选FLP && 已选音频);
    $('btnEnter').textContent = 已载入 ? '进入编辑器' : '解析并进入编辑器';
    $('importStatus').textContent = 已载入
      ? '工程已就绪'
      : ((已选FLP && 已选音频) ? '可以开始解析'
        : (已选FLP ? '还需选择音频'
          : (已选音频 ? '还需选择 FLP' : '等待选择文件…')));
    return;
  }
  $('btnEnter').disabled = !(a && b);
  $('importStatus').textContent = (a && b) ? '可以进入编辑器' :
    (a ? '还需导入音频' : (b ? '还需导入 FLP' : '等待导入…'));
}

$('btnEnter').onclick = async () => {
  /* 服务模式下：先解析（FLP + 音频分析），完成后刷新页面 ——
     新页面由服务端用该工程的数据构建。
     为什么刷新而不是就地替换数据：
       组件代码在加载时就消费了 DATA（bindings.js 生成 PPQ/TEMPO/SHAPES
       等顶层常量），就地换数据等于要重跑一遍绑定层，复杂且易错。 */
  /* 所选文件已经载入 → 直接进编辑器，不要再解析一遍 */
  if (服务模式 && 已载入所选()) {
    进入编辑器();
    return;
  }

  if (服务模式 && 已选FLP && 已选音频) {
    $('btnEnter').disabled = true;
    const 进度 = (t) => {
      $('importStatus').textContent = (t.阶段 || '') + '  ' +
        Math.round((t.进度 || 0) * 100) + '%' +
        (t.消息 ? '  · ' + t.消息 : '');
    };
    try {
      设忙碌(true);
      const r = await 调接口('/api/import',
        { flp: 已选FLP, audio: 已选音频 });
      if (!r.id) { toast('导入失败：' + (r.错误 || '未知')); 
        $('btnEnter').disabled = false; return; }
      const t = await 等任务(r.id, 进度);
      if (t.状态 === '完成') {
        $('importStatus').textContent = '解析完成，正在载入…';
        /* 带 #enter 重载：用户点的是「解析**并进入**编辑器」，
           解析完就该直接进去，不该让他再点一次。 */
        location.href = location.pathname + '#enter';
        location.reload();
      } else {
        $('importStatus').textContent = '导入失败：' + (t.错误 || '');
        toast('导入失败：' + (t.错误 || ''));
        $('btnEnter').disabled = false;
      }
    } catch (e) {
      toast('导入出错：' + e.message);
      $('btnEnter').disabled = false;
    } finally {
      设忙碌(false);
    }
    return;
  }
  进入编辑器();
};

/* 鼓组识别结果提示
   ------------------------------------------------------------
   在导入页显示：识别到多少个、其中多少个靠自动规则、
   多少个疑似鼓组但没纳入（并提示加 #step）。
   没有未纳入项时不显示，避免打扰。 */
function 显示鼓组提示(stats, missed, audio){
  const 框 = $('drumNotice');
  if (!框) return;
  const 纳入 = stats['纳入'] || 0;
  const 未纳入 = (missed || []).length;
  const 音频 = (audio || {})['音频命中'] || 0;

  if (纳入 === 0 && 未纳入 === 0 && 音频 === 0) {
    框.style.display = 'none';
    return;
  }

  const 行 = [];
  /* 整句模板：片段拼接无法翻译（英文语序不同） */
  行.push(译('drum.found', { n: 纳入 }) +
          (音频 ? 译('drum.foundAudio', { n: 音频 }) : ''));
  const 细则 = [];
  if (stats['按关键词']) 细则.push('通道名 ' + stats['按关键词']);
  if (stats['按音高'])   细则.push('音高 ' + stats['按音高']);
  if (stats['按节奏'])   细则.push('节奏 ' + stats['按节奏']);
  if (stats['按后缀'])   细则.push('#step ' + stats['按后缀']);
  if (细则.length) 行.push('（' + 细则.join(' · ') + '）');

  let html = 行.join('');

  if (未纳入 > 0) {
    html += 译('drum.missed', { n: 未纳入 });
    const 例 = missed.slice(0, 3)
      .map(m => '「' + (m.name || ('P' + m.id)) + '」').join(' ');
    if (例) html += 译('drum.missedExample', { list: 例 });
  }

  框.innerHTML = html;
  框.style.display = 'block';
}

/* 服务模式：把页面上的说明文案改掉（原型里的「模拟」字样不再成立） */
if (服务模式) {
  const 脚 = document.querySelector('.wFoot');
  if (脚) {
    脚.innerHTML = '当前工程：<b>' +
      ((window.__PROJECT__ && window.__PROJECT__.name) || DATA.projectName) +
      '</b>' + (window.__PROJECT__ && window.__PROJECT__.duration
        ? '　时长 ' + window.__PROJECT__.duration.toFixed(1) + 's' : '') +
      '<br>画布中的组件为<b>真实渲染</b> —— 所见即最终视频的画面。';
  }
  /* 从服务端带回的工程信息填充到导入页 ——
     否则用户看到的是空白的「等待选择文件」，
     而实际上工程已经载入了。 */
  const pm = window.__PROJECT__ || {};
  if (pm.name) {
    $('dropFlp').classList.add('filled');
    $('flpMeta').textContent = pm.flp
      ? pm.flp.split(/[\\/]/).pop() : (pm.name + '.flp');
    $('tbProj').textContent = (pm.name || 'project') + '.flp';
    已选FLP = pm.flp || null;
  }
  if (pm.audio) {
    $('dropAudio').classList.add('filled');
    $('audioMeta').textContent = pm.audio.split(/[\\/]/).pop();
    $('tbAudio').textContent = pm.audio.split(/[\\/]/).pop();
    已选音频 = pm.audio;
  } else if (pm.示例) {
    /* 示例工程没有真实音频路径（数据是预分析的）——
       此时不能真渲染，故不填音频，也不允许点「解析」 */
  }
  检查导入();

  /* 鼓组识别结果提示
     ------------------------------------------------------------
     软音源的自动识别不可能 100% 准确（实测 8 个工程：
     命中 81%，误判 13%）。故当有「疑似鼓组但没纳入」的 pattern 时，
     明确提示用户：给 pattern 名加 #step 即可强制纳入。

     为什么不静默：用户会以为「软件坏了」，而其实只需改个名字。 */
  显示鼓组提示(DATA.drumStats || {}, DATA.drumMissed || [],
              DATA.drumAudio || {});

  /* 从导入流程带 #enter 回来：工程已就绪就直接进编辑器。
     ------------------------------------------------------------
     **必须等整个脚本执行完再进**，不能在这里直接调 初始化()。

     原因：初始化() → 渲染画布()，而 渲染画布 里引用的 `渲染序号`
     声明在**本文件更靠后的位置**。在本行调用会撞上 TDZ：

       ReferenceError: Cannot access '渲染序号' before initialization
           at 渲染画布
           at 初始化

     表现是「进了编辑器，但画布上一个组件都没有」——
     而且不弹错、界面看着正常，只是空的，极难定位。

     之前只有用户手点按钮才会调 初始化()，那时脚本早已执行完，
     所以这个顺序问题一直没暴露；加了 #enter 自动进入才触发。 */
  if (location.hash === '#enter' && 已载入所选()) {
    history.replaceState(null, '', location.pathname);
    const 进入 = () => 进入编辑器();
    if (document.readyState === 'complete') setTimeout(进入, 0);
    else window.addEventListener('load', () => setTimeout(进入, 0));
  }
}

/* ============================================================
   主题
   ============================================================ */
function 渲染主题(){
  const g = $('themeGrid');
  g.innerHTML = '';
  THEMES.forEach(t => {
    const d = document.createElement('div');
    d.className = 'themeCard' + (t.wide ? ' wide' : '') +
                  (主题键 === t.key ? ' on' : '');
    d.innerHTML =
      '<div class="tick">✓</div>' +
      '<div class="name">' + t.name + ' <span class="en">' + t.en + '</span></div>' +
      (t.note ? '<div class="en" style="letter-spacing:0">' + t.note + '</div>' : '') +
      '<div class="swatches">' +
        t.sw.map(c => '<i style="background:' + c + '"></i>').join('') +
      '</div>';
    d.onclick = () => {
      主题键 = t.key;
      渲染主题();
      /* 顺序很重要：主题令牌（TY）是在 渲染画布() 里由 setActiveTheme
         更新的，故必须先渲染画布、再重算文字字号 ——
         否则重算读到的还是上一个主题的 displaySize（实测差一拍）。 */
      渲染画布();
      重算全部文字字号();
      渲染画布();
    };
    g.appendChild(d);
  });
}

/* 取得当前主题对象（"默认"用中性令牌合成） */
function 当前主题(){
  /* 优先用 artdirections.json 里的 default ——
     单一来源：GUI 与渲染管线读同一份数据，导出才不会「未知主题」。
     合成函数仅作为该条目缺失时的兜底。 */
  if (DIRECTIONS && DIRECTIONS.directions && DIRECTIONS.directions['default']) {
    return DIRECTIONS.directions[主题键] || DIRECTIONS.directions['default'];
  }
  if (主题键 === 'default') return 合成默认主题();
  return DIRECTIONS.directions[主题键];
}

/* 默认主题：中性灰阶，无纹理倾向。
   注意：surfaces.js 暂无 SURFACE.default，故 texture 用 'none'
   使其走基础绘制路径（不套用任何主题的质感）。 */
function 合成默认主题(){
  return {
    name: '默认', subtitle: 'DEFAULT',
    palette: {
      bg:'#E8E8E6', surface:'#D8D8D5', ink:'#2A2A28', inkMid:'#6E6E6A',
      inkFaint:'#A8A8A4', accent:'#5A5A58', accent2:'#3C3C3A', accent3:'#8A8A86',
    },
    type: {
      display:'"Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
      body:'"Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
      mono:'"Consolas", monospace',
      displaySize:78, labelSize:12, tracking:2.0, displayWeight:400,
    },
    treatment: { texture:'none' },
  };
}

/* ============================================================
   模板库
   ============================================================ */
function 渲染模板(){
  const box = $('tplList');
  box.innerHTML = '';
  TEMPLATES.forEach(t => {
    const 布局 = 方向 === 'land' ? t.land : t.port;
    const 空 = !布局 || !布局.length;
    const d = document.createElement('div');
    d.className = 'tplCard' + (当前模板 === t.id ? ' on' : '');

    /* 缩略图：按真实比例画小方块。
       空模板画虚线空框，表达「清空」的语义。 */
    let 缩略;
    if (空) {
      缩略 = '<div class="tplThumb empty"></div>';
    } else {
      const sx = 46 / 画布.w, sy = 28 / 画布.h;
      const 块 = 布局.map(b =>
        '<i style="left:' + (b.x * sx) + 'px;top:' + (b.y * sy) + 'px;' +
        'width:' + Math.max(2, b.w * sx) + 'px;' +
        'height:' + Math.max(1.5, b.h * sy) + 'px"></i>').join('');
      缩略 = '<div class="tplThumb">' + 块 + '</div>';
    }

    d.innerHTML = 缩略 +
      '<div class="tplMeta">' +
        '<div class="tn">' + t.name + '</div>' +
        '<div class="td">' + t.note +
          (空 ? '' : ' · ' + 布局.length + ' 件') + '</div>' +
      '</div>';
    d.onclick = () => 套用模板(t);
    box.appendChild(d);
  });
}

/* 解析模板里的文字规格。
   ------------------------------------------------------------
   模板用**倍率**表达字号（相对主题 displaySize），
   因为各主题的 displaySize 差异很大（50~132）：
   若模板写死像素，構成的标题与図面的标题就一样大，主题失去性格；
   若模板写倍率，各主题各自缩放，同时构图位置（画布绝对坐标）保持稳定。

   最小/最大字号用于兜底：displaySize 极端的主题也不会失控。 */
function 解析模板文字(样式){
  const s = Object.assign(文字默认样式(), 样式 || {});
  /* **保留** 字号倍率 / 最小字号 / 最大字号：
     字号虽在此刻算出绝对值，但倍率必须留着 ——
     换主题时要按新主题的 displaySize 重算（见 重算文字字号）。
     若丢掉倍率，切换主题后字号不变，「随主题缩放」就失效了。 */
  if (s.字号倍率 !== undefined && s.字号倍率 !== null) {
    应用字号倍率(s);
  }
  return s;
}

/* 由 倍率 × 当前主题 displaySize 求字号 */
function 应用字号倍率(s){
  const 倍率 = s.字号倍率;
  if (倍率 === undefined || 倍率 === null) return;
  const 基准 = (typeof TY !== 'undefined' && TY.displaySize) ? TY.displaySize : 78;
  let px = 基准 * 倍率;
  if (s.最小字号) px = Math.max(s.最小字号, px);
  if (s.最大字号) px = Math.min(s.最大字号, px);
  s.字号 = Math.round(px);
}

/* 主题变化后重算所有带倍率的文字字号，并重新自适应框。
   这样「構成」(displaySize 132) 的标题天然比「図面」(50) 大，
   各主题保持自己的性格。 */
function 重算全部文字字号(){
  放置.forEach(function (p) {
    if (p.id !== 'text' || !p.样式) return;
    if (p.样式.字号倍率 === undefined) return;
    应用字号倍率(p.样式);
    自适应文字框(p);
    /* 字号变了 → 宽高变了 → 必须重新按锚点落位，
       否则右/下对齐的文字会随字号增长而溢出画布 */
    定位文字(p);
  });
}

/* 按锚点把文字框摆到锚点位置。
   ------------------------------------------------------------
   锚点存成独立字段 p.锚点（画布坐标），每次都从它重算 p.x/p.y。
   不能直接对 p.x 做减法 —— 那是一次性的，重复调用会漂移；
   而字号的任何变化都会改变 p.w，必须能重新落位。

   初版只在套用模板时定位一次，于是主题切换改了字号后，
   右对齐的文字就向右溢出了画布（实测 1987 > 1920）。 */
function 定位文字(p){
  const a = p.锚点;
  if (!a) return;
  const 锚 = p.锚 || 'tl';
  p.x = a.x;
  p.y = a.y;
  switch (锚) {
    case 'tr': p.x = a.x - p.w; break;
    case 'tc': p.x = a.x - p.w / 2; break;
    case 'bl': p.y = a.y - p.h; break;
    case 'br': p.x = a.x - p.w; p.y = a.y - p.h; break;
    case 'bc': p.x = a.x - p.w / 2; p.y = a.y - p.h; break;
    default: break;               /* tl */
  }
}

function 套用模板(t){
  const 布局 = 方向 === 'land' ? t.land : t.port;

  if (!布局 || !布局.length) {
    /* 空白模板：清空画布，回到初始状态 */
    放置 = [];
    清空选择();
    当前模板 = t.id;
    渲染画布(); 渲染组件库(); 渲染模板();
    记录历史();
    $('previewBadge').style.display = 'none';
    toast('已清空画布');
    return;
  }

  放置 = 布局.map((b, i) => {
    const p = {
      uid: uidSeq++, id: b.id, x: b.x, y: b.y,
      w: b.w || 0, h: b.h || 0, z: i + 1, hidden: false,
    };
    if (b.id === 'text') {
      p.样式 = 解析模板文字(b.样式);
      /* 锚点存下来：字号的任何变化都会改宽高，
         需要能重新落位（否则右对齐的文字会随字号增长而溢出） */
      p.锚 = b.锚 || 'tl';
      p.锚点 = { x: b.x, y: b.y };
      自适应文字框(p);
      定位文字(p);
    }
    return p;
  });
  当前模板 = t.id;
  清空选择();
  渲染画布(); 渲染组件库(); 渲染模板();
  记录历史();
  $('previewBadge').style.display = 'block';
  toast('已套用模板：' + t.name);
}

/* ============================================================
   组件库
   ============================================================ */
function 渲染组件库(){
  const box = $('compLib');
  box.innerHTML = '';
  COMPS.forEach(grp => {
    const gd = document.createElement('div');
    gd.className = 'compGroup';
    gd.innerHTML = '<div class="compGroupName">' + grp.g + '</div>';
    grp.items.forEach(it => {
      const used = 放置.some(p => p.id === it.id);
      const d = document.createElement('div');
      d.className = 'compItem' + (used ? ' used' : '');
      d.draggable = true;
      d.innerHTML = '<div class="ci"></div>' +
        '<span class="cn">' + it.name + '</span>' +
        '<span class="cd">' + it.w + '×' + it.h + '</span>';
      d.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', it.id);
        d.classList.add('dragging');
      });
      d.addEventListener('dragend', () => d.classList.remove('dragging'));
      gd.appendChild(d);
    });
    box.appendChild(gd);
  });
}

/* ============================================================
   画布渲染（真实组件）
   ============================================================ */
function 应用缩放(){
  /* 布局尺寸给 stageBox，视觉缩放给 stage。
     两者分离后，滚动容器看到的就是缩放后的真实尺寸，
     放大时顶部/左侧的溢出也能滚到（此前用 flex 居中 + margin
     补偿，溢出部分无法滚动）。 */
  const box = $('stageBox');
  box.style.width  = Math.round(画布.w * 缩放) + 'px';
  box.style.height = Math.round(画布.h * 缩放) + 'px';
  stage.style.width  = 画布.w + 'px';
  stage.style.height = 画布.h + 'px';
  stage.style.transform = 'scale(' + 缩放 + ')';
  stage.style.margin = '0';          /* 居中交由 stageBox 的 margin:auto */
  $('zoomVal').textContent = Math.round(缩放 * 100) + '%';
  $('cbSize').textContent = 画布.w + ' × ' + 画布.h;
  $('fbSize').textContent = 画布.w + '×' + 画布.h;
}

let 渲染序号 = 0;   /* 用于让旧画布失效，避免竞态 */

/* 只重绘一个组件（拖动「窗口」滑杆时用）
   ------------------------------------------------------------
   为什么不能直接调 渲染画布()：那会删掉并重建**全部** .win 节点，
   拖动过程中每帧重建几十个 DOM 会明显卡顿，
   而且会打断正在进行的手势（选中态/拖拽状态都会丢）。

   注意：设置 canvas.width 会**重置变换矩阵**，
   所以必须先改尺寸、再 scale，顺序不能反。 */
function 重绘单个组件(p, el) {
  const cv = el.querySelector('canvas');
  if (!cv) return;
  const 画布缩放 = 缩放 || 1;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const 倍率 = Math.max(DPR, Math.min(3, DPR / Math.max(0.15, 画布缩放) * 1.0));
  cv.width = Math.max(1, Math.round(p.w * 倍率));
  cv.height = Math.max(1, Math.round(p.h * 倍率));
  const g = cv.getContext('2d');
  g.scale(倍率, 倍率);
  setActiveTheme(当前主题(), 主题键 === 'default' ? 'sumi' : 主题键);
  CUR = 静帧秒;
  绘制组件实例(g, p);
}

function 渲染画布(){
  const 我的序号 = ++渲染序号;
  [...stage.querySelectorAll('.win')].forEach(n => n.remove());

  /* 切换主题：设置全局主题，组件内部据此取色 */
  setActiveTheme(当前主题(), 主题键 === 'default' ? 'sumi' : 主题键);

  const bg = P.bg;
  stage.style.background = bg;

  放置.forEach(p => {
    const spec = 查找组件(p.id);
    const d = document.createElement('div');
    d.className = 'win' + (已选中(p.uid) ? ' sel' : '') +
                   (p.uid === 主选 ? ' sel-main' : '') +
                   (p.hidden ? ' isHidden' : '');
    /* 关键：uid 必须写入 dataset，否则 mousedown 时无法反查组件
       （v2 首版漏了这行，导致放置后无法再次选中/拖动） */
    d.dataset.uid = String(p.uid);
    d.style.cssText =
      'left:' + p.x + 'px;top:' + p.y + 'px;' +
      'width:' + p.w + 'px;height:' + p.h + 'px;' +
      'z-index:' + p.z + ';';
    /* 隐藏的组件**不**用 display:none ——
       那样会屏蔽鼠标事件，用户再也点不到它，等于删除。
       视觉隐藏交给 .win.isHidden 的 opacity:0（见 app.css）。 */

    /* 真实 canvas 渲染。

       分辨率（重要）：
       组件 canvas 按 p.w × 倍率 创建像素，再被 CSS transform
       缩放到「画布缩放」倍显示。若倍率 = DPR(1)，
       显示时的有效密度 = 1 × 0.49 = 0.49 —— 位图被降采样，
       细笔画（文字竖线）会丢失，表现为「文字变细」。

       故倍率取 max(DPR, 画布缩放 × DPR × 2)，
       保证显示时至少 2 倍超采样，缩放后依然锐利。
       代价是内存与绘制成本上升，但组件数量有限，可接受。 */
    const cv = document.createElement('canvas');
    const 画布缩放 = 缩放 || 1;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    /* 至少 1，且保证显示密度 >= 2 */
    const 倍率 = Math.max(DPR, Math.min(3, DPR / Math.max(0.15, 画布缩放) * 1.0));
    cv.width = Math.max(1, Math.round(p.w * 倍率));
    cv.height = Math.max(1, Math.round(p.h * 倍率));
    const g = cv.getContext('2d');
    g.scale(倍率, 倍率);

    /* ------------------------------------------------------------
       绘制组件内容 —— 调用**共用**函数 绘制组件实例()（core/paint.js）

       预览与导出共用同一处实现，否则必然出现「所见非所得」：
       此前预览逐组件画底板/柔化、导出整帧画一次且不支持文字，
       在 GUI 里调好的效果导出后拿不到。

       坐标系：本 canvas 已 scale(倍率)，原点即组件左上角，
       单位即目标尺寸像素 —— 与 绘制组件实例 的约定一致。
       ------------------------------------------------------------ */
    CUR = 静帧秒;
    绘制组件实例(g, p);

    d.appendChild(cv);

    const lb = document.createElement('div');
    lb.className = 'wlabel';
    lb.textContent = (spec ? spec.name : p.id) + ' · ' + p.w + '×' + p.h + ' · z' + p.z;
    d.appendChild(lb);

    /* 文字组件：加就地编辑层 */
    if (p.id === 'text') {
      const ta = document.createElement('textarea');
      ta.className = 'inlineEdit';
      ta.spellcheck = false;
      同步编辑层样式(ta, p);
      d.appendChild(ta);
    }

    ['nw','n','ne','w','e','sw','s','se'].forEach(h => {
      const hd = document.createElement('div');
      hd.className = 'h ' + h;
      hd.dataset.h = h;
      d.appendChild(hd);
    });

    stage.appendChild(d);
  });

  $('emptyHint').style.display = 放置.length ? 'none' : 'flex';
  $('cbCount').textContent = 放置.filter(p => !p.hidden).length + ' 个组件';
  $('fbCount').textContent = 放置.filter(p => !p.hidden).length;
  const t = THEMES.find(x => x.key === 主题键);
  $('fbTheme').textContent = t ? t.name : 主题键;
  $('fbFrame').textContent = 静帧秒.toFixed(1) + 's';
  $('pvFrame').textContent = 静帧秒.toFixed(1);
  渲染图层();
  渲染属性();
}

function 查找组件(id){
  for (const g of COMPS) {
    const f = g.items.find(x => x.id === id);
    if (f) return f;
  }
  return null;
}

/* ============================================================
   文字就地编辑
   ------------------------------------------------------------
   双击文字组件进入编辑：一个 textarea 覆盖在组件上，
   字体/字号/对齐与实际渲染一致（所见即所得），可直接打字。

   退出：Esc 或点击别处。
   注意：编辑层与 canvas 是两套渲染，字体的换行位置可能有细微
   差异，故编辑层用同样的字体与内边距，尽量贴近。
   ============================================================ */

/* 当前正在就地编辑的组件 uid（null = 无） */
let 编辑中 = null;

/* 让 textarea 的字体与 canvas 里的一致 */
function 同步编辑层样式(ta, p){
  const 样式 = p.样式 || 文字默认样式();
  const comp = COMPONENTS.filter(x => x.id === 'text')[0];
  const 实际字号 = 样式.字号 > 0 ? 样式.字号
    : Math.max(20, Math.round(TY.displaySize * 0.55));
  /* 用组件自己的角色逻辑，避免两处算法不一致 */
  const 族 = (comp && comp.角色字体) ? comp.角色字体(样式)
    : 取字体(样式.字体, 'display');
  const 重 = (comp && comp.角色字重) ? comp.角色字重(样式)
    : (样式.字重 > 0 ? 样式.字重 : TY.displayWeight);
  const pad = (comp && comp.内边距) ? comp.内边距(实际字号, 样式)
    : Math.max(2, Math.round(实际字号 * 0.16));

  ta.style.font = (样式.倾斜 ? 'italic ' : '') + 重 + ' ' +
                  实际字号 + 'px ' + 族;
  ta.style.lineHeight = (样式.行距 || 1.35);
  ta.style.padding = pad + 'px';
  ta.style.textAlign = 样式.对齐;
  ta.style.letterSpacing = (样式.字距 || 0) + 'px';
  ta.style.color = rgba(P[样式.颜色] || P.ink, 0.96);
  ta.value = 样式.内容;

  /* 尺寸：不小于组件框，且随内容扩展。
     field-sizing 不支持时用测量值兜底。 */
  const m = comp && comp.测量 ? comp.测量(样式, 0) : null;
  if (m) {
    ta.style.minWidth = p.w + 'px';
    ta.style.minHeight = p.h + 'px';
    /* 多给一点余量，避免光标贴边时滚动 */
    ta.style.width = Math.max(p.w, m.w + 4) + 'px';
    ta.style.height = Math.max(p.h, m.h + 4) + 'px';
  }
}

/* 进入编辑 */
function 进入文字编辑(uid){
  const el = stage.querySelector('.win[data-uid="' + uid + '"]');
  if (!el) return;
  const p = 放置.find(x => x.uid === uid);
  if (!p || p.id !== 'text') return;

  /* 同一时刻只允许一个编辑 */
  退出文字编辑();

  el.classList.add('editing');
  const ta = el.querySelector('.inlineEdit');
  if (!ta) return;
  同步编辑层样式(ta, p);
  ta.focus();
  /* 光标移到末尾 */
  ta.setSelectionRange(ta.value.length, ta.value.length);
  编辑中 = uid;
}

/* 退出编辑（提交内容） */
function 退出文字编辑(){
  if (编辑中 === null) return;
  const uid = 编辑中;
  const el = stage.querySelector('.win[data-uid="' + uid + '"]');
  const p = 放置.find(x => x.uid === uid);
  编辑中 = null;
  if (!el || !p) return;

  const ta = el.querySelector('.inlineEdit');
  el.classList.remove('editing');
  if (ta) {
    const 新内容 = ta.value;
    if (新内容 !== (p.样式 && p.样式.内容)) {
      if (!p.样式) p.样式 = 文字默认样式();
      p.样式.内容 = 新内容;
      自适应文字框(p);
      /* 同步属性面板 */
      if (选中 === uid) $('tContent').value = 新内容;
    }
  }
  渲染画布();
}


/* ============================================================
   拖拽放置
   ============================================================ */
stage.addEventListener('dragover', e => e.preventDefault());
stage.addEventListener('drop', e => {
  e.preventDefault();
  const id = e.dataTransfer.getData('text/plain');
  if (!id) return;
  const spec = 查找组件(id);
  if (!spec) return;
  const r = stage.getBoundingClientRect();
  const x = Math.round((e.clientX - r.left) / 缩放 - spec.w / 2);
  const y = Math.round((e.clientY - r.top) / 缩放 - spec.h / 2);
  添加组件(id, x, y, spec.w, spec.h);
  toast('已添加：' + spec.name);
});

function 添加组件(id, x, y, w, h){
  /* 先记录变更前的状态，再修改 —— 否则撤销无内容可恢复 */
  const maxZ = 放置.reduce((m, p) => Math.max(m, p.z), 0);
  const 新 = {
    uid: uidSeq++, id: id,
    x: Math.max(0, Math.min(画布.w - w, x)),
    y: Math.max(0, Math.min(画布.h - h, y)),
    w: w, h: h, z: maxZ + 1, hidden: false,
  };
  /* 文字组件：初始化样式并让框自适应内容 */
  if (id === 'text') {
    新.样式 = 文字默认样式();
    自适应文字框(新);
    新.x = Math.max(0, Math.min(画布.w - 新.w, 新.x));
    新.y = Math.max(0, Math.min(画布.h - 新.h, 新.y));
  }
  放置.push(新);
  单选(新.uid);
  /* 变更后再记一次，使"添加"本身成为可撤销的一步 */
  渲染画布(); 渲染组件库();
  记录历史();
}

/* ============================================================
   选中 / 拖动 / 缩放 / 吸附
   ============================================================ */
let 拖 = null;

/* 双击识别（自行计时，不用原生 dblclick）
   原因见 mousedown 处理器内的注释：渲染画布() 会重建 DOM，
   原生 dblclick 无法可靠触发。 */
let 上次点击uid = null;
let 上次点击时刻 = 0;

stage.addEventListener('mousedown', e => {
  /* 编辑中的 textarea 内的点击不触发选中/拖动 */
  if (e.target.classList && e.target.classList.contains('inlineEdit')) return;

  /* 清理残留的交互状态。
     框选/拖动正常由 mouseup 结束，但 mouseup 可能丢失
     （鼠标在窗口外松开、或被其它逻辑吞掉）。
     残留会让后续操作走错分支 ——
     实测：残留的框选会让下一次拖动变成框选，并把选中清空。
     故任何新的 mousedown 都先复位。 */
  if (框选) { 隐藏框选(); 框选 = null; }
  if (拖) { 拖 = null; 隐藏参考线(); }

  const win = e.target.closest('.win');
  if (!win) {
    /* 点空白处：
       · 不按修饰键 → 取消选择 + 开始框选
       · Shift/Ctrl → 保持现有选择，开始框选（加选） */
    const 加选模式 = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!加选模式) {
      退出文字编辑();
      清空选择();
      更新选中样式(); 渲染属性(); 渲染图层();
    }
    /* 记录框选起点（画布坐标） */
    const r0 = stage.getBoundingClientRect();
    框选 = {
      x0: (e.clientX - r0.left) / 缩放,
      y0: (e.clientY - r0.top) / 缩放,
      加选: 加选模式,
      原有: 加选模式 ? new Set(选中集) : new Set(),
    };
    e.preventDefault();
    return;
  }
  const uid = Number(win.dataset.uid);
  const p = 放置.find(x => x.uid === uid);
  if (!p) {
    console.error('窗口 uid 无效：', win.dataset.uid, '可用：',
                  放置.map(q => q.uid));
    return;
  }

  /* 点到别的组件：退出正在进行的编辑 */
  if (编辑中 !== null && 编辑中 !== uid) 退出文字编辑();

  /* 记录点击时间，用于手动识别双击。
     为什么不用原生 dblclick：
       mousedown 会触发 渲染画布()，而它会**销毁并重建 .win 元素**，
       浏览器因此无法把两次点击识别为双击（元素已不是同一个）。
       故改为自己计时判断。 */
  const 现在 = performance.now();
  const 是双击 = (uid === 上次点击uid) && (现在 - 上次点击时刻 < 380);

  if (是双击 && p.id === 'text') {
    上次点击uid = null;              /* 复位，避免三击重复触发 */
    e.preventDefault();
    进入文字编辑(uid);
    return;                          /* 双击不进入拖动 */
  }
  上次点击uid = uid;
  上次点击时刻 = 现在;

  /* ---- 选择逻辑（含 Shift 加选/减选）----
     规则与业界一致：
       · Shift/Ctrl + 点击未选中项 → 加入选择
       · Shift/Ctrl + 点击已选中项 → 从选择中移除
       · 普通点击已选中项（多选中）→ 保持多选，仅切换主选
       · 普通点击未选中项 → 单选 */
  const 修饰 = e.shiftKey || e.ctrlKey || e.metaKey;
  if (修饰) {
    if (已选中(uid)) 减选(uid); else 加选(uid);
  } else if (!已选中(uid)) {
    单选(uid);
  } else {
    /* 已在选中集里：保持多选，只更新主选 */
    主选 = uid;
  }

  const h = e.target.dataset.h;
  const r = stage.getBoundingClientRect();
  const mx = (e.clientX - r.left) / 缩放;
  const my = (e.clientY - r.top) / 缩放;

  /* 拖动前的快照（用于多选整体移动；撤销在 mouseup 时记录） */
  const 拖动项 = 选中项().map(function (q) {
    return { uid:q.uid, 原x:q.x, 原y:q.y, w:q.w, h:q.h };
  });

  /* 手动拖动 = 用户接管位置，解除模板锚点。
     否则下次改字号/换主题时会被拉回锚点位置。 */
  if (!h) 选中项().forEach(function (q) { delete q.锚点; });

  if (h) {
    /* 缩放：把**起始状态**完整快照下来。
       文字组件的字号缩放必须基于这个快照计算，
       绝不能在每次 mousemove 时基于上一次的结果再乘比例 ——
       那会变成指数增长（用户报告「稍微一动就变无限大」）。 */
    const o = { x: p.x, y: p.y, w: p.w, h: p.h };
    拖 = { mode:'resize', h:h, p:p, mx0:mx, my0:my, o:o,
           等比: e.shiftKey, 中心: e.altKey };
    if (p.id === 'text') {
      拖.文字 = {
        基准字号: 文字实际字号(p.样式),      /* 快照，不随拖动变化 */
        基准宽: p.w,
        基准高: p.h,
      };
    }
  } else {
    拖 = { mode:'move', p:p, mx0:mx, my0:my, o:{x:p.x,y:p.y},
           拖动项: 拖动项, 锁轴: null, 复制: e.altKey };
    /* Alt+拖动 = 复制并移动 */
    if (e.altKey) {
      拖动项.forEach(function (q) { q.原uid = q.uid; });
    }
  }

  e.preventDefault();

  /* 选中态变化：**只更新 class，不重建 DOM**。
     重建会打断浏览器的事件检测（如双击），也浪费性能。
     只有尺寸/内容真正变化时才需要重绘 canvas。 */
  更新选中样式();
  渲染属性();
  渲染图层();
});

/* 只更新选中态相关的 class，不重建 DOM。
   用于「点击选中」这类只改状态不改内容的操作。 */
function 更新选中样式(){
  stage.querySelectorAll('.win').forEach(function (el) {
    const uid = Number(el.dataset.uid);
    el.classList.toggle('sel', 已选中(uid));
    /* 多选时用不同颜色区分主选与次选 */
    el.classList.toggle('sel-main', uid === 主选);
  });
}

/* ---- 框选 ---- */
let 框选 = null;

function 显示框选(x, y, w, h){
  const el = $('marquee');
  if (!el) return;
  el.style.display = 'block';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.width = Math.max(1, w) + 'px';
  el.style.height = Math.max(1, h) + 'px';
}

function 隐藏框选(){
  const el = $('marquee');
  if (el) el.style.display = 'none';
}

window.addEventListener('mousemove', e => {
  /* ---- 框选 ---- */
  if (框选) {
    const r = stage.getBoundingClientRect();
    const mx = (e.clientX - r.left) / 缩放;
    const my = (e.clientY - r.top) / 缩放;
    const x1 = Math.min(框选.x0, mx), x2 = Math.max(框选.x0, mx);
    const y1 = Math.min(框选.y0, my), y2 = Math.max(框选.y0, my);

    /* 标记「确实框选过」。
       初版漏了这行 —— mouseup 时 `!框选.移动过` 恒为 true，
       于是每次框选都被当成「单纯点空白」，松手即清空选择。
       （实测表现：按住时不松手能全部选中、Del 可删，
         一松手选中就没了。） */
    if (x2 - x1 > 3 || y2 - y1 > 3) 框选.移动过 = true;

    显示框选(x1, y1, x2 - x1, y2 - y1);

    /* 与矩形相交的组件加入选择 */
    const 新集 = new Set(框选.原有);
    放置.forEach(function (p) {
      if (p.hidden) return;
      const 交 = !(p.x > x2 || p.x + p.w < x1 || p.y > y2 || p.y + p.h < y1);
      if (交) 新集.add(p.uid);
    });
    选中集 = 新集;
    主选 = 选中集.size ? [...选中集][选中集.size - 1] : null;
    更新选中样式();
    渲染属性();
    渲染图层();
    return;
  }

  if (!拖) return;
  const r = stage.getBoundingClientRect();
  const mx = (e.clientX - r.left) / 缩放;
  const my = (e.clientY - r.top) / 缩放;
  const dx = mx - 拖.mx0, dy = my - 拖.my0;

  /* 记录是否真正移动过。微小抖动（<2px）不算，
     否则「点击」会被误判为「拖动」。 */
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) 拖.移动过 = true;

  const p = 拖.p, o = 拖.o;

  if (拖.mode === 'move') {
    /* Shift 锁轴：按主位移方向锁定为水平或垂直 */
    let ddx = dx, ddy = dy;
    if (e.shiftKey) {
      if (!拖.锁轴) {
        拖.锁轴 = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      }
      if (拖.锁轴 === 'x') ddy = 0; else ddx = 0;
    } else {
      拖.锁轴 = null;
    }

    let nx = Math.round(o.x + ddx), ny = Math.round(o.y + ddy);
    const snap = 吸附计算(nx, ny, p);
    /* 吸附计算可能返回非整数（例如居中吸附取平均）。
       必须取整 —— 否则被拖的组件会落下小数坐标，
       而跟随的组件是取整的，两者位移不一致（实测差 0.5px）。 */
    const 新x = Math.round(
      Math.max(-p.w * 0.5, Math.min(画布.w - p.w * 0.5, snap.x)));
    const 新y = Math.round(
      Math.max(-p.h * 0.5, Math.min(画布.h - p.h * 0.5, snap.y)));
    /* 多选整体移动：主选位移多少，其余同量位移。
       从 mousedown 的**原始位置**直接算，不做累加 ——
       累加式（每次加上增量差）容易因取整而漂移。 */
    const 实dx = 新x - o.x, 实dy = 新y - o.y;
    p.x = 新x; p.y = 新y;
    (拖.拖动项 || []).forEach(function (q) {
      if (q.uid === p.uid) return;
      const obj = 放置.find(z => z.uid === q.uid);
      if (!obj) return;
      obj.x = Math.round(q.原x + 实dx);
      obj.y = Math.round(q.原y + 实dy);
    });
  } else {
    const hh = 拖.h;

    /* 文字组件 + 自适应模式：拖拽缩放的是**字号**。
       全部基于 mousedown 时的快照计算，不累乘 ——
       否则会指数增长（用户报告的「一动就无限大」）。
       用高度比例作为系数：高度不受文本长度影响，比宽度稳定。 */
    if (拖.文字 && p.样式 && !p.样式.自动换行) {
      const T = 拖.文字;
      let 目标H = T.基准高;
      if (hh.includes('s')) 目标H = T.基准高 + dy;
      if (hh.includes('n')) 目标H = T.基准高 - dy;
      if (hh.includes('e') && !hh.includes('s') && !hh.includes('n')) {
        目标H = T.基准高 * ((T.基准宽 + dx) / T.基准宽);
      }
      if (hh.includes('w') && !hh.includes('s') && !hh.includes('n')) {
        目标H = T.基准高 * ((T.基准宽 - dx) / T.基准宽);
      }
      const 比例 = Math.max(0.25, Math.min(6, 目标H / T.基准高));
      const 新字号 = Math.max(8, Math.min(600, Math.round(T.基准字号 * 比例)));

      p.样式.字号 = 新字号;
      自适应文字框(p);

      if (hh.includes('w')) p.x = 拖.o.x + 拖.o.w - p.w; else p.x = 拖.o.x;
      if (hh.includes('n')) p.y = 拖.o.y + 拖.o.h - p.h; else p.y = 拖.o.y;
    } else {
      /* 普通组件（或文字组件开启固定换行）：直接改框 */
      let nx = o.x, ny = o.y, nw = o.w, nh = o.h;

      /* 先算原始变化 */
      if (hh.includes('e')) nw = o.w + dx;
      if (hh.includes('s')) nh = o.h + dy;
      if (hh.includes('w')) { nw = o.w - dx; }
      if (hh.includes('n')) { nh = o.h - dy; }

      /* Shift 等比：以变化较大的边为准，另一边按原比例推算 */
      if (e.shiftKey && o.w > 0 && o.h > 0) {
        const 比例 = o.w / o.h;
        const 横变 = hh.includes('e') || hh.includes('w');
        const 纵变 = hh.includes('s') || hh.includes('n');
        if (横变 && 纵变) {
          /* 角点：取面积变化较大的方向 */
          if (Math.abs(nw - o.w) / o.w >= Math.abs(nh - o.h) / o.h) {
            nh = nw / 比例;
          } else {
            nw = nh * 比例;
          }
        } else if (横变) {
          nh = nw / 比例;
        } else if (纵变) {
          nw = nh * 比例;
        }
      }

      nw = Math.max(40, Math.round(nw));
      nh = Math.max(24, Math.round(nh));

      /* 从左边/上边拖时，保持对边不动 */
      if (hh.includes('w')) nx = o.x + o.w - nw; else nx = o.x;
      if (hh.includes('n')) ny = o.y + o.h - nh; else ny = o.y;

      /* Alt：以中心为锚 */
      if (e.altKey) {
        nx = o.x + (o.w - nw) / 2;
        ny = o.y + (o.h - nh) / 2;
      }

      p.x = Math.round(nx); p.y = Math.round(ny);
      p.w = nw; p.h = nh;
    }
  }
  更新窗口DOM();
  渲染属性();
  渲染图层();
});

window.addEventListener('mouseup', () => {
  /* ---- 结束框选 ---- */
  if (框选) {
    隐藏框选();
    const 是点击 = !框选.移动过;
    框选 = null;
    if (是点击) {
      /* 单纯点空白：取消选择 */
      清空选择();
      更新选中样式(); 渲染属性(); 渲染图层();
    } else {
      toast('已选中 ' + 选中数() + ' 个组件');
    }
    return;
  }
  if (!拖) return;
  const 有位移 = 拖.移动过 === true;
  const 拖的是 = 拖.p;
  拖 = null;
  隐藏参考线();
  /* 只在**真正拖动过**时才重绘与记录历史。
     单纯点击（按下即抬起，无位移）不改布局：
     重绘会销毁重建 .win 元素、打断事件检测（导致双击失效），
     记录历史则会污染撤销栈。 */
  if (有位移) { 渲染画布(); 记录历史(); }
});

/* Esc 退出就地编辑 + 全局快捷键 */
window.addEventListener('keydown', e => {
  /* 编辑中：只处理 Esc 与 Ctrl+Enter，其余交给 textarea */
  if (编辑中 !== null) {
    if (e.key === 'Escape') { e.preventDefault(); 退出文字编辑(); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); 退出文字编辑(); return;
    }
    return;
  }

  /* 焦点在输入控件里时不拦截（否则无法在属性面板输入） */
  const t = e.target;
  const 在输入 = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                       t.tagName === 'SELECT' || t.isContentEditable);

  const ctrl = e.ctrlKey || e.metaKey;

  /* ---- 与输入无关的快捷键 ---- */
  if (e.key === 'Escape') {
    e.preventDefault();
    清空选择(); 更新选中样式(); 渲染属性(); 渲染图层();
    return;
  }

  if (ctrl && e.key.toLowerCase() === 'a' && !在输入) {
    e.preventDefault(); 全选();
    更新选中样式(); 渲染属性(); 渲染图层();
    toast('已全选 ' + 选中数() + ' 个组件');
    return;
  }

  if (ctrl && e.key.toLowerCase() === 'z' && !在输入) {
    e.preventDefault();
    if (e.shiftKey) 重做(); else 撤销();
    更新选中样式(); 渲染属性(); 渲染图层();
    return;
  }
  if (ctrl && e.key.toLowerCase() === 'y' && !在输入) {
    e.preventDefault(); 重做();
    更新选中样式(); 渲染属性(); 渲染图层();
    return;
  }

  if (ctrl && e.key.toLowerCase() === 'c' && !在输入) {
    e.preventDefault(); 复制选中(); return;
  }
  if (ctrl && e.key.toLowerCase() === 'x' && !在输入) {
    e.preventDefault(); 剪切(); return;
  }
  if (ctrl && e.key.toLowerCase() === 'v' && !在输入) {
    e.preventDefault(); 粘贴(); return;
  }
  if (ctrl && e.key.toLowerCase() === 'd' && !在输入) {
    e.preventDefault(); 原地复制(); return;
  }

  /* ---- 层序快捷键 ---- */
  if (ctrl && e.shiftKey && (e.key === ']' || e.key === '}')) {
    e.preventDefault(); 层序置顶(); return;
  }
  if (ctrl && e.shiftKey && (e.key === '[' || e.key === '{')) {
    e.preventDefault(); 层序置底(); return;
  }

  /* ---- 视图快捷键 ---- */
  if (ctrl && (e.key === '0' || e.key === ')')) {
    e.preventDefault(); 适应窗口(); return;
  }
  if (ctrl && (e.key === '1' || e.key === '!')) {
    e.preventDefault(); 缩放 = 1; 应用缩放(); return;
  }

  /* ---- 删除 ---- */
  if ((e.key === 'Delete' || e.key === 'Backspace') && !在输入) {
    e.preventDefault(); 删除选中(); return;
  }

  /* ---- 方向键微移 ---- */
  if (!在输入 && e.key.indexOf('Arrow') === 0) {
    const 步 = e.shiftKey ? 10 : 1;
    let dx = 0, dy = 0;
    if (e.key === 'ArrowLeft') dx = -步;
    if (e.key === 'ArrowRight') dx = 步;
    if (e.key === 'ArrowUp') dy = -步;
    if (e.key === 'ArrowDown') dy = 步;
    if (dx || dy) { e.preventDefault(); 微移(dx, dy); }
    return;
  }

  /* ---- Tab 循环切换选中 ---- */
  if (e.key === 'Tab' && !在输入 && 放置.length) {
    e.preventDefault();
    const 可见 = 放置.filter(p => !p.hidden);
    if (!可见.length) return;
    const 当前 = 可见.findIndex(p => p.uid === 主选);
    const 下一个 = 可见[(当前 + 1) % 可见.length];
    单选(下一个.uid);
    更新选中样式(); 渲染属性(); 渲染图层();
    return;
  }
});

/* 拖动中只更新几何，不重绘 canvas（避免卡顿） */
/* 把数据里的位置/尺寸同步到 DOM。
   ------------------------------------------------------------
   必须更新**所有被选中的**组件，而不是只有主选那一个 ——
   多选拖拽时其余组件的数据也变了，若只更新主选，
   拖动过程中只有被抓住的那个在动，松手重绘后其余才跳到新位置
   （用户报告的现象）。 */
function 更新窗口DOM(){
  /* 没选中任何项时，至少把主选同步上（例如程序化改单个组件） */
  let 列表 = 放置.filter(x => 已选中(x.uid));
  if (!列表.length && 主选 !== null) {
    列表 = 放置.filter(x => x.uid === 主选);
  }
  列表.forEach(function (p) {
    const el = stage.querySelector('.win[data-uid="' + p.uid + '"]');
    if (!el) return;
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    el.style.width = p.w + 'px';
    el.style.height = p.h + 'px';
    const cv = el.querySelector('canvas');
    if (cv) { cv.style.width = p.w + 'px'; cv.style.height = p.h + 'px'; }
    const lb = el.querySelector('.wlabel');
    if (lb) {
      const spec = 查找组件(p.id);
      lb.textContent = (spec ? spec.name : p.id) + ' · ' + p.w + '×' + p.h +
                       ' · z' + p.z;
    }
  });
}

const SNAP = 6;

function 吸附计算(nx, ny, p){
  const 目标X = [0, 画布.w / 2 - p.w / 2, 画布.w - p.w];
  const 目标Y = [0, 画布.h / 2 - p.h / 2, 画布.h - p.h];
  放置.forEach(q => {
    if (q.uid === p.uid || q.hidden) return;
    目标X.push(q.x, q.x + q.w / 2 - p.w / 2, q.x + q.w - p.w);
    目标Y.push(q.y, q.y + q.h / 2 - p.h / 2, q.y + q.h - p.h);
  });

  let bx = null, bdx = SNAP + 1;
  目标X.forEach(t => { const d = Math.abs(nx - t); if (d < bdx) { bdx = d; bx = t; } });
  let by = null, bdy = SNAP + 1;
  目标Y.forEach(t => { const d = Math.abs(ny - t); if (d < bdy) { bdy = d; by = t; } });

  const 吸X = (bx !== null && bdx <= SNAP), 吸Y = (by !== null && bdy <= SNAP);
  显示参考线(吸X ? bx : null, 吸Y ? by : null, p);
  return { x: 吸X ? bx : nx, y: 吸Y ? by : ny };
}

function 显示参考线(x, y, p){
  const gv = $('gv'), gh = $('gh');
  if (x !== null) {
    gv.classList.add('on');
    const 候选 = [0, 画布.w / 2, 画布.w];
    放置.forEach(q => { if (q.uid !== p.uid) 候选.push(q.x, q.x + q.w / 2, q.x + q.w); });
    let best = 候选[0], bd = 1e9;
    候选.forEach(c => {
      const d = Math.abs((x + p.w / 2) - c);
      if (d < bd) { bd = d; best = c; }
    });
    gv.style.left = best + 'px';
  } else gv.classList.remove('on');

  if (y !== null) {
    gh.classList.add('on');
    const 候选 = [0, 画布.h / 2, 画布.h];
    放置.forEach(q => { if (q.uid !== p.uid) 候选.push(q.y, q.y + q.h / 2, q.y + q.h); });
    let best = 候选[0], bd = 1e9;
    候选.forEach(c => {
      const d = Math.abs((y + p.h / 2) - c);
      if (d < bd) { bd = d; best = c; }
    });
    gh.style.top = best + 'px';
  } else gh.classList.remove('on');
}
function 隐藏参考线(){
  $('gv').classList.remove('on');
  $('gh').classList.remove('on');
}

/* ============================================================
   属性面板
   ============================================================ */
/* 哪些组件有「时间窗」概念（可在属性面板调整窗口大小）
   ------------------------------------------------------------
   对应各组件内部读取 窗口小节() 的地方：
     playlist  主时间轴跨度（MAIN_WIN_BARS）
     stepper   步进器滚动窗（见 stepper-core 的 winTicks）
     pianoroll 卷帘滚动窗
     spectrum  频谱滚动窗
     waveform  波形滚动窗
   其它组件（瞬态/响度/矢量示波/音高分布等）没有时间窗，不显示该控件。 */
const 有时间窗的组件 = {
  playlist: { 默认: 26, 说明: '主时间轴跨度' },
  stepper:  { 默认: 8,  说明: '步进器滚动窗' },
  pianoroll:{ 默认: 2,  说明: '卷帘滚动窗' },
  spectrum: { 默认: 2,  说明: '频谱滚动窗' },
  waveform: { 默认: 2,  说明: '波形滚动窗' }
};

function 渲染属性(){
  /* 隐藏按钮的文案与状态必须跟随当前选中组件（任务4）。
     否则用户点了隐藏，按钮还写着「隐藏」，不知道现在是显示还是隐藏。 */
  (function 更新隐藏按钮(){
    const 项 = 放置.find(x => x.uid === 选中);
    const b = $('btnHide');
    if (!b) return;
    const 隐 = !!(项 && 项.hidden);
    b.textContent = 译(隐 ? 'prop.show' : 'prop.hide');
    b.dataset.hidden = 隐 ? '1' : '';
    b.style.color = 隐 ? 'var(--acc)' : '';
    b.style.borderColor = 隐 ? 'var(--acc-dim)' : '';
  })();

  const p = 放置.find(x => x.uid === 选中);
  if (!p) {
    $('propEmpty').style.display = 'block';
    $('propForm').style.display = 'none';
    $('propBadge').textContent = '未选中';
    return;
  }
  $('propEmpty').style.display = 'none';
  $('propForm').style.display = 'block';
  const spec = 查找组件(p.id);
  $('propBadge').textContent = spec ? spec.name : p.id;

  $('pX').value = p.x; $('pY').value = p.y;
  $('pW').value = p.w; $('pH').value = p.h; $('pZ').value = p.z;
  const g = 最大公约数(p.w, p.h);
  $('pRatio').value = (p.w / g) + ' : ' + (p.h / g) + '  （' + (p.w / p.h).toFixed(2) + '）';

  /* 柔化强度（每个组件独立） */
  const 柔 = p.柔化 === undefined ? 18 : Math.round(p.柔化 * 100);
  $('pFade').value = 柔;
  $('pFadeVal').textContent = 柔 + '%';

  /* 组件内文字开关（文字组件自身无内嵌文字，故对它无意义） */
  const 有内嵌文字 = p.id !== 'text';
  $('pHideText').checked = !!p.隐藏文字;
  $('pHideText').disabled = !有内嵌文字;
  $('pHideText').parentElement.title = 有内嵌文字
    ? '关闭后组件内自带的数值、刻度、单位等文字会被隐藏'
    : '文字组件没有内嵌文字';

  /* 窗口：仅对有时间的组件显示，并把当前值填进去 */
  const 窗信息 = 有时间窗的组件[p.id];
  if ($('pWinRow')) {
    $('pWinRow').style.display = 窗信息 ? 'flex' : 'none';
    if ($('pWinHint')) $('pWinHint').style.display = 窗信息 ? 'block' : 'none';
  }
  if (窗信息) {
    const 当前窗 = (p.窗口 === undefined || p.窗口 === null)
      ? 窗信息.默认 : p.窗口;
    $('pWin').value = 当前窗;
    $('pWinVal').textContent = 当前窗 + ' 小节';
    $('pWin').title = 窗信息.说明;
  }

  /* 文字面板：仅 text 组件显示 */
  const 是文字 = p.id === 'text';
  $('textPanel').style.display = 是文字 ? 'block' : 'none';
  if (是文字) {
    if (!p.样式) p.样式 = Object.assign({}, 文字默认样式());
    填充文字面板(p.样式);
  } else {
    /* 非文字组件的宽高**永远可编辑**。
       ------------------------------------------------------------
       这里必须显式恢复，不能指望别处顺手改回来：
       填充文字面板() 在文字自适应模式下会把 pW/pH 置为 disabled，
       但它只在选中文字组件时才被调用 —— 切回普通组件时没人重置，
       于是宽高输入框**永久变灰、改不动**。
       （用户实测：「属性里面宽高属性的值无法更改，只能拖鼠标」。）

       症状很迷惑：刚打开时能改，一旦选过文字组件，之后所有组件
       都改不了 —— 而界面上没有任何提示说明为什么。 */
    $('pW').disabled = false;
    $('pH').disabled = false;
    $('pW').title = '';
    $('pH').title = '';
  }
}

/* 文字组件的默认样式（取自组件定义，避免两处维护） */
function 文字默认样式(){
  const c = COMPONENTS.filter(x => x.id === 'text')[0];
  return c && c.默认 ? Object.assign({}, c.默认) : {
    内容: '{title}', 字体: '', 字号: 0, 字重: 0, 对齐: 'left',
    行距: 1.35, 字距: 0, 颜色: 'ink', 大写: false, 倾斜: false,
    背景: false, 自动换行: false,
  };
}

/* 文字的实际字号（样式为 0 时用主题默认换算）。
   集中一处，避免各调用点算法不一致。 */
function 文字实际字号(样式){
  if (!样式) return Math.max(20, Math.round(TY.displaySize * 0.55));
  if (样式.字号 > 0) return 样式.字号;
  return Math.max(20, Math.round(TY.displaySize * 0.55));
}

/* 让文字组件的框自适应其内容。
   在改内容 / 改字号 / 改字体 / 改行距 / 改字距 后调用。
   固定换行模式下不动（框由用户决定）。

   ## 尺寸上限（重要）
   字号上限挡不住「文字太宽」的情况：
   实测 構成（displaySize 132）下标题框达 1981px，超出 1920 画布。
   因为不同主题的 displaySize 相差 2.6 倍，光靠 clamp 字号不够。

   故模板可给出 最大宽比 / 最大高比（相对画布）：
   若超出，按比例缩减字号再重测 —— 保证任何主题下都不溢出画布。 */
function 自适应文字框(p){
  if (p.id !== 'text') return;
  const comp = COMPONENTS.filter(x => x.id === 'text')[0];
  if (!comp || !comp.测量) return;
  const 样式 = p.样式 || 文字默认样式();
  if (样式.自动换行) return;              /* 固定换行：框不变 */

  let m = comp.测量(样式, 0);

  const 限w = 样式.最大宽比 ? 画布.w * 样式.最大宽比 : Infinity;
  const 限h = 样式.最大高比 ? 画布.h * 样式.最大高比 : Infinity;
  let 缩 = 1;
  if (m.w > 限w) 缩 = Math.min(缩, 限w / m.w);
  if (m.h > 限h) 缩 = Math.min(缩, 限h / m.h);
  if (缩 < 1) {
    const 原 = 文字实际字号(样式);
    样式.字号 = Math.max(8, Math.round(原 * 缩));
    m = comp.测量(样式, 0);
  }

  /* 右边界约束：框不能超出画布。
     ------------------------------------------------------------
     只按 最大宽比 收窄是不够的 —— 多数主题不设这个值，
     于是框宽就是文字原宽。displaySize 大的主题（如 chrome_freak 的 120）
     实测标题宽 2206px > 1920。

     与 src/components/text.js 的缩字号逻辑配套：
       text.js      画的时候不溢出（把绘制框 clamp 到右边界）
       这里         存的框尺寸也不溢出
     只做一处会导致「选中框比画面大」的不一致。 */
  const 右界 = Math.max(60, 画布.w - Math.max(0, p.x || 0));
  if (m.w > 右界) {
    const 底线 = Math.max(8, Math.round(文字实际字号(样式) * 0.3));
    for (let 轮 = 0; 轮 < 6; 轮++) {
      const 目标 = Math.max(
        底线, Math.floor(样式.字号 * (右界 / m.w) * 0.99));
      if (目标 >= 样式.字号) break;
      样式.字号 = Math.min(样式.字号 - 1, 目标);
      m = comp.测量(样式, 0);
      if (m.w <= 右界) break;
      if (样式.字号 <= 底线) break;
    }
  }

  p.w = Math.max(40, Math.min(m.w, 右界));
  p.h = Math.max(24, m.h);
}

/* 初始化字体下拉（按类分组） */
function 初始化字体下拉(){
  const sel = $('tFont');
  sel.innerHTML = '';
  const 跟随 = document.createElement('option');
  跟随.value = '';
  跟随.textContent = 译('font.followTheme',
                       { name: 主题字体名('display') });
  sel.appendChild(跟随);

  const 组 = 字体分组();
  Object.keys(组).forEach(类 => {
    const og = document.createElement('optgroup');
    og.label = 类;
    组[类].forEach(名 => {
      const o = document.createElement('option');
      o.value = 名; o.textContent = 名;
      og.appendChild(o);
    });
    sel.appendChild(og);
  });
}

function 填充文字面板(s){
  $('tContent').value = s.内容;
  $('tFont').value = s.字体 || '';
  $('tRole').value = s.角色 || 'display';
  $('tSize').value = s.字号 || '';
  $('tWeight').value = String(s.字重 || 0);
  $('tLine').value = s.行距;
  $('tTrack').value = s.字距;
  $('tColor').value = s.颜色;
  $('tUpper').checked = !!s.大写;
  $('tItalic').checked = !!s.倾斜;
  $('tBg').checked = !!s.背景;
  $('tWrap').checked = !!s.自动换行;
  /* 自适应模式下宽高由内容决定，禁用几何输入避免混淆 */
  const 锁 = !s.自动换行;
  $('pW').disabled = 锁;
  $('pH').disabled = 锁;
  $('pW').title = 锁 ? '框自适应文本；开启「固定换行」后可手动调整' : '';
  $('pH').title = $('pW').title;
  [...$('tAlign').children].forEach(b =>
    b.classList.toggle('on', b.dataset.a === s.对齐));
  [...$('tRot').children].forEach(b =>
    b.classList.toggle('on', Number(b.dataset.r) === (s.旋转 || 0)));
}

function 改文字(键, 值){
  const p = 放置.find(x => x.uid === 选中);
  if (!p || p.id !== 'text') return;
  if (!p.样式) p.样式 = 文字默认样式();
  p.样式[键] = 值;

  /* 手动改字号 = 明确指定，此后不再随主题缩放。
     故清掉倍率 —— 否则切主题会把用户的设置覆盖掉。
     （「跟随主题」用下拉里的字体=空来表达，字号同理：
       想恢复随主题缩放，重新套用模板即可。） */
  if (键 === '字号') {
    delete p.样式.字号倍率;
    delete p.样式.最小字号;
    delete p.样式.最大字号;
  }

  /* 影响尺寸的改动 → 框自适应 + 重新落位 */
  if (['内容','字号','字体','角色','字重','行距','字距','大写','倾斜',
       '自动换行','旋转'].indexOf(键) >= 0) {
    自适应文字框(p);
    定位文字(p);          /* 尺寸变了要按锚点重新落位，否则会偏移 */
  }
  渲染画布();
}

/* 文字面板事件 */
$('tContent').addEventListener('input', e => 改文字('内容', e.target.value));
$('tFont').addEventListener('change', e => 改文字('字体', e.target.value));
$('tRole').addEventListener('change', e => 改文字('角色', e.target.value));
$('tSize').addEventListener('change', e => 改文字('字号', Number(e.target.value) || 0));
$('tWeight').addEventListener('change', e => 改文字('字重', Number(e.target.value) || 0));
$('tLine').addEventListener('change', e => 改文字('行距', Number(e.target.value) || 1.35));
$('tTrack').addEventListener('change', e => 改文字('字距', Number(e.target.value) || 0));
$('tColor').addEventListener('change', e => 改文字('颜色', e.target.value));
$('tUpper').addEventListener('change', e => 改文字('大写', e.target.checked));
$('tItalic').addEventListener('change', e => 改文字('倾斜', e.target.checked));
$('tBg').addEventListener('change', e => 改文字('背景', e.target.checked));
$('tWrap').addEventListener('change', e => 改文字('自动换行', e.target.checked));
$('tAlign').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  [...e.currentTarget.children].forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  改文字('对齐', b.dataset.a);
});

$('tRot').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  [...e.currentTarget.children].forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  /* 旋转会交换框的宽高，故改完要重新自适应 */
  改文字('旋转', Number(b.dataset.r));
  const p = 放置.find(x => x.uid === 选中);
  if (p && p.id === 'text') { 自适应文字框(p); 渲染画布(); }
});

/* 柔化滑块 */
/* 窗口拖动：实时重绘该组件，让用户立刻看到窗口大小变化的效果。
   ------------------------------------------------------------
   只重绘受影响的那一个组件（用 重绘组件），不是整画布 ——
   拖动时每帧全量重绘会卡。 */
$('pWin').addEventListener('input', e => {
  const p = 放置.find(x => x.uid === 选中);
  if (!p) return;
  const v = Number(e.target.value) || 1;
  p.窗口 = v;
  $('pWinVal').textContent = v + ' 小节';
  const el = stage.querySelector('.win[data-uid="' + p.uid + '"]');
  if (el) 重绘单个组件(p, el);
});
$('pWin').addEventListener('change', () => { 记录历史(); });

$('pFade').addEventListener('input', e => {
  const p = 放置.find(x => x.uid === 选中);
  if (!p) return;
  const v = Number(e.target.value);
  p.柔化 = v / 100;
  $('pFadeVal').textContent = v + '%';
  渲染画布();
});

/* 组件内文字开关 */
$('pHideText').addEventListener('change', e => {
  const 项 = 选中项();
  if (!项.length) return;
  项.forEach(function (p) { p.隐藏文字 = e.target.checked; });
  渲染画布();
  记录历史();
  toast(e.target.checked ? '已隐藏组件内文字' : '已显示组件内文字');
});
function 最大公约数(a, b){ return b ? 最大公约数(b, a % b) : a; }

['pX','pY','pW','pH','pZ'].forEach(id => {
  $(id).addEventListener('change', () => {
    const p = 放置.find(x => x.uid === 选中);
    if (!p) return;
    p.x = Number($('pX').value) || 0;
    p.y = Number($('pY').value) || 0;
    p.w = Math.max(60, Number($('pW').value) || 60);
    p.h = Math.max(40, Number($('pH').value) || 40);
    p.z = Number($('pZ').value) || 1;
    渲染画布();
  });
});

$('zUp').onclick = () => {
  const p = 放置.find(x => x.uid === 选中);
  if (!p) return;
  const maxZ = 放置.reduce((m, q) => Math.max(m, q.z), 0);
  if (p.z < maxZ) { p.z = maxZ + 1; 渲染画布(); toast('已置顶'); }
  else toast('已在最上层');
};
$('zDown').onclick = () => {
  const p = 放置.find(x => x.uid === 选中);
  if (!p) return;
  const minZ = 放置.reduce((m, q) => Math.min(m, q.z), 99);
  if (p.z > minZ) { p.z = Math.max(1, p.z - 1); 渲染画布(); toast('已下移'); }
  else toast('已在最下层');
};
$('btnHide').onclick = () => {
  const p = 放置.find(x => x.uid === 选中);
  if (!p) return;
  p.hidden = !p.hidden;
  渲染画布();
  渲染属性();          /* 按钮文案要跟着变 */
  渲染图层();
  记录历史();
  toast(p.hidden ? 译('msg.hidden') : 译('msg.shown'));
};
$('btnDel').onclick = () => {
  /* 统一走 删除选中()，这样历史记录与多选都正确 */
  if (!选中数()) return;
  删除选中();
};

/* ============================================================
   图层列表
   ============================================================ */
function 渲染图层(){
  const box = $('layerList');
  box.innerHTML = '';
  [...放置].sort((a, b) => b.z - a.z).forEach(p => {
    const spec = 查找组件(p.id);
    const d = document.createElement('div');
    d.className = 'layerItem' + (p.uid === 选中 ? ' sel' : '') +
                  (p.hidden ? ' hidden' : '');
    d.innerHTML =
      '<span class="li-name">' + (spec ? spec.name : p.id) + '</span>' +
      '<span class="li-z">z' + p.z + '</span>' +
      '<span class="li-eye">' + (p.hidden ? '◌' : '●') + '</span>';
    d.onclick = e => {
      if (e.target.classList.contains('li-eye')) {
        p.hidden = !p.hidden;
        渲染画布(); 渲染图层();
        记录历史();
        return;
      }
      单选(p.uid);
      更新选中样式(); 渲染属性(); 渲染图层();
    };
    box.appendChild(d);
  });
  if (!放置.length) {
    box.innerHTML = '<div style="font-size:11.5px;color:var(--fg2);padding:6px 2px">' +
      '画布中还没有组件</div>';
  }
}

/* ============================================================
   顶栏 / 底栏
   ============================================================ */
$('segOrient').onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.o === 方向) return;          /* 没变就不动 */
  [...e.currentTarget.children].forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  方向 = b.dataset.o;
  画布 = 方向 === 'land' ? { w:1920, h:1080 } : { w:1080, h:1920 };

  /* 已套用模板 → 顺手套用该模板的另一方向版本。
     否则横屏的布局原样留在竖屏画布上，大多会超出边界
     （模板为两个方向分别设计了构图，不是简单重排）。 */
  const t = 当前模板 ? TEMPLATES.filter(x => x.id === 当前模板)[0] : null;
  if (t && t.id !== 'blank') {
    套用模板(t);                 /* 内部会渲染 + 记历史 */
    适应窗口();
    渲染模板();
    toast(译('msg.switchOrient', {
      dir: 译(方向 === 'land' ? 'word.landscape' : 'word.portrait'),
      name: t.name
    }));
    return;
  }

  适应窗口(); 渲染模板(); 渲染画布();
  toast('画布：' + 画布.w + '×' + 画布.h);
};
$('segFps').onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  [...e.currentTarget.children].forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  帧率 = parseInt(b.dataset.f, 10) || 30;
  toast('帧率：' + 帧率 + ' fps');
};

function 适应窗口(){
  const wrap = $('canvasWrap');
  const aw = wrap.clientWidth - 52, ah = wrap.clientHeight - 52;
  缩放 = Math.min(aw / 画布.w, ah / 画布.h, 1);
  应用缩放();
}
window.addEventListener('resize', 适应窗口);
$('zoomIn').onclick  = () => { 缩放 = Math.min(2, 缩放 + 0.08); 应用缩放(); };
$('zoomOut').onclick = () => { 缩放 = Math.max(0.15, 缩放 - 0.08); 应用缩放(); };
$('zoomFit').onclick = 适应窗口;

/* 把当前画布状态导出成布局对象。
   逐项列出字段，不用展开运算符 —— 新增属性（柔化 / 隐藏文字 / 样式）
   必须显式带上，否则保存后丢失。 */
function 取布局(){
  return {
    版本: 1,
    画布: { w: 画布.w, h: 画布.h },
    主题: 主题键,
    帧率: 帧率,
    静帧秒: 静帧秒,
    工程: (window.__PROJECT__ || {}).name || DATA.projectName || null,
    组件: 放置.map(function (p) {
      const o = { id:p.id, x:p.x, y:p.y, w:p.w, h:p.h, z:p.z,
                  hidden: !!p.hidden };
      if (p.柔化 !== undefined) o.柔化 = p.柔化;
      if (p.隐藏文字 !== undefined) o.隐藏文字 = p.隐藏文字;
      /* 窗口：只存显式设过的值。没设过就不写 ——
         让组件用自己的默认，避免把「当前默认」固化进布局。 */
      if (p.窗口 !== undefined && p.窗口 !== null) o.窗口 = p.窗口;
      if (p.样式) o.样式 = p.样式;
      return o;
    }),
  };
}

/* 把布局对象恢复到画布上。返回恢复的组件数。 */
function 套用布局(d){
  if (!d || !d.组件) return 0;
  if (d.画布 && d.画布.w && d.画布.h) {
    画布 = { w: d.画布.w, h: d.画布.h };
    方向 = (画布.w > 画布.h) ? 'land' : 'port';
    [...$('segOrient').children].forEach(b =>
      b.classList.toggle('on', b.dataset.o === 方向));
  }
  if (d.主题) { 主题键 = d.主题; 渲染主题(); }
  if (d.帧率) {
    帧率 = d.帧率;
    [...$('segFps').children].forEach(b =>
      b.classList.toggle('on', Number(b.dataset.f) === 帧率));
  }
  放置 = d.组件.map(function (c) {
    /* uid 重新分配：避免与当前画布上的对象冲突 */
    const p = { uid: uidSeq++, id: c.id, x: c.x, y: c.y, w: c.w, h: c.h,
                z: c.z || 1, hidden: !!c.hidden };
    if (c.柔化 !== undefined) p.柔化 = c.柔化;
    if (c.隐藏文字 !== undefined) p.隐藏文字 = c.隐藏文字;
    /* 窗口设置（时间窗/频率窗等）也必须恢复 ——
       取布局() 存了它，这里不读就等于保存了却丢掉。 */
    if (c.窗口 !== undefined && c.窗口 !== null) p.窗口 = c.窗口;
    if (c.样式) p.样式 = Object.assign(文字默认样式(), c.样式);
    return p;
  });
  清空选择();
  /* 文字框按存下来的字号重算（存的是绝对值，不依赖当前主题） */
  放置.forEach(function (p) {
    if (p.id === 'text' && p.样式) 自适应文字框(p);
  });
  适应窗口(); 渲染画布(); 渲染组件库(); 渲染图层(); 渲染属性();
  记录历史();
  return 放置.length;
}

$('btnSaveLayout').onclick = async () => {
  const 数据 = 取布局();
  if (!服务模式) {
    console.log('layout.json =', JSON.stringify(数据, null, 2));
    toast('离线原型：布局已输出到控制台（F12 查看）');
    return;
  }
  const 名 = prompt('保存为（不含扩展名）',
    (window.__PROJECT__ || {}).name || DATA.projectName || 'layout');
  if (!名) return;
  const r = await 调接口('/api/layout/save', { 名称: 名, 布局: 数据 });
  if (r.ok) toast('已保存：' + r.名称);
  else toast('保存失败：' + (r.错误 || ''));
};

$('btnLoadLayout').onclick = async () => {
  if (!服务模式) {
    toast('离线原型不支持读取，请用 python app_server.py 启动');
    return;
  }
  const 列表 = await (await fetch('/api/layout/list')).json();
  const 项 = (列表.布局 || []);
  if (!项.length) { toast('还没有保存过布局'); return; }
  const 名 = prompt('读取哪个布局？\n\n' +
    项.map((x, i) => (i + 1) + '. ' + x.名称).join('\n'), 项[0].名称);
  if (!名) return;
  const r = await fetch('/api/layout/load', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 名称: 名 }),
  });
  if (!r.ok) { toast('读取失败'); return; }
  const d = await r.json();
  const n = 套用布局(d);
  toast('已读取布局：' + n + ' 个组件');
};
$('btnExport').onclick = () => {
  if (!放置.length) { toast('画布为空，请先添加组件'); return; }
  打开导出面板();
};

/* ============================================================
   导出面板
   ------------------------------------------------------------
   用户确认要「全部参数都暴露，带默认值」：
     输出路径 / 时长 / 起点 / 帧率 / 分辨率 / 码率 / 预设 / 并行度 / 音频
   分辨率与帧率从顶栏带过来（那是画布级设置），面板里也显示出来。
   ============================================================ */
/* 导出可用的时间轴总长。
   ------------------------------------------------------------
   **不能用音频长度** —— 工程可能比音频长得多
   （实测 island：音频 80.6s / 工程 165.9s），按音频会截掉后半段。
   优先取 projectDuration，退回音频长度。 */
function 导出总长(){
  const pm = window.__PROJECT__ || {};
  return (pm.projectDuration || pm.duration ||
          (DATA.audio && DATA.audio.duration) || 0);
}

/* 起点变化时，把时长拉到「剩余可用长度」。
   ------------------------------------------------------------
   这是用户明确预期的行为：工程 120 秒，起点设 60，
   应该导出 60~120 共 60 秒，而不是 120 秒（后半段静止）。
   同时更新输入框的 max，避免用户还能填出超界的值。 */
function 同步导出时长(强制){
  const 总长 = 导出总长();
  if (!(总长 > 0)) return;
  const 起 = Math.max(0, Math.min(parseFloat($('exStart').value) || 0, 总长));
  const 剩余 = Math.max(0.1, 总长 - 起);
  const 当前 = parseFloat($('exDur').value) || 0;
  if (强制 || !(当前 > 0) || 当前 > 剩余 + 1e-6) {
    $('exDur').value = 剩余.toFixed(2);
  }
  $('exDur').max = 剩余.toFixed(2);
  $('exStart').max = 总长.toFixed(2);
}

function 打开导出面板(){
  const pm = window.__PROJECT__ || {};
  const 时长 = 导出总长();
  $('exOut').value = pm.输出默认 ||
    ((pm.name || DATA.projectName || 'visualizer') + '.mp4');
  $('exStart').value = '0';
  $('exDur').value = 时长.toFixed(2);
  $('exTotal').textContent = 时长.toFixed(2);
  同步导出时长(true);
  $('exFps').textContent = 帧率;
  $('exSize').textContent = 画布.w + '×' + 画布.h;
  $('exBitrate').value = '';
  $('exPreset').value = 'medium';
  $('exParallel').value = '';
  $('exAudio').checked = true;
  $('exProg').style.display = 'none';
  $('exResult').style.display = 'none';
  $('exErr').style.display = 'none';
  $('exGo').disabled = false;
  $('exGo').textContent = '开始导出';
  $('exModal').classList.add('on');

  if (!服务模式) {
    $('exErr').style.display = 'block';
    $('exErr').textContent =
      '当前是离线原型（直接打开 HTML 文件），没有本地服务，无法真正导出。' +
      '请用 python app_server.py 启动后再试。';
    $('exGo').disabled = true;
  }
}

/* 起点改了就把时长收到剩余长度内 —— 用户改起点多半是想「从这导到结尾」 */
$('exStart').addEventListener('change', () => 同步导出时长(true));
$('exStart').addEventListener('input', () => {
  /* 输入过程中只更新 max，不改用户正在填的时长，避免打断输入 */
  const 总长 = 导出总长();
  const 起 = parseFloat($('exStart').value) || 0;
  if (总长 > 0 && 起 >= 0 && 起 < 总长) {
    $('exDur').max = Math.max(0.1, 总长 - 起).toFixed(2);
  }
});

$('exClose').onclick = () => $('exModal').classList.remove('on');
$('exModal').onclick = (e) => {
  if (e.target === $('exModal')) $('exModal').classList.remove('on');
};

$('exPickOut').onclick = async () => {
  const p = await 选文件('out');
  if (p) $('exOut').value = p;
};

let 当前渲染任务 = null;

$('exCancel').onclick = async () => {
  if (当前渲染任务) {
    await 调接口('/api/cancel', { id: 当前渲染任务 });
    $('exStage').textContent = '正在取消…';
  }
};

$('exGo').onclick = async () => {
  if (!服务模式) return;
  /* 记住本次参数，下次打开直接带出 */
  保存导出参数();
  /* 时长与起点：clamp 到工程总长内。
     ------------------------------------------------------------
     不 clamp 的话，起点 60 + 时长 120 会渲染 60~180 秒，
     而工程只到 120 秒 —— 后 60 秒全是同一张静止画面（真实 bug）。
     这里再拦一次，即使服务端 clamp 也先给用户明确提示。 */
  const 总长 = 导出总长();
  const 起点 = Math.max(0, parseFloat($('exStart').value) || 0);
  let 时长 = parseFloat($('exDur').value) || 0;
  if (时长 <= 0) { toast('时长必须大于 0'); return; }
  if (总长 > 0) {
    if (起点 >= 总长) {
      toast('起点超出工程长度（共 ' + 总长.toFixed(1) + ' 秒）');
      return;
    }
    const 剩余 = 总长 - 起点;
    if (时长 > 剩余 + 0.01) {
      const 原 = 时长;
      时长 = Math.max(0.1, Math.round(剩余 * 100) / 100);
      $('exDur').value = 时长.toFixed(2);
      toast('时长已按工程长度收窄：' + 原.toFixed(1) + ' → ' +
            时长.toFixed(1) + ' 秒（起点 ' + 起点.toFixed(1) + ' 秒）');
    }
  }

  /* 布局 = 画布上所有组件的完整状态，含柔化 / 隐藏文字 / 文字样式。
     逐项列出，不用展开运算符 —— 新增属性容易漏。 */
  const 组件 = 放置.filter(p => !p.hidden).map(function (p) {
    const o = { id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, z: p.z };
    if (p.柔化 !== undefined) o.柔化 = p.柔化;
    if (p.隐藏文字 !== undefined) o.隐藏文字 = p.隐藏文字;
    if (p.窗口 !== undefined && p.窗口 !== null) o.窗口 = p.窗口;
    if (p.样式) o.样式 = p.样式;
    return o;
  });

  const 参数 = {
    flp: (window.__PROJECT__ || {}).flp,
    audio: (window.__PROJECT__ || {}).audio,
    主题: 主题键,
    画布: { w: 画布.w, h: 画布.h },
    帧率: 帧率,
    时长: 时长,
    起点: 起点,
    输出: $('exOut').value.trim(),
    码率: $('exBitrate').value.trim() || null,
    预设: $('exPreset').value,
    并行度: parseInt($('exParallel').value, 10) || null,
    无音频: !$('exAudio').checked,
    组件: 组件,
  };

  $('exGo').disabled = true;
  $('exGo').textContent = '导出中…';
  $('exErr').style.display = 'none';
  $('exResult').style.display = 'none';
  $('exProg').style.display = 'block';
  $('exProg').classList.remove('done');

  try {
    const r = await 调接口('/api/render', 参数);
    if (!r.id) throw new Error(r.错误 || '服务未受理');
    当前渲染任务 = r.id;

    const t = await 等任务(r.id, (t) => {
      $('exBar').style.width = Math.round((t.进度 || 0) * 100) + '%';
      $('exPct').textContent = Math.round((t.进度 || 0) * 100) + '%';
      $('exStage').textContent = t.阶段 || '';
      $('exMsg').textContent = t.消息 || '';
    });

    $('exBar').style.width = '100%';
    if (t.状态 === '完成') {
      $('exPct').textContent = '100%';
      $('exStage').textContent = '完成';
      $('exMsg').textContent = '';
      const 产 = t.产物 || {};
      const 用时 = 产.耗时 ? ('（用时 ' + 产.耗时 + 's）') : '';
      /* 文件已经**直接写到用户选的路径**了，不需要再点下载。
         之前那个「下载」链接是「服务端产出、浏览器取回」的遗留，
         点它只会让人以为成品在别处。 */
      const 路径 = 产.视频 || 参数.输出 || '';
      $('exResult').style.display = 'block';
      $('exResult').innerHTML =
        译('export.saved') + '：<b class="mPath">' + 路径 + '</b>' + 用时;
      $('exProg').classList.add('done');
      toast(译('msg.exportSaved'));
    } else {
      throw new Error(t.错误 || ('任务' + t.状态));
    }
  } catch (e) {
    $('exErr').style.display = 'block';
    $('exErr').textContent = '导出失败：' + e.message;
    toast('导出失败');
  } finally {
    $('exGo').disabled = false;
    $('exGo').textContent = '开始导出';
    当前渲染任务 = null;
  }
};

/* ============================================================
   初始化
   ============================================================ */
/* ============================================================
   右键菜单
   ------------------------------------------------------------
   两套：组件上、空白处。
   右键菜单是「发现性」的主要入口 —— 用户不必记住快捷键。
   ============================================================ */
const ctx = $('ctxmenu');

function 关闭菜单(){ ctx.classList.remove('on'); }

function 显示菜单(x, y, 项){
  ctx.innerHTML = '';
  项.forEach(function (it) {
    if (it === '-') {
      const s = document.createElement('div');
      s.className = 'sep';
      ctx.appendChild(s);
      return;
    }
    const d = document.createElement('div');
    d.className = 'mi' + (it.禁用 ? ' disabled' : '');
    d.innerHTML = '<span>' + it.名 + '</span>' +
      (it.键 ? '<span class="k">' + it.键 + '</span>' : '');
    if (!it.禁用) {
      d.onclick = function (ev) {
        ev.stopPropagation();
        关闭菜单();
        it.动作();
      };
    }
    ctx.appendChild(d);
  });

  /* 先显示再量尺寸，避免超出视口 */
  ctx.style.left = x + 'px';
  ctx.style.top = y + 'px';
  ctx.classList.add('on');
  const b = ctx.getBoundingClientRect();
  if (b.right > window.innerWidth - 8) {
    ctx.style.left = Math.max(4, window.innerWidth - b.width - 8) + 'px';
  }
  if (b.bottom > window.innerHeight - 8) {
    ctx.style.top = Math.max(4, window.innerHeight - b.height - 8) + 'px';
  }
}

stage.addEventListener('contextmenu', function (e) {
  e.preventDefault();
  const win = e.target.closest('.win');

  if (!win) {
    /* 空白处菜单 */
    const 有剪贴 = 剪贴板.length > 0;
    显示菜单(e.clientX, e.clientY, [
      { 名: '粘贴', 键: 'Ctrl+V', 动作: 粘贴, 禁用: !有剪贴 },
      { 名: '全选', 键: 'Ctrl+A', 动作: function () {
          全选(); 更新选中样式(); 渲染属性(); 渲染图层();
          toast('已全选 ' + 选中数() + ' 个组件');
        }, 禁用: 放置.length === 0 },
      '-',
      { 名: '撤销', 键: 'Ctrl+Z', 动作: function () {
          撤销(); 更新选中样式(); 渲染属性(); 渲染图层(); },
        禁用: 历史.位置 <= 0 },
      { 名: '重做', 键: 'Ctrl+Shift+Z', 动作: function () {
          重做(); 更新选中样式(); 渲染属性(); 渲染图层(); },
        禁用: 历史.位置 >= 历史.栈.length - 1 },
      '-',
      { 名: '适应窗口', 键: 'Ctrl+0', 动作: 适应窗口 },
      { 名: '实际大小', 键: 'Ctrl+1', 动作: function () {
          缩放 = 1; 应用缩放(); } },
    ]);
    return;
  }

  /* 组件菜单：若右键的组件未选中，先选中它 */
  const uid = Number(win.dataset.uid);
  if (!已选中(uid)) {
    单选(uid);
    更新选中样式(); 渲染属性(); 渲染图层();
  }
  const n = 选中数();
  const 后缀 = n > 1 ? '（' + n + ' 个）' : '';

  显示菜单(e.clientX, e.clientY, [
    { 名: '复制' + 后缀, 键: 'Ctrl+C', 动作: 复制选中 },
    { 名: '剪切' + 后缀, 键: 'Ctrl+X', 动作: 剪切 },
    { 名: '原地复制', 键: 'Ctrl+D', 动作: 原地复制 },
    { 名: '粘贴', 键: 'Ctrl+V', 动作: 粘贴, 禁用: !剪贴板.length },
    '-',
    { 名: '置顶', 键: 'Ctrl+Shift+]', 动作: 层序置顶 },
    { 名: '置底', 键: 'Ctrl+Shift+[', 动作: 层序置底 },
    '-',
    { 名: '隐藏', 动作: function () {
        const 项 = 选中项();
        if (!项.length) return;
        项.forEach(function (p) { p.hidden = true; });
        清空选择();
        渲染画布(); 渲染组件库();
        记录历史();
        toast('已隐藏 ' + 项.length + ' 个组件');
      } },
    { 名: '删除' + 后缀, 键: 'Delete', 动作: 删除选中 },
  ]);
});

/* 点击任何地方都关闭菜单 */
window.addEventListener('mousedown', function (e) {
  if (!ctx.contains(e.target)) 关闭菜单();
}, true);
window.addEventListener('blur', 关闭菜单);
window.addEventListener('resize', 关闭菜单);

/* ============================================================
   视图操作
   ============================================================ */

/* Ctrl+滚轮 缩放画布（以光标位置为锚，手感更自然） */
$('canvasWrap').addEventListener('wheel', function (e) {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  const 旧 = 缩放;
  const 步 = e.deltaY > 0 ? -0.08 : 0.08;
  缩放 = Math.max(0.1, Math.min(3, 缩放 + 步));
  if (缩放 === 旧) return;
  应用缩放();
}, { passive: false });

/* 空格 + 拖动 = 平移画布 */
let 空格按下 = false;
let 平移 = null;
window.addEventListener('keydown', function (e) {
  if (e.code === 'Space' && 编辑中 === null) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    空格按下 = true;
    e.preventDefault();
    $('canvasWrap').style.cursor = 'grab';
  }
});
window.addEventListener('keyup', function (e) {
  if (e.code === 'Space') {
    空格按下 = false;
    平移 = null;
    $('canvasWrap').style.cursor = '';
  }
});
$('canvasWrap').addEventListener('mousedown', function (e) {
  if (!空格按下) return;
  e.preventDefault();
  e.stopPropagation();     /* 不触发框选 */
  平移 = { x: e.clientX, y: e.clientY,
           sl: $('canvasWrap').scrollLeft, st: $('canvasWrap').scrollTop };
  $('canvasWrap').style.cursor = 'grabbing';
}, true);
window.addEventListener('mousemove', function (e) {
  if (!平移) return;
  $('canvasWrap').scrollLeft = 平移.sl - (e.clientX - 平移.x);
  $('canvasWrap').scrollTop = 平移.st - (e.clientY - 平移.y);
});
window.addEventListener('mouseup', function () {
  if (平移) {
    平移 = null;
    $('canvasWrap').style.cursor = 空格按下 ? 'grab' : '';
  }
});

/* ============================================================
   初始化
   ============================================================ */
function 初始化(){
  /* 先按当前语言填一遍静态文案。
     window.__LANG__ 由构建/服务端注入（来自 settings.json）。
     未注入时 i18n 默认中文。 */
  try {
    if (typeof 应用语言 === 'function') 应用语言();
  } catch (e) { console.error('[i18n]', e); }

  渲染主题();
  渲染模板();
  渲染组件库();
  初始化字体下拉();
  应用缩放();
  适应窗口();
  渲染画布();

  /* 从工程文件还原画布。
     ------------------------------------------------------------
     window.__RESTORE__ 由服务端在构建页面时注入
     （preview/build_gui.py 的 构建页面(待恢复=…)）。
     **必须放在 渲染画布() 之后** —— 套用布局() 依赖 stage 已就绪。

     这个调用曾经漏掉：函数定义了却没人调，
     导致打开工程只恢复「导入 FLP 后的初始状态」，
     画布上的组件与主题全部丢失。 */
  try {
    if (尝试还原工程()) {
      /* 刚打开的文件不该显示「未保存」：
         重置撤销基线，把还原后的状态当作干净起点。 */
      历史.栈 = [];
      历史.位置 = -1;
      记录历史();
      清除脏();
    }
  } catch (e) {
    console.error('[restore]', e);
  }
  /* 初始快照，作为撤销的起点 */
}


/* ============================================================
   设置面板
   ------------------------------------------------------------
   设置存在服务端（%APPDATA%/FLVisualizer/settings.json）。
   离线原型（file://）下没有服务，面板会提示不可用。

   语言切换的特殊处理：
     改语言后**立即**在客户端应用（不刷新），
     同时存到服务端 —— 下次构建页面时直接用新语言，
     避免先闪一下中文再切英文。
   ============================================================ */

let 设置快照缓存 = null;

async function 载入设置(){
  if (!服务模式) return null;
  try {
    const r = await fetch('/api/settings');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    设置快照缓存 = await r.json();
    return 设置快照缓存;
  } catch (e) {
    console.warn('[settings] 载入失败', e);
    return null;
  }
}

function 填充设置面板(快照){
  if (!快照) return;
  const s = 快照.设置 || {};
  const 常规 = s['常规'] || {};
  const 路径 = s['路径'] || {};
  const 导出 = s['导出'] || {};

  if ($('setLang')) $('setLang').value = 常规['语言'] || 'auto';
  if ($('setProjDir')) $('setProjDir').value = 路径['工程目录'] || '';
  if ($('setExportDir')) $('setExportDir').value = 路径['导出目录'] || '';
  if ($('setCacheDir')) $('setCacheDir').value = 路径['缓存目录'] || '';
  if ($('setFps')) $('setFps').value = 导出['帧率'] || 30;
  if ($('setPreset')) $('setPreset').value = 导出['编码预设'] || 'medium';
  if ($('setParallel')) $('setParallel').value = 导出['并行度'] || 0;
  if ($('setOpenFolder')) $('setOpenFolder').checked = !!导出['完成后打开目录'];

  /* 语言提示：auto 时显示系统语言，否则显示当前生效语言 */
  const 提示 = $('setLangHint');
  if (提示) {
    if ((常规['语言'] || 'auto') === 'auto') {
      提示.textContent = 译('set.followSystem',
        { lang: 快照.系统语言 === 'zh' ? '中文' : 'English' });
    } else {
      提示.textContent = '';
    }
  }

  /* 路径提示：显示解析后的真实路径 + 是否可写 */
  const 路径信息 = 快照.路径 || {};
  const 设占位 = (id, 名) => {
    const el = $(id);
    if (!el) return;
    el.placeholder = 路径信息[名] || '';
  };
  设占位('setProjDir', '工程目录');
  设占位('setExportDir', '导出目录');
  设占位('setCacheDir', '缓存目录');

  if ($('setConfigPath')) {
    $('setConfigPath').textContent = 快照.配置文件 || '';
  }

  /* 缓存大小 */
  刷新缓存大小();
}

async function 刷新缓存大小(){
  if (!服务模式 || !$('setCacheSize')) return;
  try {
    const r = await fetch('/api/settings/dirs');
    const d = await r.json();
    const c = d['缓存目录'] || {};
    const 字节 = c['字节'] || 0;
    const 文本 = 字节 > 1048576
      ? (字节 / 1048576).toFixed(1) + ' MB'
      : Math.max(0, Math.round(字节 / 1024)) + ' KB';
    $('setCacheSize').textContent = 文本 +
      (c['可写'] === false ? ' · ' + 译('set.notWritable') : '');
  } catch (e) {
    /* 忽略 */
  }
}

async function 打开设置面板(){
  $('setModal').classList.add('on');
  if (!服务模式) {
    const 提示 = $('setLangHint');
    if (提示) 提示.textContent = 译('offline.startFirst');
    return;
  }
  const 快照 = await 载入设置();
  if (快照) 填充设置面板(快照);
  else toast(译('set.loadFailed'));
}

async function 保存设置(){
  if (!服务模式) { toast(译('offline.startFirst')); return; }

  const 补丁 = {
    '常规': {
      '语言': $('setLang').value,
    },
    '路径': {
      '工程目录': $('setProjDir').value.trim(),
      '导出目录': $('setExportDir').value.trim(),
      '缓存目录': $('setCacheDir').value.trim(),
    },
    '导出': {
      '帧率': parseInt($('setFps').value, 10) || 30,
      '编码预设': $('setPreset').value,
      '并行度': parseInt($('setParallel').value, 10) || 0,
      '完成后打开目录': !!$('setOpenFolder').checked,
    },
  };

  try {
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 补丁 }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.错误 || 'unknown');

    设置快照缓存 = d.设置;
    填充设置面板(d.设置);

    /* 语言立即生效（不刷新页面） */
    const 目标 = d.设置['生效语言'];
    if (目标 && 目标 !== 取语言()) 切换语言(目标);

    toast(译('set.saved'));
  } catch (e) {
    toast(译('set.saveFailed') + e.message);
  }
}

async function 重置设置(){
  if (!服务模式) { toast(译('offline.startFirst')); return; }
  try {
    const r = await fetch('/api/settings/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.错误 || 'unknown');
    设置快照缓存 = d.设置;
    填充设置面板(d.设置);
    const 目标 = d.设置['生效语言'];
    if (目标 && 目标 !== 取语言()) 切换语言(目标);
    toast(译('set.saved'));
  } catch (e) {
    toast(译('set.saveFailed') + e.message);
  }
}

/* 语言变更后：重填静态文案已由 切换语言() 内部完成，
   这里补刷那些由 JS 动态生成的文案（状态行、图层等）。 */
设语言切换后(function () {
  try {
    应用语言();
    if (typeof 检查导入 === 'function') 检查导入();
    if (typeof 渲染属性 === 'function') 渲染属性();
    if (typeof 渲染图层 === 'function') 渲染图层();
  } catch (e) { console.warn('[i18n] 重渲染失败', e); }
});

/* ---- 绑定 ---- */
if ($('btnSettings')) {
  $('btnSettings').onclick = () => 打开设置面板();
}
if ($('setClose')) {
  $('setClose').onclick = () => $('setModal').classList.remove('on');
}
if ($('setSave')) {
  $('setSave').onclick = () => 保存设置();
}
if ($('setReset')) {
  $('setReset').onclick = () => 重置设置();
}
if ($('setModal')) {
  $('setModal').onclick = (e) => {
    if (e.target === $('setModal')) $('setModal').classList.remove('on');
  };
}
if ($('setLang')) {
  /* 改语言时立即预览（不必等保存） */
  $('setLang').onchange = () => {
    const v = $('setLang').value;
    if (v !== 'auto' && v !== 取语言()) 切换语言(v);
  };
}

/* 启动时按注入的语言初始化 */
(function () {
  const 注入 = (typeof window.__LANG__ === 'string') ? window.__LANG__ : null;
  if (注入 && 有语言(注入)) 设语言(注入);
})();


/* ============================================================
   从工程文件还原布局
   ------------------------------------------------------------
   服务端打开 .flvproj 后，下次构建页面会注入 window.__RESTORE__：
     { 布局, 主题, 静帧秒, 导出设置 }
   这里在初始化时把它应用上去。

   为什么不在构建期直接生成布局：
     构建期只负责给数据，画布还原需要跑 套用布局() 的全套逻辑
     （重算文字框、适应窗口、渲染图层…），必须在前端做。
   ============================================================ */

function 尝试还原工程(){
  const r = window.__RESTORE__;
  if (!r || !r.布局) return false;
  try {
    if (r.主题) {
      主题键 = r.主题;
      渲染主题();
    }
    if (typeof r.静帧秒 === 'number') 静帧秒 = r.静帧秒;

    const 组件 = (r.布局.组件 || []);
    if (组件.length) {
      套用布局(r.布局);
      toast(译('msg.projectRestored', { n: 组件.length }));
      return true;
    }
  } catch (e) {
    console.error('[restore]', e);
    toast(译('msg.projectRestoreFailed') + e.message);
  }
  return false;
}


/* ============================================================
   工程管理：保存 / 打开 / 最近列表 / 未保存提示
   ------------------------------------------------------------
   工程文件是 .flvproj（zip：元数据 + 分析缓存 + 缩略图）。
   服务端负责读写，前端负责收集当前状态与还原。

   未保存提示的意义：
     用户调了半天布局，切工程或关页面时全丢了，体验极差。
     故记录脏标记，在离开前提示。
   ============================================================ */

let 未保存 = false;

function 标记脏(){
  if (未保存) return;
  未保存 = true;
  if ($('tbDirty')) $('tbDirty').style.display = '';
}

function 清除脏(){
  未保存 = false;
  if ($('tbDirty')) $('tbDirty').style.display = 'none';
}

/* 收集当前工程状态（保存用） */
function 收集工程状态(){
  const 布局 = 取布局();
  return {
    名称: (window.__PROJECT__ || {}).name ||
          DATA.projectName || '未命名工程',
    布局: 布局,
    主题: 主题键,
    静帧秒: 静帧秒,
    导出设置: {
      帧率: 帧率,
      宽度: 画布.w,
      高度: 画布.h,
    },
  };
}

/* 画布首帧缩略图（base64 PNG，去掉 data: 前缀） */
function 截取缩略图(){
  try {
    const cv = document.createElement('canvas');
    const W = 320, H = Math.round(320 * 画布.h / 画布.w);
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
    const s = W / 画布.w;
    放置.forEach(function(p){
      if (p.hidden) return;
      const el = stage.querySelector('.win[data-uid="' + p.uid + '"]');
      const c = el && el.querySelector('canvas');
      if (c) g.drawImage(c, p.x * s, p.y * s, p.w * s, p.h * s);
    });
    return cv.toDataURL('image/png').split(',')[1];
  } catch (e) {
    return null;
  }
}

async function 保存工程(另存为){
  if (!服务模式) { toast(译('offline.startFirst')); return; }
  if (!放置.length) { toast(译('msg.canvasEmpty')); return; }

  let 名称 = (window.__PROJECT__ || {}).name || DATA.projectName ||
             '未命名工程';
  if (另存为) {
    const 输入 = prompt(译('proj.namePrompt'), 名称);
    if (!输入) return;
    名称 = 输入.trim() || 名称;
  }

  const 状态 = 收集工程状态();
  状态.名称 = 名称;
  状态.缩略图 = 截取缩略图();

  try {
    const r = await fetch('/api/project/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(状态),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.错误 || 'unknown');
    清除脏();
    toast(译('proj.saved') + d.名称);
  } catch (e) {
    toast(译('proj.saveFailed') + e.message);
  }
}

async function 打开工程(){
  if (!服务模式) { toast(译('offline.startFirst')); return; }

  if (未保存 && !(await 询问(译('proj.confirmDiscard')))) return;

  const 选 = await 调接口('/api/project/pick', {});
  if (!选 || !选.path) return;
  await 真正打开(选.path);
}

async function 真正打开(路径){
  try {
    const r = await fetch('/api/project/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 路径 }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.错误 || 'unknown');

    /* 服务端已把页面标记为待重建。重载后：
       · 页面用工程的布局/主题构建
       · __RESTORE__ 注入，初始化时还原画布

       带 #enter 重载 —— 与导入流程一致，直接进编辑器。
       否则会停在导入屏，用户还得再点一次「进入编辑器」
       才会触发 初始化() → 还原画布，看起来像「打开工程没反应」。 */
    toast(译('proj.opened') + d.名称);
    清除脏();
    setTimeout(() => {
      location.href = location.pathname + '#enter';
    }, 350);
  } catch (e) {
    toast(译('proj.openFailed') + e.message);
  }
}

async function 载入最近工程(){
  if (!服务模式) return;
  try {
    const r = await fetch('/api/project/recent');
    const d = await r.json();
    const 列表 = d.工程 || [];
    const 框 = $('recentBox');
    const 容器 = $('recentList');
    if (!框 || !容器) return;

    if (!列表.length) { 框.style.display = 'none'; return; }
    框.style.display = 'block';
    容器.innerHTML = '';

    列表.forEach(function (项) {
      const row = document.createElement('div');
      row.className = 'recentItem';

      const 名 = document.createElement('div');
      名.className = 'recentName';
      名.textContent = 项.名称 || '(未命名)';
      row.appendChild(名);

      const 元 = document.createElement('div');
      元.className = 'recentMeta';
      if (项.错误) {
        元.className += ' recentBad';
        元.textContent = 项.错误;
      } else if (项.引用有效 === false) {
        元.className += ' recentBad';
        元.textContent = 译('proj.missingRef');
      } else {
        元.textContent = 译('proj.components', { n: 项.组件数 || 0 });
      }
      row.appendChild(元);

      const 删 = document.createElement('button');
      删.className = 'recentRemove';
      删.textContent = '×';
      删.title = 译('menu.removeFromRecent');
      删.onclick = async (ev) => {
        ev.stopPropagation();
        await 调接口('/api/project/forget', { 路径: 项.路径 });
        载入最近工程();
      };
      row.appendChild(删);

      row.onclick = () => 真正打开(项.路径);
      容器.appendChild(row);
    });
  } catch (e) {
    console.warn('[recent]', e);
  }
}

/* ---- 绑定 ---- */
if ($('btnProjSave')) {
  $('btnProjSave').onclick = (e) => 保存工程(e.shiftKey);
}
if ($('btnProjOpen')) {
  $('btnProjOpen').onclick = () => 打开工程();
}

/* 离开页面提示：有未保存改动时 */
window.addEventListener('beforeunload', function (e) {
  if (未保存) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/* 任何布局改动都标记脏。
   ------------------------------------------------------------
   注意：**不能**写 `记录历史 = function(){...}` ——
   记录历史 是函数声明，严格模式下给它赋值会抛 TypeError，
   导致整个脚本从这里中断（后续所有监听器都不注册）。

   正确做法是在 记录历史 自己的函数体里调 标记脏()。
   见下方 记录历史 的实现。 */


/* ============================================================
   拖拽导入
   ------------------------------------------------------------
   浏览器不给 JS 文件真实路径，故拖入的文件先上传到本机临时目录，
   由服务端返回真实路径。

   上传后**复用既有的导入流程**（写入 已选FLP / 已选音频 →
   检查导入() → 触发 btnEnter），不另写一套 ——
   重复实现会导致「改一处不等于改功能」。

   关于自动配对：
     上传目录里只有本次拖入的文件，没有原目录的其它文件，
     所以服务端无法凭 FLP 路径找到原目录的同名音频。
     真实可用的场景是「FLP 与音频一起拖入」；
     只拖 FLP 时明确提示补上音频，而不是静默失败。
   ============================================================ */

const 允许扩展 = {
  '.flp': 'flp',
  '.mp3': 'audio', '.wav': 'audio', '.flac': 'audio',
  '.ogg': 'audio', '.aiff': 'audio', '.m4a': 'audio',
};
const 上传上限 = 500 * 1024 * 1024;

let 拖拽计数 = 0;
let 正在上传 = false;

function 显示拖拽遮罩(开){
  const m = $('dropMask');
  if (m) m.classList.toggle('on', !!开);
}

/* 拖拽进入/离开要计数：子元素会连续触发 enter/leave，
   只按布尔值会让遮罩闪烁。 */
window.addEventListener('dragenter', function (e) {
  if (!e.dataTransfer || !e.dataTransfer.types) return;
  if (Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') < 0) return;
  e.preventDefault();
  拖拽计数++;
  显示拖拽遮罩(true);
});

window.addEventListener('dragover', function (e) {
  if (!e.dataTransfer || !e.dataTransfer.types) return;
  if (Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') < 0) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

window.addEventListener('dragleave', function (e) {
  if (!e.dataTransfer || !e.dataTransfer.types) return;
  if (Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') < 0) return;
  拖拽计数 = Math.max(0, 拖拽计数 - 1);
  if (拖拽计数 === 0) 显示拖拽遮罩(false);
});

window.addEventListener('drop', function (e) {
  if (!e.dataTransfer || !e.dataTransfer.files ||
      !e.dataTransfer.files.length) return;
  e.preventDefault();
  拖拽计数 = 0;
  显示拖拽遮罩(false);
  const 文件 = Array.prototype.slice.call(e.dataTransfer.files);
  处理拖入文件(文件);
});

/* 上传单个文件：File 直接作为 body，浏览器流式发送 */
async function 上传文件(file){
  const r = await fetch('/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(file.size),
      'X-File-Name': encodeURIComponent(file.name),
    },
    body: file,
  });
  const d = await r.json();
  if (!d.ok) throw new Error(d.错误 || 'upload failed');
  return d;
}

async function 处理拖入文件(文件){
  if (!服务模式) { toast(译('offline.startFirst')); return; }
  if (正在上传) return;
  正在上传 = true;

  try {
    /* 先按扩展名与大小筛掉不合格的 —— 不要传完才发现类型不对 */
    const 合格 = [];
    const 拒绝 = [];
    for (const f of 文件) {
      const 点 = f.name.lastIndexOf('.');
      const 扩展 = 点 >= 0 ? f.name.slice(点).toLowerCase() : '';
      if (!允许扩展[扩展]) { 拒绝.push(f.name); continue; }
      if (f.size > 上传上限) { 拒绝.push(f.name); continue; }
      合格.push({ file: f, 类: 允许扩展[扩展] });
    }
    if (拒绝.length) toast(译('drop.badType', { ext: 拒绝.join(', ') }));
    if (!合格.length) return;

    /* 上传（按 FLP 优先，便于先确定主文件） */
    合格.sort((a, b) => (a.类 === 'flp' ? -1 : 1) -
                        (b.类 === 'flp' ? -1 : 1));

    const 结果 = [];
    for (let i = 0; i < 合格.length; i++) {
      const 项 = 合格[i];
      $('importStatus').textContent = 译('drop.uploading', {
        name: 项.file.name + ' (' + (i + 1) + '/' + 合格.length + ')',
      });
      const 上 = await 上传文件(项.file);
      结果.push({ 类: 项.类, ...上 });
    }
    toast(译('drop.uploaded', { n: 结果.length }));

    const flp = 结果.filter(x => x.类 === 'flp')[0];
    const 音频 = 结果.filter(x => x.类 === 'audio')[0];

    if (!flp) { toast(译('drop.needFlp')); $('importStatus').textContent = ''; return; }

    /* ---- 写入既有状态，复用既有导入流程 ---- */
    已选FLP = flp.路径;
    $('dropFlp').classList.add('filled');
    $('flpMeta').textContent = flp.名称;
    const tb = $('tbProj');
    if (tb) tb.textContent = flp.名称;

    if (音频) {
      已选音频 = 音频.路径;
      $('dropAudio').classList.add('filled');
      $('audioMeta').textContent = 音频.名称;
      const ta = $('tbAudio');
      if (ta) ta.textContent = 音频.名称;
    }

    检查导入();

    if (!音频) {
      toast(译('drop.noPair'));
      return;                     /* 等用户补拖音频 */
    }

    /* 两个都有了 → 只更新状态，**不自动解析**。
       让用户先看到鼓组识别提示，确认后再点「解析并进入编辑器」。
       大工程解析要几十秒，自动开始会让人以为卡住。 */
    $('importStatus').textContent = 译('start.canParse');
  } catch (e) {
    toast(译('drop.uploadFailed') + e.message);
    $('importStatus').textContent = '';
  } finally {
    正在上传 = false;
  }
}


/* ============================================================
   导出预设 / 参数记忆 / 时长口径提示（G4）
   ------------------------------------------------------------
   预设只负责**填参数**，用户仍可手改；手改后预设自动变成「自定义」。

   「输出路径」不记忆 —— 它通常每次不同，记住反而要手动清空。
   其余参数（码率/编码预设/并行度/混入音频）存到 settings.json。
   ============================================================ */

/* 三档预设。数值来自此前的实测（不是凭感觉定的）：
     · medium + crf18 是画质/速度的平衡点
     · 并行 4 路实测最优（6 路反而更慢）
     · 快速预览降到 ultrafast + 并行 6，牺牲画质换时间 */
const 导出预设 = {
  quality:  { 码率: '', 编码预设: 'slow',     并行度: 4, 混入音频: true },
  standard: { 码率: '', 编码预设: 'medium',   并行度: 4, 混入音频: true },
  fast:     { 码率: '6M', 编码预设: 'ultrafast', 并行度: 6, 混入音频: true },
};

function 套用导出预设(名){
  if (名 === 'custom') return;
  const p = 导出预设[名];
  if (!p) return;
  $('exBitrate').value = p.码率;
  $('exPreset').value = p.编码预设;
  $('exParallel').value = String(p.并行度);
  $('exAudio').checked = p.混入音频;
}

/* 用户手改了任一参数 → 预设切到「自定义」 */
function 导出参数变自定义(){
  const sel = $('exPresetPick');
  if (sel && sel.value !== 'custom') sel.value = 'custom';
}

/* 读取上次保存的导出参数 */
async function 载入导出参数(){
  if (!服务模式) return null;
  try {
    const r = await fetch('/api/settings');
    const d = await r.json();
    return (d.设置 || {})['导出'] || null;
  } catch (e) {
    return null;
  }
}

/* 保存本次导出参数 */
async function 保存导出参数(){
  if (!服务模式) return;
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        补丁: {
          导出: {
            码率: $('exBitrate').value.trim(),
            编码预设: $('exPreset').value,
            并行度: parseInt($('exParallel').value, 10) || 0,
            混入音频: !!$('exAudio').checked,
          },
        },
      }),
    });
  } catch (e) {
    /* 参数记忆失败不该影响导出本身 */
    console.warn('[export] 保存参数失败', e);
  }
}

/* 填充时长口径提示 */
function 填充时长提示(){
  const pm = window.__PROJECT__ || {};
  const 音频时长 = pm.duration || (DATA.audio && DATA.audio.duration) || 0;
  const 工程时长 = pm.projectDuration || 音频时长;
  const el = $('exDurHint');
  if (!el) return;

  if (!音频时长) {
    el.textContent = 译('ex.audioMissing');
    el.style.color = '#e06e6e';
    return;
  }

  /* 工程比音频长 1 秒以上 → 明确说明后半段静音。
     实测存在这种工程（165.9s 工程 / 80.6s 音频），
     用户不知道为什么导出后后半段没声音。 */
  if (工程时长 > 音频时长 + 1) {
    el.textContent = 译('ex.durationWarn', {
      proj: 工程时长.toFixed(1), audio: 音频时长.toFixed(1),
    });
    el.style.color = '#d99a4e';
  } else {
    el.textContent = 译('ex.durationOk', {
      proj: 工程时长.toFixed(1), audio: 音频时长.toFixed(1),
    });
    el.style.color = '';
  }
}

/* ---- 绑定 ---- */
if ($('exPresetPick')) {
  $('exPresetPick').onchange = () => 套用导出预设($('exPresetPick').value);
}
['exBitrate', 'exPreset', 'exParallel', 'exAudio'].forEach(function (id) {
  const el = $(id);
  if (!el) return;
  el.addEventListener('change', 导出参数变自定义);
  el.addEventListener('input', 导出参数变自定义);
});

/* 打开导出面板时：套用记住的参数（若存在），否则用标准预设 */
if (typeof 打开导出面板 === 'function') {
  const 原打开导出面板 = 打开导出面板;
  打开导出面板 = async function () {
    原打开导出面板.apply(this, arguments);
    填充时长提示();

    const 上次 = await 载入导出参数();
    if (上次 && (上次.编码预设 || 上次.码率 || 上次.并行度 !== undefined)) {
      $('exBitrate').value = 上次.码率 || '';
      $('exPreset').value = 上次.编码预设 || 'medium';
      $('exParallel').value = (上次.并行度 === 0 || 上次.并行度)
        ? String(上次.并行度) : '';
      $('exAudio').checked = 上次.混入音频 !== false;

      /* 与预设完全一致时显示对应预设名，否则显示「自定义」 */
      let 命中 = 'custom';
      for (const k of Object.keys(导出预设)) {
        const q = 导出预设[k];
        if (q.码率 === $('exBitrate').value &&
            q.编码预设 === $('exPreset').value &&
            q.并行度 === (parseInt($('exParallel').value, 10) || 0)) {
          命中 = k;
          break;
        }
      }
      $('exPresetPick').value = 命中;
    } else {
      $('exPresetPick').value = 'standard';
      套用导出预设('standard');
    }
  };
}


/* ============================================================
   快捷键面板 / 工程快捷键 / 加载态（G5）
   ------------------------------------------------------------
   快捷键有十几条，代码里有但用户不知道，等于没有。
   面板是最低成本的可发现性。

   面板内容**从代码里已实现的键位抄下来**，不是凭记忆写 ——
   写错键位比不写更糟（用户照着按却不生效）。
   ============================================================ */

const 快捷键表 = [
  { 组: 'keys.groupEdit', 项: [
    ['Ctrl + Z', 'keys.undo'],
    ['Ctrl + Shift + Z', 'keys.redo'],
    ['Ctrl + C', 'keys.copy'],
    ['Ctrl + X', 'keys.cut'],
    ['Ctrl + V', 'keys.paste'],
    ['Ctrl + D', 'keys.duplicate'],
    ['Ctrl + A', 'keys.selectAll'],
    ['Delete', 'keys.delete'],
    ['↑ ↓ ← →', 'keys.nudge'],
    ['Shift + 方向键', 'keys.nudgeBig'],
    ['Tab', 'keys.cycle'],
  ]},
  { 组: 'keys.groupLayer', 项: [
    ['Ctrl + Shift + ]', 'keys.raiseTop'],
    ['Ctrl + Shift + [', 'keys.lowerBottom'],
  ]},
  { 组: 'keys.groupView', 项: [
    ['Ctrl + 0', 'keys.fit'],
    ['Ctrl + 1', 'keys.actual'],
    ['Esc', 'keys.escape'],
    ['?', 'keys.help'],
  ]},
  { 组: 'keys.groupProject', 项: [
    ['Ctrl + S', 'keys.save'],
    ['Ctrl + O', 'keys.open'],
    ['Ctrl + Enter', 'keys.enter'],
  ]},
];

function 渲染快捷键面板(){
  const g = $('keysGrid');
  if (!g) return;
  g.innerHTML = '';
  快捷键表.forEach(function (组) {
    const box = document.createElement('div');
    box.className = 'keysGroup';
    const t = document.createElement('div');
    t.className = 'keysGroupTitle';
    t.textContent = 译(组.组);
    box.appendChild(t);
    组.项.forEach(function (项) {
      const row = document.createElement('div');
      row.className = 'keysRow';
      const k = document.createElement('kbd');
      k.textContent = 项[0];
      const s2 = document.createElement('span');
      s2.textContent = 译(项[1]);
      row.appendChild(k);
      row.appendChild(s2);
      box.appendChild(row);
    });
    g.appendChild(box);
  });
}

function 打开快捷键面板(){
  渲染快捷键面板();
  const m = $('keysModal');
  if (m) m.classList.add('on');
}

function 关闭快捷键面板(){
  const m = $('keysModal');
  if (m) m.classList.remove('on');
}

/* 加载态：导入/导出进行中给 body 加 busy 类 */
function 设忙碌(开){
  document.body.classList.toggle('busy', !!开);
}

/* ---- 绑定 ---- */
if ($('keysClose')) $('keysClose').onclick = () => 关闭快捷键面板();
if ($('keysModal')) {
  $('keysModal').onclick = (e) => {
    if (e.target === $('keysModal')) 关闭快捷键面板();
  };
}

/* ---- 追加键位 ---- */
window.addEventListener('keydown', function (e) {
  /* 在输入框里打字时不拦截 */
  const 在输入 = /^(INPUT|TEXTAREA|SELECT)$/.test(
    (e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
  if (在输入) return;

  const ctrl = e.ctrlKey || e.metaKey;

  /* ? 打开快捷键面板（Shift+/ 在多数键盘上产生 ?） */
  if (!ctrl && (e.key === '?' || (e.key === '/' && e.shiftKey))) {
    e.preventDefault();
    if ($('keysModal') && $('keysModal').classList.contains('on')) {
      关闭快捷键面板();
    } else {
      打开快捷键面板();
    }
    return;
  }

  /* Esc 关闭快捷键面板（优先于其它 Esc 行为） */
  if (e.key === 'Escape' && $('keysModal') &&
      $('keysModal').classList.contains('on')) {
    e.preventDefault();
    关闭快捷键面板();
    return;
  }

  /* Ctrl+S 保存工程 */
  if (ctrl && !e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (typeof 保存工程 === 'function') 保存工程(e.shiftKey);
    return;
  }

  /* Ctrl+O 打开工程 */
  if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    if (typeof 打开工程 === 'function') 打开工程();
    return;
  }
});


/* 选 FLP 后自动带出同目录同名音频
   ------------------------------------------------------------
   只在「用系统对话框选文件」这条路径上做 —— 那时有真实路径。
   拖拽路径拿不到原目录，无法配对（详见 处理拖入文件 的说明）。

   三种结果：
     · 同名 / 目录唯一 → 直接填入，提示一句
     · 多候选          → 弹选择框让用户挑（不猜）
     · 没有            → 什么都不做，等用户自己选
   ============================================================ */
async function 尝试自动配对(flp路径){
  if (!服务模式) return;
  try {
    const r = await fetch('/api/pair/audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flp: flp路径 }),
    });
    const d = await r.json();
    if (!d.ok) return;

    if (d.音频) {
      已选音频 = d.音频.路径;
      $('dropAudio').classList.add('filled');
      $('audioMeta').textContent = d.音频.名称;
      $('tbAudio').textContent = d.音频.名称;
      检查导入();
      toast(译('drop.paired', { name: d.音频.名称 }));
      return;
    }

    /* 多候选：列出来让用户选，不自动猜 */
    if (d.候选 && d.候选.length > 1) {
      const 名 = d.候选.map((x, i) => (i + 1) + '. ' + x.名称).join('\n');
      const 输入 = prompt(译('drop.chooseAudio') + '\n' + 名, '1');
      if (!输入) return;
      const 项 = d.候选[parseInt(输入, 10) - 1];
      if (!项) return;
      已选音频 = 项.路径;
      $('dropAudio').classList.add('filled');
      $('audioMeta').textContent = 项.名称;
      $('tbAudio').textContent = 项.名称;
      检查导入();
    }
  } catch (e) {
    /* 配对失败不影响手动选音频 */
    console.warn('[pair]', e);
  }
}


/* ============================================================
   自动保存（G2 补完）
   ------------------------------------------------------------
   不覆盖用户的工程文件 —— 那会让人措手不及（可能只是随手改着玩）。
   改存恢复文件，启动时若发现就问是否恢复。

   触发：每 90 秒（有未保存改动才写）+ 页面隐藏时立即写。
   页面隐藏是意外关闭最常见的先兆（切走、最小化、关标签）。
   ============================================================ */

const 自动保存间隔 = 90 * 1000;
let 自动保存计时 = null;

async function 写自动保存(){
  if (!服务模式 || !未保存 || !放置.length) return;
  try {
    await fetch('/api/autosave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        名称: (window.__PROJECT__ || {}).name || DATA.projectName || '未命名',
        布局: 取布局(),
        主题: 主题键,
        静帧秒: 静帧秒,
      }),
    });
  } catch (e) {
    /* 自动保存失败要静默 —— 不能因为后台保存失败打断用户 */
    console.warn('[autosave]', e);
  }
}

async function 清自动保存(){
  if (!服务模式) return;
  try {
    await fetch('/api/autosave/clear', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: '{}' });
  } catch (e) { /* 忽略 */ }
}

function 启动自动保存(){
  if (自动保存计时) clearInterval(自动保存计时);
  自动保存计时 = setInterval(写自动保存, 自动保存间隔);

  /* 页面隐藏时立即写一次 */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') 写自动保存();
  });
}

/* 应用内询问框（替代原生 confirm）
   ------------------------------------------------------------
   原生 confirm() 会**阻塞渲染进程**：headless 测试里整个页面失联，
   CDP 的 Runtime.evaluate 与 Debugger.pause 都无响应，
   表现为「打开页面卡死」（实测踩到，排查了很久）。

   返回值：Promise<boolean>，确定 = true。
   用法：if (!(await 询问('要丢弃改动吗？'))) return; */
function 询问(提示, 确定文案){
  return new Promise(function (resolve) {
    const 罩 = document.createElement('div');
    罩.className = 'askMask';
    const 框 = document.createElement('div');
    框.className = 'askBox';

    const 文 = document.createElement('div');
    文.className = 'askText';
    文.textContent = String(提示 == null ? '' : 提示);
    框.appendChild(文);

    const 行 = document.createElement('div');
    行.className = 'askActions';

    const 取消 = document.createElement('button');
    取消.className = 'btn ghost';
    取消.textContent = 译('common.cancel') || '取消';

    const 确定 = document.createElement('button');
    确定.className = 'btn primary';
    确定.textContent = 确定文案 || (译('common.ok') || '确定');

    function 收(值){
      罩.remove();
      document.removeEventListener('keydown', 键);
      resolve(值);
    }
    function 键(e){
      if (e.key === 'Escape') { e.preventDefault(); 收(false); }
      else if (e.key === 'Enter') { e.preventDefault(); 收(true); }
    }

    取消.onclick = function (e) { e.stopPropagation(); 收(false); };
    确定.onclick = function (e) { e.stopPropagation(); 收(true); };
    /* 点遮罩空白处 = 取消（与原生 confirm 的「关掉即取消」一致） */
    罩.onclick = function (e) { if (e.target === 罩) 收(false); };

    行.appendChild(取消);
    行.appendChild(确定);
    框.appendChild(行);
    罩.appendChild(框);
    document.body.appendChild(罩);
    document.addEventListener('keydown', 键);
    确定.focus();
  });
}

/* 启动时检查是否有可恢复内容 */
async function 检查自动保存(){
  if (!服务模式) return;
  /* 只在「有未导入的工程状态」时提示 ——
     空画布时的自动保存没有恢复价值，提示只会打扰。 */
  try {
    const r = await fetch('/api/autosave');
    const d = await r.json();
    if (!d.有) return;
    if (!d.组件数 || d.组件数 < 1) { 清自动保存(); return; }

    const 时间 = d.时间 ? new Date(d.时间 * 1000) : null;
    const 提示 = 译('auto.found', {
      name: d.名称 || '未命名',
      n: d.组件数 || 0,
      time: 时间 ? 时间.toLocaleString() : '',
    });
    if (!(await 询问(提示))) { 清自动保存(); return; }

    /* 恢复：走与工程打开相同的还原路径 */
    const rr = await fetch('/api/autosave/restore', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (rr.ok) {
      清除脏();
      setTimeout(() => location.reload(), 250);
    }
  } catch (e) {
    console.warn('[autosave]', e);
  }
}

/* 用户明确保存后清掉恢复文件 */
if (typeof 保存工程 === 'function') {
  const 原保存工程 = 保存工程;
  保存工程 = async function () {
    const r = await 原保存工程.apply(this, arguments);
    /* 保存成功才清（未保存状态由 清除脏 置位） */
    if (!未保存) 清自动保存();
    return r;
  };
}

启动自动保存();
if (document.readyState === 'complete') {
  setTimeout(检查自动保存, 2500);
} else {
  window.addEventListener('load', () => setTimeout(检查自动保存, 2500));
}


/* ============================================================
   自绘标题栏（任务5：无边框窗口）
   ------------------------------------------------------------
   流程：
     1. 页面加载后问服务端「支持无边框窗口吗」
     2. 支持 → 去掉原生标题栏 + 显示自绘标题栏
     3. 不支持（浏览器标签页 / 非 Windows）→ 什么都不做

   拖动与按钮都通过 /api/window 让服务端调 Win32 API。
   为什么不让前端直接做：浏览器没有操作窗口的能力，
   连「拖动窗口」都得靠系统消息。
   ============================================================ */

const 窗口可用 = { 支持: false, 已启用: false };

async function 窗口接口(动作) {
  try {
    const r = await fetch('/api/window', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 动作 }),
    });
    return await r.json();
  } catch (e) {
    return { ok: false };
  }
}

async function 初始化标题栏(){
  if (!服务模式) return;

  /* pywebview 的窗口可能比页面晚就绪，故重试几次 */
  let d = null;
  for (let i = 0; i < 6; i++) {
    d = await 窗口接口('detect');
    if (d && d.ok && d.可用) break;
    await new Promise(r => setTimeout(r, 400));
  }
  if (!d || !d.ok || !d.可用) return;   /* 浏览器标签页：保留原生标题栏 */
  窗口可用.支持 = true;
  窗口可用.宿主 = d.宿主 || 'win32';

  /* Edge --app 回退路径：它自带一条 Edge 画的标题栏，去不掉。
     那种情况下**不显示**自绘标题栏，否则会出现两条，更难看。 */
  if (窗口可用.宿主 !== 'pywebview') {
    窗口可用.已启用 = false;
    return;
  }

  /* 诊断日志：出问题时能看出走了哪条分支 */
  console.log('[window] 宿主=' + 窗口可用.宿主 + ' 显示自绘标题栏');

  /* 显示自绘标题栏。
     pywebview 的窗口是**真无边框**（frameless=True），
     没有原生标题栏，所以这里要显示自己的。

     若走的是 Edge --app 回退路径，服务端返回的宿主是 win32 ——
     那种情况下不显示自绘标题栏（会出现两条），
     改为让 Edge 那条跟随界面配色（见页面 meta theme-color）。 */
  const bar = $('titlebar');
  if (bar) bar.style.display = 'flex';
  document.body.classList.add('hasTitlebar');

  /* 等一帧，让标题栏先完成布局 */
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 60)));

  /* pywebview 的窗口本来就是无边框，deframe 是无操作但必须返回成功。
     这里不因 deframe 失败而隐藏标题栏 —— 只要宿主是 pywebview，
     窗口就一定是无边框的。 */
  const r = await 窗口接口('deframe');
  if (!r.ok && 窗口可用.宿主 !== 'pywebview') {
    console.warn('[window] 去边框失败，保留原生标题栏');
    if (bar) bar.style.display = 'none';
    document.body.classList.remove('hasTitlebar');
    return;
  }
  窗口可用.已启用 = true;

  /* ---- 拖动 ---- */
  const 拖动区 = $('tbDrag');
  if (拖动区) {
    拖动区.addEventListener('mousedown', async function (e) {
      /* 双击标题栏 = 最大化/还原（与原生窗口一致的约定） */
      if (e.detail === 2) {
        await 窗口接口('toggle');
        更新最大化图标();
        return;
      }
      if (e.button !== 0) return;
      await 窗口接口('drag');
    });
  }

  /* ---- 按钮 ---- */
  if ($('tbMin')) $('tbMin').onclick = () => 窗口接口('minimize');
  if ($('tbMax')) $('tbMax').onclick = async () => {
    await 窗口接口('toggle');
    更新最大化图标();
  };
  if ($('tbClose')) $('tbClose').onclick = async () => {
    /* 有未保存改动时先确认。
       用 询问() 而不是 confirm()：原生对话框阻塞渲染进程。 */
    if (未保存 && !(await 询问(译('proj.confirmDiscard')))) return;
    await 窗口接口('close');
  };

  更新最大化图标();
}

async function 更新最大化图标(){
  const d = await 窗口接口('state');
  const b = $('tbMax');
  if (!b || !d.ok) return;
  const 最大 = !!d.最大化;
  b.title = 译(最大 ? 'win.restore' : 'win.maximize');
  /* 最大化时图标从「方框」换成「两个叠放的方框」 */
  b.innerHTML = 最大
    ? '<svg width="10" height="10" viewBox="0 0 10 10">' +
      '<rect x="3" y="1.5" width="5" height="5" fill="none" ' +
      'stroke="currentColor" stroke-width="1.1"/>' +
      '<rect x="1.5" y="3" width="5" height="5" fill="none" ' +
      'stroke="currentColor" stroke-width="1.1"/></svg>'
    : '<svg width="10" height="10" viewBox="0 0 10 10">' +
      '<rect x="2.5" y="2.5" width="5" height="5" fill="none" ' +
      'stroke="currentColor" stroke-width="1.2"/></svg>';
}

/* 启动：延后一点，等窗口真正创建出来 */
if (document.readyState === 'complete') {
  setTimeout(初始化标题栏, 800);
} else {
  window.addEventListener('load', () => setTimeout(初始化标题栏, 800));
}
