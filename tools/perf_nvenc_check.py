"""核实 GTX 1650 的 NVENC 是否真正可用。

背景：之前只测到 AMD Radeon（核显），漏了 NVIDIA GTX 1650。
原因：笔记本双显卡，显示器接在核显上，独显处于待机但驱动正常。

关键问题：ffmpeg 能否使用 GTX 1650 的 NVENC？
需要实测，不能假设。
"""
import json
import pathlib
import subprocess
import sys
import tempfile
import time

import imageio_ffmpeg
import numpy as np

exe = imageio_ffmpeg.get_ffmpeg_exe()

print("=" * 76)
print("NVIDIA GTX 1650 · NVENC 可用性核实")
print("=" * 76)
print()

# 1) nvidia-smi 是否可用
print("【1】nvidia-smi（NVIDIA 驱动工具）")
smi = pathlib.Path(r"C:\Windows\System32\nvidia-smi.exe")
if smi.is_file():
    进程 = subprocess.run([str(smi)], capture_output=True, timeout=30)
    输出 = 进程.stdout.decode("utf-8", "replace")
    for 行 in 输出.splitlines()[:12]:
        if 行.strip():
            print("  " + 行.strip()[:100])
else:
    候选 = list(pathlib.Path(r"C:\Program Files\NVIDIA Corporation").rglob("nvidia-smi.exe")) \
        if pathlib.Path(r"C:\Program Files\NVIDIA Corporation").is_dir() else []
    print("  未找到 nvidia-smi.exe")
    if 候选:
        print("  但发现: %s" % 候选[0])
        smi = 候选[0]

print()

# 2) 查驱动版本是否满足 NVENC 要求
print("【2】驱动信息")
try:
    r = subprocess.run(["wmic", "path", "win32_VideoController",
                        "where", "name like '%NVIDIA%'",
                        "get", "Name,DriverVersion,DriverDate"],
                       capture_output=True, timeout=20)
    文本 = r.stdout.decode("utf-8", "replace")
    for 行 in 文本.splitlines():
        if 行.strip() and "Name" not in 行:
            print("  " + 行.strip()[:100])
except Exception as e:
    print("  查询失败: %s" % e)

print()
print("  说明：NVENC 要求驱动 >= 470（Windows）。")
print("        GTX 1650（TU117 核心）支持 NVENC，但**仅 H.264/HEVC**，")
print("        且第 7 代 NVENC 编码器在 GTX 1650 上被削减为**单个编码单元**。")

print()
print("=" * 76)
print("【3】实测：ffmpeg 调用 h264_nvenc")
print("=" * 76)
print()

宽, 高, 帧数 = 1920, 1080, 60
测试帧 = []
for i in range(帧数):
    帧 = np.zeros((高, 宽, 3), dtype=np.uint8)
    帧[:, :, 0] = np.linspace(0, 255, 高, dtype=np.uint8)[:, None]
    帧[:, :, 1] = (i * 4) % 256
    帧[300:700, (i * 30) % (宽 - 400):(i * 30) % (宽 - 400) + 400] = 220
    测试帧.append(帧)

