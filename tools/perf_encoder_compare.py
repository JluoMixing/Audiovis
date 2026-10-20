"""编码器对比测试：软件 vs 硬件。

用户要求：编码阶段单独测试，不要与绘图加速混为一谈。

测试条件：用**真实渲染的帧**（非合成图）编码，保证可比性。
测量：耗时、文件大小、可解码性、画质（与无损基准的 PSNR）。
"""
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time

import imageio_ffmpeg
import numpy as np
from PIL import Image

exe = imageio_ffmpeg.get_ffmpeg_exe()
根 = pathlib.Path(r"D:\FL_VISUAL_TEST")

# 用真实帧：从 v2 测试的产出取
帧源 = pathlib.Path.home() / "AppData/Local/Temp/v2b"
if not 帧源.is_dir():
    帧源 = pathlib.Path.home() / "AppData/Local/Temp/v2frames"
帧列表 = sorted(帧源.glob("*.png"))[:60]
if not 帧列表:
    sys.exit("找不到测试帧，请先运行 capture_v2.mjs")

print("=" * 78)
print("编码器对比测试")
print("=" * 78)
print()
print("测试帧: %d 帧，来自 %s" % (len(帧列表), 帧源.name))
w, h = Image.open(帧列表[0]).size
print("分辨率: %dx%d" % (w, h))
print()

工作目录 = pathlib.Path(tempfile.mkdtemp(prefix="enc_cmp_"))
# 复制帧为连续命名（ffmpeg 需要）
for i, f in enumerate(帧列表):
    shutil.copy(f, 工作目录 / ("f%05d.png" % i))

# ---- 无损基准（用于 PSNR） ----
基准帧 = np.stack([np.asarray(Image.open(f).convert("RGB"), dtype=np.uint8)
                   for f in 帧列表[:10]])

方案 = [
    ("libx264 preset=medium crf18", ["-c:v", "libx264", "-preset", "medium", "-crf", "18"]),
    ("libx264 preset=fast crf18", ["-c:v", "libx264", "-preset", "fast", "-crf", "18"]),
    ("libx264 preset=veryfast crf18", ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"]),
    ("libx264 preset=ultrafast crf18", ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "18"]),
    ("h264_amf (AMD 硬件)", ["-c:v", "h264_amf", "-quality", "balanced",
                            "-rc", "cqp", "-qp_i", "20", "-qp_p", "20"]),
    ("h264_amf quality=quality", ["-c:v", "h264_amf", "-quality", "quality",
                                   "-rc", "cqp", "-qp_i", "20", "-qp_p", "20"]),
    ("hevc_amf (AMD 硬件 HEVC)", ["-c:v", "hevc_amf", "-quality", "balanced",
                                   "-rc", "cqp", "-qp_i", "22", "-qp_p", "22"]),
    ("h264_mf (Media Foundation)", ["-c:v", "h264_mf", "-rate_control", "quality",
                                     "-quality", "80"]),
]

结果 = []
for 名称, 编码参数 in 方案:
    输出 = 工作目录 / ("out_%s.mp4" % abs(hash(名称)))
    if 输出.exists():
        输出.unlink()

    命令 = [exe, "-y", "-loglevel", "error",
            "-framerate", "30", "-i", str(工作目录 / "f%05d.png")]
    命令 += 编码参数
    命令 += ["-pix_fmt", "yuv420p", str(输出)]

    try:
        起 = time.perf_counter()
        进程 = subprocess.run(命令, capture_output=True, timeout=600)
        耗时 = time.perf_counter() - 起

        if 进程.returncode != 0 or not 输出.exists() or 输出.stat().st_size < 1000:
            错误 = 进程.stderr.decode("utf-8", "replace").strip().splitlines()
            结果.append({"方案": 名称, "可用": False,
                         "错误": (错误[-1][:90] if 错误 else "无输出")})
            print("  ✗ %-30s %s" % (名称, 结果[-1]["错误"]))
            continue

        # PSNR：与无损基准比对前 10 帧
        解码目录 = 工作目录 / ("dec_%d" % abs(hash(名称)))
        解码目录.mkdir(exist_ok=True)
        subprocess.run([exe, "-y", "-loglevel", "error", "-i", str(输出),
                        "-frames:v", "10", str(解码目录 / "d%05d.png")],
                       capture_output=True, timeout=300)
        解码帧 = sorted(解码目录.glob("*.png"))
        psnr = None
        if len(解码帧) >= 10:
            差 = []
            for i, f in enumerate(解码帧[:10]):
                a = np.asarray(Image.open(f).convert("RGB"), dtype=np.float64)
                b = 基准帧[i].astype(np.float64)
                mse = float(((a - b) ** 2).mean())
                差.append(mse)
            mse = sum(差) / len(差)
            psnr = 10 * np.log10(255 ** 2 / mse) if mse > 0 else 99.0

        结果.append({
            "方案": 名称, "可用": True,
            "每帧ms": round(耗时 / len(帧列表) * 1000, 2),
            "总秒": round(耗时, 2),
            "文件KB": round(输出.stat().st_size / 1024, 1),
            "PSNR": round(psnr, 2) if psnr else None,
        })
        print("  ✓ %-30s %6.2f ms/帧  %7.1f KB  PSNR %s" % (
            名称, 耗时 / len(帧列表) * 1000, 输出.stat().st_size / 1024,
            ("%.2f" % psnr) if psnr else "—"))

        shutil.rmtree(解码目录, ignore_errors=True)
        if 输出.exists():
            输出.unlink()

    except Exception as e:
        结果.append({"方案": 名称, "可用": False,
                     "错误": "%s: %s" % (type(e).__name__, str(e)[:70])})
        print("  ✗ %-30s %s" % (名称, str(e)[:70]))

