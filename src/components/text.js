/* 文字 · text
   ------------------------------------------------------------
   自由文字块。内容由用户输入，不是从工程数据推导。

   ## 尺寸模型（第三版，前两版都错了）

   ### 第一版的错
   字号从**框高**推导（h * 0.34）。框与字互相耦合，
   拖入后框 620×200 而字很小，拖拽又把字形变。

   ### 第二版的错（更根本）
   沿用了「按注册尺寸绘制 → scale 到目标尺寸」这条**位图组件**的路径。
   但文字是**矢量**的，非等比缩放会拉伸字形。
   实测：只有框比例 = 注册比例(3.10) 时不变形，
        其余 10/11 种尺寸组合都会拉伸。
   这解释了用户看到的「只有某个特定大小才正常」。

   ### 第三版（正确）
   文字组件走**独立的渲染路径**：直接在目标尺寸上绘制，
   不经过任何 canvas scale。

   字号是**绝对像素值**，与框尺寸解耦：
     · 字号 0  = 跟随主题（displaySize 的一个比例）
     · 字号 >0 = 用户指定，绝对值，不随框变化
   框是字号的**结果**（自适应模式）或**容器**（固定换行模式）。

   拖拽缩放时改的是**字号**，框随之重算 —— 这样字形永远不变形。

   ## 字体默认跟随主题
   样式.字体 为空时使用当前主题的 type.display。

   ## 变量
   {title} {tempo} {time} {bars} {tracks} {notes}
   ============================================================ */

/* 测量用的离屏上下文（复用） */
let __量布 = null;
function 量上下文() {
  if (!__量布) __量布 = document.createElement('canvas').getContext('2d');
  return __量布;
}

/* 解析文本中的变量 */
function 解析文字变量(文本, 时刻秒) {
  if (!文本) return '';
  return 文本.replace(/\{(\w+)\}/g, function (m, 名) {
    switch (名) {
      case 'title':  return DATA.projectName || 'Untitled';
      case 'tempo':  return TEMPO.toFixed(1);
      case 'ppq':    return String(PPQ);
      case 'time':   return clockStr(时刻秒 === undefined ? CUR : 时刻秒);
      case 'bars':   return String(Math.round(MAXTICK / (PPQ * 4)));
      case 'tracks': return String(TL.tracks.filter(function (t) {
                       return t.clips.length; }).length);
      case 'notes':  return String(Object.keys(SHAPES).reduce(function (a, k) {
                       return a + SHAPES[k].notes.length; }, 0));
      default:       return m;
    }
  });
}

/* 字体角色 → 字体栈与默认字重。

   主题为每个角色都定义了配套字体（type.display / body / mono），
   文字组件按「角色」取用，而不是一律用 display。
   这样同一模板里可以出现「标题用 display、元数据用 mono」
   的层次 —— 正是真实印刷品的做法。 */
function 文字角色字体(样式) {
  const 角色 = (样式 && 样式.角色) || 'display';
  return 取字体(样式 && 样式.字体, 角色);
}

function 文字角色字重(样式) {
  if (样式 && 样式.字重 > 0) return 样式.字重;
  const 角色 = (样式 && 样式.角色) || 'display';
  /* mono/body 用常规字重，display 用主题设定的字重 */
  if (角色 === 'mono' || 角色 === 'body') return 400;
  return TY.displayWeight;
}

/* 字号（绝对像素值）。
   样式.字号 > 0 时直接使用；否则按主题 displaySize 换算。

   注意：**不再参考框尺寸** —— 字号与框解耦，
   这是第三版的核心修正。 */
function 文字实际字号(样式) {
  if (样式 && 样式.字号 > 0) return 样式.字号;
  const 基准 = (typeof TY !== 'undefined' && TY.displaySize) ? TY.displaySize : 78;
  return Math.max(20, Math.round(基准 * 0.55));
}

/* 内边距：随字号缩放。
   标注类（mono/body）留白小一些，避免小字周围太空。 */
function 文字内边距(字号, 样式) {
  const 系数 = (样式 && (样式.角色 === 'mono' || 样式.角色 === 'body'))
    ? 0.10 : 0.16;
  return Math.max(2, Math.round(字号 * 系数));
}

/* 构造 font 字符串 */
function 文字字体串(样式, 字号) {
  const 族 = 文字角色字体(样式);
  const 重 = 文字角色字重(样式);
  return (样式.倾斜 ? 'italic ' : '') + 重 + ' ' + 字号 + 'px ' + 族;
}

