"""运行时环境：统一处理「源码运行」与「打包后运行」的差异。

## 为什么需要

源码运行时，一切路径都相对 `__file__` 就行。
打包（PyInstaller）后有两类目录，语义完全不同：

  资源目录（只读）—— 随包分发的文件：界面 HTML、模板、主题、示例工程、ffmpeg、node
  用户目录（可写）—— 设置、缓存、工程、导出

若混用，会出现两类典型故障：
  · 把设置写进资源目录 → 安装到 Program Files 后写入失败
  · 从用户目录找界面 → 找不到，白屏

本模块把这两类路径集中在此，其它模块一律通过它取路径，
不再各自写 `Path(__file__).parent`。

## 冻结后的差异

  onefile：资源解压到临时目录（sys._MEIPASS），程序退出即删
  onedir ：资源就在 exe 同目录（PyInstaller 5.x 为 _internal 子目录）

两种都要能工作，故 资源根() 优先用 _MEIPASS，退回 exe 所在目录。
"""
import os
import pathlib
import shutil
import sys


def 是否为打包版():
    """是否运行在 PyInstaller 冻结环境里。"""
    return bool(getattr(sys, "frozen", False))


def 程序目录():
    """exe 所在目录（源码运行时为仓库根）。"""
    if 是否为打包版():
        return pathlib.Path(sys.executable).resolve().parent
    return pathlib.Path(__file__).resolve().parents[1]


def 资源根():
    """随包分发的只读资源所在目录。

    onefile 下是 _MEIPASS 临时解压目录；onedir 下与程序目录相同
    （PyInstaller 5.7 会把数据放进 dist 根，6.x 放进 _internal）。
    """
    if 是否为打包版():
        mp = getattr(sys, "_MEIPASS", None)
        if mp:
            return pathlib.Path(mp)
        # 6.x 的 _internal 布局
        内部 = 程序目录() / "_internal"
        if 内部.is_dir():
            return 内部
        return 程序目录()
    return pathlib.Path(__file__).resolve().parents[1]


# ---------------------------------------------------------------- 外部可执行文件

def _找可执行(名, 打包内相对路径):
    """先找打包内的副本，再找 PATH。

    这个顺序很重要：打包内的是「已验证版本」，
    PATH 里的可能是别的版本，行为未必一致。
    """
    for base in (资源根(), 程序目录()):
        p = base / 打包内相对路径
        if p.is_file():
            return str(p)

    # 退回 PATH
    for d in os.environ.get("PATH", "").split(os.pathsep):
        if not d:
            continue
        f = pathlib.Path(d) / (名 + ".exe")
        if f.is_file():
            return str(f)
    return None


def node路径():
    """Node.js 可执行文件。

    视频渲染（src/render/capture_v2.mjs）需要它。
    源码运行时用系统的；打包时把 node.exe 放进 bundles/ 目录。
    """
    return _找可执行("node", pathlib.PurePath("bundles") / "node.exe")


def 浏览器路径():
    """Chromium 内核浏览器。渲染帧需要，无法打包，只能找系统里的。"""
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
            if not d:
                continue
            f = pathlib.Path(d) / (名 + ".exe")
            if f.is_file():
                return str(f)
    return None


def ffmpeg路径():
    """ffmpeg。由 imageio-ffmpeg 附带，打包时随包分发。

    注意：冻结版里不能只信 `imageio_ffmpeg.get_ffmpeg_exe()` ——
    它靠 `__file__` 推导包目录，而模块在 PYZ 归档里，`__file__` 不可靠，
    实测会返回一个不存在的路径。故加显式兜底查找。
    """
    # 1) 官方接口（源码运行时最准）
    try:
        import imageio_ffmpeg
        p = imageio_ffmpeg.get_ffmpeg_exe()
        if p and pathlib.Path(p).is_file():
            return p
    except Exception:
        pass

    # 2) 显式找已知位置（打包版走这里）
    for base in (资源根(), 程序目录()):
        for 子 in ("imageio_ffmpeg/binaries", "bundles", "binaries"):
            d = base / 子
            if not d.is_dir():
                continue
            for pat in ("ffmpeg*.exe", "ffmpeg*"):
                hits = sorted(x for x in d.glob(pat) if x.is_file())
                if hits:
                    return str(hits[0])

    # 3) PATH
    return _找可执行("ffmpeg", pathlib.PurePath("bundles") / "ffmpeg.exe")


# ---------------------------------------------------------------- 资源路径快捷方式

def 用户数据目录():
    """可写的用户数据目录（浏览器 profile、临时数据）。

    **不能**用程序目录：
      · 装到 Program Files 后那里只读
      · 会把 dist 目录弄脏（实测导致构建时删不掉）
    """
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        d = pathlib.Path(base) / "Audiovis"
        旧 = pathlib.Path(base) / "FLVisualizer"
    else:
        d = pathlib.Path.home() / ".local" / "share" / "audiovis"
        旧 = pathlib.Path.home() / ".local" / "share" / "flvisualizer"

    # 旧版叫 FLVisualizer，改名后把旧目录整体搬过来 ——
    # 里面有浏览器 profile（localStorage 可能存了界面状态），
    # 不迁移等于让老用户丢掉这些。移动失败就继续用旧目录，不影响启动。
    try:
        if not d.exists() and 旧.exists():
            d.parent.mkdir(parents=True, exist_ok=True)
            旧.rename(d)
    except Exception:
        if 旧.exists():
            d = 旧

    d.mkdir(parents=True, exist_ok=True)
    return d


def 应用配置目录():
    """浏览器 --user-data-dir 用（与用户日常浏览器隔离）。"""
    d = 用户数据目录() / "appdata"
    d.mkdir(parents=True, exist_ok=True)
    return d


def 资源(*parts):
    """拼一个资源路径。"""
    return 资源根().joinpath(*parts)


def 界面模板():
    """GUI 源（模块化目录）。"""
    return 资源("preview", "gui", "index.html")


def 界面产物():
    """构建好的单文件界面。"""
    return 资源("preview", "gui_prototype.html")


def 分析缓存():
    """示例工程的分析缓存。"""
    return 资源("preview", ".cache", "analysis.json")


def 示例快照():
    return 资源("data", "projects", "nujabes", "project_snapshot.json")


def 模板库():
    return 资源("preview", "templates.json")


def 主题方向():
    return 资源("preview", "themes", "artdirections.json")


# ---------------------------------------------------------------- 自检

def 环境摘要():
    return {
        "打包版": 是否为打包版(),
        "程序目录": str(程序目录()),
        "资源根": str(资源根()),
        "node": node路径(),
        "浏览器": 浏览器路径(),
        "ffmpeg": ffmpeg路径(),
        "界面产物存在": 界面产物().is_file(),
        "示例缓存存在": 分析缓存().is_file(),
        "模板存在": 模板库().is_file(),
    }


if __name__ == "__main__":
    import json
    print(json.dumps(环境摘要(), ensure_ascii=False, indent=1))
