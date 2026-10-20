"""最终验收：通过服务渲染一段**带音轨**的视频，核验产物本身。

前面各阶段分别验证了渲染路径一致、布局注入、服务接口、GUI 交互。
这一条是端到端的验收：从「GUI 会发的那种请求」出发，
拿到 mp4，然后检查它的实际参数（分辨率/帧率/时长/音轨）。
"""
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import imageio_ffmpeg  # noqa: E402

端口 = int(sys.argv[1]) if len(sys.argv) > 1 else 8799
基址 = "http://127.0.0.1:%d" % 端口
工程 = pathlib.Path(r"E:\FL_Project\amapiano")
输出 = pathlib.Path(r"D:\FL_VISUAL_TEST\out\final_acceptance.mp4")

通过 = 0
失败 = 0


def 断言(名, 条件, 详情=""):
    global 通过, 失败
    if 条件:
        通过 += 1
        print("  ✓ " + 名)
    else:
        失败 += 1
        print("  ✗ " + 名 + ("  → " + str(详情) if 详情 else ""))


def 发(路径, 数据):
    req = urllib.request.Request(
        基址 + 路径, data=json.dumps(数据).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def 等任务(ident, 超时=1800):
    起 = time.time()
    while time.time() - 起 < 超时:
        with urllib.request.urlopen(基址 + "/api/job?id=" + ident,
                                    timeout=30) as r:
            t = json.loads(r.read().decode("utf-8"))
        print("    %5.0fs  %-6s %-12s %4.0f%%  %s" % (
            time.time() - 起, t["状态"], t["阶段"], t["进度"] * 100,
            t.get("消息") or ""))
        if t["状态"] != "运行中":
            return t
        time.sleep(4)
    return {"状态": "超时"}


print("=" * 76)
print("最终验收：服务 → 带音轨的 mp4 → 核验产物")
print("=" * 76)
print()

# 沿用 GUI 会发的那种布局（竖屏 + 文字 + 逐组件柔化 + 隐藏内文字）
布局 = {
    "flp": str(工程 / "amapiano.flp"),
    "audio": str(工程 / "amapiano.mp3"),
    "主题": "construct",
    "画布": {"w": 1080, "h": 1920},
    "帧率": 30,
    "时长": 6.0,
    "起点": 4.0,
    "预设": "ultrafast",
    "并行度": 2,
    "无音频": False,
    "输出": str(输出),
    "组件": [
        {"id": "playlist", "x": 64, "y": 430, "w": 952, "h": 484,
         "z": 1, "柔化": 0.0},
        {"id": "stepper", "x": 64, "y": 978, "w": 443, "h": 166,
         "z": 2, "柔化": 0.42, "隐藏文字": True},
        {"id": "spectrum", "x": 537, "y": 978, "w": 479, "h": 150,
         "z": 3},
        {"id": "text", "x": 64, "y": 360, "w": 400, "h": 56, "z": 4,
         "样式": {"内容": "{title}", "角色": "display", "字号": 52,
                  "大写": True, "颜色": "ink", "字距": 3.0,
                  "行距": 1.1, "对齐": "left", "旋转": 0,
                  "背景": False, "自动换行": False}},
    ],
}

print("【1】提交渲染（1080×1920 · 30fps · 6 秒 · 带音轨）")
t0 = time.time()
r = 发("/api/render", 布局)
断言("已受理", "id" in r, r)
任务 = 等任务(r["id"])
耗时 = time.time() - t0
断言("渲染完成", 任务["状态"] == "完成", 任务.get("错误"))
print()

产 = 任务.get("产物") or {}
视频 = pathlib.Path(产.get("视频") or "")
断言("产物文件存在", 视频.is_file(), str(视频))
断言("产物路径与请求一致", 视频.resolve() == 输出.resolve(),
     "%s vs %s" % (视频, 输出))
print()

print("【2】核验 mp4 本身（用 ffprobe 读实际参数）")
ff = imageio_ffmpeg.get_ffmpeg_exe()
# imageio 只带 ffmpeg，不带 ffprobe；改用 ffmpeg -i 读元信息
r2 = subprocess.run([ff, "-i", str(视频)], capture_output=True, text=True,
                    encoding="utf-8", errors="replace")
信息 = (r2.stderr or "")
print("    " + "\n    ".join(
    l.strip() for l in 信息.splitlines()
    if any(k in l for k in ("Duration", "Stream #", "Video:", "Audio:"))))
print()

断言("含视频流", "Video:" in 信息, "")
断言("含音频流（音轨已混入）", "Audio:" in 信息,
     "无音轨" if "Audio:" not in 信息 else "")
断言("分辨率 1080x1920", "1080x1920" in 信息 or "1080, 1920" in 信息,
     [l for l in 信息.splitlines() if "Video:" in l])
断言("帧率 30", "30 fps" in 信息 or "30fps" in 信息,
     [l for l in 信息.splitlines() if "Video:" in l])
断言("时长约 6 秒", "00:00:06" in 信息,
     [l for l in 信息.splitlines() if "Duration" in l])
断言("文件非空（> 200 KB）", 视频.stat().st_size > 200_000,
     "%.2f MB" % (视频.stat().st_size / 1e6))
print()

print("【3】通过 /api/video 取回（GUI 的下载链接走这条）")
with urllib.request.urlopen(基址 + "/api/video?id=" + 任务["id"],
                            timeout=300) as rr:
    数据 = rr.read()
断言("取回 200 且是 mp4", len(数据) > 200_000 and 数据[4:8] == b"ftyp",
     "%.2f MB" % (len(数据) / 1e6))
断言("长度与磁盘文件一致", len(数据) == 视频.stat().st_size,
     "%d vs %d" % (len(数据), 视频.stat().st_size))
print()

print("【4】耗时")
print("    渲染 %.1f 秒（6 秒视频 · 竖屏 · 2 路并行）" % 耗时)
print()

print("=" * 76)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 76)
sys.exit(1 if 失败 else 0)