/* 排版：把文本切成行。
   含 CJK 按字切，西文按词切（避免把 TITLE 劈成 TI/TLE）。 */
function 文字排版(g, 文本, 可用宽, 允许换行) {
  const 行 = [];
  文本.split('\n').forEach(function (段) {
    if (!允许换行 || 可用宽 <= 0) { 行.push(段); return; }
    const 含CJK = /[\u4e00-\u9fff\u3000-\u303f]/.test(段);
    const 单元 = 含CJK ? Array.from(段) : 段.split(/(\s+)/);
    let 当前 = '';
    for (const u of 单元) {
      const 试 = 当前 + u;
      if (g.measureText(试).width > 可用宽 && 当前.trim()) {
        行.push(当前.trimEnd());
        当前 = u.trimStart();
      } else {
        当前 = 试;
      }
    }
    行.push(当前.trimEnd());
  });
  return 行;
}

/* 测量文本的自然尺寸（供 GUI 设置框尺寸）。

   ## 垂直留白的处理（重要）

   初版框高 = 行数 × 字号 × 行距 + 内边距×2。
   但「字号 × 行距」是为**多行**预留的行间空间，
   单行文字的实际墨迹高只有约「字号 × 0.7」，
   于是单行时上下各空出一大截 —— 实测留白占 41%。

   现改为按**实际墨迹高度**计算：
     · 用 measureText 的 actualBoundingBox 取真实上下边界
     · 单行时框高 = 墨迹高 + 内边距×2
     · 多行时框高 = 墨迹高 + (行数-1) × 行距 + 内边距×2
   这样单行紧贴、多行有正常行距。 */
function 测量文字(样式, 参考宽) {
  const g = 量上下文();
  const 字号 = 文字实际字号(样式);
  const 行距 = 字号 * (样式.行距 || 1.35);
  const pad = 文字内边距(字号, 样式);
  const 字距 = 样式.字距 || 0;

  let 文本 = 解析文字变量(样式.内容, CUR);
  if (样式.大写) 文本 = 文本.toUpperCase();

  g.font = 文字字体串(样式, 字号);

  const 允许换行 = !!样式.自动换行 && 参考宽 > 0;
  const 可用宽 = 允许换行 ? Math.max(20, 参考宽 - pad * 2) : 0;
  const 行 = 文字排版(g, 文本, 可用宽, 允许换行);

  /* 逐行量墨迹：宽度取最长行，高度取各行的实际 ink 范围 */
  let 最宽 = 0;
  let 最高 = 0;
  行.forEach(function (t) {
    const m = g.measureText(t);
    const w = m.width + (字距 > 0 ? 字距 * Math.max(0, t.length - 1) : 0);
    if (w > 最宽) 最宽 = w;
    /* actualBoundingBox 在部分环境可能为 undefined，用字号兜底 */
    const 升 = (m.actualBoundingBoxAscent !== undefined)
      ? m.actualBoundingBoxAscent : 字号 * 0.75;
    const 降 = (m.actualBoundingBoxDescent !== undefined)
      ? m.actualBoundingBoxDescent : 字号 * 0.25;
    const ink = 升 + 降;
    if (ink > 最高) 最高 = ink;
  });
  if (最高 <= 0) 最高 = 字号 * 0.72;      /* 空文本兜底 */

  /* 高度：首行的墨迹高 + 后续每行按行距递增 */
  const 内容高 = 行.length <= 1
    ? 最高
    : 最高 + (行.length - 1) * 行距;

  const w = 允许换行 ? Math.ceil(参考宽) : Math.ceil(最宽) + pad * 2;
  const h = Math.ceil(内容高) + pad * 2;

  /* 旋转 90/270 时，外框宽高互换（文字变成竖排占位） */
  const 旋 = ((样式.旋转 || 0) % 360 + 360) % 360;
  const 换 = (旋 === 90 || 旋 === 270);

  return { w: 换 ? h : w, h: 换 ? w : h,
           行: 行, 字号: 字号, 行距: 行距,
           内边距: pad, 内容宽: Math.ceil(最宽),
           内容高: Math.ceil(内容高), 墨迹高: Math.ceil(最高),
           旋转: 旋 };
}

/* 文字组件的默认样式。
   作为模块级常量，供 测量/绘制 在没有显式样式时兜底。
   组件注册的 默认 字段引用同一份内容（拷贝，不共享引用）。 */
