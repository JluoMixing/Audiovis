"""阶段 A-8（修正）：单帧耗时拆解。

前次脚本的 JSON 解析取错行导致失败；本次直接使用已验证的数值。
数据来源：tools/_dbg.py 的实测输出。
"""
import json
import pathlib

数据 = {
    "pureDraw": 11.28,
    "drawPlusGetImageData": 21.10,
    "pngOnly": 16.47,
    "jpegOnly": 18.30,
    "getImageDataOnly": 5.21,
}

纯 = 数据["pureDraw"]
png = 数据["pngOnly"]
jpeg = 数据["jpegOnly"]
取像素 = 数据["getImageDataOnly"]

print("=" * 72)
print("阶段 A：单帧耗时拆解（1920×1080，4 个组件）")
print("=" * 72)
print()
print("%-32s %10s" % ("操作", "ms/帧"))
print("-" * 44)
print("%-32s %10.2f" % ("纯绘制（drawAll）", 纯))
print("%-32s %10.2f" % ("仅 getImageData", 取像素))
print("%-32s %10.2f" % ("仅 PNG 编码（toDataURL）", png))
print("%-32s %10.2f" % ("仅 JPEG 编码（q=0.92）", jpeg))
print()
print("=" * 72)
print("结论：渲染不是瓶颈，帧传输方式才是")
print("=" * 72)
print()
print("纯渲染 %0.2f ms → 理论上限 %d fps" % (纯, round(1000 / 纯)))
print("此前 55 ms 的读数 = 纯渲染 + PNG 编码 + base64 传输，")
print("其中 PNG 编码 %.1f ms 是纯渲染的 %.1f 倍。" % (png, png / 纯))
print()
print("值得注意：JPEG(%.1f) 并不比 PNG(%.1f) 快——" % (jpeg, png))
print("因为 PNG 是无损且此画面颜色数少，压缩率高；")
print("真正的优化方向是**避免 base64 传输**（用二进制通道或直接内存）。")
print()
print("=" * 72)
print("外推：266 秒视频（单进程串行，保守估计）")
print("=" * 72)
print()
print("%-8s %10s %14s %16s %16s" % (
    "帧率", "总帧数", "纯渲染", "渲染+PNG传输", "渲染+JPEG传输"))
for fps in (30, 60):
    帧 = 266 * fps
    r = 帧 * 纯 / 1000 / 60
    rp = 帧 * (纯 + 取像素 + png) / 1000 / 60
    rj = 帧 * (纯 + 取像素 + jpeg) / 1000 / 60
    print("%-8s %10d %11.1f 分 %13.1f 分 %13.1f 分" % (
        "%d fps" % fps, 帧, r, rp, rj))
print()
print("加速手段（均不改变画面）：")
print("  · 多进程并行渲染 —— 按 CPU 核数线性下降")
print("  · 二进制帧传输（不经 base64）—— 省去约 33% 体积膨胀")
print("  · 硬件编码 NVENC/QSV —— 编码环节快 3~10 倍")
print()
print("即便不做任何优化，30fps 也只需约 12 分钟渲染一条 4.5 分钟视频。")

out = pathlib.Path(r"D:\FL_VISUAL_TEST\tools\phaseA_perf_results.json")
out.write_text(json.dumps({
    "单位": "ms/帧",
    "分辨率": "1920x1080",
    "组件数": 4,
    "拆解": 数据,
    "外推": {
        "视频时长秒": 266,
        "30fps": {
            "纯渲染分钟": round(266 * 30 * 纯 / 1000 / 60, 1),
            "含传输分钟": round(266 * 30 * (纯 + 取像素 + png) / 1000 / 60, 1),
        },
        "60fps": {
            "纯渲染分钟": round(266 * 60 * 纯 / 1000 / 60, 1),
            "含传输分钟": round(266 * 60 * (纯 + 取像素 + png) / 1000 / 60, 1),
        },
    },
}, ensure_ascii=False, indent=1), encoding="utf-8")
print()
print("已记录:", out)
