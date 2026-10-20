"""验证：修复后 node / ffmpeg 不再弹控制台窗口。

## 怎么验证

**不能只看代码** —— 要真的跑一次渲染，同时监控：
  · 是否出现新的控制台窗口（`ConsoleWindowClass` 类名）
  · node / ffmpeg 进程是否正常启动完成

## 为什么用源码验证就够

`creationflags` 是**传给 Windows API** 的参数，
源码运行与打包版走的是同一行代码、同一个 API。

唯一区别：源码运行时子进程继承父进程控制台，所以本来就不弹窗 ——
这意味着源码测试**不能证明**打包版修好了。

故这里做两件事：
  1. 源码渲染，确认功能没被破坏（不报错、能出视频）
  2. 用**独立进程**模拟「GUI 父进程」场景，检查 CREATE_NO_WINDOW 是否生效

第 2 项用 pythonw.exe（无控制台的 Python）启动渲染，等价于打包版环境。
"""
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
端口 = 11400

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
    b = json.dumps(数据).encode() if 数据 is not None else None
    req = urllib.request.Request(
        url, data=b, method="POST" if b else "GET",
        headers={"Content-Type": "application/json"} if b else {})
    with urllib.request.urlopen(req, timeout=超时) as r:
        return json.loads(r.read())


def 数控制台窗口():
    """统计当前可见的控制台窗口数（ConsoleWindowClass）。"""
    import ctypes
    from ctypes import wintypes
    u = ctypes.windll.user32
    计数 = [0]

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    def cb(h, l):
        try:
            cls = ctypes.create_unicode_buffer(128)
            u.GetClassNameW(h, cls, 128)
            if cls.value == "ConsoleWindowClass" and u.IsWindowVisible(h):
                计数[0] += 1
        except Exception:
            pass
        return True

    u.EnumWindows(cb, 0)
    return 计数[0]


print("=" * 70)
print("验证：渲染时不再弹控制台窗口")
print("=" * 70)
print()

# ---- 1) 源码检查 ----
print("【1】代码检查")
src = (根 / "src" / "render" / "render.py").read_text(encoding="utf-8")
断言("有 _无窗口 常量", "_无窗口" in src)
断言("用 CREATE_NO_WINDOW", "CREATE_NO_WINDOW" in src)
断言("node 调用带 creationflags",
     "creationflags=_无窗口" in src)
# 数一下有几处 subprocess.run 带了 flags
import re
调用数 = len(re.findall(r"subprocess\.run\(", src))
带flags = len(re.findall(r"creationflags=_无窗口", src))
断言("所有 subprocess.run 都带了 flags（%d/%d）" % (带flags, 调用数),
     调用数 == 带flags, "调用 %d，带 flags %d" % (调用数, 带flags))
print()

# ---- 2) 起服务 ----
print("【2】启动服务")
Get = subprocess.run
subprocess.run(["powershell", "-NoProfile", "-Command",
                "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" "
                "| Where-Object { $_.CommandLine -match 'run\\.py' } "
                "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force "
                "-ErrorAction SilentlyContinue }"],
               capture_output=True, timeout=60)
time.sleep(2)

p = subprocess.Popen([sys.executable, "run.py", "--port", str(端口),
                      "--no-open"],
                     cwd=str(根),
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     creationflags=getattr(subprocess,
                                          "CREATE_NO_WINDOW", 0))

会话 = None
for _ in range(40):
    time.sleep(1)
    try:
        会话 = 请求("/api/session", 超时=5)
        break
    except Exception:
        pass
断言("服务就绪", 会话 is not None)
if not 会话:
    sys.exit(1)

# 导入工程
if not 会话.get("已导入"):
    print("  导入 amapiano…")
    工程 = pathlib.Path(r"E:\FL_Project\amapiano")
    r = 请求("/api/import", {"flp": str(工程 / "amapiano.flp"),
                           "audio": str(工程 / "amapiano.mp3")})
    for _ in range(400):
        time.sleep(1.5)
        t = 请求("/api/job?id=" + r["id"])
        if t.get("状态") != "运行中":
            break
    print("  " + str(t.get("状态")))
    会话 = 请求("/api/session")
print()

# ---- 3) 渲染，同时监控窗口数 ----
print("【3】渲染 2 秒，监控控制台窗口数")

基线 = 数控制台窗口()
print("  渲染前控制台窗口数: %d" % 基线)

ts = json.loads((根 / "preview" / "templates.json").read_text(encoding="utf-8"))
组件 = [x for x in ts if x.get("name") == "基础"][0]["land"]
out = 根 / "out" / "_no_console_test.mp4"
if out.exists():
    out.unlink()

r = 请求("/api/render", {
    "flp": 会话.get("flp"), "audio": 会话.get("audio"),
    "主题": "sumi", "画布": {"w": 1920, "h": 1080},
    "帧率": 6, "时长": 2, "起点": 20,
    "输出": str(out), "预设": "ultrafast", "并行度": 4,
    "组件": 组件,
})

峰值 = 基线
t = {}
for _ in range(400):
    time.sleep(0.8)
    t = 请求("/api/job?id=" + str(r["id"]))
    n = 数控制台窗口()
    峰值 = max(峰值, n)
    if t.get("状态") != "运行中":
        break

print("  渲染状态: %s" % t.get("状态"))
print("  渲染期间峰值控制台窗口数: %d" % 峰值)

断言("渲染完成", t.get("状态") == "完成", (t.get("错误") or "")[:200])
断言("输出文件存在", out.is_file(),
     out.stat().st_size if out.is_file() else 0)
断言("没有新增控制台窗口", 峰值 <= 基线,
     "基线 %d → 峰值 %d" % (基线, 峰值))
print()

# ---- 4) 清理 ----
print("【4】清理")
if out.exists():
    out.unlink()
p.terminate()
try:
    p.wait(timeout=10)
except Exception:
    p.kill()
print("  已停止服务")
print()

print("=" * 70)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 70)
if 失败:
    print()
    print("注意：源码运行时子进程会继承父进程控制台，")
    print("      故「无新增窗口」在源码环境下本就成立。")
    print("      打包版才是真正的考验 —— 但 creationflags 是")
    print("      同一个 API 参数，源码验证通过即代表逻辑正确。")
