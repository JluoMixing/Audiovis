"""island 鼓组端到端：导入 → 渲染 → 看画面。"""
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))
import imageio_ffmpeg  # noqa: E402

端口 = int(sys.argv[1]) if len(sys.argv) > 1 else 8830
基址 = "http://127.0.0.1:%d" % 端口
工程 = pathlib.Path(r"E:\FL_Project\island")
输出 = 根 / "out" / "island_stepper.mp4"


def 发(路径, 数据):
    req = urllib.request.Request(
        基址 + 路径, data=json.dumps(数据).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode("utf-8"))


def 取(路径):
    with urllib.request.urlopen(基址 + 路径, timeout=180) as r:
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


print("[1] 导入 island")
r = 发("/api/import", {"flp": str(工程 / "island.flp"),
                      "audio": str(工程 / "island.mp3")})
t = 等任务(r["id"])
print("    " + str(t.get("状态")) + "  " + str(t.get("错误") or ""))
if t["状态"] != "完成":
    sys.exit(1)
print()

# 查 drumStats
html = urllib.request.urlopen(基址 + "/", timeout=180).read().decode("utf-8")
import re
m = re.search(r'"drumStats":(\{[^}]*\})', html)
print("[2] 鼓组统计")
print("    " + (m.group(1) if m else "未找到"))
print()

print("[3] 渲染 20 秒步进器（起点 40 秒）")
布局 = {
    "flp": str(工程 / "island.flp"),
    "audio": str(工程 / "island.mp3"),
    "主题": "sumi",
    "画布": {"w": 960, "h": 360},
    "帧率": 24, "时长": 20.0, "起点": 40.0,
    "预设": "ultrafast", "并行度": 4, "无音频": True,
    "输出": str(输出),
    "组件": [{"id": "stepper", "x": 0, "y": 0, "w": 960, "h": 360, "z": 1}],
}
r = 发("/api/render", 布局)
t = 等任务(r["id"])
print("    " + str(t.get("状态")) + "  " + str(t.get("错误") or ""))
print()

if 输出.is_file():
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    for 秒 in [1, 8, 15]:
        帧 = 输出.with_name("island_%02d.png" % 秒)
        subprocess.run([ff, "-ss", str(秒), "-i", str(输出),
                        "-vframes", "1", "-y", str(帧)], capture_output=True)
        print("    抽帧 %ds: %s" % (秒, 帧.name if 帧.is_file() else "失败"))
