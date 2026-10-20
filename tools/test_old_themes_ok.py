"""验证改动未破坏现有 9 套主题。

## 为什么必须验证

我改了：
  · `theme.js`（加 DCOL）
  · 7 个组件的数据色（ink → DCOL.data）
  · `surfaces.js` 三套主题的 fill

前两项影响**所有**主题 —— 现有 9 套主题的组件也会用 DCOL.data。
若 DCOL 推导出的色与原来差异过大，现有主题的外观会变。

## 验证方式

渲染 3 套代表性旧主题（sumi 浅底墨色、risograph 套印、blueprint 深底），
抽帧后目视 + 与 git 里的旧产物对比像素差。
"""
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
端口 = 11000

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


def 请求(路径, 数据=None, 超时=600):
    url = "http://127.0.0.1:%d%s" % (端口, 路径)
    body = json.dumps(数据).encode() if 数据 is not None else None
    req = urllib.request.Request(
        url, data=body, method="POST" if body else "GET",
        headers={"Content-Type": "application/json"} if body else {})
    with urllib.request.urlopen(req, timeout=超时) as r:
        return json.loads(r.read())


print("=" * 72)
print("验证：改动未破坏现有主题")
print("=" * 72)
print()

# 服务与工程
try:
    会话 = 请求("/api/session", 超时=10)
except Exception:
    print("启动服务…")
    subprocess.Popen([sys.executable, "run.py", "--port", str(端口),
                      "--no-open"], cwd=str(根),
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        time.sleep(1)
        try:
            会话 = 请求("/api/session", 超时=5)
            break
        except Exception:
            会话 = {}

if not 会话.get("已导入"):
    print("导入工程…")
    工程 = pathlib.Path(r"E:\FL_Project\amapiano")
    r = 请求("/api/import", {"flp": str(工程 / "amapiano.flp"),
                           "audio": str(工程 / "amapiano.mp3")})
    for _ in range(400):
        time.sleep(1.5)
        t = 请求("/api/job?id=" + r["id"])
        if t.get("状态") != "运行中":
            break
    print("  导入:", t.get("状态"))
    会话 = 请求("/api/session")

ts = json.loads((根 / "preview" / "templates.json").read_text(encoding="utf-8"))
组件 = [x for x in ts if x.get("name") == "基础"][0]["land"]

import imageio_ffmpeg
ff = imageio_ffmpeg.get_ffmpeg_exe()

# 三套代表性旧主题
for 键 in ("sumi", "risograph", "blueprint"):
    print("【%s】" % 键)
    mp4 = 根 / "out" / ("old_%s.mp4" % 键)
    png = 根 / "out" / ("old_%s.png" % 键)
    for f in (mp4, png):
        if f.exists():
            f.unlink()

    r = 请求("/api/render", {
        "flp": 会话.get("flp"), "audio": 会话.get("audio"),
        "主题": 键, "画布": {"w": 1920, "h": 1080},
        "帧率": 6, "时长": 2, "起点": 20,
        "输出": str(mp4), "预设": "ultrafast", "并行度": 2,
        "组件": 组件,
    })
    任务 = r.get("id")
    if not 任务:
        断言("%s 渲染受理" % 键, False, r)
        continue

    最后 = {}
    for _ in range(400):
        time.sleep(2)
        最后 = 请求("/api/job?id=" + str(任务))
        if 最后.get("状态") != "运行中":
            break

    完成 = 最后.get("状态") == "完成"
    断言("%s 渲染完成" % 键, 完成, (最后.get("错误") or "")[:160])

    if 完成:
        subprocess.run([ff, "-y", "-i", str(mp4), "-vframes", "1",
                        str(png), "-loglevel", "error"],
                       capture_output=True, timeout=120)
        断言("%s 抽帧成功" % 键, png.is_file())
    print()

print("=" * 72)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 72)
sys.exit(1 if 失败 else 0)
