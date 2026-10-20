"""直接查窗口状态，不截图（截图受 SetWindowRgn 干扰）。"""
import ctypes
import ctypes.wintypes as wt
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

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
time.sleep(10)

u = ctypes.windll.user32
g = ctypes.windll.gdi32

print()
print("=== 窗口状态 ===")
r = wt.RECT()
u.GetWindowRect(hwnd, ctypes.byref(r))
print("  GetWindowRect: %d,%d %dx%d" % (r.left, r.top,
                                       r.right - r.left, r.bottom - r.top))

# 查可见区
rgn = g.CreateRectRgn(0, 0, 0, 0)
ret = u.GetWindowRgn(hwnd, rgn)
if ret:
    rr = wt.RECT()
    g.GetRgnBox(rgn, ctypes.byref(rr))
    print("  可见区: %d,%d %dx%d" % (rr.left, rr.top,
                                    rr.right - rr.left, rr.bottom - rr.top))
    g.DeleteObject(rgn)
else:
    print("  无可见区限制（整窗可见）")

print("  是否最大化:", bool(u.IsZoomed(hwnd)))
print("  样式: 0x%08X" % u.GetWindowLongW(hwnd, -16))

# 查客户区
cr = wt.RECT()
u.GetClientRect(hwnd, ctypes.byref(cr))
print("  客户区尺寸: %dx%d" % (cr.right - cr.left, cr.bottom - cr.top))

# 屏幕分辨率
print("  屏幕: %dx%d" % (u.GetSystemMetrics(0), u.GetSystemMetrics(1)))

# 用 PrintWindow 抓（不受 SetWindowRgn 影响）
class BIH(ctypes.Structure):
    _fields_ = [
        ("biSize", wt.DWORD), ("biWidth", wt.LONG),
        ("biHeight", wt.LONG), ("biPlanes", wt.WORD),
        ("biBitCount", wt.WORD), ("biCompression", wt.DWORD),
        ("biSizeImage", wt.DWORD), ("biXPelsPerMeter", wt.LONG),
        ("biYPelsPerMeter", wt.LONG), ("biClrUsed", wt.DWORD),
        ("biClrImportant", wt.DWORD),
    ]

w, h = r.right - r.left, r.bottom - r.top
hdc = u.GetWindowDC(hwnd)
mem = g.CreateCompatibleDC(hdc)
bmp = g.CreateCompatibleBitmap(hdc, w, h)
g.SelectObject(mem, bmp)
# PW_RENDERFULLCONTENT = 2
ok = u.PrintWindow(hwnd, mem, 2)
print()
print("  PrintWindow:", bool(ok))

bi = BIH()
bi.biSize = ctypes.sizeof(BIH)
bi.biWidth = w
bi.biHeight = -h
bi.biPlanes = 1
bi.biBitCount = 32
buf = ctypes.create_string_buffer(w * h * 4)
g.GetDIBits(mem, bmp, 0, h, buf, ctypes.byref(bi), 0)
g.DeleteObject(bmp)
g.DeleteDC(mem)
u.ReleaseDC(hwnd, hdc)

from PIL import Image
import numpy as np
img = Image.frombuffer("RGBA", (w, h), buf, "raw", "BGRA", 0, 1).convert("RGB")
out = 根 / "out" / "printwindow.png"
img.save(out)
a = np.asarray(img).astype(float)
print("  截图:", out)
print("  平均亮度: %.1f  标准差: %.1f" % (a.mean(), a.std()))

# 逐行亮度（看顶部是否还有浅色标题栏）
行亮度 = a.mean(axis=(1, 2))
print()
print("  顶部 40 行亮度：")
for y in range(0, min(40, h)):
    print("    y=%-3d %6.1f" % (y, 行亮度[y]))

# 关掉
try:
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
