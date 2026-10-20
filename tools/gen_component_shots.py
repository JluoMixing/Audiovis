"""生成三套主题 × 全组件的真实渲染预览。

## 做法

对每套主题、每个组件，各渲染一次静帧（1 帧视频再抽帧），
得到 3 × 12 = 36 张真实渲染图。

## 为什么这么做

之前的方案页是我自己写的 canvas 模拟代码 —— 那是**示意**，不是真实渲染。
你要的是「全组件预览」，必须走真实管线，否则看不出真实效果
（尤其步进器的 BLOOM 动画、SURFACE 的质感）。

## 单组件渲染

`/api/render` 接受 `组件` 数组。给一个只含单个组件的数组，
画布设成该组件的注册尺寸，就得到该组件的单独渲染。
"""
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
端口 = 11000
输出目录 = 根 / "out" / "components"
输出目录.mkdir(parents=True, exist_ok=True)


def 请求(路径, 数据=None, 超时=600):
    url = "http://127.0.0.1:%d%s" % (端口, 路径)
    body = json.dumps(数据).encode() if 数据 is not None else None
    req = urllib.request.Request(
        url, data=body, method="POST" if body else "GET",
        headers={"Content-Type": "application/json"} if body else {})
    with urllib.request.urlopen(req, timeout=超时) as r:
        return json.loads(r.read())


组件 = [
    ("playlist", "主时间轴", 1180, 600),
    ("stepper", "步进器", 960, 360),
    ("spectrum", "频谱", 640, 200),
    ("waveform", "波形", 640, 160),
    ("pianoroll", "钢琴卷帘", 900, 300),
    ("pitchwheel", "音级轮", 360, 360),
    ("vectorscope", "声场", 300, 300),
    ("loudness", "响度", 420, 300),
    ("brightness", "明亮度", 420, 300),
    ("transient", "瞬态", 420, 300),
    ("transport", "走带读数", 320, 170),
    ("text", "文字", 620, 200),
]

主题 = ["wh_soft", "chrome_freak", "nuclear"]

# 确保服务
try:
    请求("/api/session", 超时=10)
except Exception:
    print("启动服务…")
    subprocess.Popen([sys.executable, "run.py", "--port", str(端口),
                      "--no-open"], cwd=str(根),
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        time.sleep(1)
        try:
            请求("/api/session", 超时=5)
            break
        except Exception:
            pass

会话 = 请求("/api/session")
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

import imageio_ffmpeg
ff = imageio_ffmpeg.get_ffmpeg_exe()

总 = len(主题) * len(组件)
完成 = 0
失败 = []

for 键 in 主题:
    print()
    print("=== %s ===" % 键)
    for cid, 名, w, h in 组件:
        mp4 = 输出目录 / ("%s_%s.mp4" % (键, cid))
        png = 输出目录 / ("%s_%s.png" % (键, cid))
        if mp4.exists():
            mp4.unlink()
        if png.exists():
            png.unlink()

        # 单个组件居中放在画布上
        布局 = [{
            "id": cid, "x": 0, "y": 0, "w": w, "h": h,
            "样式": {},
        }]
        # 串行 + 重试：并发过高会「页面未就绪」
        成功 = False
        for 尝试 in range(3):
            try:
                r = 请求("/api/render", {
                    "flp": 会话.get("flp"), "audio": 会话.get("audio"),
                    "主题": 键, "画布": {"w": w, "h": h},
                    # 起点必须在**音频长度内**（本工程音频仅 39.6s，
                    # 而工程总长 211.7s）。超界会导致频谱/波形无数据。
                    "帧率": 6, "时长": 1, "起点": 20,
                    "输出": str(mp4), "预设": "ultrafast", "并行度": 1,
                    "组件": 布局,
                })
                任务 = r.get("id")
                if not 任务:
                    失败.append((键, cid, "未受理"))
                    break

                最后 = {}
                for _ in range(300):
                    time.sleep(1.5)
                    最后 = 请求("/api/job?id=" + str(任务))
                    if 最后.get("状态") != "运行中":
                        break

                if 最后.get("状态") != "完成":
                    if 尝试 < 2:
                        time.sleep(3)
                        continue
                    失败.append((键, cid, 最后.get("错误")))
                    print("  ✗ %-12s %s"
                          % (cid, (最后.get("错误") or "")[:50]))
                    break

                subprocess.run([ff, "-y", "-i", str(mp4), "-vframes", "1",
                                str(png), "-loglevel", "error"],
                               capture_output=True, timeout=120)
                if png.is_file() and png.stat().st_size > 500:
                    完成 += 1
                    成功 = True
                    print("  ✓ %-12s %dx%d" % (cid, w, h))
                else:
                    失败.append((键, cid, "抽帧失败"))
                    print("  ✗ %-12s 抽帧失败" % cid)
                break
            except Exception as e:
                if 尝试 < 2:
                    time.sleep(3)
                    continue
                失败.append((键, cid, str(e)[:100]))
                print("  ✗ %-12s %s" % (cid, str(e)[:50]))
                break
        time.sleep(0.5)

print()
print("=" * 60)
print("完成 %d / %d" % (完成, 总))
if 失败:
    print("失败：")
    for x in 失败:
        print("  %s %s: %s" % x)
