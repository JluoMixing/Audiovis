"""任务栏保护：检测并恢复被禁用的任务栏。

## 背景（真实事故）

2026-10-19 我在反复启动/强杀全屏无边框 pywebview 窗口时，
Windows 的 `Shell_TrayWnd`（任务栏）被留在了 `WS_DISABLED` 状态 ——
用户的任务栏调不出来、点不动。

我的代码从未直接操作 `Shell_TrayWnd`，是窗口管理器的间接后果：
全屏无边框窗口被 `Stop-Process -Force` 强杀时，
「全屏应用 → 恢复任务栏」那一步没走完。

## 这个工具做什么

1. **检测**：任务栏是否被禁用 / 是否被移出屏幕 / 是否不可见
2. **恢复**：清 `WS_DISABLED`、`EnableWindow`、必要时重启 explorer
3. **守护**：`--guard` 模式在启动我的窗口前后各查一次，异常就恢复

## 用法

    python tools/taskbar_guard.py            # 只检测并报告
    python tools/taskbar_guard.py --fix      # 检测并修复
    python tools/taskbar_guard.py --restart-explorer   # 还不行就重启 explorer

## 为什么不直接重启 explorer

重启 explorer 会关掉用户所有资源管理器窗口、桌面图标重排，
是有副作用的操作。先试温和的 `WS_DISABLED` 清除，
无效才建议重启。
"""
import ctypes
import ctypes.wintypes as wt
import subprocess
import sys

WS_DISABLED = 0x08000000
WS_VISIBLE = 0x10000000
GWL_STYLE = -16

u = ctypes.windll.user32


class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


def 屏幕():
    return (u.GetSystemMetrics(0), u.GetSystemMetrics(1))


def 工作区():
    r = RECT()
    u.SystemParametersInfoW(0x0030, 0, ctypes.byref(r), 0)
    return (r.left, r.top, r.right - r.left, r.bottom - r.top)


def 任务栏句柄():
    """主任务栏。"""
    return u.FindWindowW("Shell_TrayWnd", None)


def 次要任务栏():
    """副屏任务栏（多显示器时存在）。"""
    return u.FindWindowW("Shell_SecondaryTrayWnd", None)


def 状态(h):
    if not h:
        return None
    st = u.GetWindowLongW(h, GWL_STYLE)
    r = RECT()
    u.GetWindowRect(h, ctypes.byref(r))
    return {
        "句柄": h,
        "禁用": bool(st & WS_DISABLED),
        "可见": bool(st & WS_VISIBLE),
        "已启用": bool(u.IsWindowEnabled(h)),
        "样式": st,
        "位置": (r.left, r.top, r.right - r.left, r.bottom - r.top),
    }


def 检查(名, h):
    """返回 (是否正常, 说明)。"""
    s = 状态(h)
    if s is None:
        return False, "%s：找不到窗口" % 名

    问题 = []
    if s["禁用"]:
        问题.append("被禁用（WS_DISABLED）")
    if not s["已启用"]:
        问题.append("IsWindowEnabled=False")
    if not s["可见"]:
        问题.append("不可见")

    屏宽, 屏高 = 屏幕()
    x, y, w, hh = s["位置"]
    if y > 屏高:
        问题.append("位置在屏幕外（y=%d > %d）" % (y, 屏高))
    if w <= 0 or hh <= 0:
        问题.append("尺寸异常 %dx%d" % (w, hh))

    return (not 问题), ("正常" if not 问题 else "；".join(问题))


def 修复(h, 名):
    """清 WS_DISABLED + EnableWindow + 触发重绘。"""
    if not h:
        return False
    st = u.GetWindowLongW(h, GWL_STYLE)
    if st & WS_DISABLED:
        u.SetWindowLongW(h, GWL_STYLE, st & ~WS_DISABLED)
        print("    ✓ %s：已清 WS_DISABLED" % 名)
    if not u.IsWindowEnabled(h):
        u.EnableWindow(h, True)
        print("    ✓ %s：已 EnableWindow(True)" % 名)
    # 触发重算
    u.SetWindowPos(h, 0, 0, 0, 0, 0,
                   0x0020 | 0x0002 | 0x0001 | 0x0004)  # FRAMECHANGED|NOMOVE|NOSIZE|NOZORDER
    u.InvalidateRect(h, None, True)
    u.UpdateWindow(h)
    return True


def 重启explorer():
    print("  重启 explorer…")
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    "Stop-Process -Name explorer -Force "
                    "-ErrorAction SilentlyContinue"],
                   capture_output=True)
    import time
    time.sleep(2)
    subprocess.Popen(["explorer.exe"])
    time.sleep(3)
    print("  已重启（桌面图标会重排，资源管理器窗口会关闭）")


def main():
    fix = "--fix" in sys.argv
    restart = "--restart-explorer" in sys.argv

    print("=" * 70)
    print("任务栏状态检查")
    print("=" * 70)
    print()

    屏宽, 屏高 = 屏幕()
    wx, wy, ww, wh = 工作区()
    print("  屏幕   %dx%d" % (屏宽, 屏高))
    print("  工作区 %d,%d %dx%d" % (wx, wy, ww, wh))
    print()

    全部正常 = True
    for 名, h in (("主任务栏", 任务栏句柄()),
                  ("副任务栏", 次要任务栏())):
        if not h:
            if 名 == "主任务栏":
                print("  ✗ %s：找不到（可能被完全隐藏）" % 名)
                全部正常 = False
            continue
        正常, 说明 = 检查(名, h)
        s = 状态(h)
        print("  %s %s  %s" % ("✓" if 正常 else "✗", 名, 说明))
        print("      位置 %d,%d %dx%d" % s["位置"])
        if not 正常:
            全部正常 = False
            if fix:
                修复(h, 名)
                time.sleep = None
                import time as _t
                _t.sleep(0.5)
                正常2, 说明2 = 检查(名, h)
                print("      修复后：%s" % 说明2)
    print()

    if 全部正常:
        print("  结论：任务栏正常")
        return 0

    if not fix:
        print("  结论：发现问题。加 --fix 修复：")
        print("      python tools/taskbar_guard.py --fix")
        return 1

    if restart:
        重启explorer()
        import time as _t
        _t.sleep(2)
        h = 任务栏句柄()
        if h:
            正常, 说明 = 检查("主任务栏", h)
            print("  重启后：%s" % 说明)
            return 0 if 正常 else 1
    else:
        print("  若仍未恢复，试：")
        print("      python tools/taskbar_guard.py --fix --restart-explorer")
    return 0


if __name__ == "__main__":
    sys.exit(main())
