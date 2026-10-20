// 验证 test_parity 确实能抓住「两条路径不一致」的回归
//
// 两个注意点（实测踩到）：
//   1. 构建产物用 CRLF，匹配串必须归一化换行符
//   2. 一致性测试检验的是「两条路径是否一致」，不是功能是否正确。
//      故缺陷必须注入在**其中一侧**；注入到共用函数会让两边同时变，
//      一致性依然成立（功能正确性由 test_clip_hide 等覆盖）。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const 目标 = 'D:\\FL_VISUAL_TEST\\preview\\gui_prototype.html';
const 原文 = readFileSync(目标, 'utf8');

/* 归一化换行后再匹配，命中后按原文的换行风格写回 */
function 替换(s, 旧, 新) {
  const 归一 = t => t.replace(/\r\n/g, '\n');
  const 反归一 = t => t.replace(/\n/g, '\r\n');
  const 归一后 = 归一(s);
  if (!归一后.includes(旧)) return null;
  return 反归一(归一后.replace(旧, 新));
}

const 缺陷表 = [
  {
    名: '导出侧底色画法不同（真踩过）',
    旧: "  if (opt.背景 !== false && W && H) {\n" +
        "    g.fillStyle = P.bg;\n" +
        "    g.fillRect(0, 0, W, H);\n" +
        "  }",
    新: "  if (opt.背景 !== false && W && H) {\n" +
        "    panelBackground(g, W, H);\n" +
        "  }",
  },
  {
    名: '导出侧漏掉一个组件',
    旧: "  (layout || []).forEach(function (item) {\n" +
        "    if (item.hidden) return;",
    新: "  (layout || []).forEach(function (item) {\n" +
        "    if (item.hidden) return;\n" +
        "    if (item.id === 'spectrum') return;",
  },
  {
    名: '导出侧未传样式（文字退化）',
    旧: "      if (comp.绘制) comp.绘制(g, p.w, p.h, 样式);",
    新: "      if (comp.绘制) comp.绘制(g, p.w, p.h, comp.默认);",
  },
  {
    名: '导出侧忽略逐组件柔化',
    旧: "      设柔化(柔);\n      panelBackground(g, 原W, 原H);",
    新: "      设柔化(null);\n      panelBackground(g, 原W, 原H);",
  },
  {
    名: '导出侧忽略文字底板开关',
    旧: "      if (样式.背景) {",
    新: "      if (false) {",
  },
  {
    名: '导出侧忽略隐藏文字开关',
    旧: "      设组件文字(!p.隐藏文字);",
    新: "      设组件文字(true);",
  },
];

function 跑测试() {
  const r = spawnSync('node', ['tools/test_parity.mjs'],
    { cwd: 'D:\\FL_VISUAL_TEST', encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/通过 (\d+) \/ (\d+)/);
  return m ? { 通过: Number(m[1]), 总: Number(m[2]) } : { 通过: 0, 总: 0 };
}

console.log('='.repeat(74));
console.log('验证 test_parity 能抓住「两条路径不一致」的回归');
console.log('='.repeat(74));
console.log();

try {
  const 基线 = 跑测试();
  console.log('  基线（未破坏）: ' + 基线.通过 + ' / ' + 基线.总);
  if (基线.通过 !== 基线.总) {
    console.log('  ✗ 基线不干净，无法用于验证');
    process.exit(1);
  }
  console.log();

  let 抓住 = 0;
  for (const d of 缺陷表) {
    const 新文件 = 替换(原文, d.旧, d.新);
    if (新文件 === null) {
      console.log('  ? ' + d.名 + ' —— 注入失败（未找到目标代码）');
      continue;
    }
    writeFileSync(目标, 新文件, 'utf8');
    const r = 跑测试();
    const ok = r.通过 < r.总;
    if (ok) 抓住++;
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + d.名.padEnd(28) +
                ' → ' + r.通过 + ' / ' + r.总 +
                (ok ? '  （抓住 ' + (r.总 - r.通过) + ' 项）' : '  ← 未抓住！'));
    writeFileSync(目标, 原文, 'utf8');
  }

  console.log();
  console.log('='.repeat(74));
  console.log('抓住 ' + 抓住 + ' / ' + 缺陷表.length + ' 个故意缺陷');
  console.log(抓住 === 缺陷表.length
    ? '✓ 测试确实能发现渲染路径的不一致'
    : '✗ 测试有盲区，需补强');
} finally {
  writeFileSync(目标, 原文, 'utf8');
  console.log('已还原文件');
}
