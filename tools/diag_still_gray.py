"""查 spectrum / loudness 在 chrome_freak 下为何仍灰。

## 线索

预览里：
  · 波形 ✓ 红
  · 卷帘 ✓ 红
  · 声场 ✓ 灰（但该有红点）
  · 频谱 ✗ 灰
  · 响度 ✗ 灰
  · 明亮度 ✗ 灰
  · 瞬态 ✗ 灰

说明我改的 DCOL 在这些组件里没生效，或改了但被别的绘制盖住。
"""
import pathlib
import re

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")

for cid in ("spectrum", "loudness", "brightness", "transient",
            "vectorscope"):
    p = 根 / "src" / "components" / (cid + ".js")
    s = p.read_text(encoding="utf-8")
    print("=== %s ===" % cid)
    有DCOL = "DCOL" in s
    print("  用 DCOL:", 有DCOL)
    for i, l in enumerate(s.split("\n"), 1):
        if "DCOL" in l or ("P.ink" in l and ("fill" in l or "stroke" in l
                                             or "sMark" in l)):
            print("    L%-4d %s" % (i, l.strip()[:86]))
    print()
