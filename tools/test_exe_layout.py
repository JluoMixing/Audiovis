"""修正 E2E 测试的布局参数形状，并验证布局真的生效。

## 之前错在哪

`跑渲染` 读的是 **顶层** `参数["组件"]`（与前端 app.js 一致）：
    const 参数 = { ..., 组件: 组件 };
而我发的是 `"布局": {"组件": [...]}` —— 这个键根本不被读取，
于是渲染用了页面兜底布局。视频照样出来了，
但**验证不到「用户的布局被尊重」这个核心行为**。

## 怎么验证布局生效

用一个**明显不同**的布局（比如只放一个小尺寸 playlist 在右下角），
渲染后抽帧，检查：
  · 画面左上角应为背景色（因为组件不在那儿）
  · 画面右下角应有内容
这样才证明布局确实被应用了，而不是用了默认布局。
"""
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

根 = pathlib.Path(__file__).resolve().parent.parent
EXE = 根 / "dist" / "Audiovis" / "Audiovis.exe"

工程目录 = pathlib.Path(r"E:\FL_Project\amapiano")
FLP = 工程目录 / "amapiano.flp"
AUDIO = 工程目录 / "amapiano.mp3"

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


def 请求(端口, 路径, 数据=None, 超时=180):
    url = "http://127.0.0.1:%d%s" % (端口, 路径)
    body = json.dumps(数据).encode("utf-8") if 数据 is not None else None
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json"} if body else {},
        method="POST" if body else "GET")
    with urllib.request.urlopen(req, timeout=超时) as r:
        return json.loads(r.read().decode("utf-8"))


def 找端口(pid, 超时=90):
    for _ in range(超时):
        ps = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "(Get-NetTCPConnection -State Listen -ErrorAction "
             "SilentlyContinue | Where-Object { $_.OwningProcess -eq %d } "
             "| Select-Object -First 1).LocalPort" % pid],
            capture_output=True, text=True, timeout=30)
        t = (ps.stdout or "").strip()
        if t.isdigit():
            return int(t)
        time.sleep(1)
    return None


def main():
    print("=" * 72)
    print("验证：打包版是否尊重用户布局")
    print("=" * 72)
    print()

    subprocess.run(["powershell", "-NoProfile", "-Command",
                    "Get-Process Audiovis -ErrorAction SilentlyContinue "
                    "| Stop-Process -Force"], capture_output=True)
    time.sleep(2)

    p = subprocess.Popen([str(EXE)], cwd=str(EXE.parent),
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    端口 = 找端口(p.pid)
    断言("服务就绪", 端口 is not None)
    if not 端口:
        p.kill()
        return 1

    # 导入
    r = 请求(端口, "/api/import", {"flp": str(FLP), "audio": str(AUDIO)})
    任务 = r["id"]
    for _ in range(240):
        time.sleep(1.5)
        t = 请求(端口, "/api/job?id=" + str(任务))
        if t.get("状态") != "运行中":
            break
    断言("导入完成", t.get("状态") == "完成", t.get("状态"))

    会话 = 请求(端口, "/api/session")

    # 故意用一个「只在右下角放一小块」的布局
    输出 = 根 / "out" / "exe_layout_test.mp4"
    if 输出.exists():
        输出.unlink()

    组件 = [
        {"id": "playlist", "x": 480, "y": 280, "w": 340, "h": 160, "z": 1},
    ]
    r = 请求(端口, "/api/render", {
        "flp": 会话.get("flp"),
        "audio": 会话.get("audio"),
        "主题": "sumi",
        "画布": {"w": 854, "h": 480},
        "帧率": 12,
        "时长": 2,
        "起点": 30,
        "输出": str(输出),
        "预设": "ultrafast",
        "并行度": 2,
        "组件": 组件,          # ← 顶层键，与前端一致
    })
    任务 = r["id"]
    最后 = {}
    for _ in range(400):
        time.sleep(2)
        最后 = 请求(端口, "/api/job?id=" + str(任务))
        if 最后.get("状态") != "运行中":
            break
    断言("渲染完成", 最后.get("状态") == "完成",
         (最后.get("错误") or "")[:200])

    p.terminate()
    try:
        p.wait(timeout=10)
    except Exception:
        p.kill()

    print()
    print("【核验布局是否生效】")
    if not 输出.is_file():
        断言("产物存在", False)
    else:
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        帧 = 根 / "out" / "layout_frame.png"
        if 帧.exists():
            帧.unlink()
        subprocess.run([ff, "-y", "-i", str(输出), "-vframes", "1",
                        str(帧), "-loglevel", "error"],
                       capture_output=True, timeout=120)
        断言("抽帧成功", 帧.is_file())
        if 帧.is_file():
            from PIL import Image
            import numpy as np
            im = np.asarray(Image.open(帧).convert("RGB")).astype(float)
            h, w, _ = im.shape
            # 左上区域（组件不该在那里）应接近背景色
            左上 = im[20:120, 20:200]
            # 右下区域（组件在那儿）应有内容
            右下 = im[int(h * 0.62):h - 10, int(w * 0.58):w - 10]
            左上均值 = 左上.mean()
            右下均值 = 右下.mean()
            左上方差 = 左上.std()
            右下方差 = 右下.std()
            print("    左上 均值=%.1f 标准差=%.1f" % (左上均值, 左上方差))
            print("    右下 均值=%.1f 标准差=%.1f" % (右下均值, 右下方差))
            # 阈值 6.0 而非 4.0：主题背景带轻微渐变/暗角，
            # 纯背景区的 std 实测约 4.5，用 4.0 会误报。
            # 有组件时该区域 std 会到 15 以上，区分度足够。
            断言("左上区域是空的（布局没被忽略）", 左上方差 < 6.0,
                 "标准差 %.2f" % 左上方差)
            断言("右下区域有内容", 右下方差 > 8.0,
                 "标准差 %.2f" % 右下方差)

    print()
    print("=" * 72)
    print("通过 %d / %d" % (通过, 通过 + 失败))
    print("=" * 72)
    return 0 if 失败 == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
