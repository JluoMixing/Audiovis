"""pywebview 无边框窗口宿主。

## 职责

只做三件事：创建窗口、执行窗口命令、优雅关闭。
不含任何「本机特定」的假设。

## 鲁棒性设计（换机器不能坏）

### 1. 屏幕尺寸与任务栏位置

**不用** `GetSystemMetrics(0/1)`（那是整屏，且只给主屏）。
用 `MonitorFromWindow` + `GetMonitorInfo` 取**窗口所在显示器的工作区**，
自动避开任务栏（无论它在底部/顶部/左侧/右侧、自动隐藏还是常显）。

### 2. 多显示器

按「窗口将要出现在哪个显示器」算，而不是假设主屏。
启动时先取鼠标所在显示器（用户的注意力在那里），
找不到就退回主显示器。

### 3. DPI 缩放

Windows 有两套坐标：
  · **physical pixels** — Win32 API（GetWindowRect / SetWindowPos）
  · **logical pixels** — pywebview 的 width/height/x/y

在 125% / 150% 缩放下两者不等。pywebview 内部按 logical 处理，
而 Win32 要 physical。**混用会导致窗口尺寸差 25%~50%。**

本模块统一在 physical 层工作（Win32 更底层、更可靠），
只在传给 pywebview 时按该显示器的 DPI 换算成 logical。

### 4. 最小尺寸

小屏笔记本（1366×768、1280×720）放不下 900×600 的固定最小值。
改为 `min(预设, 工作区 * 0.6)`，保证任何屏幕都能开。

### 5. 还原尺寸

不依赖 pywebview 的「还原」，也不依赖我们自己记的尺寸 ——
`ShowWindow(SW_RESTORE)` 由系统记住「最大化前的矩形」，
这是 Windows 的标准行为，比我们猜更可靠。

## 平台

仅 Windows（用 Win32）。其它平台退回 pywebview 的默认行为。
"""
import ctypes
import ctypes.wintypes as wt
import sys
import threading
import time

# ---------------------------------------------------------------- 常量

SW_MINIMIZE = 6
SW_MAXIMIZE = 3
SW_RESTORE = 9

SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010
SWP_FRAMECHANGED = 0x0020
SWP_SHOWWINDOW = 0x0040

MONITOR_DEFAULTTONEAREST = 2
MONITOR_DEFAULTTOPRIMARY = 1

_窗口 = None
_锁 = threading.Lock()


def 可用():
    """pywebview 是否可用。"""
    try:
        import webview  # noqa: F401
        return True
    except Exception:
        return False


def 取窗口():
    """拿当前窗口对象（供 /api/window 使用）。"""
    with _锁:
        return _窗口


# ================================================================ 显示器与 DPI

class _RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


class _MONITORINFO(ctypes.Structure):
    _fields_ = [("cbSize", wt.DWORD),
                ("rcMonitor", _RECT),
                ("rcWork", _RECT),
                ("dwFlags", wt.DWORD)]


def _user32():
    return ctypes.windll.user32


def _显示器信息(显示器句柄):
    """取某显示器的工作区（去掉任务栏）。返回 (x, y, 宽, 高, dpi)。

    失败返回 None。
    """
    if not 显示器句柄:
        return None
    u = _user32()
    try:
        mi = _MONITORINFO()
        mi.cbSize = ctypes.sizeof(_MONITORINFO)
        if not u.GetMonitorInfoW(显示器句柄, ctypes.byref(mi)):
            return None
        r = mi.rcWork          # 工作区：已排除任务栏
        宽 = r.right - r.left
        高 = r.bottom - r.top
        if 宽 <= 0 or 高 <= 0:
            return None
        return (r.left, r.top, 宽, 高, _显示器DPI(显示器句柄))
    except Exception:
        return None


