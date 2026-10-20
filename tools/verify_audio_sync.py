"""验证音频混流的**同步正确性**。

方法：从输出视频提取音轨，与原始 mp3 的对应区间做波形相关性比对。
若同步正确，两者应高度相关。
"""
import json
import pathlib
import subprocess
import sys

import imageio_ffmpeg
import numpy as np

exe = imageio_ffmpeg.get_ffmpeg_exe()
根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
视频 = 根 / "out" / "nujabes_test.mp4"
原音频 = pathlib.Path(r"E:\FL_Project\nujabes\nujabes.mp3")
起点 = 20.0          # 渲染起点
时长 = 10.0


def 解码为数组(路径, 起始=0.0, 时长=None, 采样率=22050):
    """用 ffmpeg 解码为单声道 float 数组。"""
    命令 = [exe, "-v", "error"]
    if 起始:
        命令 += ["-ss", "%.6f" % 起始]
    if 时长:
        命令 += ["-t", "%.6f" % 时长]
    命令 += ["-i", str(路径), "-f", "f32le", "-ac", "1",
             "-ar", str(采样率), "-"]
    进程 = subprocess.run(命令, capture_output=True, timeout=300)
    if 进程.returncode != 0:
        raise RuntimeError(进程.stderr.decode("utf-8", "replace")[:300])
    return np.frombuffer(进程.stdout, dtype=np.float32)


print("=" * 70)
print("音频同步验证")
print("=" * 70)
print()

# 1) 输出视频的音轨
视频音 = 解码为数组(视频, 0, 时长)
print("输出视频音轨: %d 采样 (%.2f 秒 @22050Hz)" % (
    len(视频音), len(视频音) / 22050))

# 2) 原始音频的同一起点
原音 = 解码为数组(原音频, 起点, 时长)
print("原始音频区间: %d 采样 (起点 %.1fs)" % (len(原音), 起点))

# 3) 对齐长度
n = min(len(视频音), len(原音))
a = 视频音[:n]
b = 原音[:n]

# 4) 归一化后计算相关性
def 归一化(x):
    x = x - x.mean()
    s = x.std()
    return x / s if s > 1e-9 else x

an, bn = 归一化(a), 归一化(b)
相关 = float(np.corrcoef(an, bn)[0, 1])

print()
print("=== 相关性 ===")
print("  相关系数: %.4f" % 相关)
print("  判定: %s" % (
    "✓ 高度相关，音画同步正确" if 相关 > 0.95 else
    "△ 中度相关，可能有偏移" if 相关 > 0.7 else
    "✗ 不相关，同步有误"))

# 5) 互相关找最佳偏移
if 相关 < 0.999:
    print()
    print("=== 偏移检测（互相关）===")
    最大滞后 = int(2.0 * 22050)   # 搜索 ±2 秒
    片段 = 22050 * 3              # 用 3 秒片段
    偏移结果 = []
    for 滞后 in range(-最大滞后, 最大滞后 + 1, 10):
        if 滞后 >= 0:
            x = an[滞后:滞后 + 片段]
            y = bn[:len(x)]
        else:
            x = an[:片段 + 滞后]
            y = bn[-滞后:-滞后 + len(x)]
        if len(x) < 片段 * 0.5:
            continue
        c = float(np.corrcoef(x, y)[0, 1])
        偏移结果.append((滞后, c))
    if 偏移结果:
        最佳 = max(偏移结果, key=lambda t: t[1])
        print("  最佳偏移: %+d 采样 = %+.4f 秒 (相关 %.4f)" % (
            最佳[0], 最佳[0] / 22050, 最佳[1]))
        print("  判定: %s" % (
            "✓ 无偏移" if abs(最佳[0]) < 220 else
            "△ 轻微偏移 %.0f ms" % (abs(最佳[0]) / 22.05)))

# 6) 音量检查（确认不是静音）
print()
print("=== 音量检查 ===")
print("  输出音轨 RMS: %.4f  峰值: %.4f" % (
    float(np.sqrt((a ** 2).mean())), float(np.abs(a).max())))
print("  原始音频 RMS: %.4f  峰值: %.4f" % (
    float(np.sqrt((b ** 2).mean())), float(np.abs(b).max())))
if float(np.abs(a).max()) < 0.001:
    print("  ✗ 输出音轨接近静音！")
else:
    print("  ✓ 输出音轨有实际内容")

结果 = {
    "相关系数": round(相关, 4),
    "同步判定": "正确" if 相关 > 0.95 else "可疑",
    "视频音轨采样": len(视频音),
    "原始音频采样": len(原音),
    "起点秒": 起点,
    "时长秒": 时长,
}
out = 根 / "tools" / "audio_sync_result.json"
out.write_text(json.dumps(结果, ensure_ascii=False, indent=1), encoding="utf-8")
print()
print("已记录:", out)
