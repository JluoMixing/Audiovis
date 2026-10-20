"""用真实 HTTP 接口走一遍导出，看导出的视频里步进器是否只有一种。

用户报：导出后步进器只有一个乐器，名称是「其它」。
但 GUI 预览里 collectDrums 返回 kick/snare/hihat —— 两者不一致。
"""
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import imageio_ffmpeg  # noqa: E402

端口 = int(sys.argv[1]) if len(sys.argv) > 1 else 8810
基址 = "http://127.0.0.1:%d" % 端口
工程 = pathlib.Path(r"E:\FL_Project\nujabes")
输出 = pathlib.Path(r"D:\FL_VISUAL_TEST\out\nujabes_step.mp4")


def 发(路径, 数据):
    req = urllib.request.Request(
        基址 + 路径, data=json.dumps(数据).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def 取(路径):
    with urllib.request.urlopen(基址 + 路径, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def 等任务(ident, 超时=1200):
    起 = time.time()
    while time.time() - 起 < 超时:
        t = 取("/api/job?id=" + ident)
        print("    %5.0fs  %-6s %-12s %4.0f%%  %s" % (
            time.time() - 起, t["状态"], t["阶段"], t["进度"] * 100,
            t.get("消息") or ""))
        if t["状态"] != "运行中":
            return t
        time.sleep(4)
    return {"状态": "超时"}


print("=" * 76)
print("真实导出：nujabes 工程，只渲染步进器")
print("=" * 76)
print()

# 先导入真实工程（不是示例快照）
print("[1] 导入真实工程")
r = 发("/api/import", {"flp": str(工程 / "nujabes.flp"),
                      "audio": str(工程 / "nujabes.mp3")})
if "id" not in r:
    print("  导入未受理: " + json.dumps(r, ensure_ascii=False))
    sys.exit(1)
t = 等任务(r["id"])
print("    " + str(t.get("状态")) + "  " + str(t.get("错误") or ""))
if t["状态"] != "完成":
    sys.exit(1)
print()

# 只放一个步进器，占满画布，最能看清
print("[2] 渲染 3 秒（画面只有一个步进器）")
布局 = {
    "flp": str(工程 / "nujabes.flp"),
    "audio": str(工程 / "nujabes.mp3"),
    "主题": "sumi",
    "画布": {"w": 960, "h": 360},
    "帧率": 30,
    "时长": 3.0,
    "起点": 10.0,
    "预设": "ultrafast",
    "并行度": 2,
    "无音频": True,
    "输出": str(输出),
    "组件": [
        {"id": "stepper", "x": 0, "y": 0, "w": 960, "h": 360, "z": 1},
    ],
}
r = 发("/api/render", 布局)
if "id" not in r:
    print("  渲染未受理: " + json.dumps(r, ensure_ascii=False))
    sys.exit(1)
t = 等任务(r["id"])
print("    " + str(t.get("状态")) + "  " + str(t.get("错误") or ""))
if t["状态"] != "完成":
    sys.exit(1)
print()

# 抽首帧
print("[3] 抽首帧")
ff = imageio_ffmpeg.get_ffmpeg_exe()
帧 = 输出.with_suffix(".png")
subprocess.run([ff, "-i", str(输出), "-vframes", "1", "-y", str(帧)],
               capture_output=True)
print("    %s  %s" % (帧.exists(), 帧))