def _显示器DPI(显示器句柄):
    """该显示器的 DPI（96 = 100%）。

    ## 重要：多路探测，因为单一 API 会骗人

    `shcore.GetDpiForMonitor` 在**进程未声明 DPI 感知**时返回 96
    （系统默认），而实际可能是 120/144/192。实测本机：
    页面 `devicePixelRatio = 1.25`，但该 API 返回 96。

    故按可靠性顺序尝试：
      1. `GetDpiForWindow`（Win10 1607+，返回窗口实际 DPI）
      2. `shcore.GetDpiForMonitor`
      3. 注册表 `LogPixels`（系统级缩放）
      4. 96 兜底

    ## 注意

    这个值**只用于诊断与自检**。实际摆位全部走 Win32 physical 坐标，
    不需要换算 —— 见 `启动窗口()` 的说明。
    """
    # 1) GetDpiForWindow
    try:
        h = _枚举本窗口("Audiovis")
        if h:
            dpi = ctypes.windll.user32.GetDpiForWindow(h)
            if dpi and dpi > 0:
                return int(dpi)
    except Exception:
        pass

    # 2) GetDpiForMonitor
    try:
        shcore = ctypes.windll.shcore
        x, y = wt.UINT(), wt.UINT()
        if shcore.GetDpiForMonitor(显示器句柄, 0, ctypes.byref(x),
                                   ctypes.byref(y)) == 0:
            if x.value > 0:
                return int(x.value)
    except Exception:
        pass

    # 3) 注册表 LogPixels（96/120/144/192）
    try:
        import winreg
        with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Control Panel\Desktop") as k:
            v, _ = winreg.QueryValueEx(k, "LogPixels")
            if v and 96 <= v <= 480:
                return int(v)
    except Exception:
        pass

    return 96


def _鼠标所在显示器():
    """鼠标指针所在显示器（用户的注意力在那儿）。"""
    u = _user32()
    try:
        pt = wt.POINT()
        if not u.GetCursorPos(ctypes.byref(pt)):
            return 0
        return u.MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST)
    except Exception:
        return 0


def _主显示器():
    u = _user32()
    try:
        return u.MonitorFromPoint(wt.POINT(0, 0), MONITOR_DEFAULTTOPRIMARY)
    except Exception:
        return 0


def 目标工作区():
    """算出窗口该用哪个工作区。

    优先「鼠标所在显示器」，退回主显示器，再退回 SPI_GETWORKAREA。

    返回 dict：
        x, y        物理像素坐标
        w, h        物理像素尺寸
        dpi         该显示器 DPI
        scale       dpi / 96
    """
    for 取 in (_鼠标所在显示器, _主显示器):
        info = _显示器信息(取())
        if info:
            x, y, w, h, dpi = info
            return {"x": x, "y": y, "w": w, "h": h,
                    "dpi": dpi, "scale": dpi / 96.0}

    # 最后兜底：SPI_GETWORKAREA
    u = _user32()
    try:
        r = _RECT()
        u.SystemParametersInfoW(0x0030, 0, ctypes.byref(r), 0)
        w = r.right - r.left
        h = r.bottom - r.top
        if w > 0 and h > 0:
            return {"x": r.left, "y": r.top, "w": w, "h": h,
                    "dpi": 96, "scale": 1.0}
    except Exception:
        pass

    # 绝对兜底
    return {"x": 0, "y": 0,
            "w": max(800, u.GetSystemMetrics(0)),
            "h": max(600, u.GetSystemMetrics(1)),
            "dpi": 96, "scale": 1.0}


# ================================================================ 窗口句柄

def _枚举本窗口(标题, 只要最大=True):
    """枚举标题匹配、类名像 pywebview 主窗口的句柄。

    **必须过滤尺寸与位置** —— 系统里还有隐藏的辅助窗口
    （实测有 `-25600,-25600 159x27` 这种），只按标题会抓错。
    """
    u = _user32()
    屏宽 = u.GetSystemMetrics(0)
    屏高 = u.GetSystemMetrics(1)
    候选 = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def cb(hwnd, _l):
        try:
            buf = ctypes.create_unicode_buffer(256)
            u.GetWindowTextW(hwnd, buf, 256)
            if buf.value != 标题:
                return True
            if not u.IsWindowVisible(hwnd):
                return True
            cls = ctypes.create_unicode_buffer(256)
            u.GetClassNameW(hwnd, cls, 256)
            if "WindowsForms" not in cls.value:
                return True
            r = _RECT()
            u.GetWindowRect(hwnd, ctypes.byref(r))
            w = r.right - r.left
            h = r.bottom - r.top
            if w < 200 or h < 150:
                return True            # 太小，不是主窗口
            if r.left < -1000 or r.top < -1000:
                return True            # 屏幕外（隐藏窗口特征）
            if r.left > 屏宽 or r.top > 屏高:
                return True
            候选.append((hwnd, w, h))
        except Exception:
            pass
        return True

    u.EnumWindows(cb, 0)
    if not 候选:
        return 0
    if 只要最大:
        候选.sort(key=lambda x: x[1] * x[2], reverse=True)
    return 候选[0][0]


