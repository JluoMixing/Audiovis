/* ============================================================
   组件注册表
   ------------------------------------------------------------
   组件通过 register() 声明自己；画廊读取 COMPONENTS 渲染。
   这是组件与预览台之间唯一的接口。

   依赖：无
   ============================================================ */

/* 所有已注册组件。顺序即显示顺序（按 group 分组后）。 */
const COMPONENTS = [];

/* 注册一个组件。
   ------------------------------------------------------------
   参数：
     id      唯一标识（小写、无空格），用于调试与定位
     name    显示名
     group   分组：结构 / 内容 / 音频 / 信息
     w, h    默认尺寸（预览台可缩放）
     desc    说明文字，支持 HTML
     draw    (g, w, h) => void  绘制函数
             g 已按 devicePixelRatio 缩放，直接用 CSS 像素坐标

   校验：缺少必需字段时立即报错，避免静默失败。
*/
function register(spec) {
  const need = ['id', 'name', 'w', 'h', 'draw'];
  const missing = need.filter(function (k) { return spec[k] === undefined; });
  if (missing.length) {
    throw new Error('组件注册失败，缺少字段: ' + missing.join(', '));
  }
  if (COMPONENTS.some(function (c) { return c.id === spec.id; })) {
    throw new Error('组件 id 重复: ' + spec.id);
  }
  if (spec.group === undefined) spec.group = '其他';
  if (spec.desc === undefined) spec.desc = '';
  COMPONENTS.push(spec);
}

/* 按 id 取组件（调试用） */
function getComponent(id) {
  return COMPONENTS.filter(function (c) { return c.id === id; })[0] || null;
}

/* 分组的固定顺序（画廊按此顺序显示） */
const GROUP_ORDER_UI = ['结构', '内容', '音频', '信息'];
