"""验证 island：时长应覆盖整个工程（166s）而非音频（80s）。"""
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))
import imageio_ffmpeg  # noqa: E402

端口 = int(sys.argv[1]) if len(sys.argv) > 1 else 8820
基址 = "http://127.0.0.1:%d" % 端口
工程 = pathlib.Path(r"E:\FL_Project\island")


def 发(路径, 数据):
    req = urllib.request.Request(
        基址 + 路径, data=json.dumps(数据).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode("utf-8"))


def 取(路径):
    with urllib.request.urlopen(基址 + 路径, timeout=180) as r:
        return json.loads(r.read().decode("utf-8"))


def 等任务(ident, 超时=2400):
    起 = time.time()
    while time.time() - 起 < 超时:
        t = 取("/api/job?id=" + ident)
        print("    %5.0fs  %-6s %-10s %4.0f%%" % (
            time.time() - 起, t["状态"], t["阶段"], t["进度"] * 100))
        if t["状态"] != "运行中":
            return t
        time.sleep(5)
    return {"状态": "超时"}


print("=" * 74)
print("island 时长验证")
print("=" * 74)
print()

print("[1] 导入")
r = 发("/api/import", {"flp": str(工程 / "island.flp"),
                      "audio": str(工程 / "island.mp3")})
t = 等任务(r["id"])
print("    " + str(t.get("状态")) + "  " + str(t.get("错误") or ""))
if t["状态"] != "完成":
    sys.exit(1)
print()

会话 = 取("/api/session")
print("[2] 工程信息")
print("    工程名: %s" % 会话.get("name"))
print("    音频时长: %.2f 秒" % 会话.get("duration", 0))
print("    工程长度: %.2f 秒" % 会话.get("projectDuration", 0))
print()

音频长 = 会话.get("duration", 0)
工程长 = 会话.get("projectDuration", 0)
通过 = 0
失败 = 0


def 断言(名, 条件, 详情=""):
    global 通过, 失败
    if 条件:
        通过 += 1
        print("  ✓ " + 名)
    else:
        失败 += 1
        print("  ✗ " +名 + ("  → " + str(详情) if 详情 else ""))


断言("工程长度已算出", 工程长 > 0, 工程长)
断言("工程长度 > 音频长度（本工程如此）", 工程长 > 音频长,
     "工程 %.1f vs 音频 %.1f" % (工程长, 音频长))
print()

print("[3] 渲染 20 秒（从 100 秒起 —— 音频外，验证不被截断）")
输出 = 根 / "out" / "island_tail.mp4"
布局 = {
    "flp": str(工程 / "island.flp"),
    "audio": str(工程 / "island.mp3"),
    "主题": "sumi",
    "画布": {"w": 640, "h": 360},
    "帧率": 24,
    "时长": 20.0,
    "起点": 100.0,
    "预设": "ultrafast",
    "并行度": 4,
    "无音频": False,          # 带音频，验证 apad 是否工作
    "输出": str(输出),
    "组件": [
        {"id": "waveform", "x": 0, "y": 0, "w": 640, "h": 360, "z": 1},
    ],
}
r = 发("/api/render", 布局)
t = 等任务(r["id"])
断言("渲染完成", t["状态"] == "完成", t.get("错误"))
print()

if 输出.is_file():
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    rr = subprocess.run([ff, "-i", str(输出)], capture_output=True, text=True,
                        encoding="utf-8", errors="replace")
    信息 = rr.stderr or ""
    for line in 信息.splitlines():
        if "Duration" in line or "Stream #" in line:
            print("    " + line.strip())
    print()
    断言("输出时长约 20 秒（未被音频截断）", "00:00:20" in 信息,
         [l for l in 信息.splitlines() if "Duration" in l])
    断言("含音频流", "Audio:" in 信息)
else:
    断言("产物存在", False, str(输出))

print()
print("=" * 74)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 74)
sys.exit(1 if 失败 else 0)
