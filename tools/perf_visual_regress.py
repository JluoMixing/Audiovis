"""视觉回归：对比两种传输方式产出的帧是否**像素级一致**。

优化必须不改变画面。若 v1 与 v2 的帧有差异，说明优化引入了问题。
"""
import hashlib
import pathlib
import sys

import numpy as np
from PIL import Image

v1 = pathlib.Path(sys.argv[1] if len(sys.argv) > 1
                  else pathlib.Path.home() / "AppData/Local/Temp/v1frames")
v2 = pathlib.Path(sys.argv[2] if len(sys.argv) > 2
                  else pathlib.Path.home() / "AppData/Local/Temp/v2frames")

print("=" * 74)
print("视觉回归：CDP+base64 (v1) vs HTTP 二进制 (v2)")
print("=" * 74)
print()

f1 = sorted(v1.glob("*.png"))
f2 = sorted(v2.glob("*.png"))
print("v1 帧数: %d" % len(f1))
print("v2 帧数: %d" % len(f2))

n = min(len(f1), len(f2))
if n == 0:
    sys.exit("没有可比对的帧")

print("比对前 %d 帧" % n)
print()

一致 = 0
不同 = []
最大差异 = 0.0

for i in range(n):
    a = np.asarray(Image.open(f1[i]).convert("RGB"), dtype=np.int16)
    b = np.asarray(Image.open(f2[i]).convert("RGB"), dtype=np.int16)
    if a.shape != b.shape:
        不同.append((i, "尺寸不同 %s vs %s" % (a.shape, b.shape)))
        continue
    diff = np.abs(a - b)
    m = float(diff.max())
    if m == 0:
        一致 += 1
    else:
        最大差异 = max(最大差异, m)
        不同.append((i, "最大像素差 %.0f，平均 %.3f，不同像素 %.3f%%" % (
            m, float(diff.mean()),
            float((diff.max(axis=2) > 0).mean() * 100))))

print("%-10s %s" % ("结果", "数值"))
print("-" * 50)
print("%-10s %d / %d" % ("完全一致", 一致, n))
print("%-10s %d" % ("有差异", len(不同)))
if 不同:
    print("%-10s %.1f" % ("最大像素差", 最大差异))
print()

if 不同:
    print("差异明细（前 8 条）:")
    for i, 说明 in 不同[:8]:
        print("  帧 %d: %s" % (i, 说明))
    print()
    print("判定: ✗ 存在差异，需检查优化是否改变了画面")
else:
    print("判定: ✓ 像素级完全一致 —— 优化未改变任何画面内容")

# 文件哈希对比（作为补充证据）
print()
print("文件哈希抽样（前 3 帧）:")
for i in range(min(3, n)):
    h1 = hashlib.sha256(f1[i].read_bytes()).hexdigest()[:16]
    h2 = hashlib.sha256(f2[i].read_bytes()).hexdigest()[:16]
    print("  %s  v1=%s  v2=%s  %s" % (
        f1[i].name, h1, h2, "同" if h1 == h2 else "异"))

# 大小对比（编码参数应一致）
print()
print("文件大小对比:")
s1 = sum(f.stat().st_size for f in f1[:n]) / n / 1024
s2 = sum(f.stat().st_size for f in f2[:n]) / n / 1024
print("  v1 平均 %.1f KB/帧" % s1)
print("  v2 平均 %.1f KB/帧" % s2)
print("  差异 %.2f%%" % (abs(s1 - s2) / s1 * 100))
