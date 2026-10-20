"""Audiovis 启动器。

双击本文件即可（或 `python run.py`）：
  1. 检查环境（Python 包、浏览器）
  2. 需要时先构建 GUI 页面
  3. 起本地服务并打开浏览器

## 为什么需要启动器

直接 python app_server.py 也能跑，但它假设环境已就绪：
  · GUI 页面可能还没构建过（模板改了也要重建）
  · 缺依赖时报错信息不友好
启动器把这些前置检查集中处理，并给出可执行的修复提示。
"""
import importlib.util
import pathlib
import subprocess
import sys

# 资源根：源码运行时是仓库根，打包后是 exe 所在目录。
# 不能只用 __file__ —— 见 src/runtime.py 的说明。
_初始根 = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(_初始根))

try:
    from src.runtime import 资源根 as _资源根
    根 = _资源根()
except Exception:
    根 = _初始根
sys.path.insert(0, str(根))


def 依赖():
    """需要哪些第三方包。缺了给 pip 命令，不直接抛栈。"""
    return [
        ("numpy", "numpy"),
        ("imageio_ffmpeg", "imageio-ffmpeg"),
    ]


def 检查依赖():
    缺 = []
    for 模块, 包名 in 依赖():
        if importlib.util.find_spec(模块) is None:
            缺.append(包名)
    return 缺


def 找浏览器():
    import os
    候选 = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for p in 候选:
        if pathlib.Path(p).is_file():
            return p
    for 名 in ("msedge", "chrome", "chromium"):
        for d in os.environ.get("PATH", "").split(os.pathsep):
            f = pathlib.Path(d) / (名 + ".exe")
            if f.is_file():
                return str(f)
    return None


def 构建页面(强制=False):
    """GUI 页面由模板构建。模板比产物新、或产物不存在时就重建。

    打包版不重建：产物已随包分发，且 `build_gui` 模块可能没被打进去
    （它是 importlib 动态导入，PyInstaller 的静态分析看不到）。
    故导入失败时退回「直接用现成产物」。
    """
    产物 = 根 / "preview" / "gui_prototype.html"

    try:
        sys.path.insert(0, str(根 / "preview"))
        import importlib
        bg = importlib.import_module("build_gui")
        模板 = bg.模板文件
        产物 = bg.输出
    except Exception as e:
        # 打包版走这里：不重建，直接用随包分发的产物
        if 产物.is_file():
            return False, 产物
        raise SystemExit(
            "界面文件缺失，且无法重建（%s）。\n"
            "程序可能不完整，请重新解压。" % e)

    try:
        需重建 = (not 产物.is_file() or 强制
                  or 模板.stat().st_mtime > 产物.stat().st_mtime)
    except OSError:
        需重建 = not 产物.is_file()

    if 需重建:
        载荷, _ = bg.读缓存数据()
        方向 = bg.读方向()
        产物.write_text(bg.构建页面(载荷, 方向), encoding="utf-8")
        return True, 产物
    return False, 产物


def 应用模式启动(浏览器, 端口):
    """用浏览器的 --app 模式打开独立窗口（无地址栏）。

    ## 为什么用这个而不是 pywebview

    本机 pip 连不上 PyPI（代理问题），装不了 pywebview。
    `--app=` 是 Chromium 内核自带的能力：
      · 没有地址栏 / 标签页 / 工具栏
      · 独立窗口，标题栏与任务栏图标取自页面 title 与 favicon
      · 用独立 user-data-dir，与用户自己的浏览器完全隔离
      · 零依赖

    缺点：进程仍是 msedge.exe（任务栏里能看到多个 Edge 进程）。
    这在不改技术栈、不装依赖的前提下是最接近原生窗口的形态。
    """
    import subprocess

    # 配置目录必须在**可写**的位置。
    # 不能用 exe 同目录 —— 装到 Program Files 后那里只读，
    # 而且会把 dist 弄脏（实测导致重新构建时删不掉）。
    try:
        from src.runtime import 应用配置目录
        配置目录 = 应用配置目录()
    except Exception:
        配置目录 = 根 / ".appdata"
        配置目录.mkdir(parents=True, exist_ok=True)

    参数 = [
        浏览器,
        "--app=http://127.0.0.1:%d/" % 端口,
        "--start-maximized",
        "--user-data-dir=%s" % 配置目录,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=TranslateUI",
        # 关掉「恢复上次会话」气泡，否则每次启动都弹
        "--disable-session-crashed-bubble",
        "--hide-crash-restore-bubble",
    ]
    subprocess.Popen(参数, close_fds=True,
                     creationflags=getattr(subprocess, "DETACHED_PROCESS", 0))
    return True


