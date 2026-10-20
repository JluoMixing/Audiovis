/* ============================================================
   全主题总览
   ------------------------------------------------------------
   同一组组件在 8 个主题下的表现对比。
   用于检查：主题适配是否到位、各组件在不同主题下是否都成立。

   注意：本页只渲染「单主题预览」之外的对比视图。
   每个主题独立渲染全部组件，共 8 × N 个画布。

   依赖：core/*, app/bindings.js, components/*, bloom/*
   ============================================================ */

const wrap = document.getElementById('wrap');
const CELLS = [];

/* 每个主题渲染的组件子集（全渲染会过重，选取有代表性的） */
const SHOWCASE = ['playlist', 'stepper', 'pianoroll', 'pitchwheel',
                  'spectrum', 'waveform', 'loudness', 'transient'];

(function buildAllThemes() {
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  DIRECTIONS.order.forEach(function (key) {
    const T = DIRECTIONS.directions[key];

    const sec = document.createElement('div');
    sec.className = 'themeSection';

    const title = document.createElement('div');
    title.className = 'themeTitle';
    title.innerHTML = T.name + '<em>' + T.subtitle + '</em>';
    sec.appendChild(title);

    const note = document.createElement('div');
    note.className = 'themeNote';
    note.innerHTML = T.concept +
      '<br><b>数据翻译：</b>' + T.translation +
      (BLOOM_DESC[key] ? '　<b>绽放语汇：</b>' + BLOOM_DESC[key] : '');
    sec.appendChild(note);

    const grid = document.createElement('div');
    grid.className = 'grid';

    SHOWCASE.forEach(function (id) {
      const c = getComponent(id);
      if (!c) return;

      const cell = document.createElement('div');
      cell.className = 'gridCell';

      const lab = document.createElement('div');
      lab.className = 'gridLabel';
      lab.textContent = c.name + '  ' + c.w + '×' + c.h;
      cell.appendChild(lab);

      /* 为控制体积，总览页按 0.62 缩放显示 */
      const SCALE = 0.62;
      const cw = Math.round(c.w * SCALE), ch = Math.round(c.h * SCALE);

      const cv = document.createElement('canvas');
      cv.width = cw * DPR;
      cv.height = ch * DPR;
      cv.style.width = cw + 'px';
      cv.style.height = ch + 'px';
      const g = cv.getContext('2d');
      g.scale(DPR * SCALE, DPR * SCALE);

      cell.appendChild(cv);
      grid.appendChild(cell);

      CELLS.push({ c: c, g: g, T: T, key: key, DPR: DPR, SCALE: SCALE,
                   w: c.w, h: c.h });
    });

    sec.appendChild(grid);
    wrap.appendChild(sec);
  });
})();

/* ---- 渲染 ----
   关键：每个组件必须用它所属主题的令牌渲染。
   组件内部通过全局 P/TY/TR 读主题，故渲染前切换。 */
function renderCell(cell) {
  setActiveTheme(cell.T, cell.key);
  const g = cell.g;
  g.save();
  g.setTransform(cell.DPR * cell.SCALE, 0, 0, cell.DPR * cell.SCALE, 0, 0);
  panelBackground(g, cell.w, cell.h);
  g.restore();
  try {
    cell.c.draw(g, cell.w, cell.h);
  } catch (e) {
    console.error('[' + cell.key + '/' + cell.c.id + ']', e);
  }
}

function redraw() {
  CELLS.forEach(renderCell);
  /* 恢复初始主题，避免影响其他逻辑 */
  setActiveTheme(DIRECTIONS.directions[window.__THEME_KEY__], window.__THEME_KEY__);
  document.getElementById('clock').textContent = clockStr(CUR);
  document.getElementById('scrub').value = String(Math.round(CUR / DUR * 1000));
}

/* ---- 控制 ---- */
let playing = false, rate = 6, last = 0;

document.getElementById('scrub').addEventListener('input', function (e) {
  CUR = Number(e.target.value) / 1000 * DUR;
  redraw();
});
document.getElementById('play').addEventListener('change', function (e) {
  playing = e.target.checked; last = 0;
});
document.getElementById('rate').addEventListener('input', function (e) {
  rate = Number(e.target.value);
  document.getElementById('rateVal').textContent = rate + '×';
});
document.getElementById('winbars').addEventListener('input', function (e) {
  WIN_BARS = Number(e.target.value);
  document.getElementById('winVal').textContent = WIN_BARS + ' 小节';
  redraw();
});
document.getElementById('mainwin').addEventListener('input', function (e) {
  MAIN_WIN_BARS = Number(e.target.value);
  document.getElementById('mainWinVal').textContent = MAIN_WIN_BARS + ' 小节';
  redraw();
});
document.getElementById('decay').addEventListener('input', function (e) {
  DECAY_BEATS = Number(e.target.value) / 10;
  document.getElementById('decayVal').textContent = DECAY_BEATS.toFixed(1) + ' 拍';
  document.getElementById('decaySec').textContent =
    '= ' + decaySeconds(DECAY_BEATS).toFixed(2) + ' 秒';
  redraw();
});
document.getElementById('btnNow').addEventListener('click', function () {
  CUR = 48; redraw();
});

function loop(ts) {
  if (playing) {
    if (last) CUR += (ts - last) / 1000 * rate;
    if (CUR >= DUR) CUR = 0;
    last = ts;
    redraw();
  } else { last = 0; }
  requestAnimationFrame(loop);
}

document.getElementById('decaySec').textContent =
  '= ' + decaySeconds(DECAY_BEATS).toFixed(2) + ' 秒';
redraw();
requestAnimationFrame(loop);