const 文字默认值 = {
  内容: '{title}',
  角色: 'display',
  字体: '',
  字号: 0,
  字重: 0,
  对齐: 'left',
  行距: 1.35,
  字距: 0,
  颜色: 'ink',
  大写: false,
  倾斜: false,
  背景: false,
  自动换行: false,
  旋转: 0,
};

register({
  id: 'text', name: '文字', w: 620, h: 200, group: '内容',
  desc: '自由文字块。<b>字体默认跟随主题</b>，可在属性面板覆盖。' +
        '<b>框自适应文本</b>：改内容或字号时框自动贴合；' +
        '开启「固定换行」后框由你决定，文本在框内换行。' +
        '<b>双击可直接编辑</b>。支持变量：<code>{title}</code>、' +
        '<code>{tempo}</code>、<code>{time}</code>、<code>{bars}</code>。',

  默认: Object.assign({}, 文字默认值),

  /* 供 GUI 调用：算该样式下的自然尺寸 */
  测量: function (样式, 参考宽) {
    return 测量文字(样式, 参考宽);
  },

  /* 供 GUI 调用：取实际字号 */
  字号: function (样式) {
    return 文字实际字号(样式);
  },

  /* 供 GUI 调用：字体栈 / 字重 / 内边距
     （就地编辑层需要与 canvas 渲染完全一致的排版参数，
      故统一从这里取，避免两处算法分叉） */
  角色字体: function (样式) { return 文字角色字体(样式); },
  角色字重: function (样式) { return 文字角色字重(样式); },
  内边距: function (字号, 样式) { return 文字内边距(字号, 样式); },

  /* 渲染。
     关键：w/h 是**目标尺寸**（不是注册尺寸再缩放）。
     GUI 对本组件走独立路径，不做 canvas scale。 */
  /* 渲染。
     关键：w/h 是**目标尺寸**（不是注册尺寸再缩放）。
     GUI 对本组件走独立路径，不做 canvas scale。

     样式通过参数显式传入，**不改写 this.默认**。
     初版是 `comp.默认 = p.样式`（在 GUI 里赋值），
     那会污染组件的共享默认对象 —— 于是「上一个渲染过的文字样式」
     会泄漏到下一个新建/套用的文字（实测：帯 的 旋转=90
     泄漏到后面所有模板）。这与之前几类 bug 同源：
     **把共享对象当作参数通道**。 */
  draw: function (g, w, h) {
    return 绘制文字(g, w, h, this.默认);
  },

  /* 供 GUI 调用：带显式样式的绘制 */
  绘制: function (g, w, h, 样式) {
    return 绘制文字(g, w, h, 样式);
  }
});

