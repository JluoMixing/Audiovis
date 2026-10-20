/* ============================================================
   字体库
   ------------------------------------------------------------
   提供可选的字体清单，按「主题配套」与「通用」分组。

   设计原则：
     · 主题字体优先 —— 选定主题后，文字的默认字体取自该主题的
       type.display / type.body / type.mono（见 core/theme.js）
     · 用户可覆盖 —— 在属性面板中改字体，覆盖主题默认
     · 只列常用字体 —— 后续按需维护

   注意：这里列的是**字体族名**，实际能否渲染取决于系统是否安装。
   故每一项都带 fallback 链，保证任何环境下都有可用字体。
   ============================================================ */

/* 字体条目：{ 名, 栈, 类 }  —— 栈为完整 CSS font-family 值 */
const 字体库 = [
  /* ---- 中文：衬线（宋/楷）---- */
  { 名: '宋体',     栈: '"宋体", "SimSun", serif',                     类: '中文衬线' },
  { 名: '楷体',     栈: '"楷体", "KaiTi", "华文楷体", serif',           类: '中文衬线' },
  { 名: '华文中宋', 栈: '"华文中宋", "STZhongsong", "宋体", serif',     类: '中文衬线' },
  { 名: '思源宋体', 栈: '"Source Han Serif SC", "Noto Serif SC", "宋体", serif', 类: '中文衬线' },

  /* ---- 中文：无衬线（黑/等线）---- */
  { 名: '微软雅黑', 栈: '"微软雅黑", "Microsoft YaHei", sans-serif',     类: '中文黑体' },
  { 名: '等线',     栈: '"等线", "DengXian", "Segoe UI", sans-serif',   类: '中文黑体' },
  { 名: '苹方',     栈: '"PingFang SC", "微软雅黑", sans-serif',        类: '中文黑体' },
  { 名: '思源黑体', 栈: '"Source Han Sans SC", "Noto Sans SC", "微软雅黑", sans-serif', 类: '中文黑体' },

  /* ---- 西文：衬线 ---- */
  { 名: 'Georgia',  栈: 'Georgia, "Times New Roman", serif',           类: '西文衬线' },
  { 名: 'Gelasio',  栈: 'Gelasio, Georgia, serif',                     类: '西文衬线' },
  { 名: 'Times',    栈: '"Times New Roman", Times, serif',             类: '西文衬线' },

  /* ---- 西文：无衬线 ---- */
  { 名: 'Inter',    栈: 'Inter, "Segoe UI", sans-serif',               类: '西文无衬线' },
  { 名: 'Segoe UI', 栈: '"Segoe UI", system-ui, sans-serif',           类: '西文无衬线' },
  { 名: 'Arial',    栈: 'Arial, Helvetica, sans-serif',                类: '西文无衬线' },

  /* ---- 展示/粗黑 ---- */
  { 名: 'Arial Black', 栈: '"Arial Black", Impact, sans-serif',         类: '展示' },
  { 名: 'Impact',      栈: 'Impact, "Arial Black", sans-serif',         类: '展示' },
  { 名: 'Bahnschrift', 栈: 'Bahnschrift, "Arial Narrow", sans-serif',   类: '展示' },
  { 名: 'Bahnschrift Condensed',
    栈: '"Bahnschrift Condensed", Bahnschrift, "Arial Narrow", sans-serif', 类: '展示' },

  /* ---- 等宽 ---- */
  { 名: 'Consolas',  栈: 'Consolas, "Courier New", monospace',          类: '等宽' },
  { 名: 'Courier New', 栈: '"Courier New", Courier, monospace',         类: '等宽' },
];

/* 取字体栈。名称为空时返回主题对应的角色字体。 */
function 取字体(名, 角色) {
  角色 = 角色 || 'body';
  if (名) {
    const f = 字体库.filter(function (x) { return x.名 === 名; })[0];
    if (f) return f.栈;
  }
  /* 回退到当前主题的角色字体 */
  if (角色 === 'display') return TY.display;
  if (角色 === 'mono') return TY.mono;
  return TY.body;
}

/* 按类分组（供属性面板的 <optgroup> 使用） */
function 字体分组() {
  const 组 = {};
  字体库.forEach(function (f) {
    (组[f.类] = 组[f.类] || []).push(f.名);
  });
  return 组;
}

/* 主题配套字体的名称（用于属性面板显示「跟随主题」） */
function 主题字体名(角色) {
  const 栈 = 角色 === 'display' ? TY.display : 角色 === 'mono' ? TY.mono : TY.body;
  /* 从栈里取第一个族名 */
  const m = 栈.match(/^\s*"([^"]+)"|^\s*([^,]+)/);
  return m ? (m[1] || m[2] || '').trim() : '';
}
