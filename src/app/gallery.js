/* ============================================================
   预览台画廊
   ------------------------------------------------------------
   读取已注册的组件，逐个渲染到画布，并提供时间轴控制。

   设计：画廊只依赖 registry 的公共接口（COMPONENTS 数组），
   不关心组件内部实现。新增组件无需改动此文件。

   依赖：core/*, app/bindings.js
   ============================================================ */

const wrap = document.getElementById('wrap');
const ITEMS = [];

/* ---- 建立组件卡片 ---- */
(function buildGallery() {
  /* 按分组顺序排列；未在 GROUP_ORDER_UI 中登记的分组排在最后 */
  const groups = [];
  COMPONENTS.forEach(function (c) {
    if (groups.indexOf(c.group) < 0) groups.push(c.group);
  });
  groups.sort(function (a, b) {
    const ia = GROUP_ORDER_UI.indexOf(a), ib = GROUP_ORDER_UI.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  groups.forEach(function (grp) {
    const gh = document.createElement('div');
    gh.className = 'grp';
    gh.textContent = grp.toUpperCase();
    wrap.appendChild(gh);

    COMPONENTS.filter(function (c) { return c.group === grp; })
      .forEach(function (c) {
        const box = document.createElement('div');
        box.innerHTML =
          '<div class="cHead"><span class="cName">' + c.name +
          '</span><span class="cId">' + c.id + '</span>' +
          '<span class="cSize">' + c.w + '×' + c.h + '</span></div>' +
          '<div class="cDesc">' + c.desc + '</div>';

        const cv = document.createElement('canvas');
        cv.width = c.w * DPR;
        cv.height = c.h * DPR;
        cv.style.width = c.w + 'px';
        cv.style.height = c.h + 'px';
        const g = cv.getContext('2d');
        g.scale(DPR, DPR);
        box.appendChild(cv);
        wrap.appendChild(box);

        ITEMS.push({ c: c, g: g, DPR: DPR });
      });
  });
})();

/* ---- 重绘全部组件 ---- */
function redraw() {
  ITEMS.forEach(function (it) {
    const g = it.g;
    /* 重置变换并铺底：确保每帧从干净状态开始 */
    g.save();
    g.setTransform(it.DPR, 0, 0, it.DPR, 0, 0);
    panelBackground(g, it.c.w, it.c.h);
    g.restore();
    try {
      it.c.draw(it.g, it.c.w, it.c.h);
    } catch (e) {
      /* 单个组件出错不应中断其他组件 */
      console.error('[' + it.c.id + ']', e);
    }
  });
  document.getElementById('clock').textContent = clockStr(CUR);
  document.getElementById('scrub').value = String(Math.round(CUR / DUR * 1000));
}

/* ---- 播放控制 ---- */
let playing = false, rate = 6, last = 0;

document.getElementById('scrub').addEventListener('input', function (e) {
  CUR = Number(e.target.value) / 1000 * DUR;
  redraw();
});

document.getElementById('play').addEventListener('change', function (e) {
  playing = e.target.checked;
  last = 0;
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
  CUR = 48;
  redraw();
});

/* ---- 主循环 ---- */
function loop(ts) {
  if (playing) {
    if (last) CUR += (ts - last) / 1000 * rate;
    if (CUR >= DUR) CUR = 0;
    last = ts;
    redraw();
  } else {
    last = 0;
  }
  requestAnimationFrame(loop);
}

/* ---- 启动 ---- */
document.getElementById('decaySec').textContent =
  '= ' + decaySeconds(DECAY_BEATS).toFixed(2) + ' 秒';
redraw();
requestAnimationFrame(loop);
