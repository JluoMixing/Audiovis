/* ============================================================
   数据访问层
   ------------------------------------------------------------
   组件不直接读 DATA 的深层结构，而是用这里的函数。
   这样数据格式变化时只需改这一处。

   依赖：core/canvas-kit.js, core/time.js
   ============================================================ */

/* ---- 鼓组 ---- */

/* 鼓件类别的固定顺序（决定行的排列） */
const GROUP_ORDER = ['kick', 'snare', 'hihat', 'openhat', 'crash', 'tom', 'fx', 'other'];

/* 鼓件类别的中文名 */
const GROUP_CN = {
  kick: '底鼓', snare: '军鼓', hihat: '踩镲', openhat: '开镲',
  crash: '吊镲', tom: '通鼓', fx: '效果', other: '其他'
};

/* 收集当前时刻所有发声的鼓组，并按鼓件类别合并成行。
   ------------------------------------------------------------
   为什么要合并：本工程鼓组分散在多个 Pattern 里同时播放
   （实测 48s 时有 P2 kick + P5/P6 snare + P7/P9 hihat 共 5 个）。
   若只取其中一个，画面就只显示一种鼓件——这是 F6 的真实行为：
   通道机架显示所有通道，不是某一个 Pattern。

   返回 { groups, data, stepCount, live }
     groups    按 GROUP_ORDER 排列的鼓件类别数组
     data      { 类别: { sources:[PatternId], steps:[{step,absTick,vel}] } }
     stepCount 最长行的步数
     live      参与合并的片段列表
*/
function collectDrums(nt) {
  const STEP = PPQ / 4;
  let live = [];

  /* 按 id 找鼓组 —— 不能用 Number(pid)
     ------------------------------------------------------------
     DRUM_USE 的键除了 pattern id（数字），还有 "audio"
     （名字带 #step 的音频 clip）。Number("audio") 是 NaN，
     而 NaN !== NaN 恒成立，于是音频组永远选不中 ——
     行画出来了但一个音符都不显示（实测踩到）。

     改为：先按原值比，再按数字比（并排除 NaN）。 */
  function 找组(pid) {
    for (let i = 0; i < DRUMS.length; i++) {
      if (String(DRUMS[i].id) === String(pid)) return DRUMS[i];
    }
    const n = Number(pid);
    if (!isNaN(n)) {
      for (let i = 0; i < DRUMS.length; i++) {
        if (DRUMS[i].id === n) return DRUMS[i];
      }
    }
    return null;
  }

  /* 预读 / 回溯窗口：让行数稳定，不来回跳
     ------------------------------------------------------------
     用户反馈：步进器行数会在几秒内 3→2→1→3 来回切，
     尤其 audio clip 与 pattern 并存的段落最明显。

     实测（island，沿时间轴逐 1/4 拍采样 1624 点）：
       64.7s 3→2、65.6s 2→1、66.4s 1→3
       整曲出现 5 次这种「凹陷」，每次约 2 秒。

     原因：行集合只看「此刻正在播的 clip」。两段三行的区间之间，
     如果夹着短暂的空档（clip 换段/首尾不齐），行数就掉下去再弹回来。

     修法：判断「哪些行该出现」时，用**加宽的时间窗**：
       往后再看 2 小节（即将到来的 clip 提前占位）
       往前再看 1 小节（刚结束的 clip 不立刻消失）
     这样行数在一段区间内保持恒定，切换只发生在真正换段的时刻。

     注意：**行的集合**用加宽窗，而**音符**仍按各自的绝对 tick 绘制，
     所以提前占位的行只是空行，不会有音符提前出现。 */
  const AHEAD = 2 * PPQ * 4;      /* 往后 2 小节 */
  const BACK = 1 * PPQ * 4;       /* 往前 1 小节 */

  Object.keys(DRUM_USE).forEach(function (pid) {
    const grp = 找组(pid);
    if (!grp) return;
    DRUM_USE[pid].forEach(function (iv) {
      if (nt >= iv.start - BACK && nt < iv.end + AHEAD) {
        live.push({ grp: grp, iv: iv, 提前: nt < iv.start,
                    延后: nt >= iv.end });
      }
    });
  });

  /* 若无正在播放的，顺延到最近的（同样可多个） */
  if (!live.length) {
    let best = Infinity;
    Object.keys(DRUM_USE).forEach(function (pid) {
      const grp = 找组(pid);
      if (!grp) return;
      DRUM_USE[pid].forEach(function (iv) {
        const d = nt < iv.start ? iv.start - nt : nt - iv.end;
        if (d < best) { best = d; live = [{ grp: grp, iv: iv }]; }
        else if (d === best) live.push({ grp: grp, iv: iv });
      });
    });
  }

  /* 行按 key 归并 —— 不按分数
     ------------------------------------------------------------
     ## 为什么不能用「分数相近」归并（踩过）
     实测 nujabes：鼓通道音高全是 C5(72)，频率分对每行都一样，
     只剩节奏分，于是 kick 与 snare 恰好都算出 0.61，
     被「分数差 ≤ 0.12」的规则并成一行 —— 三行变两行。

     归并依据必须和数据来源一致：
       · 通道名识别出了族别（kick/snare/hihat）→ **按族名归并**
       · 否则（软音源按音高分行）           → **按音高归并**
     分数只用来**排序**（谁排第一行），不参与归并。 */
  const 行桶 = {};        /* key -> { key, score, sources:[], steps:[] } */

  function 取桶(key, score) {
    const k = key === undefined || key === null ? ('s' + score) : String(key);
    if (!行桶[k]) {
      行桶[k] = { key: k, score: score, sources: [], steps: [] };
    } else if (score < 行桶[k].score) {
      /* 同一行来自多个 pattern 时，取更靠前（更小）的分数 */
      行桶[k].score = score;
    }
    return 行桶[k];
  }

  let maxStep = 0;
  live.forEach(function (item) {
    item.grp.rows.forEach(function (row) {
      const b = 取桶(row.key,
                     row.score === undefined ? 0.5 : row.score);
      if (b.sources.indexOf(item.grp.id) < 0) b.sources.push(item.grp.id);

      /* 音频行（#step 的采样）：数据层已给出**绝对 tick**。
         ------------------------------------------------------------
         不能套用下面 pattern 那条公式：
             绝对 = iv.start + origin + 步序 × 格长
         音频行里同一行有多个 clip 分布在全曲，共用一个 origin 会算错
         （实测偏了整整一个 origin，音符被推到工程末尾之外，画面全空）。 */
      if (row.absTicks) {
        row.absTicks.forEach(function (abs) {
          const rel = Math.round((abs - item.iv.start) / STEP);
          if (rel > maxStep) maxStep = rel;
          b.steps.push({ step: rel, absTick: abs, vel: 100 });
        });
        return;
      }

      Object.keys(row.steps).forEach(function (k) {
        const s = Number(k);
        /* 绝对 tick = clip 起点 + 量化原点 + 步序 × 格长 */
        const abs = item.iv.start + item.grp.origin + s * STEP;
        const rel = Math.round((abs - item.iv.start) / STEP);
        if (rel > maxStep) maxStep = rel;
        b.steps.push({ step: rel, absTick: abs, vel: row.steps[k] });
      });
    });
  });

  /* 去重：同一行里同一绝对时刻只留一击
     ------------------------------------------------------------
     Playlist 里同一位置可能叠了多个同组 clip（实测 island 的
     FD_kick#step 在 33792~33907 出现了两次），两个都 live 时
     同一组被遍历两遍，音符翻倍（25 → 50）。

     去重按 absTick 的 1/16 格取整 —— 同一格内的重复视为同一击。 */
  Object.keys(行桶).forEach(function (k) {
    const b = 行桶[k];
    const 见过 = {};
    const 保留 = [];
    b.steps.forEach(function (st) {
      const 格 = Math.round(st.absTick / STEP);
      if (见过[格]) return;
      见过[格] = true;
      保留.push(st);
    });
    b.steps = 保留;
  });

  /* 按分数升序排 —— 底鼓在前、踩镲在后 */
  const 桶数组 = Object.keys(行桶).map(function (k) { return 行桶[k]; });
  桶数组.sort(function (a, b) {
    if (a.score !== b.score) return a.score - b.score;
    return String(a.key) < String(b.key) ? -1 : 1;
  });

  const groups = 桶数组.map(function (b, i) { return i; });
  const data = {};
  桶数组.forEach(function (b, i) {
    data[i] = { sources: b.sources, steps: b.steps, score: b.score,
                key: b.key };
  });

  return {
    groups: groups,
    data: data,
    stepCount: maxStep + 1,
    live: live,
    scores: 桶数组.map(function (b) { return b.score; }),
  };
}

