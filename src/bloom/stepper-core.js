/* ============================================================
   步进器绘制核心
   ------------------------------------------------------------
   把「合并后的鼓组 + 绽放动画」画成 F6 风格的步进器。

   设计要点（均来自实测与用户确认）：
   1. 零指针 —— 不画指针线、不画当前列框。「现在」完全由
      绽放动画的余晖指示：刚响过的最亮最大，越旧越淡越小。
   2. 未轮到的音符不显示 —— lifecycle() 返回 null 即跳过。
      画面只呈现"刚发生的"与"正在消散的"，像持续书写的墨迹。
   3. 构图 —— 可见音符只存在于「现在」之前（已奏响、正在消散），
      故指针位置取 78%，窗口 = 消散时长 / 0.78，
      使消散轨迹铺满左侧，右侧留作"即将到来"的余白。

   依赖：core/*, bloom/themes/*, bloom/dispatch.js
   ============================================================ */

function drawStepper(g, T, key, w, h, nt, opt) {
  opt = opt || {};
  const pad = opt.pad === undefined ? 14 : opt.pad;
  const P = T.palette;

  const D = collectDrums(nt);
  if (!D.groups.length) return;

  const top = pad + 28, bottom = h - pad - 22;
  /* 左侧只留色条：不再显示行名，故不再需要给文字留 96px。
   原来留 96px 是三字行名（底鼓/军鼓/踩镲）+ 色条 + 间距。
   现在只留 pad + 色条(3px) + 间距，约 18px 足够。 */
  const gx = pad + 18, gw = w - gx - pad;
  const rowH = (bottom - top) / D.groups.length;

  /* 时间窗：指针位置固定，窗口宽度由消散时长决定 */
  const NOW_POS = 0.78;
  /* 窗口大小可由组件的「窗口」属性覆盖（属性面板里调）。
     ------------------------------------------------------------
     stepper 的默认窗口不是固定小节数，而是从消散时长反推的
     （消散越久，需要显示的时间跨度越大才自然）。
     所以 窗口小节(0) 返回 0 时保持原有推导逻辑，行为不变。 */
  const 指定小节 = 窗口小节(0);
  const winTicks = 指定小节 > 0
    ? 指定小节 * PPQ * 4
    : Math.max(2, DECAY_BEATS / NOW_POS) * PPQ;
  const winStart = nt - winTicks * NOW_POS;
  const toX = function (absTick) { return gx + ((absTick - winStart) / winTicks) * gw; };

  /* 拍格：极淡，只作为时间参照 */
  const b0 = Math.floor(winStart / PPQ), b1 = Math.ceil((winStart + winTicks) / PPQ);
  for (let b = b0; b <= b1; b++) {
    const x = toX(b * PPQ);
    if (x < gx || x > gx + gw) continue;
    const bar = b % 4 === 0;
    g.strokeStyle = rgba(P.inkFaint, bar ? 0.20 : 0.075);
    g.lineWidth = bar ? 1 : 0.7;
    g.beginPath(); g.moveTo(Math.round(x) + .5, top);
    g.lineTo(Math.round(x) + .5, bottom); g.stroke();
  }

  /* 鼓件配色：类别间明显区分，同类别内保持主题和谐 */
  /* 行配色：按**行序**取色，不再按鼓件名
     ------------------------------------------------------------
     数据层不再输出 group / name —— 行是按「频率 + 节奏」自动排的，
     第 0 行最像底鼓、越往后越像踩镲，但**不保证**名字对。
     既然不显示名字，猜错也无所谓；一旦按名字配色写死，
     名字猜错时颜色也会跟着错，反而更迷惑。

     所以只按「第几行」给颜色：低频深色 → 中频强调色 → 高频浅灰。
     行数多于 4 时循环使用，靠行位置本身区分。 */
  const byIndex = [
    mixHex(P.ink, '#000000', 0.10),       /* 第 0 行：最深（底鼓） */
    mixHex(P.accent, P.ink, 0.06),        /* 第 1 行：强调色（军鼓） */
    mixHex(P.ink, P.bg, 0.52),            /* 第 2 行：中灰（踩镲） */
    mixHex(P.accent, P.bg, 0.30),         /* 第 3 行 */
    mixHex(P.accent, P.bg, 0.06),         /* 第 4 行 */
    mixHex(P.inkMid, P.bg, 0.34)          /* 第 5 行及以后 */
  ];
  function 行色(ri) {
    return byIndex[ri % byIndex.length];
  }

  const bloom = bloomFor(key);

  D.groups.forEach(function (gk, ri) {
    const y = top + ri * rowH, cy = y + rowH * 0.5;
    const m = D.data[gk];

    /* 行底：极淡，仅界定行范围 */
    g.fillStyle = rgba(P.inkFaint, 0.035);
    g.fillRect(gx, y + rowH * 0.08, gw, rowH * 0.84);

    /* 只画色条，**不显示行名**
       ------------------------------------------------------------
       用户明确要求：所有行名都不显示，省得猜错。
       行是按「频率 + 节奏」自动分的（底鼓在前、踩镲在后），
       既然不显示名字，写错也无所谓；一旦显示名字，猜错就会误导。

       布局：色条紧贴行区左边，行区之外不再有文字。 */
    const 色 = 行色(ri);
    g.fillStyle = rgba(色, 0.9);
    g.fillRect(gx - 9, cy - rowH * 0.24, 3, rowH * 0.48);

    /* 只绘制处于生命周期内的音符 */
    const sizeBase = Math.min(rowH * 0.44, 26);
    m.steps.forEach(function (st) {
      const L = lifecycle(st.absTick, nt, DECAY_BEATS);
      if (!L) return;                       /* 未轮到 或 已消散 → 不显示 */
      const x = toX(st.absTick);
      if (x < gx - 40 || x > gx + gw + 40) return;
      const vel = Math.max(0, Math.min(1, (st.vel - 40) / 80));
      g.save();
      g.beginPath(); g.rect(gx - 2, y + 1, gw + 4, rowH - 2); g.clip();
      /* 第 9 个参数：本行鼓件族的颜色。
         ------------------------------------------------------------
         不传的话 bloom 一律用 P.ink，三族颜色完全相同 ——
         用户会以为「只显示了 hihat」（实测反馈）。
         行色按行序取，不依赖鼓件名。 */
      bloom(g, T, x, cy, sizeBase, vel, L,
            Math.floor(st.absTick) + ri * 31, 行色(ri));
      g.restore();
    });
  });

  /* 底部状态：明确可见音符数，便于验证"未轮到不显示" */
  let visible = 0, total = 0;
  D.groups.forEach(function (gk) {
    D.data[gk].steps.forEach(function (st) {
      total++;
      if (lifecycle(st.absTick, nt, DECAY_BEATS)) visible++;
    });
  });
  g.fillStyle = rgba(P.inkFaint, 0.85);
  g.font = '400 9px ' + T.type.mono;
  g.textBaseline = 'bottom';
  g.fillText(D.live.length + ' PATTERNS · ' + D.groups.length + ' VOICES · ' +
             visible + '/' + total + ' 音符在生命周期内', gx, h - pad - 4);
  g.textAlign = 'right';
  g.fillText('消散 ' + DECAY_BEATS.toFixed(1) + ' 拍', gx + gw, h - pad - 4);
  g.textAlign = 'left';
}
