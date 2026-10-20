"""核实本机实际可用的硬件编码器。

之前的优化预测假设了 NVENC/QSV，但本机 GPU 是 AMD Radeon 集成显卡，
需实测确认到底有哪些编码器可用 —— 不能沿用假设。
"""
import json
import pathlib
import re
import subprocess
import sys
import time

import imageio_ffmpeg

exe = imageio_ffmpeg.get_ffmpeg_exe()
print("=" * 74)
print("硬件编码器可用性核实")
print("=" * 74)
print()
print("ffmpeg: %s" % exe)
进程 = subprocess.run([exe, "-version"], capture_output=True)
版本行 = 进程.stdout.decode("utf-8", "replace").splitlines()[0]
print("版本: %s" % 版本行[:100])
print()

# 1) 列出所有编码器
进程 = subprocess.run([exe, "-hide_banner", "-encoders"],
                      capture_output=True)
编码器文本 = 进程.stdout.decode("utf-8", "replace")

# 2) 检查硬件加速 API
进程2 = subprocess.run([exe, "-hide_banner", "-hwaccels"],
                       capture_output=True)
硬件API = 进程2.stdout.decode("utf-8", "replace").strip()
print("=== 可用的硬件加速 API ===")
for 行 in 硬件API.splitlines()[1:]:
    print("  %s" % 行.strip())
print()

# 3) 逐个检查候选硬件编码器
候选 = [
    ("h264_nvenc", "NVIDIA NVENC"),
    ("hevc_nvenc", "NVIDIA NVENC (HEVC)"),
    ("h264_qsv", "Intel Quick Sync"),
    ("hevc_qsv", "Intel QSV (HEVC)"),
    ("h264_amf", "AMD AMF"),
    ("hevc_amf", "AMD AMF (HEVC)"),
    ("h264_vaapi", "VAAPI (Linux)"),
    ("h264_mf", "Media Foundation"),
    ("libx264", "x264 软件编码"),
    ("libx265", "x265 软件编码"),
]

print("=== 编码器可用性 ===")
可用 = []
for 名称, 说明 in 候选:
    if 名称 in 编码器文本:
        可用.append((名称, 说明, True))
        print("  %-14s %-24s 已编译入 ffmpeg" % (名称, 说明))
    else:
        可用.append((名称, 说明, False))
        print("  %-14s %-24s 未编译" % (名称, 说明))
print()

# 4) 实际尝试编码（编译入 ≠ 本机可用）
print("=" * 74)
print("实际编码测试（编译入不等于本机可用）")
print("=" * 74)
print()

import numpy as np
宽, 高, 帧数 = 1280, 720, 30
测试帧 = []
for i in range(帧数):
    帧 = np.zeros((高, 宽, 3), dtype=np.uint8)
    帧[:, :, 0] = (i * 8) % 256
    帧[100:300, (i * 20) % (宽 - 200):(i * 20) % (宽 - 200) + 200] = 200
    测试帧.append(帧)

结果 = []
for 名称, 说明, 编译入 in 可用:
    if not 编译入:
        continue
    输出 = pathlib.Path(f"{__import__('tempfile').gettempdir()}/enc_{名称}.mp4")
    if 输出.exists():
        输出.unlink()

    命令 = [exe, "-y", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", "bgr24",
            "-s", "%dx%d" % (宽, 高), "-r", "30", "-i", "-"]
    if "nvenc" in 名称 or "qsv" in 名称 or "amf" in 名称:
        命令 += ["-c:v", 名称]
        if "nvenc" in 名称:
            命令 += ["-preset", "p4", "-cq", "20"]
        elif "qsv" in 名称:
            命令 += ["-global_quality", "20"]
        else:
            命令 += ["-quality", "balanced", "-rc", "cqp", "-qp_i", "20", "-qp_p", "20"]
    elif 名称 == "libx265":
        命令 += ["-c:v", "libx265", "-preset", "medium", "-crf", "22"]
    else:
        命令 += ["-c:v", 名称, "-preset", "medium", "-crf", "20"]
    命令 += [str(输出)]

    try:
        起 = time.perf_counter()
        进程 = subprocess.Popen(命令, stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        for 帧 in 测试帧:
            进程.stdin.write(帧.tobytes())
        进程.stdin.close()
        _, err = 进程.communicate(timeout=120)
        耗时 = time.perf_counter() - 起

        if 输出.exists() and 输出.stat().st_size > 1000:
            每帧 = 耗时 / 帧数 * 1000
            结果.append({
                "编码器": 名称, "说明": 说明, "可用": True,
                "每帧ms": round(每帧, 2), "大小KB": round(输出.stat().st_size / 1024, 1),
            })
            print("  ✓ %-14s %6.2f ms/帧  %8.1f KB" % (名称, 每帧, 输出.stat().st_size / 1024))
        else:
            错误 = err.decode("utf-8", "replace").strip().splitlines()
            信息 = 错误[-1][:80] if 错误 else "无输出"
            结果.append({"编码器": 名称, "说明": 说明, "可用": False, "错误": 信息})
            print("  ✗ %-14s 失败: %s" % (名称, 信息))
    except Exception as e:
        结果.append({"编码器": 名称, "说明": 说明, "可用": False,
                     "错误": "%s: %s" % (type(e).__name__, str(e)[:60])})
        print("  ✗ %-14s 异常: %s" % (名称, str(e)[:60]))
    finally:
        if 输出.exists():
            输出.unlink()

# 5) 结论
print()
print("=" * 74)
print("结论")
print("=" * 74)
print()
可用硬件 = [r for r in 结果 if r.get("可用") and r["编码器"] != "libx264"
            and r["编码器"] != "libx265"]
软件 = [r for r in 结果 if r.get("可用") and r["编码器"] in ("libx264", "libx265")]

if 可用硬件:
    print("本机可用的硬件编码器：")
    for r in 可用硬件:
        print("  %-14s %6.2f ms/帧  (%s)" % (r["编码器"], r["每帧ms"], r["说明"]))
    print()
    最快硬件 = min(可用硬件, key=lambda x: x["每帧ms"])
    x264 = [r for r in 软件 if r["编码器"] == "libx264"]
    if x264:
        加速 = x264[0]["每帧ms"] / 最快硬件["每帧ms"]
        print("  相对 libx264 加速: %.2f×" % 加速)
        print("  → 之前预测的「硬件编码省 13.5 ms/帧」需按此修正")
else:
    print("本机**没有可用的硬件编码器**。")
    print()
    print("原因分析：")
    print("  · GPU 为 AMD Radeon 集成显卡（非 NVIDIA，故无 NVENC）")
    print("  · 也非 Intel 核显（故无 QSV）")
    print("  · AMD 的 AMF 在 Windows 上需 ffmpeg 编译时启用，且集成显卡支持有限")
    print()
    print("  → 之前预测中的「硬件编码 NVENC/QSV 省 13.5 ms/帧」在本机**不成立**")
    print("     该预测应标注为「假设，本机不可用」")

out = pathlib.Path(r"D:\FL_VISUAL_TEST\tools\perf_encoders.json")
out.write_text(json.dumps({
    "硬件加速API": 硬件API,
    "编码器结果": 结果,
    "可用硬件编码器": [r["编码器"] for r in 可用硬件],
}, ensure_ascii=False, indent=1), encoding="utf-8")
print()
print("已记录:", out)
