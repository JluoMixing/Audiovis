"""渲染「基础」横屏模板，看文字位置到底哪里不对。

不跑全量测试，只渲染一次抽帧看。
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


def 请求(路径, 数据=None, 超时=300):
    url = "http://127.0.0.1:%d%s" % (端口, 路径)
    body = json.dumps(数据).encode() if 数据 is not None else None
    req = urllib.request.Request(
        url, data=body, method="POST" if body else "GET",
        headers={"Content-Type": "application/json"} if body else {})
    with urllib.request.urlopen(req, timeout=超时) as r:
        return json.loads(r.read())


print("=" * 70)
print("渲染「基础」横屏模板，检查文字位置")
print("=" * 70)
print()

# 确保有工程
会话 = 请求("/api/session")
if not 会话.get("已导入"):
    print("导入 amapiano…")
    工程 = pathlib.Path(r"E:\FL_Project\amapiano")
    r = 请求("/api/import", {"flp": str(工程 / "amapiano.flp"),
                           "audio": str(工程 / "amapiano.mp3")})
    for _ in range(300):
        time.sleep(1.5)
        t = 请求("/api/job?id=" + r["id"])
        if t.get("状态") != "运行中":
            break
    print("  " + str(t.get("状态")))
    会话 = 请求("/api/session")

# 读模板
ts = json.loads((根 / "preview" / "templates.json").read_text(encoding="utf-8"))
模板 = [t for t in ts if t.get("name") == "基础"][0]
组件 = 模板["land"]

print("模板组件：")
for c in 组件:
    if c.get("id") == "text":
        st = c.get("样式") or {}
        print("  text x=%s y=%s 对齐=%s 内容=%r"
              % (c.get("x"), c.get("y"), st.get("对齐"),
                 (st.get("内容") or "")[:20]))
    else:
        print("  %-12s x=%-5s y=%-5s w=%-5s h=%s"
              % (c.get("id"), c.get("x"), c.get("y"),
                 c.get("w"), c.get("h")))
print()

# 渲染 2 秒
输出 = 根 / "out" / "tpl_text_check.mp4"
if 输出.exists():
    输出.unlink()
r = 请求("/api/render", {
    "flp": 会话.get("flp"), "audio": 会话.get("audio"),
    "主题": "sumi", "画布": {"w": 1920, "h": 1080},
    "帧率": 6, "时长": 2, "起点": 30,
    "输出": str(输出), "预设": "ultrafast", "并行度": 2,
    "组件": 组件,
})
任务 = r["id"]
最后 = {}
for _ in range(300):
    time.sleep(2)
    最后 = 请求("/api/job?id=" + str(任务))
    if 最后.get("状态") != "运行中":
        break
断言("渲染完成", 最后.get("状态") == "完成",
     (最后.get("错误") or "")[:200])
print()

if 输出.is_file():
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    帧 = 根 / "out" / "tpl_text_check.png"
    if 帧.exists():
        帧.unlink()
    subprocess.run([ff, "-y", "-i", str(输出), "-vframes", "1",
                    str(帧), "-loglevel", "error"],
                   capture_output=True, timeout=120)
    if 帧.is_file():
        print("抽帧:", 帧)

print()
print("=" * 70)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 70)
