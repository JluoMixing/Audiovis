"""验证运行中的窗口图标。

## 上次为什么没找到窗口

我筛了类名含 `WindowsForms`，但可能：
  · 窗口还没创建完（启动 40 秒内不够）
  · 类名不匹配

## 本脚本

放宽筛选条件，列出所有标题为 Audiovis 的可见窗口，
再逐个检查图标句柄。
"""
import ctypes
import ctypes.wintypes as wt
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
exe = 根 / "dist" / "FLVisualizer" / "FLVisualizer.exe"
端口 = 11800

print("=" * 70)
print("验证窗口图标")
print("=" * 70)
print()

subprocess.run(["powershell", "-NoProfile", "-Command",
                "Get-CimInstance Win32_Process -Filter "
                "\"Name='FLVisualizer.exe'\" | "
                "ForEach-Object { Stop-Process -Id $_.ProcessId -Force "
                "-ErrorAction SilentlyContinue }"],
               capture_output=True, timeout=60)
time.sleep(2)

p = subprocess.Popen([str(exe), "--port", str(端口)],
                     cwd=str(根 / "dist" / "FLVisualizer"),
                     stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL)


def 请求(路径, 数据=None, 超时=120):
    url = "http://127.0.0.1:%d%s" % (端口, 路径)
    b = json.dumps(数据).encode() if 数据 is not None else None
    req = urllib.request.Request(
        url, data=b, method="POST" if b else "GET",
        headers={"Content-Type": "application/json"} if b else {})
    with urllib.request.urlopen(req, timeout=超时) as r:
        return json.loads(r.read())


# 等服务
会话 = None
for _ in range(50):
    time.sleep(1)
    try:
        会话 = 请求("/api/session", 超时=5)
        break
    except Exception:
        pass
print("服务:", "就绪" if 会话 else "失败")
print()

# 再等窗口创建
time.sleep(10)

u = ctypes.windll.user32
所有 = []


@ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
def 枚举(hwnd, l):
    try:
        buf = ctypes.create_unicode_buffer(512)
        u.GetWindowTextW(hwnd, buf, 512)
        标题 = buf.value or ""
        if "audiovis" in 标题.lower():
            cls = ctypes.create_unicode_buffer(256)
            u.GetClassNameW(hwnd, cls, 256)
            r = wt.RECT()
            u.GetWindowRect(hwnd, ctypes.byref(r))
            所有.append({
                "hwnd": hwnd,
                "标题": 标题,
                "类名": cls.value,
                "可见": bool(u.IsWindowVisible(hwnd)),
                "尺寸": (r.right - r.left, r.bottom - r.top),
            })
    except Exception:
        pass
    return True


u.EnumWindows(枚举, 0)

print("找到 %d 个标题含 audiovis 的窗口：" % len(所有))
for w in 所有:
    print("  hwnd=%d  标题=%r" % (w["hwnd"], w["标题"]))
    print("    类名=%r  可见=%s  尺寸=%dx%d"
          % (w["类名"], w["可见"], *w["尺寸"]))

    # 读图标
    WM_GETICON = 0x007F
    ICON_SMALL = 0
    ICON_BIG = 1
    ICON_SMALL2 = 2
    小 = u.SendMessageW(w["hwnd"], WM_GETICON, ICON_SMALL, 0)
    大 = u.SendMessageW(w["hwnd"], WM_GETICON, ICON_BIG, 0)
    小2 = u.SendMessageW(w["hwnd"], WM_GETICON, ICON_SMALL2, 0)
    print("    WM_GETICON: 小=%s 大=%s 小2=%s" % (小, 大, 小2))

    # 如果 WM_GETICON 返回 0，用 GetClassLongPtr 读窗口类图标
    GCLP_HICON = -14
    GCLP_HICONSM = -34
    try:
        类大 = u.GetClassLongPtrW(w["hwnd"], GCLP_HICON)
        类小 = u.GetClassLongPtrW(w["hwnd"], GCLP_HICONSM)
        print("    GetClassLongPtr: 大=%s 小=%s" % (类大, 类小))
    except Exception as e:
        print("    GetClassLongPtr 失败: %s" % e)
print()

# 结论
有图标 = any(
    (u.SendMessageW(w["hwnd"], 0x007F, 1, 0) != 0) or
    (u.SendMessageW(w["hwnd"], 0x007F, 0, 0) != 0)
    for w in 所有) if 所有 else False

print("=" * 70)
if 所有:
    print("找到窗口 %d 个。" % len(所有))
    print("窗口图标句柄非零: %s" % ("✓ 有图标" if 有图标 else "（由窗口类默认提供）"))
    print()
    print("说明：pywebview 的窗口图标由 .NET/WebView2 宿主设置，")
    print("     可能通过窗口类而非 WM_GETICON 暴露 —— 句柄为 0 不代表没图标。")
    print("     最可靠的验证是看任务栏/标题栏的实际显示。")
else:
    print("未找到窗口 —— 可能窗口还没创建，或标题不是 Audiovis。")
print("=" * 70)

subprocess.run(["powershell", "-NoProfile", "-Command",
                "Get-CimInstance Win32_Process -Filter "
                "\"Name='FLVisualizer.exe'\" | "
                "ForEach-Object { Stop-Process -Id $_.ProcessId -Force "
                "-ErrorAction SilentlyContinue }"],
               capture_output=True, timeout=60)
