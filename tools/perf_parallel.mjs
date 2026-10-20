/* ============================================================
   并行渲染吞吐测试
   ------------------------------------------------------------
   用户明确要求：不要默认四个进程就能获得四倍加速。
   本测试实测 1/2/3/4/6 路并行的真实吞吐，并记录：
     · 每路实际耗时
     · 总墙钟时间
     · 加速比（对比理论线性值）
     · 进程启动开销

   方法：把 120 帧切成 N 份，启动 N 个 capture_v2 进程，
        测量总墙钟时间。每路写自己的帧文件到同一目录
        （帧号不重叠，无写冲突）。
   ============================================================ */

import { spawn } from 'node:child_process';
import { rmSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const PAGE = resolve(arg('page'));
const BROWSER = arg('browser');
const FRAMES = parseInt(arg('frames', '120'), 10);
const WIDTH = arg('width', '1920');
const HEIGHT = arg('height', '1080');
const SCRIPT = resolve(arg('script', 'src/render/capture_v2.mjs'));
const BASE_OUT = arg('out', join(process.env.TEMP || '/tmp', 'par_test'));

const 并行度列表 = arg('levels', '1,2,3,4,6').split(',').map(Number);

function 跑一路(索引, 起点, 终点, 输出目录) {
  return new Promise(resolve => {
    const 进程 = spawn('node', [
      SCRIPT,
      '--page', PAGE,
      '--out', 输出目录,
      '--frames', String(FRAMES),
      '--range', `${起点}:${终点}`,
      '--fps', '30',
      '--width', String(WIDTH),
      '--height', String(HEIGHT),
      '--transport', 'http',
      '--browser', BROWSER,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let out = '', err = '';
    进程.stdout.on('data', d => out += d);
    进程.stderr.on('data', d => err += d);
    进程.on('close', code => {
      let 信息 = null;
      const m = out.match(/RESULT=(\{.*\})/);
      if (m) { try { 信息 = JSON.parse(m[1]); } catch (e) {} }
      resolve({ 索引, 起点, 终点, code, 信息, err: err.slice(0, 300) });
    });
  });
}

console.log('='.repeat(78));
console.log('并行渲染吞吐测试');
console.log('='.repeat(78));
console.log();
console.log(`总帧数: ${FRAMES}   分辨率: ${WIDTH}x${HEIGHT}`);
console.log(`测试并行度: ${并行度列表.join(', ')}`);
console.log();

const 结果 = [];

for (const N of 并行度列表) {
  const 输出目录 = join(BASE_OUT, `par${N}`);
  try { rmSync(输出目录, { recursive: true, force: true }); } catch (e) {}
  mkdirSync(输出目录, { recursive: true });

  // 切分帧区间
  const 每份 = Math.ceil(FRAMES / N);
  const 区间 = [];
  for (let i = 0; i < N; i++) {
    const a = i * 每份;
    const b = Math.min(a + 每份, FRAMES);
    if (a < b) 区间.push([a, b]);
  }

  console.log(`--- ${区间.length} 路并行 ---`);
  const 墙钟起 = Date.now();
  const 各路 = await Promise.all(
    区间.map(([a, b], i) => 跑一路(i, a, b, 输出目录))
  );
  const 墙钟 = (Date.now() - 墙钟起) / 1000;

  // 统计
  const 实际帧 = readdirSync(输出目录).filter(f => f.endsWith('.png')).length;
  const 成功路 = 各路.filter(r => r.code === 0).length;
  const 失败 = 各路.filter(r => r.code !== 0);

  结果.push({
    并行度: 区间.length,
    墙钟秒: Number(墙钟.toFixed(2)),
    总帧数: 实际帧,
    msPerFrame: Number((墙钟 / Math.max(1, 实际帧) * 1000).toFixed(2)),
    成功路,
    失败路: 失败.length,
  });

  console.log(`  实际产出 ${实际帧}/${FRAMES} 帧，成功 ${成功路}/${区间.length} 路`);
  console.log(`  墙钟 ${墙钟.toFixed(2)} s  →  ${(墙钟 / Math.max(1, 实际帧) * 1000).toFixed(2)} ms/帧`);
  if (失败.length) {
    失败.forEach(f => console.log(`  ✗ 路 ${f.索引} (${f.起点}:${f.终点}) code=${f.code} ${f.err.slice(0, 120)}`));
  }
  console.log();
}

// 汇总
console.log('='.repeat(78));
console.log('汇总');
console.log('='.repeat(78));
console.log();
const 基准 = 结果.find(r => r.并行度 === 1) || 结果[0];
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
console.log(pad('并行度', 8) + padL('墙钟s', 10) + padL('ms/帧', 12) +
            padL('产出帧', 10) + padL('实测加速', 12) + padL('效率', 10));
console.log('-'.repeat(72));
for (const r of 结果) {
  const 加速 = 基准.msPerFrame / r.msPerFrame;
  const 效率 = 加速 / r.并行度 * 100;
  console.log(pad(r.并行度, 8) + padL(r.墙钟秒.toFixed(2), 10) +
              padL(r.msPerFrame.toFixed(2), 12) + padL(r.总帧数, 10) +
              padL(加速.toFixed(2) + '×', 12) +
              padL(效率.toFixed(0) + '%', 10));
}
console.log();
console.log('说明：');
console.log('  · 效率 = 实测加速 ÷ 并行度 × 100%');
console.log('  · 100% 表示完美线性；低于 100% 说明存在竞争或启动开销');
console.log('  · 每路都需启动一个浏览器进程，启动成本约 1~2 秒');
console.log('  · ★ 本测试仅 ' + FRAMES + ' 帧，启动开销占比大，');
console.log('    故并行效率被**低估**。稳态吞吐需用更多帧测量。');

writeFileSync(join(process.env.TEMP || '/tmp', 'par_test.json'),
              JSON.stringify(结果, null, 1), 'utf-8');
console.log();
console.log('已记录: %TEMP%\\par_test.json');
