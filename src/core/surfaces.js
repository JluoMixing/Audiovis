/* ============================================================
   主题表面处理（核心）
   ------------------------------------------------------------
   问题：此前各组件直接写 `g.fillRect` + `rgba(P.ink, a)`，
   导致换主题只是换颜色，缺少各主题自己的质感。

   方案：把「填充 / 描边 / 标记 / 网格」四类基本操作抽象出来，
   每个主题给出一套自己的实现。组件调用这些原语，
   于是同一段组件代码在不同主题下自动获得该主题的质感。

   设计原则：
   · 每个实现必须属于该主题自己的世界观，不是换色
   · 轻量：每帧可能调用数百次，实现需控制循环次数
   · 确定性：使用随机前先 seed()

   依赖：core/canvas-kit.js, core/theme.js
   ============================================================ */

const SURFACE = {};

/* ---- 墨 · 紙：宣纸质感。边缘不规则，有渗透感 ---- */
SURFACE.sumi = {
  fill: function (g, x, y, w, h, col, a, opt) {
    if (w < 0.5 || h < 0.5) return;
    const key = (opt && opt.seedKey) || 0;
    seed(key);
    g.fillStyle = rgba(col, a);
    g.beginPath();
    /* 上下缘做轻微不规则，模拟墨迹渗透 */
    const steps = Math.max(2, Math.min(24, Math.floor(w / 3)));
    for (let i = 0; i <= steps; i++) {
      const px = x + w * i / steps;
      g.lineTo(px, y + (rnd() - 0.5) * Math.min(1.4, h * 0.12));
    }
    for (let i = steps; i >= 0; i--) {
      const px = x + w * i / steps;
      g.lineTo(px, y + h + (rnd() - 0.5) * Math.min(1.4, h * 0.12));
    }
    g.closePath();
    g.fill();
  },
  stroke: function (g, x, y, w, h, col, a, lw) {
    g.strokeStyle = rgba(col, a);
    g.lineWidth = lw;
    g.strokeRect(x + .5, y + .5, w - 1, h - 1);
  },
  mark: function (g, x, y, r, col, a, opt) {
    seed((opt && opt.seedKey) || 0);
    g.fillStyle = rgba(col, a);
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const ang = i / 8 * Math.PI * 2;
      const rad = r * (0.82 + rnd() * 0.36);
      i ? g.lineTo(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad)
        : g.moveTo(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
    }
    g.closePath(); g.fill();
  },
  grid: function (g, x, top, bottom, a, major) {
    g.strokeStyle = rgba(P.inkFaint, a);
    g.lineWidth = major ? 1 : 0.7;
    g.beginPath(); g.moveTo(Math.round(x) + .5, top);
    g.lineTo(Math.round(x) + .5, bottom); g.stroke();
  }
};

/* ---- 図面：制图质感。斜线填充 + 精确轮廓 + 方位刻度 ---- */
SURFACE.blueprint = {
  fill: function (g, x, y, w, h, col, a, opt) {
    if (w < 1 || h < 1) return;
    /* 底：极淡平涂 */
    g.fillStyle = rgba(col, a * 0.18);
    g.fillRect(x, y, w, h);
    /* 斜线：图纸以图案区分材料 */
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.strokeStyle = rgba(col, a * 0.85);
    g.lineWidth = 0.7;
    const gap = (opt && opt.hatchGap) || 4.5;
    const n = Math.min(120, Math.ceil((w + h) / gap));
    for (let i = 0; i <= n; i++) {
      const d = -h + i * gap;
      g.beginPath(); g.moveTo(x + d, y); g.lineTo(x + d + h, y + h); g.stroke();
    }
    g.restore();
  },
  stroke: function (g, x, y, w, h, col, a, lw) {
    g.strokeStyle = rgba(col, a);
    g.lineWidth = lw;
    g.strokeRect(x + .5, y + .5, w - 1, h - 1);
  },
  mark: function (g, x, y, r, col, a, opt) {
    /* 实心小方块 + 十字准线：图纸的基准点语汇 */
    g.fillStyle = rgba(col, a);
    g.fillRect(x - r * 0.7, y - r * 0.7, r * 1.4, r * 1.4);
    g.strokeStyle = rgba(col, a * 0.55);
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(x - r * 1.9, y); g.lineTo(x + r * 1.9, y);
    g.moveTo(x, y - r * 1.9); g.lineTo(x, y + r * 1.9);
    g.stroke();
  },
  grid: function (g, x, top, bottom, a, major) {
    g.strokeStyle = rgba(P.inkFaint, a);
    g.lineWidth = major ? 1.1 : 0.7;
    g.beginPath(); g.moveTo(Math.round(x) + .5, top);
    g.lineTo(Math.round(x) + .5, bottom); g.stroke();
    /* 主格加方位刻度 */
    if (major) {
      g.beginPath();
      g.moveTo(Math.round(x) + .5, top); g.lineTo(Math.round(x) + .5, top + 4);
      g.moveTo(Math.round(x) + .5, bottom - 4); g.lineTo(Math.round(x) + .5, bottom);
      g.stroke();
    }
  }
};