/* ---- Pattern 优先级 ---- */

/* 默认优先级：旋律性 Pattern 按音符数降序。
   正式软件中此顺序由用户拖拽决定。 */
const DEFAULT_ORDER = Object.keys(SHAPES)
  .filter(function (id) { return SHAPES[id].kind === 'melodic'; })
  .sort(function (a, b) { return SHAPES[b].notes.length - SHAPES[a].notes.length; })
  .map(Number);

const RANK = {};
DEFAULT_ORDER.forEach(function (id, i) { RANK[id] = i; });

/* 解析当前应显示的 Pattern。
   ------------------------------------------------------------
   kindFilter：只考虑该类型的 Pattern（'melodic' / 'percussive'）。
   为何需要过滤：本工程鼓组几乎全程铺满，若不过滤，
   钢琴卷帘会永远显示鼓组，而鼓组已由步进器专门呈现。

   返回 { patternId, clip, r, isActive } 或 null。
   isActive=false 表示顺延显示（指针不在该 clip 内）。
*/
function resolvePattern(rank, kindFilter) {
  const nt = nowTick();
  let active = null, nearest = null, nearestDist = Infinity;

  const pass = function (pid) {
    if (!kindFilter) return true;
    const sh = SHAPES[pid];
    return sh && sh.kind === kindFilter;
  };

  TL.tracks.forEach(function (t) {
    t.clips.forEach(function (c) {
      if (c.type !== 'pattern' || !SHAPES[c.sourceId]) return;
      if (!pass(c.sourceId)) return;
      const r = rank[c.sourceId] === undefined ? 9999 : rank[c.sourceId];
      if (nt >= c.start && nt < c.end) {
        if (!active || r < active.r || (r === active.r && c.start > active.clip.start)) {
          active = { patternId: c.sourceId, clip: c, r: r, isActive: true };
        }
      } else {
        const d = nt < c.start ? c.start - nt : nt - c.end;
        if (d < nearestDist || (d === nearestDist && r < (nearest ? nearest.r : 9999))) {
          nearestDist = d;
          nearest = { patternId: c.sourceId, clip: c, r: r, isActive: false };
        }
      }
    });
  });

  return active || nearest || null;
}