结果 = {}
for 编码器, 参数 in [
    ("libx264", ["-preset", "medium", "-crf", "18"]),
    ("h264_nvenc", ["-preset", "p4", "-cq", "20"]),
    ("h264_nvenc", ["-preset", "p1", "-cq", "20"]),   # 最快预设
    ("hevc_nvenc", ["-preset", "p4", "-cq", "22"]),
]:
    键 = 编码器 + ("_" + 参数[1] if 参数 else "")
    输出 = pathlib.Path(tempfile.gettempdir()) / ("nvenc_%s.mp4" % abs(hash(键)))
    if 输出.exists():
        输出.unlink()

    命令 = [exe, "-y", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", "bgr24",
            "-s", "%dx%d" % (宽, 高), "-r", "30", "-i", "-",
            "-c:v", 编码器] + 参数 + ["-pix_fmt", "yuv420p", str(输出)]

    try:
        起 = time.perf_counter()
        进程 = subprocess.Popen(命令, stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        for 帧 in 测试帧:
            进程.stdin.write(帧.tobytes())
        进程.stdin.close()
        _, err = 进程.communicate(timeout=300)
        耗时 = time.perf_counter() - 起

        if 输出.exists() and 输出.stat().st_size > 1000:
            每帧 = 耗时 / 帧数 * 1000
            结果[键] = {"可用": True, "每帧ms": round(每帧, 2),
                        "KB": round(输出.stat().st_size / 1024, 1)}
            print("  ✓ %-22s %7.2f ms/帧  %8.1f KB" % (键, 每帧, 输出.stat().st_size / 1024))
        else:
            错误 = err.decode("utf-8", "replace").strip().splitlines()
            信息 = 错误[-1][:90] if 错误 else "无输出"
            结果[键] = {"可用": False, "错误": 信息}
            print("  ✗ %-22s %s" % (键, 信息))
    except Exception as e:
        结果[键] = {"可用": False, "错误": str(e)[:80]}
        print("  ✗ %-22s 异常: %s" % (键, str(e)[:70]))
    finally:
        if 输出.exists():
            输出.unlink()

# 4) 与 AMD AMF 对比（用同样测试帧）
print()
print("【4】对比：AMD AMF（核显）")
for 编码器, 参数 in [
    ("h264_amf", ["-quality", "balanced", "-rc", "cqp", "-qp_i", "20", "-qp_p", "20"]),
    ("hevc_amf", ["-quality", "balanced", "-rc", "cqp", "-qp_i", "22", "-qp_p", "22"]),
]:
    输出 = pathlib.Path(tempfile.gettempdir()) / ("amf_%s.mp4" % abs(hash(编码器)))
    if 输出.exists():
        输出.unlink()
    命令 = [exe, "-y", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", "bgr24",
            "-s", "%dx%d" % (宽, 高), "-r", "30", "-i", "-",
            "-c:v", 编码器] + 参数 + ["-pix_fmt", "yuv420p", str(输出)]
    try:
        起 = time.perf_counter()
        进程 = subprocess.Popen(命令, stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        for 帧 in 测试帧:
            进程.stdin.write(帧.tobytes())
        进程.stdin.close()
        _, err = 进程.communicate(timeout=300)
        耗时 = time.perf_counter() - 起
        if 输出.exists() and 输出.stat().st_size > 1000:
            每帧 = 耗时 / 帧数 * 1000
            结果[编码器] = {"可用": True, "每帧ms": round(每帧, 2),
                           "KB": round(输出.stat().st_size / 1024, 1)}
            print("  ✓ %-22s %7.2f ms/帧  %8.1f KB" % (编码器, 每帧, 输出.stat().st_size / 1024))
        else:
            错误 = err.decode("utf-8", "replace").strip().splitlines()
            结果[编码器] = {"可用": False,
                           "错误": 错误[-1][:90] if 错误 else "无输出"}
            print("  ✗ %-22s %s" % (编码器, 结果[编码器]["错误"]))
    except Exception as e:
        结果[编码器] = {"可用": False, "错误": str(e)[:80]}
        print("  ✗ %-22s %s" % (编码器, str(e)[:70]))
    finally:
        if 输出.exists():
            输出.unlink()

# 5) 汇总
print()
print("=" * 76)
print("汇总")
print("=" * 76)
print()
可用 = {k: v for k, v in 结果.items() if v.get("可用")}
可用排序 = sorted(可用.items(), key=lambda x: x[1]["每帧ms"])
print("%-24s %12s %12s" % ("编码器", "ms/帧", "相对 x264"))
print("-" * 52)
基准 = 可用.get("libx264", {}).get("每帧ms")
for k, v in 可用排序:
    if 基准:
        print("%-24s %12.2f %11.2f×" % (k, v["每帧ms"], 基准 / v["每帧ms"]))
    else:
        print("%-24s %12.2f" % (k, v["每帧ms"]))

out = pathlib.Path(r"D:\FL_VISUAL_TEST\tools\perf_nvenc_check.json")
out.write_text(json.dumps({
    "nvidia_smi": str(smi) if smi.is_file() else None,
    "结果": 结果,
    "可用": list(可用.keys()),
}, ensure_ascii=False, indent=1), encoding="utf-8")
print()
print("已记录:", out)