/* ---- 長曝光：胶片质感。柔边 + 暖色外渗（加法混合） ---- */
SURFACE.longexposure = {
  fill: function (g, x, y, w, h, col, a, opt) {
    if (w < 1 || h < 1) return;
    g.save();
    g.globalCompositeOperation = 'lighter';
    /* 内核：柔和实心 */
    g.fillStyle = rgba(col, a * 0.72);
    roundRect(g, x, y, w, h, Math.min(h * 0.35, 4));
    g.fill();
    /* 外渗：accent 暖色晕开 */
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, rgba(P.accent, a * 0.30));
    grd.addColorStop(0.5, rgba(P.accent, a * 0.14));
    grd.addColorStop(1, rgba(P.accent, a * 0.30));
    g.fillStyle = grd;
    g.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
    g.restore();
  },
  stroke: function (g, x, y, w, h, col, a, lw) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = rgba(col, a * 0.8);
    g.lineWidth = lw;
    roundRect(g, x + .5, y + .5, w - 1, h - 1, Math.min(h * 0.3, 3));
    g.stroke();
    g.restore();
  },
  mark: function (g, x, y, r, col, a, opt) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const grd = g.createRadialGradient(x, y, 0, x, y, r * 2.4);
    grd.addColorStop(0, rgba(P.ink, Math.min(1, a * 1.05)));
    grd.addColorStop(0.35, rgba(col, a * 0.7));
    grd.addColorStop(1, rgba(col, 0));
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r * 2.4, 0, Math.PI * 2); g.fill();
    g.restore();
  },
  grid: function (g, x, top, bottom, a, major) {
    g.strokeStyle = rgba(P.inkFaint, a * 0.7);
    g.lineWidth = major ? 1 : 0.7;
    g.beginPath(); g.moveTo(Math.round(x) + .5, top);
    g.lineTo(Math.round(x) + .5, bottom); g.stroke();
  }
};

/* ---- 構成：包豪斯。硬边几何，纯色平涂，零柔化 ---- */
SURFACE.construct = {
  fill: function (g, x, y, w, h, col, a, opt) {
    if (w < 0.5 || h < 0.5) return;
    g.fillStyle = rgba(col, a);
    /* 硬边：直角，无圆角，无渐变 */
    g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)),
               Math.max(1, Math.round(h)));
  },
  stroke: function (g, x, y, w, h, col, a, lw) {
    g.strokeStyle = rgba(col, a);
    g.lineWidth = lw;
    /* 直角描边，对齐像素 */
    g.strokeRect(Math.round(x) + .5, Math.round(y) + .5,
                 Math.max(1, Math.round(w)) - 1, Math.max(1, Math.round(h)) - 1);
  },
  mark: function (g, x, y, r, col, a, opt) {
    /* 实心方块：构成语汇里没有圆 */
    const s = Math.max(2.4, r * 1.5);
    g.fillStyle = rgba(col, a);
    g.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
  },
  grid: function (g, x, top, bottom, a, major) {
    g.strokeStyle = rgba(P.inkFaint, a);
    g.lineWidth = major ? 1.4 : 0.7;
    g.beginPath(); g.moveTo(Math.round(x) + .5, top);
    g.lineTo(Math.round(x) + .5, bottom); g.stroke();
  }
};

