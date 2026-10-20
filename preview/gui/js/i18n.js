/* ============================================================
   i18n：多语言（中 / 英）
   ------------------------------------------------------------
   ## 为什么不能「逐字面量替换」

   实测 app.js 里有 207 处含中文的字符串，但大量是**拼接片段**：

       '共 ' + n + ' 个组件'
       '保存失败：' + err
       '还有 ' + k + ' 个 pattern 未纳入'

   若逐条把片段换成 t()，会得到「1 个 pattern」与
   「1 pattern」这类无法翻译的碎片 —— 英文语序不同，
   「共 N 个组件」对应 "N components"，片段拼不出来。

   故采用**带占位符的整句**：

       t('status.components', { n: 3 })   →  「共 3 个组件」/ "3 components"

   ## 用法

     t('key')                    取当前语言的文案
     t('key', { n: 3 })          占位符替换（{n} → 3）
     t('key', { n: 3 }, 'zh')    指定语言（导出页可能用另一种）
     设语言('en')                 切换并触发重渲染回调

   ## 回退链

     当前语言 → 中文（源语言）→ key 本身

   最后一步返回 key 而不是空串：**漏翻时界面上会显示 key**，
   一眼能看出哪里没翻译，比显示空白好排查。

   ## 缺翻译的处理

     英文包里缺的 key 会用中文顶上，并在控制台 warn 一次。
     不抛错 —— 一个漏翻的词不该让整个界面起不来。
   ============================================================ */

const 语言包 = {};        /* { zh: {...}, en: {...} } */
let 当前语言 = 'zh';
const 已警告 = {};

/* 注册语言包（构建时由 build_gui 注入，或运行时 load） */
function 注册语言(lang, dict) {
  语言包[lang] = dict || {};
}

function 设语言(lang) {
  if (lang !== 'zh' && lang !== 'en') lang = 'zh';
  if (当前语言 === lang) return;
  当前语言 = lang;
  if (typeof 语言变更回调 === 'function') {
    try { 语言变更回调(lang); } catch (e) { console.error(e); }
  }
}

let 语言变更回调 = null;
function 设语言变更回调(fn) { 语言变更回调 = fn; }

function 取语言() { return 当前语言; }

/* 取文案。key 缺失时回退中文，再缺失返回 key 本身。
   ------------------------------------------------------------
   ## 为什么叫 译() 而不是 t()

   实测 app.js 里有 14 处 `const t = ...` 局部变量，
   它们会**遮蔽**全局的 t()，导致 `TypeError: t is not a function`。

   这类遮蔽错误只在特定分支执行时才暴露，很难排查。
   故用一个单字、且全项目无同名的标识符：译。
   （已 grep 确认 app.js 里没有 译 作为变量名） */
function 译(key, 参数, 强制语言) {
  const lang = 强制语言 || 当前语言;
  const 表 = 语言包[lang] || {};
  let s = 表[key];

  if (s === undefined) {
    /* 回退到中文（源语言） */
    const 中文 = (语言包.zh || {})[key];
    if (中文 !== undefined) {
      if (lang !== 'zh' && !已警告[key]) {
        已警告[key] = true;
        console.warn('[i18n] 缺少 ' + lang + ' 翻译: ' + key);
      }
      s = 中文;
    } else {
      if (!已警告[key]) {
        已警告[key] = true;
        console.warn('[i18n] 未知 key: ' + key);
      }
      return key;       /* 显示 key 本身，便于发现漏配 */
    }
  }

  /* 占位符替换：{n} → 参数.n */
  if (参数) {
    s = String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return 参数[k] === undefined ? m : String(参数[k]);
    });
  }
  return s;
}

/* 注意：**不**导出 t 作为别名。
   一旦全局存在 t，任何局部 `const t` 都会遮蔽它，
   表现为「某些操作突然报 t is not a function」。
   统一用 译()。 */

/* 是否已注册某语言 */
function 有语言(lang) { return !!(语言包[lang] && Object.keys(语言包[lang]).length); }

/* 统计缺翻译的 key（开发期自检用） */
function 缺翻译清单(lang) {
  const 目标 = 语言包[lang] || {};
  const 源 = 语言包.zh || {};
  return Object.keys(源).filter(function (k) { return 目标[k] === undefined; });
}
