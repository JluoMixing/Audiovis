/* ============================================================
   时间与动画
   ------------------------------------------------------------
   两套动画模型，用途不同，不要混用：

   emphasis()  —— 瞬时强调。用于主时间轴：音符被指针扫过时短暂放大。
                  鼓组与旋律共用同一套，保证动画统一。

   lifecycle() —— 三阶段生命周期（落笔 → 扩散 → 消散）。
                  用于步进器的绽放动画。**仅适用于鼓组**，
                  因为绽放需要"一次击打"这种离散事件；
                  旋律音符有持续时长，用绽放会与主时间轴不一致。

   依赖：core/canvas-kit.js
   ============================================================ */

/* ---- 时间换算 ---- */

/* tick → 秒 */
function secOfTick(tk) { return tk / PPQ * (60 / TEMPO); }

/* 秒 → tick */
function tickOfSec(s) { return s * TEMPO / 60 * PPQ; }

/* 当前播放位置的绝对 tick */
function nowTick() { return CUR / 60 * TEMPO * PPQ; }

/* 取音频特征帧索引（带边界钳制） */
function featAt(sec) {
  return Math.max(0, Math.min(FEAT.frames - 1, Math.floor(sec * FEAT.fps)));
}

/* ---- 瞬时强调（主时间轴用） ----
   调用方传入**音符的绝对 tick**（clip.start + n.t）。

   历史教训：早期版本误传"Pattern 内的相对 tick"，
   与全局绝对 tick 比较导致单位不一致——前 10 秒因数值恰好
   接近而看似可用，之后完全失效。务必传绝对值。
*/
const ATTACK = PPQ * 0.05;      /* 起音时长（约 30ms @95BPM） */
const RELEASE = PPQ * 0.55;     /* 衰减时长（约 350ms） */
const HOLD = 0.42;              /* 持续音按住期间的强调下限 */

function emphasis(absTick, len, nt) {
  const dt = nt - absTick;
  if (dt < 0) return 0;
  const sustained = len > 0 && dt < len;
  const floor = sustained ? HOLD : 0;
  if (dt < ATTACK) return floor + (1 - floor) * (dt / ATTACK);
  return Math.max(floor, 1 - (dt - ATTACK) / RELEASE);
}

/* ---- 生命周期（步进器绽放用） ----
   三阶段：
     land  0.00–0.14 拍  落笔：核心迅速出现
     bloom 0.14–0.60 拍  扩散：半径快速增长
     fade  0.60–END      消散：半径继续缓增，浓度衰减

   消散时长以「拍」为单位，实际秒数 = 拍数 × 60/BPM，
   故 BPM 越快消散越快。

   返回 null 表示该音符不应绘制（未轮到 或 已消散）。
*/
const LAND = 0.14;
const BLOOM_END = 0.60;

function lifecycle(absTick, nt, decayBeats) {
  const age = (nt - absTick) / PPQ;
  if (age < 0 || age > decayBeats) return null;
  const land = smooth(age / LAND);
  const spread = 1 - Math.exp(-age / 0.42);
  let fade = 1;
  if (age > BLOOM_END) {
    const t = (age - BLOOM_END) / Math.max(0.001, decayBeats - BLOOM_END);
    fade = Math.pow(1 - Math.min(1, t), 1.35);
  }
  return {
    age: age,
    land: land,
    spread: spread,
    fade: fade,
    alpha: land * fade,
    grow: 0.30 + 0.70 * spread,
    impact: age < 0.30 ? Math.pow(1 - age / 0.30, 0.7) : 0
  };
}

/* 消散拍数 → 实际秒数（界面显示用，体现 BPM 挂钩） */
function decaySeconds(beats) { return beats * 60 / TEMPO; }