def 自检():
    """检查运行时依赖。失败也继续，把问题一次性列全。"""
    import traceback

    # Windows 控制台默认 GBK，打不出 ✓/✗。
    # 先尝试切 UTF-8；不支持就退回 ASCII 标记。
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    对, 错 = "OK", "!!"
    try:
        "✓".encode(getattr(sys.stdout, "encoding", None) or "utf-8")
        对, 错 = "✓", "✗"
    except Exception:
        pass

    # ---- 报告收集 ----
    # 窗口版（console=False）里 sys.stdout 可能为 None，
    # print 会抛错。故所有输出先收进列表，最后统一处理：
    #   有控制台 → 打印
    #   无控制台 → 写文件并打开
    报告 = []

    def 说(文本=""):
        报告.append(文本)
        try:
            print(文本)
        except Exception:
            pass

    def 异常详情():
        import traceback
        报告.append(traceback.format_exc())
        try:
            traceback.print_exc()
        except Exception:
            pass

    说("=" * 66)
    说("  Audiovis 自检")
    说("=" * 66)
    说()

    try:
        from src import runtime as rt
        说("  资源根    %s" % rt.资源根())
        说("  程序目录  %s" % rt.程序目录())
        说("  打包版    %s" % rt.是否为打包版())
    except Exception:
        说("  %s runtime 模块导入失败" % 错)
        异常详情()
        return 1
    说()

    说("---- 依赖模块 ----")
    失败 = 0
    # PIL 只被开发工具（tools/make_icon.py）用到，运行时不需要，故不查。
    for 模块 in ("numpy", "imageio_ffmpeg", "soundfile", "psutil", "yaml"):
        try:
            __import__(模块)
            说("  %s %s" % (对, 模块))
        except Exception:
            失败 += 1
            说("  %s %s" % (错, 模块))
            # 完整链式 traceback：第三方库常把真实异常包一层
            异常详情()
            说()
    说()

    说("---- 本项目模块 ----")
    for 模块 in ("src.audio.analyze", "src.audio.stepper", "src.render.render",
                 "src.settings", "src.project", "app_server"):
        try:
            __import__(模块)
            说("  %s %s" % (对, 模块))
        except Exception:
            失败 += 1
            说("  %s %s" % (错, 模块))
            异常详情()
            说()
    说()

    说("---- 外部可执行 ----")
    for 名, 路径 in (("node", rt.node路径()),
                     ("ffmpeg", rt.ffmpeg路径()),
                     ("浏览器", rt.浏览器路径())):
        if 路径 and pathlib.Path(路径).is_file():
            说("  %s %-6s %s" % (对, 名, 路径))
        else:
            失败 += 1
            说("  %s %-6s 未找到" % (错, 名))
    说()

    说("---- 资源文件 ----")
    for 名, 路径 in (("界面产物", rt.界面产物()),
                     ("界面模板", rt.界面模板()),
                     ("分析缓存", rt.分析缓存()),
                     ("模板库", rt.模板库()),
                     ("主题方向", rt.主题方向()),
                     ("示例快照", rt.示例快照())):
        if 路径.is_file():
            说("  %s %-8s %8.1f KB" % (对, 名, 路径.stat().st_size / 1024))
        else:
            失败 += 1
            说("  %s %-8s 缺失 %s" % (错, 名, 路径))
    说()

    说("=" * 66)
    说("  自检结果：%s" % ("全部通过" if 失败 == 0 else "%d 项失败" % 失败))
    说("=" * 66)

    # ---- 报告总是落盘；无控制台时再打开它 ----
    # 判据直接看 sys.stdout is None：
    # 窗口版（console=False）里 CPython 的 print 会静默返回而不抛错，
    # 用 try/except print 判断会永远得出「有控制台」。
    无控制台 = (sys.stdout is None)
    try:
        from src.runtime import 用户数据目录
        文件 = 用户数据目录() / "selftest.txt"
        文件.parent.mkdir(parents=True, exist_ok=True)
        文件.write_text("\n".join(报告) + "\n", encoding="utf-8")
        if 无控制台:
            import os
            os.startfile(str(文件))
    except Exception:
        pass

    return 0 if 失败 == 0 else 1