def 窗口句柄(标题="Audiovis", 超时=4.0):
    """拿主窗口句柄（带轮询，因为窗口可能还没创建）。"""
    if sys.platform != "win32":
        return 0
    截止 = time.time() + 超时
    while time.time() < 截止:
        h = _枚举本窗口(标题)
        if h:
            return h
        time.sleep(0.2)
    return 0


# ================================================================ 窗口命令

def 是否最大化(标题="Audiovis"):
    """窗口当前是否最大化。

    pywebview 的 Window 没有可靠的最大化查询：
      · Window.state 是通用 dict，不是窗口状态
      · Window.maximized 是构造参数，调用 maximize() 后不更新
    故问 Win32。
    """
    if sys.platform != "win32":
        return False
    h = 窗口句柄(标题)
    if not h:
        return False
    try:
        return bool(_user32().IsZoomed(h))
    except Exception:
        return False


def 窗口矩形(标题="Audiovis"):
    """窗口当前矩形（物理像素）。取不到返回 None。"""
    if sys.platform != "win32":
        return None
    h = 窗口句柄(标题)
    if not h:
        return None
    try:
        r = _RECT()
        _user32().GetWindowRect(h, ctypes.byref(r))
        return {"x": r.left, "y": r.top,
                "w": r.right - r.left, "h": r.bottom - r.top}
    except Exception:
        return None


def 执行命令(命令, 标题="Audiovis"):
    """执行窗口命令。返回 True 表示成功。

    命令：minimize / maximize / restore / toggle / close / state

    ## 为什么用 Win32 而不是 pywebview 的方法

    pywebview 的 minimize/maximize/restore 最终也是调 Win32，
    但它的状态跟踪不可靠（见 是否最大化 的说明）。
    直接用 Win32 更可控，且能保证 toggle 的判断与实际一致。

    ## 还原为什么用 SW_RESTORE

    `ShowWindow(SW_RESTORE)` 由**系统**记住「最大化之前的矩形」，
    比我们自己记尺寸可靠 —— 用户手动拖过窗口后也能正确还原。
    """
    if 命令 == "close":
        窗 = 取窗口()
        if 窗 is None:
            return False
        try:
            窗.destroy()
            return True
        except Exception:
            return False

    if 命令 == "state":
        return 是否最大化(标题)

    if 命令 == "drag":
        # easy_drag=False 时拖动由 drag region（标题栏的
        # .pywebview-drag-region 类）处理，服务端无需干预
        return True

    if sys.platform != "win32":
        # 非 Windows：退回 pywebview 的方法
        窗 = 取窗口()
        if 窗 is None:
            return False
        try:
            {"minimize": 窗.minimize, "maximize": 窗.maximize,
             "restore": 窗.restore}.get(命令, lambda: None)()
            return True
        except Exception:
            return False

    h = 窗口句柄(标题)
    if not h:
        return False

    u = _user32()
    try:
        if 命令 == "minimize":
            u.ShowWindow(h, SW_MINIMIZE)
        elif 命令 == "maximize":
            u.ShowWindow(h, SW_MAXIMIZE)
        elif 命令 == "restore":
            u.ShowWindow(h, SW_RESTORE)
        elif 命令 == "toggle":
            u.ShowWindow(h, SW_RESTORE if u.IsZoomed(h) else SW_MAXIMIZE)
        else:
            return False
        return True
    except Exception:
        return False


# ================================================================ 启动

def _摆位(标题, 目标, 最大化, 超时=15.0):
    """等窗口创建后摆到目标工作区，并按需最大化。

    ## 为什么不用 pywebview 的 maximized=True

    实测在 1536×864 屏上，传 width=1600/height=1000 + maximized=True
    会得到「1920×1080 @ 96,96」——超出屏幕且偏移。
    显式摆位更可靠。
    """
    if sys.platform != "win32":
        return False

    u = _user32()
    x, y, w, h = 目标["x"], 目标["y"], 目标["w"], 目标["h"]

    截止 = time.time() + 超时
    while time.time() < 截止:
        hwnd = _枚举本窗口(标题)
        if hwnd:
            try:
                if 最大化:
                    # 先摆成工作区大小（这样 SW_RESTORE 时回到这个尺寸），
                    # 再最大化
                    u.SetWindowPos(hwnd, 0, x, y, w, h,
                                   SWP_NOZORDER | SWP_NOACTIVATE |
                                   SWP_SHOWWINDOW)
                    time.sleep(0.2)
                    u.ShowWindow(hwnd, SW_MAXIMIZE)
                else:
                    u.SetWindowPos(hwnd, 0, x, y, w, h,
                                   SWP_NOZORDER | SWP_NOACTIVATE |
                                   SWP_SHOWWINDOW)
                return True
            except Exception:
                return False
        time.sleep(0.25)
    return False


