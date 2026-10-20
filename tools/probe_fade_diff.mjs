// 探针：注入「导出侧忽略柔化」后，特性专项的实测差是多少
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const 目标 = 'D:\\FL_VISUAL_TEST\\preview\\gui_prototype.html';
const 原文 = readFileSync(目标, 'utf8');

function 替换(s, 旧, 新) {
  const 归一 = t => t.replace(/\r\n/g, '\n');
  const 反 = t => t.replace(/\n/g, '\r\n');
  const n = 归一(s);
  return n.includes(旧) ? 反(n.replace(旧, 新)) : null;
}

const 注入 = 替换(原文,
  "      设柔化(柔);\n      panelBackground(g, 原W, 原H);",
  "      设柔化(null);\n      panelBackground(g, 原W, 原H);");

if (!注入) { console.log('注入失败'); process.exit(1); }

function 跑() {
  const r = spawnSync('node', ['tools/test_parity.mjs'],
    { cwd: 'D:\\FL_VISUAL_TEST', encoding: 'utf8' });
  return (r.stdout || '') + (r.stderr || '');
}

try {
  console.log('=== 基线（未注入）===');
  let out = 跑();
  out.split('\n').filter(l => /统一柔化|逐组件不同柔化|隐藏组件内文字|显示组件内文字/
    .test(l)).forEach(l => console.log('  ' + l.trim()));

  console.log();
  console.log('=== 注入「导出侧忽略柔化」后 ===');
  writeFileSync(目标, 注入, 'utf8');
  out = 跑();
  out.split('\n').filter(l => /统一柔化|逐组件不同柔化|隐藏组件内文字|显示组件内文字/
    .test(l)).forEach(l => console.log('  ' + l.trim()));

  const m = out.match(/通过 (\d+) \/ (\d+)/);
  console.log();
  console.log('  总计: ' + (m ? m[1] + ' / ' + m[2] : '?'));
} finally {
  writeFileSync(目标, 原文, 'utf8');
  console.log('已还原');
}
