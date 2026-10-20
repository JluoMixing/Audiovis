"""在多个时刻抽帧，确认整段视频里三族都出现过。"""
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import imageio_ffmpeg  # noqa: E402
from PIL import Image  # noqa: E402
import numpy as np  # noqa: E402

端口 = int(sys.argv[1]) if len(sys.argv) > 1 else 8820
基址 = "http://127.0.0.1:%d" % 端口
工程 = pathlib.Path(r"E:\FL_Project\nujabes")
输出 = pathlib.Path(r"D:\FL_VISUAL_TEST\out\nujabes_multi.mp4")


def 发(路径, 数据):
    req = urllib.request.Request(
        基址 + 路径, data=json.dumps(数据).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def 取(路径):
    with urllib.request.urlopen(基址 + 路径, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def 等任务(ident, 超时=1800):
    起 = time.time()
    while time.time() - 起 < 超时:
        t = 取("/api/job?id=" + ident)
        print("    %5.0fs  %-6s %-10s %4.0f%%" % (
            time.time() - 起, t["状态"], t["阶段"], t["进度"] * 100))
        if t["状态"] != "运行中":
            return t
        time.sleep(4)
    return {"状态": "超时"}


print("=" * 74)
print("渲染 0~30 秒（走完整鼓组变化段）")
print("=" * 74)

布局 = {
    "flp": str(工程 / "nujabes.flp"),
    "audio": str(工程 / "nujabes.mp3"),
    "主题": "sumi",
    "画布": {"w": 960, "h": 360},
    "帧率": 30,
    "时长": 30.0,
    "起点": 0.0,
    "预设": "ultrafast",
    "并行度": 4,
    "无音频": True,
    "输出": str(输出),
    "组件": [
        {"id": "stepper", "x": 0, "y": 0, "w": 960, "h": 360, "z": 1},
    ],
}
r = 发("/api/render", 布局)
t = 等任务(r["id"])
if t["状态"] != "完成":
    print("失败: " + str(t.get("错误")))
    sys.exit(1)
print()

ff = imageio_ffmpeg.get_ffmpeg_exe()
print("各时刻可见的行（读左端色条颜色）")
print()

# 色条在 x ≈ gx-9，gx = pad+96 = 110，所以 x≈101
结果 = []
for 秒 in [1, 5, 10, 15, 20, 25, 29]:
    帧文件 = 输出.with_name("m_%02d.png" % 秒)
    subprocess.run([ff, "-ss", str(秒), "-i", str(输出), "-vframes", "1",
                    "-y", str(帧文件)], capture_output=True)
    if not 帧文件.is_file():
        continue
    a = np.asarray(Image.open(帧文件).convert("RGB"))
    H, W = a.shape[:2]
    top, bottom = 14 + 28, H - 14 - 22
    # 找色条：在 x=95..115 范围内，每行找最暗的列
    行色 = []
    for ri in range(3):
        y0 = int(top + (bottom - top) * ri / 3)
        y1 = int(top + (bottom - top) * (ri + 1) / 3)
        cy = (y0 + y1) // 2
        条 = a[cy - 5:cy + 5, 90:120]
        亮度 = 条.mean(axis=2)
        idx = np.unravel_index(亮度.argmin(), 亮度.shape)
        最暗 = 条[idx]
        lum = 0.2126 * 最暗[0] + 0.7152 * 最暗[1] + 0.0722 * 最暗[2]
        行色.append((tuple(int(v) for v in 最暗), round(float(lum), 1)))
    结果.append((秒, 行色))
    print("  %2ds: %s" % (秒, "  ".join(
        "rgb(%3d,%3d,%3d)" % c for c, _ in 行色)))

print()
# 统计出现了几种不同颜色（区分 kick 黑 / snare 红 / hihat 灰）
def 归类(rgb):
    r, g, b = rgb
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if r - g > 25 and r - b > 25:
        return "snare(红)"
    if lum < 70:
        return "kick(黑)"
    if lum < 200:
        return "hihat(灰)"
    return "浅"


print("归类：")
for 秒, 行色 in 结果:
    print("  %2ds: %s" % (秒, "  ".join(归类(c) for c, _ in 行色)))
