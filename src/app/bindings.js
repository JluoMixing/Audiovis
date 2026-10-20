/* ============================================================
   数据绑定
   ------------------------------------------------------------
   把注入的原始 JSON 转成组件直接可用的常量。
   所有组件通过这里的常量访问数据，不直接读 DATA 深层结构。

   依赖：core/canvas-kit.js
   ============================================================ */

const SPEC = DATA.spectrogram;
const SPEC_BYTES = decodeB64(SPEC.data);

const VS = DATA.vectorscope;
const VS_L = decodeI16(VS.left);
const VS_R = decodeI16(VS.right);

const WAVE = DATA.waveform;
const TL = DATA.timeline;
const SHAPES = DATA.patternShapes;
const FEAT = DATA.features;
const DRUMS = DATA.drumGroups;
const DRUM_USE = DATA.drumUsage;

const DUR = DATA.audio.duration;
const PPQ = TL.ppq;
const TEMPO = TL.tempo;
const MAXTICK = TL.maxTick;

const PITCH_LO = DATA.pitchRange[0];
const PITCH_HI = DATA.pitchRange[1];
const PITCH_SPAN = Math.max(1, PITCH_HI - PITCH_LO);
const HIST = DATA.pitchHistogram;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/* ---- 可调参数（由预览台滑块控制） ---- */
let CUR = DATA.previewTime;   /* 当前播放位置（秒） */
let WIN_BARS = 2;             /* 音频类组件的滚动窗（小节） */
let MAIN_WIN_BARS = 26;       /* 主时间轴时间跨度（小节）——控制速度感 */
let DECAY_BEATS = 3.0;        /* 步进器绽放消散时长（拍）
                                 以「拍」为单位 → 秒数 = 拍数×60/BPM，
                                 故 BPM 越快消散越快 */
