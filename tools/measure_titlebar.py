"""验证：能否把 Edge --app 的自绘标题栏「顶出」窗口。

## 现象

`--app` 窗口顶部有一条 Edge 自己画的标题栏（浅灰蓝 + 标题 + 图标）。
它不是 Win32 的 WS_CAPTION（那个早就没了），所以清样式去不掉。

## 思路

Edge 的标题栏高度是固定的（约 40px）。若把**窗口客户区**整体上移
40px（即窗口位置 y - 40，高度 + 40），页面内容就会盖住那条标题栏？

不行 —— 客户区由 Edge 自己布局，改窗口位置只是移动整个窗口。

## 真正可行的思路

用 `SetWindowRgn` 设置窗口可见区域，把顶部 40px 裁掉。
窗口整体视觉上就少了那条标题栏，而页面内容仍从客户区顶部开始。

副作用：页面顶部会被裁掉 40px（但我们的自绘标题栏也在顶部，
正好用它填补 —— 自绘标题栏高 34px，接近 Edge 的 40px）。

## 先测：Edge 标题栏实际多高

用页面里 JS 的 innerHeight vs 窗口高度算不出来（那是客户区）。
改为截图测量：找那条浅灰蓝横条的高度。
"""
import ctypes
import ctypes.wintypes as wt
import pathlib
import subprocess
import sys
import time

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
sys.path.insert(0, str(根))


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


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wt.DWORD), ("biWidth", wt.LONG),
        ("biHeight", wt.LONG), ("biPlanes", wt.WORD),
        ("biBitCount", wt.WORD), ("biCompression", wt.DWORD),
        ("biSizeImage", wt.DWORD), ("biXPelsPerMeter", wt.LONG),
        ("biYPelsPerMeter", wt.LONG), ("biClrUsed", wt.DWORD),
        ("biClrImportant", wt.DWORD),
    ]


def 抓屏(x, y, w, h):
    u = ctypes.windll.user32
    g = ctypes.windll.gdi32
    hdc = u.GetDC(0)
    mem = g.CreateCompatibleDC(hdc)
    bmp = g.CreateCompatibleBitmap(hdc, w, h)
    g.SelectObject(mem, bmp)
    g.BitBlt(mem, 0, 0, w, h, hdc, x, y, 0x00CC0020)
    bi = BITMAPINFOHEADER()
    bi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bi.biWidth = w
    bi.biHeight = -h
    bi.biPlanes = 1
    bi.biBitCount = 32
    bi.biCompression = 0
    buf = ctypes.create_string_buffer(w * h * 4)
    g.GetDIBits(mem, bmp, 0, h, buf, ctypes.byref(bi), 0)
    g.DeleteObject(bmp)
    g.DeleteDC(mem)
    u.ReleaseDC(0, hdc)
    from PIL import Image
    return Image.frombuffer("RGBA", (w, h), buf, "raw", "BGRA", 0, 1).convert("RGB")


subprocess.run(["powershell", "-NoProfile", "-Command",
                "Get-Process msedge -ErrorAction SilentlyContinue "
                "| Where-Object { $_.MainWindowTitle -like '*Audiovis*' } "
                "| Stop-Process -Force"], capture_output=True)
time.sleep(2)

print("启动…")
p = subprocess.Popen([sys.executable, "run.py", "--port", "0"],
                     cwd=str(根), stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL)
端口 = 找端口(p.pid)

from src import window as 窗
hwnd = 窗.找窗口("Audiovis", 超时=40)
print("hwnd:", hwnd)
time.sleep(9)

u = ctypes.windll.user32
u.SetForegroundWindow(hwnd)
time.sleep(1.5)

r = wt.RECT()
u.GetWindowRect(hwnd, ctypes.byref(r))
w, h = r.right - r.left, r.bottom - r.top
print("窗口: %d,%d %dx%d" % (r.left, r.top, w, h))

img = 抓屏(r.left, r.top, w, h)
out = 根 / "out" / "edge_titlebar.png"
img.save(out)
print("截图:", out)

# 逐行分析：找顶部那条浅色横条有多高
import numpy as np
a = np.asarray(img).astype(float)
行亮度 = a.mean(axis=(1, 2))
print()
print("=== 顶部 60 行亮度（找标题栏边界）===")
for y in range(0, min(60, h)):
    print("  y=%-3d 亮度=%6.1f" % (y, 行亮度[y]))

# 标题栏通常是亮色（浅灰蓝），页面是深色
阈值 = 100
边界 = None
for y in range(min(80, h)):
    if 行亮度[y] < 阈值:
        边界 = y
        break
print()
print("  浅色区域结束于 y = %s" % 边界)

# 关掉
try:
    import json
    import urllib.request
    req = urllib.request.Request(
        "http://127.0.0.1:%d/api/window" % 端口,
        data=json.dumps({"动作": "close"}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    urllib.request.urlopen(req, timeout=30).read()
except Exception:
    pass
time.sleep(1.5)
p.terminate()
try:
    p.wait(timeout=8)
except Exception:
    p.kill()
