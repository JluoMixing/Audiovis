// 对比两份基准，报告差异。
// 用法: node tools/compare_baseline.mjs <基准A.json> <基准B.json>
import { readFileSync } from 'node:fs';

const A = JSON.parse(readFileSync(process.argv[2], 'utf-8'));
const B = JSON.parse(readFileSync(process.argv[3], 'utf-8'));

const ids = Object.keys(A).filter(k => B[k]);
let same = 0, diff = 0, missing = 0;
const details = [];

Object.keys(A).forEach(id => {
  if (!B[id]) { missing++; details.push(`  ${id}: 基准B中缺失`); return; }
  if (A[id].w !== B[id].w || A[id].h !== B[id].h) {
    details.push(`  ${id}: 尺寸不同 ${A[id].w}x${A[id].h} vs ${B[id].w}x${B[id].h}`);
    diff++;
    return;
  }
  const sa = A[id].samples, sb = B[id].samples;
  const n = Math.min(sa.length, sb.length);
  let d = 0;
  for (let i = 0; i < n; i++) {
    if (sa[i].sum !== sb[i].sum) {
      d++;
      if (d <= 2) details.push(`  ${id} @${sa[i].sec}s: ${sa[i].sum} vs ${sb[i].sum}`);
    }
  }
  if (d === 0) same++;
  else { diff++; details.push(`  ${id}: ${d}/${n} 个采样点不同`); }
});

console.log('=== 像素回归对比 ===');
console.log(`  完全一致: ${same} 个组件`);
console.log(`  有差异:   ${diff} 个组件`);
if (missing) console.log(`  缺失:     ${missing} 个组件`);
console.log(`  对比采样点: ${Object.values(A).reduce((a,b)=>a+b.samples.length,0)}`);
if (details.length) {
  console.log('');
  console.log('差异明细:');
  details.slice(0, 30).forEach(d => console.log(d));
  if (details.length > 30) console.log(`  ... 另有 ${details.length-30} 条`);
}
console.log('');
console.log(diff === 0 && missing === 0
  ? '✓ 重构未改变任何组件的渲染结果'
  : '✗ 存在差异，需检查');
process.exit(diff === 0 && missing === 0 ? 0 : 1);
