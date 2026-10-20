"""端到端测试打包后的 exe。

## 测什么

不是「能启动」就算完，而是走完真实使用链路：
  1. 启动 exe，等到服务就绪
  2. 页面能取到、标题正确
  3. 导入真实工程（FLP + 音频，走 Python 解析 + 音频分析）
  4. 提交渲染（走 node + headless 浏览器 + ffmpeg 编码）
  5. 核验产出的 mp4 存在、有大小、可解码

第 4 步是打包的关键考验：它同时依赖
  · bundles/node.exe（我们打进去的）
  · imageio_ffmpeg 的 ffmpeg（hook 收集的）
  · 系统里的 Edge（外部依赖）
任一环节缺失都会在这里暴露。

## 用法

    python tools/test_exe_e2e.py [--exe=<路径>]
"""
import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

根 = pathlib.Path(__file__).resolve().parent.parent
# 用命名参数而不是位置参数：跑批工具靠「有没有 sys.argv[1]」
# 判断该不该传端口，位置参数会被误当成端口。
EXE = 根 / "dist" / "FLVisualizer" / "FLVisualizer.exe"
for _a in sys.argv[1:]:
    if _a.startswith("--exe="):
        EXE = pathlib.Path(_a.split("=", 1)[1])

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


def 请求(端口, 路径, 数据=None, 超时=120):
    url = "http://127.0.0.1:%d%s" % (端口, 路径)
    body = json.dumps(数据).encode("utf-8") if 数据 is not None else None
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json"} if body else {},
        method="POST" if body else "GET")
    with urllib.request.urlopen(req, timeout=超时) as r:
        return json.loads(r.read().decode("utf-8"))


def 找端口(pid, 超时=60):
    """从进程的监听端口里找出服务端口。"""
    for _ in range(超时):
        try:
            ps = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 "(Get-NetTCPConnection -State Listen -ErrorAction "
                 "SilentlyContinue | Where-Object { $_.OwningProcess -eq %d } "
                 "| Select-Object -First 1).LocalPort" % pid],
                capture_output=True, text=True, timeout=30)
            t = (ps.stdout or "").strip()
            if t.isdigit():
                return int(t)
        except Exception:
            pass
        time.sleep(1)
    return None