def 计算最小尺寸(目标):
    """最小窗口尺寸，保证小屏也能开。

    固定 900×600 在 1366×768 上还剩 466px 给内容，
    但在 1280×720 或更小的虚拟机上会挤。故按工作区比例收缩。
    """
    预设宽, 预设高 = 900, 600
    # 不超过工作区的 60%
    上限宽 = int(目标["w"] * 0.6)
    上限高 = int(目标["h"] * 0.6)
    return (min(预设宽, max(480, 上限宽)),
            min(预设高, max(360, 上限高)))


def 启动窗口(端口, 标题="Audiovis", 最大化=True):
    """创建并运行 pywebview 窗口。**阻塞**，直到窗口关闭。

    参数：
        端口    本地 HTTP 服务端口
        标题    窗口标题（也用于后续按标题找句柄）
        最大化  是否启动即最大化

    尺寸与位置全部按**目标显示器的工作区**计算，不写死任何像素值。
    """
    global _窗口
    import webview

    地址 = "http://127.0.0.1:%d/" % 端口
    目标 = 目标工作区()

    # ## 关键：不用 pywebview 的 width/height/x/y
    #
    # pywebview 的尺寸是 **logical pixels**，而 Win32 是 **physical**。
    # 在 125% 缩放下两者差 25%，混用会让窗口尺寸算错。
    #
    # 更麻烦的是：进程未声明 DPI 感知时，`GetDpiForMonitor` 会返回
    # 96（假的），实测本机 devicePixelRatio=1.25 却报 96。
    #
    # 故**完全绕开**：创建时给一个安全的默认尺寸，随后全部用
    # Win32 `SetWindowPos`（physical）摆位。Win32 不受 DPI 虚拟化影响。
    安全宽 = max(800, min(1400, 目标["w"]))
    安全高 = max(600, min(900, 目标["h"]))

    with _锁:
        _窗口 = webview.create_window(
            标题,
            地址,
            width=安全宽,
            height=安全高,
            frameless=True,          # 真无边框
            # easy_drag=True 是「任意点可拖」，会让画布拖拽不可用。
            # 改用 drag region（标题栏的 .pywebview-drag-region 类）。
            easy_drag=False,
            maximized=False,         # 自己摆位（pywebview 的不可靠）
            resizable=True,
            min_size=(600, 400),     # 交给 Win32 摆位，这里只防极端
            background_color="#0d0e11",
            text_select=False,
            confirm_close=False,
        )

    threading.Thread(target=_摆位,
                     args=(标题, 目标, 最大化), daemon=True).start()

    try:
        webview.start(gui=None, debug=False)
    finally:
        with _锁:
            _窗口 = None
    return True


def 请求关闭():
    """请窗口自己关闭（优雅退出）。

    比 `Stop-Process -Force` 安全 —— 后者强杀会让 Windows
    来不及恢复任务栏状态（真实发生过）。
    """
    窗 = 取窗口()
    if 窗 is None:
        return False
    try:
        窗.destroy()
        return True
    except Exception:
        return False


def 环境摘要():
    """当前显示器与 DPI 情况（自检用）。"""
    目标 = 目标工作区()
    return {
        "平台": sys.platform,
        "pywebview": 可用(),
        "目标工作区": {"x": 目标["x"], "y": 目标["y"],
                       "w": 目标["w"], "h": 目标["h"]},
        "DPI": 目标["dpi"],
        "缩放": "%.0f%%" % (目标["scale"] * 100),
        "最小尺寸": 计算最小尺寸(目标),
    }


if __name__ == "__main__":
    import json
    print(json.dumps(环境摘要(), ensure_ascii=False, indent=1))