/* ---- 磁帶：磁带质感。颗粒 + 轻微错位 ---- */
SURFACE.tape = {
  fill: function (g, x, y, w, h, col, a, opt) {
    if (w < 1 || h < 1) return;
    g.fillStyle = rgba(col, a * 0.82);
    g.fillRect(x, y, w, h);
    /* 磁粉颗粒：疏密随机，制造粗糙感 */
    seed((opt && opt.seedKey) || 0);
    g.fillStyle = rgba(P.bg, a * 0.30);
    const n = Math.min(90, Math.floor(w * h / 22));
    for (let i = 0; i < n; i++) {
      g.fillRect(x + rnd() * w, y + rnd() * h, 1, 1);
    }
  },
  stroke: function (g, x, y, w, h, col, a, lw) {
    g.strokeStyle = rgba(col, a);
    g.lineWidth = lw;
    g.strokeRect(x + .5, y + .5, w - 1, h - 1);
  },
  mark: function (g, x, y, r, col, a, opt) {
    seed((opt && opt.seedKey) || 0);
    g.fillStyle = rgba(col, a);
    const n = 3;
    for (let i = 0; i < n; i++) {
      const s = r * (0.5 + rnd() * 0.7);
      g.fillRect(x - s / 2 + (rnd() - .5) * r * 0.8,
                 y - s / 2 + (rnd() - .5) * r * 0.8, s, s);
    }
  },
  grid: function (g, x, top, bottom, a, major) {
    /* 磁带抖动：极轻微的横向偏移 */
    g.strokeStyle = rgba(P.inkFaint, a);
    g.lineWidth = major ? 1 : 0.7;
    const off = major ? 0 : 0.4;
    g.beginPath(); g.moveTo(Math.round(x + off) + .5, top);
    g.lineTo(Math.round(x + off) + .5, bottom); g.stroke();
  }
};

/* ---- 星図：古星图册。柔光 + 星点 ---- */
SURFACE.staratlas = {
  fill: function (g, x, y, w, h, col, a, opt) {
    if (w < 1 || h < 1) return;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = rgba(col, a * 0.55);
    roundRect(g, x, y, w, h, Math.min(h * 0.4, 3));
    g.fill();
    g.restore();
  },
  stroke: function (g, x, y, w, h, col, a, lw) {
    g.strokeStyle = rgba(col, a * 0.85);
    g.lineWidth = lw;
    roundRect(g, x + .5, y + .5, w - 1, h - 1, Math.min(h * 0.35, 3));
    g.stroke();
  },
  mark: function (g, x, y, r, col, a, opt) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const grd = g.createRadialGradient(x, y, 0, x, y, r * 2);
    grd.addColorStop(0, rgba(P.ink, Math.min(1, a)));
    grd.addColorStop(1, rgba(col, 0));
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r * 2, 0, Math.PI * 2); g.fill();
    /* 星芒：短十字 */
    if (r > 1.2) {
      g.strokeStyle = rgba(P.accent, a * 0.6);
      g.lineWidth = 0.7;
      const L = r * 2.2;
      g.beginPath();
      g.moveTo(x - L, y); g.lineTo(x + L, y);
      g.moveTo(x, y - L); g.lineTo(x, y + L);
      g.stroke();
    }
    g.restore();
  },
  grid: function (g, x, top, bottom, a, major) {
    g.strokeStyle = rgba(P.inkFaint, a * 0.75);
    g.lineWidth = major ? 0.9 : 0.6;
    g.beginPath(); g.moveTo(Math.round(x) + .5, top);
    g.lineTo(Math.round(x) + .5, bottom); g.stroke();
  }
};

