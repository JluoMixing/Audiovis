"""模板长宽比适配检查。

问题：组件有各自的默认长宽比，若被拉伸到差异过大的比例，
内容会失真（如瞬态的涟漪被压成扁条）。

本脚本检查每套模板中，每个组件的实际比例与默认比例的偏差。
"""
import json
import pathlib

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
模板 = json.loads((根 / "preview" / "templates.json").read_text(encoding="utf-8"))

# 组件默认尺寸（与 GUI 原型中的 COMPS 一致）
默认 = {
    "playlist":   (1180, 600),
    "stepper":    (960, 360),
    "pianoroll":  (900, 300),
    "pitchwheel": (360, 360),
    "spectrum":   (640, 200),
    "waveform":   (640, 160),
    "vectorscope":(300, 300),
    "loudness":   (420, 300),
    "brightness": (360, 220),
    "transient":  (360, 220),
    "transport":  (520, 120),
}

名称 = {t["id"]: t["name"] for t in 模板}

print("=" * 84)
print("模板长宽比适配检查")
print("=" * 84)
print()
print("判定标准（比例偏差 = 实际比例 ÷ 默认比例）：")
print("  ✓ 0.7 ~ 1.4   内容基本不变形")
print("  △ 0.5 ~ 0.7 或 1.4 ~ 2.0   轻微变形，可接受")
print("  ✗ < 0.5 或 > 2.0   明显变形，需调整")
print()

问题总数 = 0
for t in 模板:
    for 方向, 键 in (("横屏", "land"), ("竖屏", "port")):
        布局 = t[键]
        if not 布局:
            continue
        行 = []
        for b in 布局:
            if b["id"] not in 默认:
                continue
            dw, dh = 默认[b["id"]]
            默认比 = dw / dh
            实际比 = b["w"] / b["h"]
            偏差 = 实际比 / 默认比
            if 0.7 <= 偏差 <= 1.4:
                标记 = "✓"
            elif 0.5 <= 偏差 < 0.7 or 1.4 < 偏差 <= 2.0:
                标记 = "△"
            else:
                标记 = "✗"
                问题总数 += 1
            行.append((b["id"], b["w"], b["h"], 偏差, 标记))

        if not 行:
            continue
        有问题 = [x for x in 行 if x[4] != "✓"]
        print("%s · %s" % (t["name"], 方向))
        if not 有问题:
            print("   全部 ✓")
        else:
            for cid, w, h, 偏差, 标记 in 有问题:
                dw, dh = 默认[cid]
                print("   %s %-12s 实际 %dx%d (%.2f)  默认 %dx%d (%.2f)  偏差 %.2f×"
                      % (标记, cid, w, h, w / h, dw, dh, dw / dh, 偏差))
        print()

print("=" * 84)
print("汇总：%d 处明显变形（✗）" % 问题总数)
print()
if 问题总数:
    print("建议：调整这些组件的尺寸，使其比例接近默认值。")
    print("      组件的视觉语言是按默认比例设计的，拉伸过大会失真。")
else:
    print("所有组件的比例都在可接受范围内。")
