"""阶段 A-5：编码方案核实。

本机无 ffmpeg（PATH 与 Python 包均无）。
核实可行的替代路径，并实测其可用性。
"""
import json
import pathlib
import shutil
import subprocess
import sys

print("=" * 74)
print("阶段 A：视频编码方案核实")
print("=" * 74)
print()

# 1) 系统 ffmpeg
print("【1】系统 ffmpeg")
p = shutil.which("ffmpeg")
print("   PATH 中: %s" % (p or "无"))

# 2) imageio-ffmpeg（会自带二进制）
print()
print("【2】imageio-ffmpeg（Python 包，自带 ffmpeg 二进制）")
try:
    import imageio_ffmpeg
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    print("   已安装，二进制: %s" % exe)
    print("   版本: %s" % imageio_ffmpeg.get_ffmpeg_version())
except ImportError:
    print("   未安装 —— 可通过 pip install imageio-ffmpeg 获得（约 30MB）")
except Exception as e:
    print("   异常: %s" % e)

# 3) OpenCV（已安装 4.8.1）
print()
print("【3】opencv-python（已安装）")
try:
    import cv2
    print("   版本: %s" % cv2.__version__)
    print("   VideoWriter 可用编码器（FourCC）:")
    for fourcc in ("avc1", "H264", "mp4v", "MJPG"):
        try:
            w = cv2.VideoWriter()
            ok = w.open("test.mp4", cv2.VideoWriter_fourcc(*fourcc), 30, (1920, 1080))
            if ok:
                print("     %-6s 可用" % fourcc)
            else:
                print("     %-6s 不可用" % fourcc)
            w.release()
        except Exception as e:
            print("     %-6s 异常: %s" % (fourcc, str(e)[:50]))
    # 清理测试文件
    for f in ("test.mp4",):
        if pathlib.Path(f).exists():
            pathlib.Path(f).unlink()
except ImportError:
    print("   未安装")

# 4) 系统自带的其它可能
print()
print("【4】其它可能的编码途径")
for name in ("ffmpeg.exe", "avconv.exe"):
    hits = []
    for base in (r"C:\Program Files", r"C:\Program Files (x86)", r"D:\\"):
        bp = pathlib.Path(base)
        if bp.is_dir():
            try:
                for f in bp.rglob(name):
                    hits.append(str(f))
                    if len(hits) >= 3:
                        break
            except Exception:
                pass
        if len(hits) >= 3:
            break
    print("   %s: %s" % (name, hits if hits else "未找到"))

# 5) Windows 自带的可能性
print()
print("【5】Windows 系统组件")
print("   Media Foundation: 系统内置（可用于 H.264 硬件编码）")
print("   但 Python 无直接绑定，需通过 ffmpeg 或专用库调用")

print()
print("=" * 74)
print("结论")
print("=" * 74)
print()
print("推荐路径（按优先级）：")
print("  1. pip install imageio-ffmpeg —— 自带 ffmpeg 二进制，最省事")
print("  2. 手动下载 ffmpeg.exe 放入 tools/ —— 完全可控，便于分发时说明")
print("  3. opencv-python 的 mp4v —— 无需额外依赖，但 H.264 支持有限")
print()
print("对开源项目的影响：")
print("  ffmpeg 是 LGPL/GPL，作为**独立可执行程序**调用不传染许可证")
print("  （仅链接其库才需要同许可证）。故与 GPL-3.0 项目完全兼容。")