/* 实际绘制。样式为显式参数，不依赖任何共享状态。 */
function 绘制文字(g, w, h, 样式输入) {
  const 样式 = Object.assign({}, 文字默认值, 样式输入 || {});
    const 字号 = 文字实际字号(样式);
    const 行距 = 字号 * (样式.行距 || 1.35);
    const pad = 文字内边距(字号, 样式);
    const 字距 = 样式.字距 || 0;
    const 色 = P[样式.颜色] || P.ink;

    let 文本 = 解析文字变量(样式.内容, CUR);
    if (样式.大写) 文本 = 文本.toUpperCase();

    /* ---- 旋转 ----
       印刷品上常见竖排文字（唱片侧标、书脊）。canvas 无竖排 API，
       用坐标系旋转实现：把画布转 90°，文字在旋转后的空间里照常排。
       旋转后「外框宽高」与「内层排版宽高」互换。 */
    const 旋 = ((样式.旋转 || 0) % 360 + 360) % 360;
    const 内w = (旋 === 90 || 旋 === 270) ? h : w;
    const 内h = (旋 === 90 || 旋 === 270) ? w : h;

    g.save();
    if (旋) {
      g.translate(w / 2, h / 2);
      g.rotate(旋 * Math.PI / 180);
      g.translate(-内w / 2, -内h / 2);
    }

    const 允许换行 = !!样式.自动换行;
    /* 先用原始字号算可用宽（后面缩字号时会重算） */
    const 可用宽 = Math.max(20, 内w - pad * 2);

    /* 字号自适应：关闭换行时，若单行超宽就等比缩小。
       ------------------------------------------------------------
       问题：`文字实际字号` 只按 TY.displaySize 算，不看文本宽度。
       chrome_freak 的 Impact 在 66px 下宽约 600px，而框只有 388px，
       文字直接溢出被画布裁掉（标题少一个字母）。

       关闭换行 = 「这行必须完整显示」，故缩字号是对的。
       开启换行 = 用户选择换行，不该缩。 */
    let 用字号 = 字号;
    if (!允许换行 && 文本) {
      /* 迭代逼近，而不是一次等比缩放。
         ------------------------------------------------------------
         等比公式假设「字宽与字号线性」，但实际字体在不同字号下
         字宽不等比（hinting、字距、kerning 都会变）。
         实测：Impact 一次缩到理论值后仍溢出约 4%。

         故缩了再测、最多 6 轮，每轮留 1% 余量。 */
      for (let 轮 = 0; 轮 < 6; 轮++) {
        g.font = 文字字体串(样式, 用字号);
        const 单行宽 = g.measureText(文本).width +
                       Math.max(0, 文本.length - 1) * 字距;
        if (单行宽 <= 可用宽) break;
        const 目标 = Math.floor(用字号 * (可用宽 / 单行宽) * 0.99);
        if (目标 >= 用字号) break;          /* 不再变小，防死循环 */
        用字号 = Math.max(Math.round(字号 * 0.30), 目标);
        if (用字号 <= Math.round(字号 * 0.30)) break;
      }
    }

    g.font = 文字字体串(样式, 用字号);
    g.fillStyle = rgba(色, 0.96);

    /* 缩字号后行距与内边距要跟着重算，否则垂直位置会偏 */
    const 用行距 = 用字号 * (样式.行距 || 1.35);
    const 用pad = 文字内边距(用字号, 样式);
    /* 缩字号后可用宽也变了（pad 变小） */
    const 用可用宽 = Math.max(20, 内w - 用pad * 2);

    const 行 = 文字排版(g, 文本, 用可用宽, 允许换行);

    let x = 用pad;
    if (样式.对齐 === 'center') { g.textAlign = 'center'; x = 内w / 2; }
    else if (样式.对齐 === 'right') { g.textAlign = 'right'; x = 内w - 用pad; }
    else g.textAlign = 'left';

    /* 垂直定位：与「测量」用同一套模型，保证框恰好容纳文本。
       用 alphabetic 基线才能精确控制墨迹位置：
       单行时墨迹在框内垂直居中；多行时首行墨迹顶对齐内边距。 */
    g.textBaseline = 'alphabetic';

    const m0 = g.measureText(行[0] || '');
    const 首升 = (m0.actualBoundingBoxAscent !== undefined)
      ? m0.actualBoundingBoxAscent : 用字号 * 0.75;
    const 首降 = (m0.actualBoundingBoxDescent !== undefined)
      ? m0.actualBoundingBoxDescent : 用字号 * 0.25;

    if (行.length <= 1) {
      const 基线 = (内h + 首升 - 首降) / 2;
      绘制行(g, 行[0] || '', x, 基线, 用字号, 字距, 样式.对齐);
    } else {
      let 基线 = 用pad + 首升;
      for (let i = 0; i < 行.length; i++) {
        if (i > 0) 基线 += 用行距;
        绘制行(g, 行[i], x, 基线, 用字号, 字距, 样式.对齐);
      }
    }

    g.restore();
}

/* 绘制一行。
   ------------------------------------------------------------
   tracked() 的 y 与 fillText 一样是**基线**，不是文字中心。
   初版误信了注释里的「tracked 的 y 是文字中心」，
   于是传了 `基线 - 字号 * 0.35` —— 把文字整体上移了 35% 字号，
   顶部被画布裁掉，表现为「文字没有头顶」。

   而只有 `字距 > 0` 时才走 tracked 分支，所以：
     · 有字距的文字被上移（模板里的文字预设都设了字距）
     · 无字距的文字正常
   这正是「所有模板文字都被顶部截掉」的原因。

   实测对照（16px mono，框高 24）：
     修正前 墨迹 y 1~11（上留白 1，下留白 12）
     修正后 墨迹 y 7~17（上留白 7，下留白 7） */
function 绘制行(g, 文本, x, 基线, 字号, 字距, 对齐) {
  if (字距 > 0) {
    tracked(g, 文本, x, 基线, 字距, 对齐);
  } else {
    g.fillText(文本, x, 基线);
  }
}
