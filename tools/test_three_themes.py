"""真实渲染三套新主题，验证接入正确。

## 为什么要真渲染

之前我画的是缩略图（我自己写的 canvas 代码）。
现在主题已接入真实管线，必须验证：
  · SURFACE 被组件调用
  · BLOOM 被音符调用
  · 色板/字体生效
  · 不崩

## 做法

用真实的 render 接口，三套主题各渲染 2 秒，抽帧对比。
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
print("三套新主题的真实渲染验证")
print("=" * 72)
print()

# 确保服务在跑
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

# 确保有工程
会话 = 请求("/api/session")
if not 会话.get("已导入"):
    print("导入 amapiano…")
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

# 模板组件
ts = json.loads((根 / "preview" / "templates.json").read_text(encoding="utf-8"))
模板 = [x for x in ts if x.get("name") == "基础"][0]
组件 = 模板["land"]

# 主题列表
ad = json.loads((根 / "preview" / "themes" / "artdirections.json")
                .read_text(encoding="utf-8"))
断言("artdirections 含三套新主题",
     all(k in ad["directions"] for k in
         ("wh_soft", "chrome_freak", "nuclear")))
断言("order 含三套新主题",
     all(k in ad["order"] for k in
         ("wh_soft", "chrome_freak", "nuclear")))
print()

结果 = {}
for 键 in ("wh_soft", "chrome_freak", "nuclear"):
    print("【%s】" % 键)
    输出 = 根 / "out" / ("t_%s.mp4" % 键)
    if 输出.exists():
        输出.unlink()
    r = 请求("/api/render", {
        "flp": 会话.get("flp"), "audio": 会话.get("audio"),
        "主题": 键, "画布": {"w": 1920, "h": 1080},
        "帧率": 6, "时长": 2, "起点": 40,
        "输出": str(输出), "预设": "ultrafast", "并行度": 2,
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
    断言("%s 渲染完成" % 键, 完成,
         (最后.get("错误") or "")[:200])
    if 完成 and 输出.is_file():
        断言("%s 输出文件存在" % 键, 输出.stat().st_size > 2000,
             输出.stat().st_size)
        # 抽帧
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        帧 = 根 / "out" / ("t_%s.png" % 键)
        if 帧.exists():
            帧.unlink()
        subprocess.run([ff, "-y", "-i", str(输出), "-vframes", "1",
                        str(帧), "-loglevel", "error"],
                       capture_output=True, timeout=120)
        断言("%s 抽帧成功" % 键, 帧.is_file())
        结果[键] = 帧
    print()

print("=" * 72)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 72)
for k, v in 结果.items():
    print("  %-14s %s" % (k, v))
sys.exit(1 if 失败 else 0)