def main():
    print("=" * 72)
    print("打包版端到端测试")
    print("=" * 72)
    print()
    print("  exe: %s" % EXE)
    if not EXE.is_file():
        print("  ✗ exe 不存在")
        return 1
    print("  大小: %.1f MB" % (EXE.stat().st_size / 1e6))
    print()

    # 先杀掉可能残留的实例
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    "Get-Process FLVisualizer -ErrorAction SilentlyContinue "
                    "| Stop-Process -Force"], capture_output=True)
    time.sleep(2)

    print("【1】启动 exe")
    p = subprocess.Popen([str(EXE)], cwd=str(EXE.parent),
                         stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL)
    print("  PID %d" % p.pid)

    端口 = 找端口(p.pid)
    断言("服务开始监听", 端口 is not None, 端口)
    if not 端口:
        p.kill()
        return 1
    print("  端口 %d" % 端口)
    print()

    print("【2】页面与服务")
    try:
        with urllib.request.urlopen(
                "http://127.0.0.1:%d/" % 端口, timeout=60) as r:
            html = r.read().decode("utf-8", "replace")
        断言("页面可取", len(html) > 1e6, "%d 字节" % len(html))
        断言("标题正确", "<title>FL Visualizer</title>" in html)
        断言("含工程状态注入", "window.__PROJECT__" in html or
             "__APP_MODE__" in html)
    except Exception as e:
        断言("页面可取", False, e)

    try:
        s = 请求(端口, "/api/session")
        断言("session 接口可用", isinstance(s, dict), s)
    except Exception as e:
        断言("session 接口可用", False, e)

    try:
        st = 请求(端口, "/api/settings")
        断言("settings 接口可用", "设置" in st, list(st)[:5])
    except Exception as e:
        断言("settings 接口可用", False, e)
    print()

    print("【3】导入真实工程")
    if not FLP.is_file() or not AUDIO.is_file():
        断言("测试工程存在", False, "%s / %s" % (FLP, AUDIO))
    else:
        try:
            r = 请求(端口, "/api/import", {"flp": str(FLP),
                                          "audio": str(AUDIO)})
            任务 = r.get("id")
            断言("导入任务已受理", bool(任务), r)
            for _ in range(200):
                time.sleep(1.5)
                t = 请求(端口, "/api/job?id=" + str(任务))
                if t.get("状态") != "运行中":
                    break
            断言("导入完成", t.get("状态") == "完成",
                 t.get("错误") or t.get("状态"))
        except Exception as e:
            断言("导入完成", False, e)
    print()

    print("【4】导出视频（node + 浏览器 + ffmpeg）")
    输出 = 根 / "out" / "exe_e2e.mp4"
    if 输出.exists():
        输出.unlink()

    # 渲染接口要求显式带上 flp/audio（前端是从 window.__PROJECT__ 取的）。
    # 这里从 /api/session 拿同样的信息，模拟真实前端行为。
    try:
        会话 = 请求(端口, "/api/session")
        当前flp = 会话.get("flp")
        当前audio = 会话.get("audio")
        断言("session 里有 flp/audio",
             bool(当前flp) and bool(当前audio),
             "flp=%s audio=%s" % (当前flp, 当前audio))
    except Exception as e:
        当前flp = 当前audio = None
        断言("session 里有 flp/audio", False, e)

    try:
        r = 请求(端口, "/api/render", {
            "flp": 当前flp,
            "audio": 当前audio,
            "输出": str(输出),
            "时长": 4,
            "起点": 0,
            "宽": 854, "高": 480,
            "帧率": 24,
            "并行": 2,
            "布局": {"组件": [
                {"id": "playlist", "x": 40, "y": 40, "w": 774, "h": 180},
                {"id": "text", "x": 40, "y": 260, "w": 400, "h": 60,
                 "样式": {"内容": "{title}", "字号": 30}},
            ]},
        }, 超时=120)
        任务 = r.get("id")
        断言("渲染任务已受理", bool(任务), r)
        最后 = {}
        for i in range(400):
            time.sleep(2)
            最后 = 请求(端口, "/api/job?id=" + str(任务))
            if 最后.get("状态") != "运行中":
                break
        断言("渲染完成", 最后.get("状态") == "完成",
             (最后.get("错误") or 最后.get("状态") or "")[:300])
    except Exception as e:
        断言("渲染完成", False, e)
    print()

    print("【5】核验产物")
    if 输出.is_file():
        sz = 输出.stat().st_size
        断言("mp4 已生成", sz > 10000, "%d 字节" % sz)
        # 用 ffprobe 风格：靠 ffmpeg 读一下是否可解码
        try:
            import imageio_ffmpeg
            ff = imageio_ffmpeg.get_ffmpeg_exe()
            pr = subprocess.run(
                [ff, "-v", "error", "-i", str(输出), "-f", "null", "-"],
                capture_output=True, timeout=180)
            断言("mp4 可解码", pr.returncode == 0,
                 (pr.stderr or b"").decode("utf-8", "replace")[-200:])
            时长 = 0.0
            for line in (pr.stderr or b"").decode("utf-8", "replace").split("\n"):
                pass
            断言("文件大小合理（>50KB）", sz > 50000, sz)
        except Exception as e:
            断言("mp4 可解码", False, e)
    else:
        断言("mp4 已生成", False, "文件不存在")
    print()

    # 收尾
    p.terminate()
    try:
        p.wait(timeout=10)
    except Exception:
        p.kill()

    print("=" * 72)
    print("通过 %d / %d" % (通过, 通过 + 失败))
    print("=" * 72)
    return 0 if 失败 == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
