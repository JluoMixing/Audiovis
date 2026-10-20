"""阶段 A-6：实测两条编码路径是否真正可用。

不依赖报告，直接生成一段真实视频并验证其可解码性。
"""
import json
import pathlib
import subprocess
import sys
import tempfile

import numpy as np

输出目录 = pathlib.Path(tempfile.gettempdir()) / "phaseA_encode"
输出目录.mkdir(exist_ok=True)

FPS = 30
秒数 = 3
宽, 高 = 1920, 1080
帧数 = FPS * 秒数

print("=" * 74)
print("阶段 A：编码路径实测（%dx%d, %dfps, %d 秒 = %d 帧）" % (
    宽, 高, FPS, 秒数, 帧数))
print("=" * 74)

# 生成测试帧：带时间戳的渐变 + 移动方块（便于肉眼验证）
def 造帧(i):
    t = i / 帧数
    帧 = np.zeros((高, 宽, 3), dtype=np.uint8)
    # 背景渐变
    ys = np.linspace(0, 60, 高, dtype=np.uint8)
    帧[:, :, 0] = ys[:, None]
    帧[:, :, 1] = (ys[:, None] * 0.8).astype(np.uint8)
    帧[:, :, 2] = 40
    # 移动方块
    x = int(t * (宽 - 200))
    帧[400:600, x:x + 200] = (230, 230, 230)
    # 进度条
    帧[1000:1040, :int(t * 宽)] = (200, 80, 60)
    return 帧

# ---------- 路径 1：imageio-ffmpeg ----------
print()
print("【路径 1】imageio-ffmpeg（自带 ffmpeg 7.1）")
结果1 = {"路径": "imageio-ffmpeg", "可用": False}
try:
    import imageio_ffmpeg
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    输出1 = 输出目录 / "path1_imageio.mp4"

    # 用 ffmpeg 的 rawvideo 管道输入
    命令 = [
        exe, "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "bgr24",
        "-s", "%dx%d" % (宽, 高), "-r", str(FPS),
        "-i", "-",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(输出1),
    ]
    import time
    起 = time.perf_counter()
    进程 = subprocess.Popen(命令, stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    for i in range(帧数):
        进程.stdin.write(造帧(i).tobytes())
    进程.stdin.close()
    _, err = 进程.communicate(timeout=180)
    耗时 = time.perf_counter() - 起

    if 输出1.is_file() and 输出1.stat().st_size > 0:
        结果1.update({
            "可用": True,
            "文件": str(输出1),
            "大小MB": round(输出1.stat().st_size / 1e6, 2),
            "耗时秒": round(耗时, 2),
            "每帧ms": round(耗时 / 帧数 * 1000, 1),
            "编码器": "libx264",
        })
        print("   ✓ 成功")
        print("     文件: %.2f MB   耗时: %.2f 秒   每帧: %.1f ms" % (
            结果1["大小MB"], 耗时, 结果1["每帧ms"]))
    else:
        print("   ✗ 失败: %s" % err.decode("utf-8", "replace")[:200])
except Exception as e:
    结果1["错误"] = "%s: %s" % (type(e).__name__, str(e)[:150])
    print("   ✗ 异常: %s" % 结果1["错误"])

# ---------- 路径 2：opencv ----------
print()
print("【路径 2】opencv-python（mp4v 编码器）")
结果2 = {"路径": "opencv", "可用": False}
try:
    import cv2
    输出2 = 输出目录 / "path2_opencv.mp4"
    w = cv2.VideoWriter(str(输出2), cv2.VideoWriter_fourcc(*"mp4v"),
                        FPS, (宽, 高))
    if not w.isOpened():
        print("   ✗ VideoWriter 无法打开")
    else:
        import time
        起 = time.perf_counter()
        for i in range(帧数):
            w.write(造帧(i))
        w.release()
        耗时 = time.perf_counter() - 起
        if 输出2.is_file() and 输出2.stat().st_size > 0:
            结果2.update({
                "可用": True,
                "文件": str(输出2),
                "大小MB": round(输出2.stat().st_size / 1e6, 2),
                "耗时秒": round(耗时, 2),
                "每帧ms": round(耗时 / 帧数 * 1000, 1),
                "编码器": "mp4v (MPEG-4 Part 2)",
            })
            print("   ✓ 成功")
            print("     文件: %.2f MB   耗时: %.2f 秒   每帧: %.1f ms" % (
                结果2["大小MB"], 耗时, 结果2["每帧ms"]))
        else:
            print("   ✗ 文件未生成")
except Exception as e:
    结果2["错误"] = "%s: %s" % (type(e).__name__, str(e)[:150])
    print("   ✗ 异常: %s" % 结果2["错误"])

# ---------- 验证可解码性 ----------
print()
print("【验证】用 ffmpeg 探测生成的视频")
import imageio_ffmpeg
exe = imageio_ffmpeg.get_ffmpeg_exe()
for 结果 in (结果1, 结果2):
    if not 结果.get("可用"):
        continue
    进程 = subprocess.run(
        [exe, "-v", "error", "-i", 结果["文件"],
         "-f", "null", "-"],
        capture_output=True, timeout=120)
    可解码 = 进程.returncode == 0
    # 取时长
    探测 = subprocess.run(
        [exe, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", "-i", 结果["文件"]],
        capture_output=True, timeout=60)
    时长 = 探测.stdout.decode("utf-8", "replace").strip()
    结果["可解码"] = 可解码
    结果["时长秒"] = 时长
    print("   %-14s 可解码=%s  时长=%s 秒（预期 %d）" % (
        结果["路径"], "是" if 可解码 else "否", 时长, 秒数))

# ---------- 结论 ----------
print()
print("=" * 74)
print("结论")
print("=" * 74)
可用 = [r for r in (结果1, 结果2) if r.get("可用")]
if 可用:
    最快 = min(可用, key=lambda x: x["每帧ms"])
    print()
    print("可用路径: %d 条" % len(可用))
    for r in 可用:
        print("   %-14s %-24s 每帧 %5.1f ms  可解码=%s" % (
            r["路径"], r["编码器"], r["每帧ms"], r.get("可解码")))
    print()
    print("推荐: %s（每帧 %.1f ms）" % (最快["路径"], 最快["每帧ms"]))
    print()
    print("外推（266 秒视频，仅编码开销）:")
    for fps in (30, 60):
        帧 = 266 * fps
        分 = 帧 * 最快["每帧ms"] / 1000 / 60
        print("   %d fps → %d 帧 → 约 %.1f 分钟" % (fps, 帧, 分))
else:
    print("两条路径均不可用，需另寻方案。")

out = pathlib.Path(r"D:\FL_VISUAL_TEST\tools\phaseA_encoder_results.json")
out.write_text(json.dumps({
    "imageio_ffmpeg": 结果1,
    "opencv": 结果2,
}, ensure_ascii=False, indent=1), encoding="utf-8")
print()
print("已记录:", out)
