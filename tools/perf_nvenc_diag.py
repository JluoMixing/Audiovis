"""诊断 NVENC 失败的具体原因。

Broken pipe 说明 ffmpeg 进程启动后立即退出。
需要看 ffmpeg 的完整错误输出。
"""
import pathlib
import subprocess
import tempfile

import imageio_ffmpeg
import numpy as np

exe = imageio_ffmpeg.get_ffmpeg_exe()
print("ffmpeg: %s" % exe)
print()

# 1) ffmpeg 是否编译了 nvenc（之前测过，再确认）
r = subprocess.run([exe, "-hide_banner", "-encoders"], capture_output=True)
enc = r.stdout.decode("utf-8", "replace")
print("=== nvenc 编码器是否编译入 ===")
for 行 in enc.splitlines():
    if "nvenc" in 行.lower():
        print("  " + 行.strip()[:90])

# 2) ffmpeg 是否支持 cuda 硬件设备
print()
print("=== 硬件加速 API ===")
r = subprocess.run([exe, "-hide_banner", "-hwaccels"], capture_output=True)
for 行 in r.stdout.decode("utf-8", "replace").splitlines():
    if 行.strip() and "Hardware" not in 行:
        print("  " + 行.strip())

# 3) 直接跑一次，捕获完整错误
print()
print("=" * 74)
print("完整错误输出")
print("=" * 74)
print()

宽, 高 = 640, 480
帧 = np.zeros((高, 宽, 3), dtype=np.uint8)

for 编码器, 参数 in [
    ("h264_nvenc", ["-preset", "p4", "-cq", "20"]),
    ("h264_nvenc", []),
    ("hevc_nvenc", []),
]:
    输出 = pathlib.Path(tempfile.gettempdir()) / "diag_nv.mp4"
    if 输出.exists():
        输出.unlink()

    命令 = [exe, "-y",
            "-f", "rawvideo", "-pix_fmt", "bgr24",
            "-s", "%dx%d" % (宽, 高), "-r", "30", "-i", "-",
            "-c:v", 编码器] + 参数 + ["-pix_fmt", "yuv420p", str(输出)]

    print("--- %s %s ---" % (编码器, " ".join(参数)))
    进程 = subprocess.Popen(命令, stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        # 只喂一帧，快速失败
        进程.stdin.write(帧.tobytes())
        进程.stdin.close()
    except BrokenPipeError:
        pass
    out, err = 进程.communicate(timeout=60)
    错误文本 = err.decode("utf-8", "replace").strip()
    if 错误文本:
        for 行 in 错误文本.splitlines()[-12:]:
            print("    " + 行.strip()[:110])
    else:
        print("    (无 stderr 输出)")
    print("    退出码: %d，输出存在: %s" % (进程.returncode, 输出.exists()))
    print()
    if 输出.exists():
        输出.unlink()

# 4) 检查 GPU 是否被其他进程占用
print("=" * 74)
print("GPU 占用情况")
print("=" * 74)
print()
smi = pathlib.Path(r"C:\Windows\System32\nvidia-smi.exe")
if smi.is_file():
    r = subprocess.run([str(smi), "--query-compute-apps=pid,process_name,used_memory",
                        "--format=csv"], capture_output=True, timeout=30)
    print("计算进程:")
    for 行 in r.stdout.decode("utf-8", "replace").splitlines():
        print("  " + 行.strip())

    r = subprocess.run([str(smi), "--query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu,temperature.gpu",
                        "--format=csv"], capture_output=True, timeout=30)
    print()
    print("GPU 状态:")
    for 行 in r.stdout.decode("utf-8", "replace").splitlines():
        print("  " + 行.strip())

print()
print("=" * 74)
print("分析")
print("=" * 74)
print()
print("已知事实：")
print("  · GTX 1650 存在，驱动 471.96（>= 470，满足 NVENC 要求）")
print("  · ffmpeg 编译了 h264_nvenc / hevc_nvenc")
print("  · 但调用失败")
print()
print("可能原因（需看上面的完整错误）：")
print("  1. ffmpeg 的 nvenc 需要 nvEncodeAPI64.dll（随驱动安装）")
print("  2. 笔记本双显卡：ffmpeg 可能默认选了错误的 GPU 设备")
print("  3. 驱动版本与 ffmpeg 的 NVENC SDK 版本不匹配")
print("     （ffmpeg 7.1 需要 NVENC SDK 12+，对应驱动 >= 520）")
print("  4. GPU 被其他进程独占")
