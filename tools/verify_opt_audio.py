"""验证优化版的音画同步（直接指定文件，不依赖脚本改动）。"""
import pathlib
import subprocess
import sys

import imageio_ffmpeg
import numpy as np

exe = imageio_ffmpeg.get_ffmpeg_exe()
根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
视频 = 根 / "out" / "nujabes_opt.mp4"
原音频 = pathlib.Path(r"E:\FL_Project\nujabes\nujabes.mp3")
起点, 时长 = 20.0, 10.0


def 解码(路径, 起始=0.0, 时长=None, 采样率=22050):
    命令 = [exe, "-v", "error"]
    if 起始:
        命令 += ["-ss", "%.6f" % 起始]
    if 时长:
        命令 += ["-t", "%.6f" % 时长]
    命令 += ["-i", str(路径), "-f", "f32le", "-ac", "1",
             "-ar", str(采样率), "-"]
    进程 = subprocess.run(命令, capture_output=True, timeout=300)
    return np.frombuffer(进程.stdout, dtype=np.float32)


a = 解码(视频, 0, 时长)
b = 解码(原音频, 起点, 时长)
n = min(len(a), len(b))
a, b = a[:n], b[:n]


def 归一(x):
    x = x - x.mean()
    s = x.std()
    return x / s if s > 1e-9 else x


相关 = float(np.corrcoef(归一(a), 归一(b))[0, 1])

print("=" * 68)
print("优化版音画同步验证")
print("=" * 68)
print()
print("视频: %s" % 视频.name)
print("起点: %.1f s   时长: %.1f s" % (起点, 时长))
print()
print("相关系数: %.4f" % 相关)
print("判定: %s" % ("✓ 同步正确" if 相关 > 0.95 else "✗ 同步有误"))
print()
print("输出音轨 RMS %.4f  峰值 %.4f" % (
    float(np.sqrt((a ** 2).mean())), float(np.abs(a).max())))
print("原始音频 RMS %.4f  峰值 %.4f" % (
    float(np.sqrt((b ** 2).mean())), float(np.abs(b).max())))