def main():
    if "--selftest" in sys.argv:
        return 自检()

    print("=" * 66)
    print("  Audiovis")
    print("=" * 66)
    print()

    if sys.version_info < (3, 8):
        print("需要 Python 3.8 以上，当前 %s" % sys.version.split()[0])
        return 1

    缺 = 检查依赖()
    if 缺:
        print("缺少依赖：" + ", ".join(缺))
        print()
        print("请先安装：")
        print("  %s -m pip install %s" % (sys.executable, " ".join(缺)))
        return 1
    print("  依赖        OK")

    浏览器 = 找浏览器()
    if not 浏览器:
        print("  浏览器      未找到（Edge / Chrome 任一即可）")
        print("              渲染需要 Chromium 内核的浏览器")
        return 1
    print("  浏览器      %s" % pathlib.Path(浏览器).name)

    # 分析缓存是示例工程的必需数据
    缓存 = 根 / "preview" / ".cache" / "analysis.json"
    if not 缓存.is_file():
        print()
        print("  缺少示例工程的分析缓存（%s）" % 缓存)
        print("  不影响导入自己的工程，但启动页会是空的。")
        print("  生成：python preview/audio_analysis.py")

    try:
        重建, 产物 = 构建页面()
        print("  界面        %s%s" % (
            产物.name, "（已重建）" if 重建 else "（复用）"))
    except Exception as e:
        print("  界面构建失败：%s" % e)
        return 1

    print()
    print("-" * 66)
    print("  启动中…浏览器会自动打开")
    print("-" * 66)
    print()

    import argparse
    import app_server
    ap = argparse.ArgumentParser(description="FL Visualizer")
    ap.add_argument("--port", type=int, default=0,
                    help="端口（0 = 自动选空闲端口）")
    ap.add_argument("--no-open", action="store_true",
                    help="不打开任何窗口（只起服务）")
    ap.add_argument("--browser", action="store_true",
                    help="用浏览器标签页打开（调试用；默认是独立应用窗口）")
    ap.add_argument("--demo", action="store_true",
                    help="用内置示例工程启动（开发对照用）")
    a, _ = ap.parse_known_args()

    # --demo 透传给服务端（决定首屏用示例还是空页面）
    if getattr(a, "demo", False):
        try:
            import app_server as _as
            _as.用示例启动 = True
        except Exception:
            pass

    if a.no_open:
        return app_server.启动(a.port, False)

    if a.browser:
        # 传统方式：默认浏览器开一个标签页
        return app_server.启动(a.port, True)

    # 默认：优先 pywebview（真无边框窗口）
    try:
        from src.webview_host import 可用 as 宿可用
        if 宿可用():
            print("  窗口        pywebview（无边框）")
            print()
            return app_server.启动pywebview(a.port)
    except Exception as e:
        print("  pywebview 不可用（%s），退回 Edge --app" % e)

    # 退回：Edge --app 独立窗口
    print("  窗口        Edge --app")
    return app_server.启动应用模式(a.port, lambda 端口: 应用模式启动(浏览器, 端口))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n已退出")
        sys.exit(0)