/* ---- 織：织物。经纬交织纹理 ---- */
SURFACE.weave = {
  fill: function (g, x, y, w, h, col, a, opt) {
    if (w < 1 || h < 1) return;
    g.fillStyle = rgba(col, a * 0.22);
    g.fillRect(x, y, w, h);
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    /* 经线（垂直） */
    g.strokeStyle = rgba(col, a * 0.62);
    g.lineWidth = 0.8;
    const gapV = 2.8;
    const nv = Math.min(140, Math.ceil(w / gapV));
    for (let i = 0; i <= nv; i++) {
      const px = x + i * gapV;
      g.beginPath(); g.moveTo(px, y); g.lineTo(px, y + h); g.stroke();
    }
    /* 纬线（水平），更疏 */
    g.strokeStyle = rgba(P.accent2, a * 0.42);
    const gapH = 3.6;
    const nh = Math.min(90, Math.ceil(h / gapH));
    for (let i = 0; i <= nh; i++) {
      const py = y + i * gapH;
      g.beginPath(); g.moveTo(x, py); g.lineTo(x + w, py); g.stroke();
    }
    g.restore();
  },
  stroke: function (g, x, y, w, h, col, a, lw) {
    g.strokeStyle = rgba(col, a * 0.6);
    g.lineWidth = lw;
    g.strokeRect(x + .5, y + .5, w - 1, h - 1);
  },
  mark: function (g, x, y, r, col, a, opt) {
    /* 经纬交点：小十字 */
    g.strokeStyle = rgba(col, a);
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(x - r, y); g.lineTo(x + r, y);
    g.moveTo(x, y - r); g.lineTo(x, y + r);
    g.stroke();
  },
  grid: function (g, x, top, bottom, a, major) {
    g.strokeStyle = rgba(P.inkFaint, a * 0.8);
    g.lineWidth = major ? 1 : 0.7;
    g.beginPath(); g.moveTo(Math.round(x) + .5, top);
    g.lineTo(Math.round(x) + .5, bottom); g.stroke();
  }
};

