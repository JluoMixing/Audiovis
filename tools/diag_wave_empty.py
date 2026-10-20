"""查 waveform 为什么在 nuclear / chrome_freak 下没波形。

## 线索

`waveform.js` 用 `sFill(g, sx, mid-a, sw, a*2, DATA.data3, ...)`。

`nuclear` 与 `chrome_freak` 的 SURFACE.fill：
  · nuclear.fill 画「半透明底 + 断续边框」，**不填实心**
  · chrome_freak.fill 画「斜切厚板」，但厚度小时 `if (w<2||h<2) return`

waveform 的条很窄（sw 可能 1-2px），
若 h 也小（a*2 在静音处接近 0），就被 `return` 跳过了。
"""
import pathlib
import re

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")

print("=== waveform 的 sFill 调用参数 ===")
s = (根 / "src" / "components" / "waveform.js").read_text(encoding="utf-8")
for i, l in enumerate(s.split("\n"), 1):
    if "sFill" in l:
        print("  L%-4d %s" % (i, l.strip()[:96]))
print()

print("=== 两个 SURFACE.fill 的尺寸下限 ===")
sf = (根 / "src" / "core" / "surfaces.js").read_text(encoding="utf-8")
for 名 in ("nuclear", "chrome_freak"):
    i = sf.find("SURFACE." + 名)
    段 = sf[i:i + 900]
    m = re.search(r"if \(w < ([\d.]+) \|\| h < ([\d.]+)\) return;", 段)
    print("  %-14s %s" % (名, m.group(0) if m else "无尺寸检查"))
print()

print("=== 对比：其它主题有没有尺寸下限 ===")
for m in re.finditer(r"SURFACE\.(\w+)\s*=\s*\{", sf):
    名 = m.group(1)
    段 = sf[m.end():m.end() + 400]
    chk = re.search(r"if \(w < [\d.]+ \|\| h < [\d.]+\) return;", 段)
    print("  %-14s %s" % (名, chk.group(0) if chk else "—"))