/* 收集时间窗内**所有** pattern clip（供连续滚动的组件使用）。
   ------------------------------------------------------------
   ## 为什么需要这个
   原来组件用 resolvePattern() 只取**一个** pattern，再用
   clip.start + n.t 定位音符。一旦选中的 pattern 变了，
   clip.start 变了，所有音符整体位移 —— 画面「跳」到新 pattern 的开头。
   （用户实测：「当前 pattern 结束了，会直接跳回到开头」，很突兀。）

   实测一个 2 小节窗口内有 5~14 个 clip、5~8 个不同 pattern，
   本就该同时可见。改成把窗口内所有 clip 都画出来，按各自
   clip.start 映射到同一根绝对时间轴，pattern 就是「流过去」的。

   ## 不去重（重要）
   同一 patternId 在窗口内常有**多个相邻实例**（例如 P20 在
   15360~16896 与 16896~18432 各一个，是连续两次重复播放）。
   初版为了「避免同一 pattern 双影」而每个 patternId 只留一个实例 ——
   结果窗口跨过实例边界时，选中的实例从 A 跳到 B，画面整段位移，
   **反而制造了跳变**（实测 tick 17208 处相邻帧差异 21.7，
   是中位数 4.96 的 4.4 倍）。

   正确做法：**全部保留**。窗口里同时出现同一个 pattern 的两个实例，
   本来就是「这个 pattern 正在被连续播放两次」，画面上就是它的音符
   连续流过 —— 这正是用户要的顺畅流动。

   参数：
     rank   {patternId: 优先级}（越小越优先）
     kind   'melodic' | 'percussive' | null
     wStart, wEnd   窗口的绝对 tick 范围

   返回 [{ patternId, clip, r }]，按 clip.start 升序。
*/
function collectClipsInWindow(rank, kind, wStart, wEnd) {
  const out = [];
  TL.tracks.forEach(function (t) {
    t.clips.forEach(function (c) {
      if (c.type !== 'pattern') return;
      const sh = SHAPES[c.sourceId];
      if (!sh) return;
      if (kind && sh.kind !== kind) return;
      if (c.end <= wStart || c.start >= wEnd) return;
      out.push({
        patternId: c.sourceId,
        clip: c,
        r: rank[c.sourceId] === undefined ? 9999 : rank[c.sourceId],
      });
    });
  });
  out.sort(function (a, b) {
    if (a.clip.start !== b.clip.start) return a.clip.start - b.clip.start;
    return a.r - b.r;
  });
  return out;
}

/* ---- 时间轴泳道压缩 ----
   区间图着色：每轨全曲固定一条泳道（身份稳定，不随时刻漂移）。
   返回 { assign, laneCount, laneTracks, trackCount }。
*/
function packLanes() {
  const tracks = TL.tracks;
  const perTrack = {};
  tracks.forEach(function (t) {
    if (t.clips.length) {
      perTrack[t.index] = t.clips.map(function (c) { return [c.start, c.end]; })
        .sort(function (a, b) { return a[0] - b[0]; });
    }
  });

  const order = Object.keys(perTrack).map(Number)
    .sort(function (a, b) { return perTrack[a][0][0] - perTrack[b][0][0]; });

  const lanes = [], assign = {};
  order.forEach(function (tid) {
    const ivs = perTrack[tid];
    let placed = false;
    for (let li = 0; li < lanes.length; li++) {
      const used = lanes[li];
      let ok = true;
      for (let i = 0; i < ivs.length && ok; i++) {
        for (let j = 0; j < used.length; j++) {
          if (ivs[i][0] < used[j][1] && ivs[i][1] > used[j][0]) { ok = false; break; }
        }
      }
      if (ok) { assign[tid] = li; used.push.apply(used, ivs); placed = true; break; }
    }
    if (!placed) { assign[tid] = lanes.length; lanes.push(ivs.slice()); }
  });

  const laneTracks = {};
  Object.keys(assign).forEach(function (tid) {
    const li = assign[tid];
    (laneTracks[li] = laneTracks[li] || []).push(Number(tid));
  });

  return {
    assign: assign,
    laneCount: lanes.length,
    laneTracks: laneTracks,
    trackCount: order.length
  };
}

/* 泳道压缩结果（全组件共享一份，避免重复计算） */
const PACK = packLanes();