/* ---- 孔版：Riso 印刷。半调网点 + 套印偏移 ---- */
SURFACE.risograph = {
  fill: function (g, x, y, w, h, col, a, opt) {
    if (w < 1 || h < 1) return;
    g.save();
    g.globalCompositeOperation = 'multiply';
    /* 第一色：主体 */
    g.fillStyle = rgba(P.accent, a * 0.78);
    g.fillRect(x, y, w, h);
    /* 第二色：偏移套印（Riso 工艺特征） */
    g.fillStyle = rgba(P.accent2, a * 0.52);
    g.fillRect(x - 1.4, y + 1.2, w + 2.8, h - 2.4);
    g.restore();
  },
  stroke: function (g, x, y, w, h, col, a, lw) {
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.strokeStyle = rgba(P.ink, a * 0.75);
    g.lineWidth = lw;
    g.strokeRect(x + .5, y + .5, w - 1, h - 1);
    g.restore();
  },
  mark: function (g, x, y, r, col, a, opt) {
    /* 半调网点：主点 + 偏移副点 */
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = rgba(P.accent, a);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    if (r > 1.4) {
      g.fillStyle = rgba(P.accent2, a * 0.6);
      g.beginPath(); g.arc(x + r * 0.45, y - r * 0.35, r * 0.72, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  },
  grid: function (g, x, top, bottom, a, major) {
    g.strokeStyle = rgba(P.inkFaint, a * 0.7);
    g.lineWidth = major ? 1 : 0.7;
    g.beginPath(); g.moveTo(Math.round(x) + .5, top);
    g.lineTo(Math.round(x) + .5, bottom); g.stroke();
  }
};

/* ============================================================
   白塑料（wh_soft）
   ------------------------------------------------------------
   设计原则：**白色底上，色块用描边而不是填充。**
   填充在浅底上会显得笨重廉价；1px 描边才精确、有设备感。

   这是唯一一个 fill 不填色的主题 —— 它画的是「分区边界」，
   不是「一块颜色」。色块因此看起来像设备面板上的凹槽。
   ============================================================ */
SURFACE.wh_soft = {
  fill: function (g, x, y, w, h, col, a, opt) {
    if (w < 0.5 || h < 0.5) return;
    /* 极小尺寸（波形弱信号段）必须实心 ——
       描边在 1px 高度上会变成一条线，波形会断。
       这是「描边不填充」原则的唯一例外，且只在小尺寸生效。 */
    if (w < 3 || h < 3) {
      g.fillStyle = rgba(col || P.ink, 0.72 * a);
      g.fillRect(x, y, Math.max(w, 0.8), Math.max(h, 0.8));
      return;
    }
    /* 极淡的内阴影：让区域看起来是**凹进去的**，不是涂了颜色 */
    const grd = g.createLinearGradient(0, y, 0, y + Math.min(h, 16));
    grd.addColorStop(0, rgba(P.ink, 0.030 * a));
    grd.addColorStop(1, rgba(P.ink, 0));
    g.fillStyle = grd;
    g.fillRect(x, y, w, Math.min(h, 16));
    /* 1px 描边：这是「设备感」的全部来源 */
    g.strokeStyle = rgba(P.ink, 0.10 + 0.14 * a);
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  },

  stroke: function (g, x, y, w, h, col, a, lw) {
    g.strokeStyle = rgba(col, a * 0.55);
    g.lineWidth = lw || 1;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  },

  mark: function (g, x, y, r, col, a, opt) {
    if (r < 0.6) return;
    /* 空心圆环。踩下的那一格（col 是 accent）中心加一点实心。 */
    const 主 = col && col !== P.ink && col !== P.inkMid;
    g.strokeStyle = rgba(主 ? P.accent : P.ink, 主 ? a : a * 0.42);
    g.lineWidth = 主 ? 1.8 : 1;
    g.beginPath();
    g.arc(x, y, r * 0.72, 0, Math.PI * 2);
    g.stroke();
    if (主) {
      g.fillStyle = rgba(P.accent, a);
      g.beginPath();
      g.arc(x, y, r * 0.26, 0, Math.PI * 2);
      g.fill();
    }
  },

  grid: function (g, x, top, bottom, a, major) {
    g.strokeStyle = rgba(P.ink, a * (major ? 0.13 : 0.055));
    g.lineWidth = 1;
    g.beginPath();
    /* +0.5 让 1px 线落在像素中心，不糊 */
    g.moveTo(Math.round(x) + 0.5, top);
    g.lineTo(Math.round(x) + 0.5, bottom);
    g.stroke();
  },
};

/* ============================================================
   异形铬（chrome_freak）
   ------------------------------------------------------------
   地下时装 lookbook 的排版：超粗窄体、荧光朱红、厚板与切角。

   fill 画「斜切厚板」：右上与左下各切掉一角 —— 这是它和
   所有其它主题最不同的几何特征（其余主题都是正交矩形）。

   填充用**实心深色**（不是描边）—— 白底上要的是「黑块压住画面」，
   与 wh_soft 相反。两套主题在同一产品里形成明暗两极。
   ============================================================ */
SURFACE.chrome_freak = {
  fill: function (g, x, y, w, h, col, a, opt) {
    /* 极小尺寸（波形弱信号段）退化为实心矩形 ——
       斜切在 1px 高度上没有意义，且直接 return 会让波形断裂。 */
    if (w < 0.5 || h < 0.5) return;
    if (w < 3 || h < 3) {
      g.fillStyle = rgba(col || P.ink, 0.82 * a);
      g.fillRect(x, y, Math.max(w, 0.8), Math.max(h, 0.8));
      return;
    }
    const 切 = Math.min(w, h) * 0.14;
    /* 主 clip（col 是 accent）→ 实心黑块，压住画面。
       次要 clip → 保留一点原色，避免全灰糊成一片。 */
    const 是主 = col && col.toLowerCase() === P.accent.toLowerCase();
    g.fillStyle = 是主
      ? rgba(P.ink, 0.88 * a)
      : rgba(col || P.ink, 0.30 * a);
    g.beginPath();
    g.moveTo(x + 切, y);
    g.lineTo(x + w, y);
    g.lineTo(x + w, y + h - 切);
    g.lineTo(x + w - 切, y + h);
    g.lineTo(x, y + h);
    g.lineTo(x, y + 切);
    g.closePath();
    g.fill();
  },

  stroke: function (g, x, y, w, h, col, a, lw) {
    g.strokeStyle = rgba(P.accent, a * 0.9);
    g.lineWidth = lw || 2;
    g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  },

  mark: function (g, x, y, r, col, a, opt) {
    if (r < 0.6) return;
    /* 针尖：十字。极小、极硬。 */
    g.strokeStyle = rgba(col || P.accent, a);
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x - r, y); g.lineTo(x + r, y);
    g.moveTo(x, y - r); g.lineTo(x, y + r);
    g.stroke();
  },

  grid: function (g, x, top, bottom, a, major) {
    /* 硬边竖线，无抗锯齿偏移 */
    g.strokeStyle = rgba(P.ink, a * (major ? 0.34 : 0.14));
    g.lineWidth = major ? 2 : 1;
    g.beginPath();
    g.moveTo(Math.round(x), top);
    g.lineTo(Math.round(x), bottom);
    g.stroke();
  },
};

/* ============================================================
   核警示（nuclear）
   ------------------------------------------------------------
   警示黄的几何逻辑：中心 + 三等分。不画辐射标志本身，只借构图。

   fill 画「模板喷涂」：断续短划边框 + 半透明底。
   断续是喷涂模板的特征 —— 漆从镂空处漏过去，边缘不连续。
   ============================================================ */
SURFACE.nuclear = {
  fill: function (g, x, y, w, h, col, a, opt) {
    /* 极小尺寸（波形弱信号段）退化为实心 ——
       断续边框在 1px 高度上会变成噪点，且直接 return 会让波形断裂。 */
    if (w < 0.5 || h < 0.5) return;
    if (w < 3 || h < 3) {
      g.fillStyle = rgba(col || P.accent, 0.80 * a);
      g.fillRect(x, y, Math.max(w, 0.8), Math.max(h, 0.8));
      return;
    }
    /* 半透明深底 */
    g.fillStyle = rgba(P.bg, 0.55 * a);
    g.fillRect(x, y, w, h);
    /* 断续短划边框 */
    const 划 = 10, 隙 = 8;
    g.strokeStyle = rgba(P.accent, 0.55 * a);
    g.lineWidth = 2;
    for (let px = x; px < x + w; px += 划 + 隙) {
      const 末 = Math.min(px + 划, x + w);
      g.beginPath();
      g.moveTo(px, y); g.lineTo(末, y);
      g.moveTo(px, y + h); g.lineTo(末, y + h);
      g.stroke();
    }
    for (let py = y; py < y + h; py += 划 + 隙) {
      const 末 = Math.min(py + 划, y + h);
      g.beginPath();
      g.moveTo(x, py); g.lineTo(x, 末);
      g.moveTo(x + w, py); g.lineTo(x + w, 末);
      g.stroke();
    }
  },

  stroke: function (g, x, y, w, h, col, a, lw) {
    g.strokeStyle = rgba(P.accent, a * 0.7);
    g.lineWidth = lw || 2;
    g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  },

  mark: function (g, x, y, r, col, a, opt) {
    if (r < 0.8) return;
    /* 警示斜条小圆：黄底 + 黑斜纹 */
    g.save();
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = rgba(P.accent, a * 0.9);
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.strokeStyle = rgba(P.bg, a * 0.72);
    g.lineWidth = Math.max(1.2, r * 0.34);
    for (let k = -3; k <= 3; k++) {
      g.beginPath();
      g.moveTo(x - r, y + k * r * 0.6 - r);
      g.lineTo(x + r, y + k * r * 0.6 + r);
      g.stroke();
    }
    g.restore();
  },

  grid: function (g, x, top, bottom, a, major) {
    g.strokeStyle = rgba(P.accent, a * (major ? 0.22 : 0.09));
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(Math.round(x) + 0.5, top);
    g.lineTo(Math.round(x) + 0.5, bottom);
    g.stroke();
  },
};

/* ---- 统一入口 ----
   组件调用这些函数，自动获得当前主题的质感。
   未登记的主题回退到 sumi，保证不崩。 */
function surface() {
  return SURFACE[activeThemeKey()] || SURFACE.sumi;
}

/* 便捷包装：填充 / 描边 / 标记 / 网格 */
function sFill(g, x, y, w, h, col, a, opt) {
  surface().fill(g, x, y, w, h, col, a, opt);
}
function sStroke(g, x, y, w, h, col, a, lw) {
  surface().stroke(g, x, y, w, h, col, a, lw);
}
function sMark(g, x, y, r, col, a, opt) {
  surface().mark(g, x, y, r, col, a, opt);
}
function sGrid(g, x, top, bottom, a, major) {
  surface().grid(g, x, top, bottom, a, major);
}