shutil.rmtree(工作目录, ignore_errors=True)

# ---- 汇总 ----
print()
print("=" * 78)
print("汇总")
print("=" * 78)
print()
可用 = [r for r in 结果 if r.get("可用")]
可用.sort(key=lambda x: x["每帧ms"])
print("%-32s %10s %10s %10s" % ("方案", "ms/帧", "文件KB", "PSNR"))
print("-" * 68)
for r in 可用:
    print("%-32s %10.2f %10.1f %10s" % (
        r["方案"], r["每帧ms"], r["文件KB"],
        ("%.2f" % r["PSNR"]) if r["PSNR"] else "—"))

软件 = [r for r in 可用 if "libx264" in r["方案"]]
硬件 = [r for r in 可用 if "libx264" not in r["方案"]]

print()
if 软件:
    最快软件 = min(软件, key=lambda x: x["每帧ms"])
    基准 = [r for r in 软件 if "medium" in r["方案"]]
    if 基准:
        b = 基准[0]
        print("以 libx264 medium（当前默认）为基准 %.2f ms/帧：" % b["每帧ms"])
        print()
        for r in 可用:
            print("  %-32s %6.2f×  %+7.2f ms" % (
                r["方案"], b["每帧ms"] / r["每帧ms"],
                r["每帧ms"] - b["每帧ms"]))

print()
print("=" * 78)
print("结论")
print("=" * 78)
print()
if 硬件:
    最快硬件 = min(硬件, key=lambda x: x["每帧ms"])
    b = [r for r in 软件 if "medium" in r["方案"]]
    if b:
        加速 = b[0]["每帧ms"] / 最快硬件["每帧ms"]
        print("最快硬件编码: %s（%.2f ms/帧）" % (最快硬件["方案"], 最快硬件["每帧ms"]))
        print("相对 libx264 medium 加速: %.2f×" % 加速)
        print()
        if 加速 < 1.3:
            print("★ 硬件编码在本机**收益有限**（%.2f×）—— 与原预测的 4~8× 相差甚远。" % 加速)
            print("  原因：AMD 集成显卡的硬件编码器性能有限，且需经内存回读。")
        print()
        print("★ 更有效的做法：调整 libx264 的 preset")
        for r in 软件:
            if "ultrafast" in r["方案"]:
                print("  ultrafast: %.2f ms/帧（比 medium 快 %.2f×）" % (
                    r["每帧ms"], b[0]["每帧ms"] / r["每帧ms"]))
                print("  代价：同码率下画质略降、文件略大")
            if "veryfast" in r["方案"]:
                print("  veryfast:  %.2f ms/帧（比 medium 快 %.2f×）" % (
                    r["每帧ms"], b[0]["每帧ms"] / r["每帧ms"]))

out = 根 / "tools" / "perf_encoder_compare.json"
out.write_text(json.dumps(结果, ensure_ascii=False, indent=1), encoding="utf-8")
print()
print("已记录:", out)
