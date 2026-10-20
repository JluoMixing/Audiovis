/* ============================================================
   语言包应用：把 data-i18n 标记的元素填上当前语言文案
   ------------------------------------------------------------
   为什么用 data-i18n 而不是构建期替换：
     用户在界面里切语言，要求即时生效、不刷新页面。
     构建期替换只能重新构建，做不到。

   覆盖范围：
     data-i18n="key"              填 textContent
     data-i18n-placeholder="key"  填 placeholder 属性
     data-i18n-title="key"        填 title 属性
     data-i18n-html="key"         填 innerHTML（允许内含 <b> 等标签）

   为什么要有 data-i18n-html：
     部分文案含强调标签（如页脚「这是<b>界面设计预览</b>」）。
     用 textContent 会把标签当文本显示出来。
     这些文案都来自我们自己的语言包，不含用户输入，故用 innerHTML 安全。
   ============================================================ */

function 应用语言() {
  /* 文本节点 */
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    const k = el.getAttribute('data-i18n');
    if (k) el.textContent = 译(k);
  });

  /* 允许 HTML 的 */
  document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
    const k = el.getAttribute('data-i18n-html');
    if (k) el.innerHTML = 译(k);
  });

  /* 属性 */
  document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
    const k = el.getAttribute('data-i18n-placeholder');
    if (k) el.setAttribute('placeholder', 译(k));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
    const k = el.getAttribute('data-i18n-title');
    if (k) el.setAttribute('title', 译(k));
  });

  /* 页面语言属性（影响浏览器字体回退与拼写检查） */
  document.documentElement.lang = (取语言() === 'zh' ? 'zh-CN' : 'en');
}

/* 切换语言：填文案 + 通知业务层重渲染 */
function 切换语言(lang) {
  设语言(lang);
  应用语言();
  if (typeof 语言切换后 === 'function') {
    try { 语言切换后(lang); } catch (e) { console.error(e); }
  }
}

/* 业务层可覆盖此钩子：语言变了要重绘哪些东西（toast/状态文案等） */
let 语言切换后 = null;
function 设语言切换后(fn) { 语言切换后 = fn; }
