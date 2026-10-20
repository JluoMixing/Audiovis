"""带任务栏保护的启动器。

## 为什么需要

2026-10-19 反复启动/强杀全屏无边框窗口后，Windows 的任务栏被留在
`WS_DISABLED` 状态（调不出来、点不动）。根因是全屏窗口被强杀时
「恢复任务栏」那一步没走完。

## 这个启动器做什么

1. 启动前检查任务栏，异常先恢复
2. 启动应用
3. 退出时**优雅关闭**（请窗口自己 destroy），等 2 秒再考虑强杀
4. 退出后再查一次任务栏，异常就恢复

## 用法

    python tools/run_app.py              # 正常启动
    python tools/run_app.py --port 19000
"""
import pathlib
import subprocess
import sys
import time

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))
sys.path.insert(0, str(根 / "tools"))


def 查任务栏(修复=False):
    """返回 True 表示正常。"""
    import taskbar_guard as 守
    h = 守.任务栏句柄()
    if not h:
        print("  ✗ 找不到任务栏窗口")
        return False
    正常, 说明 = 守.检查("主任务栏", h)
    if not 正常:
        print("  ✗ 任务栏异常：%s" % 说明)
        if 修复:
            守.修复(h, "主任务栏")
            time.sleep(0.5)
            正常2, 说明2 = 守.检查("主任务栏", h)
            print("  修复后：%s" % 说明2)
            return 正常2
    else:
        print("  ✓ 任务栏正常")
    return 正常


def main():
    参数 = [a for a in sys.argv[1:] if a.startswith("--port")]
    端口 = "0"
    for a in 参数:
        端口 = a.split("=")[1] if "=" in a else "0"

    print("=" * 66)
    print("  Audiovis 启动器（带任务栏保护）")
    print("=" * 66)
    print()
    print("启动前检查：")
    查任务栏(修复=True)
    print()

    命令 = [sys.executable, str(根 / "run.py"), "--port", 端口]
    print("启动：%s" % " ".join(命令[1:]))
    进程 = subprocess.Popen(命令, cwd=str(根))

    try:
        进程.wait()
    except KeyboardInterrupt:
        print()
        print("收到 Ctrl+C，优雅关闭…")
        # 请窗口自己退出
        try:
            from src.webview_host import 请求关闭
            请求关闭()
        except Exception:
            pass
        # 给窗口 2 秒自己退
        for _ in range(20):
            if 进程.poll() is not None:
                break
            time.sleep(0.1)
        if 进程.poll() is None:
            print("  2 秒未退出，强制终止")
            进程.terminate()
            try:
                进程.wait(timeout=5)
            except Exception:
                进程.kill()

    print()
    print("退出后检查：")
    查任务栏(修复=True)
    return 进程.returncode or 0


if __name__ == "__main__":
    sys.exit(main())
