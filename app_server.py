"""本地服务：把 GUI 与渲染管线接起来。

## 为什么需要服务

GUI 跑在浏览器里，它做不到三件事：
  · 读本地文件（选 FLP / 音频 / 输出路径）
  · 跑 Python 解析器（FLP → snapshot）与音频分析
  · 启动渲染进程（需要几分钟，且要能看进度）

故起一个只监听 127.0.0.1 的本地服务，浏览器通过它做这三件事。
渲染/解析都是**后台任务**，前端轮询进度，不阻塞。

## 接口

  GET  /                     当前会话的 GUI 页面
  GET  /api/session          当前工程信息（名称/时长/是否已导入）
  POST /api/pick             打开系统文件对话框，返回所选路径
  POST /api/import           解析 FLP + 分析音频 + 重建页面（后台任务）
  POST /api/render           渲染视频（后台任务）
  GET  /api/job?id=xx        任务状态与进度
  POST /api/cancel           取消任务
  GET  /api/video?id=xx      取回渲染产物（供页面预览/下载）

## 设计取舍

**导入后重建整个页面**，而不是运行时替换数据。
理由：组件代码在加载时就消费了 DATA（bindings.js 生成 PPQ/TEMPO/SHAPES 等
顶层常量），运行时替换等于要重新执行一遍绑定层，复杂且易错。
重建页面只需让浏览器刷新 —— 复用已有的构建流程，风险最低。
"""
import json
import os
import pathlib
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_初始根 = pathlib.Path(__file__).resolve().parent
try:
    from src.runtime import 资源根 as _资源根
    根 = _资源根()
except Exception:
    根 = _初始根
sys.path.insert(0, str(根))
sys.path.insert(0, str(根 / "src" / "build"))
sys.path.insert(0, str(根 / "preview"))

import importlib  # noqa: E402
构建模块 = importlib.import_module("build_gui")

from src import settings as 设置模块  # noqa: E402
from src import project as 工程模块  # noqa: E402

# ---------------------------------------------------------------- 工具

def 取模板时间戳():
    """构建依赖的「源戳」。

    ## 为什么不能只看模板

    页面是用 src/ 下的组件与核心代码**现场组装**的。
    只比较模板的 mtime 时，改 src/ 里任何文件都不会触发重建，
    浏览器会一直拿到旧页面 ——
    表现为「代码改了但界面没变」，极容易误判成改动没生效。
    （实测踩到：改了 data.js 的预读窗口，测量数字一模一样。）

    故取「模板 + src 下全部 .js」的最新 mtime 作为源戳。"""
    ts = 构建模块.模板文件.stat().st_mtime
    src目录 = 根 / "src"
    if src目录.is_dir():
        for f in src目录.rglob("*.js"):
            try:
                m = f.stat().st_mtime
                if m > ts:
                    ts = m
            except OSError:
                pass
    return ts


# ---------------------------------------------------------------- 会话状态

class 会话:
    def __init__(self):
        self.锁 = threading.Lock()
        self.页面 = None            # 当前 GUI HTML
        self.工程 = {"已导入": False, "name": "示例工程（nujabes）"}
        self.快照路径 = None
        self.分析路径 = None
        # 导入时算好的快照与分析结果 —— 渲染时直接复用，避免重复分析
        # （长工程的分析要数分钟，重复一遍是纯浪费）
        self.快照 = None
        self.分析数据 = None
        # 页面构建用的源数据与模板时间戳 —— 供「模板变了就重建」用
        self.载荷 = None
        self.方向 = None
        self.构建时模板戳 = 0.0
        # 当前打开的工程文件路径（None = 尚未保存过）
        self.工程路径 = None
        # 打开工程后待应用到前端的布局（页面构建时注入）
        self.待恢复 = None
        # 是否有未保存改动（前端也会维护一份，这里用于服务端判断）
        self.脏 = False
        self.任务 = {}              # id -> dict
        self.输出目录 = 根 / "out"
        self.输出目录.mkdir(exist_ok=True)

    # ---- 页面缓存失效 ----

    def 记录构建(self, 载荷, 方向):
        self.载荷 = 载荷
        self.方向 = 方向
        self.构建时模板戳 = 取模板时间戳()

    def 需重建(self):
        """模板被改过就要重建。

        ## 为什么必须自动重建
        服务在启动/导入时构建并缓存页面。若此后有人改了
        gui_v2_template.html，服务仍会一直返回**旧页面** ——
        表现为「代码改了但界面没变」，极难排查。

        实测踩到：导出面板的 HTML 与 JS 都写好了，
        服务返回的却是启动时缓存的旧页，页面上什么都没有，
        而浏览器里也看不出任何异常。

        这与之前「从陈旧 render_page.html 提取组件代码」是同一类问题：
        **中间产物一旦被缓存，就必须有失效判断。**"""
        if self.页面 is None or self.载荷 is None:
            return False
        return 取模板时间戳() > self.构建时模板戳 + 1e-6

    def 重构建(self):
        if self.载荷 is None:
            return False
        self.页面 = 构建模块.构建页面(
            self.载荷, self.方向, "sumi",
            工程信息=dict(self.工程), 服务模式=True)
        self.记录构建(self.载荷, self.方向)
        return True

    def 建任务(self, 类型, 说明):
        ident = uuid.uuid4().hex[:12]
        with self.锁:
            self.任务[ident] = {
                "id": ident, "类型": 类型, "说明": 说明,
                "状态": "运行中", "进度": 0.0, "阶段": "准备",
                "消息": "", "错误": None,
                "开始": time.time(), "结束": None,
                "产物": None, "取消": False,
            }
        return ident

    def 取任务(self, ident):
        with self.锁:
            t = self.任务.get(ident)
            return dict(t) if t else None

    def 更新(self, ident, **kw):
        with self.锁:
            if ident in self.任务:
                self.任务[ident].update(kw)

    def 已取消(self, ident):
        with self.锁:
            t = self.任务.get(ident)
            return bool(t and t["取消"])


会话 = 会话()


# ---------------------------------------------------------------- 初始页面

def 构建空页面():
    """没有工程时的页面：只有导入界面，无任何示例数据。

    正式版默认走这里 —— 启动后是干净的导入页，
    用户导入自己的工程后才会有鼓组提示等数据。
    """
    载荷 = 空载荷()
    方向 = 构建模块.读方向()
    工程 = {
        "已导入": False,
        "flp": "",
        "audio": "",
        "name": "",
        "duration": 0,
        "projectDuration": 0,
    }
    html = 构建模块.构建页面(载荷, 方向, "sumi", 工程信息=工程,
                           服务模式=True, 语言=设置模块.生效语言(),
                           待恢复=会话.待恢复)
    会话.页面 = html
    会话.工程 = dict(工程)
    会话.分析数据 = None
    会话.快照 = None
    会话.记录构建(载荷, 方向)
    return html


# 是否用示例工程启动（--demo）
用示例启动 = False


def 构建工程页面():
    """用会话里已有的工程 + 分析数据重建页面。

    ## 为什么需要这个

    打开 .flvproj 后要把页面换成本工程的页面，但如果走
    `构建空页面()`，会同时把 `会话.工程` 覆盖成空工程、
    并丢掉分析数据 —— 于是页面里 __PROJECT__ 没有时长，
    组件没有数据可画，导出总长为 0。

    ## 与导入流程的关系

    导入是「解析 → 分析 → 构建页面」，这里省掉前两步，
    直接用 `会话.分析数据`。`构建页面()` 的参数形状相同。

    ## 数据不全时

    没有已导入工程或没有分析数据时退回空页面 ——
    宁可显示导入界面，也不要构造一个半残的编辑器。
    """
    分析数据 = 会话.分析数据
    工程 = 会话.工程 or {}
    if not 工程.get("已导入") or not 分析数据:
        return 构建空页面()

    载荷 = dict(分析数据)
    载荷["projectName"] = (载荷.get("projectName")
                          or 工程.get("name")
                          or "未命名工程")
    载荷["previewTime"] = 载荷.get("previewTime", 0) or 0

    方向 = 构建模块.读方向()
    待恢复 = 会话.待恢复 or {}
    主题 = 待恢复.get("主题") or 工程.get("主题") or "sumi"

    # 工程信息直接用会话里的（已含 flp/audio/name/duration/projectDuration）
    页面工程 = dict(工程)
    页面工程["已导入"] = True
    # 时长兜底：老版本 .flvproj 可能没存 projectDuration
    if not 页面工程.get("projectDuration"):
        页面工程["projectDuration"] = (
            页面工程.get("duration")
            or (载荷.get("audio") or {}).get("projectDuration")
            or (载荷.get("audio") or {}).get("duration")
            or 0)

    html = 构建模块.构建页面(载荷, 方向, 主题, 工程信息=页面工程,
                          服务模式=True, 语言=设置模块.生效语言(),
                          待恢复=会话.待恢复)

    会话.页面 = html
    # **不要**覆盖 会话.工程 —— 它已经是正确的工程信息
    会话.工程 = 页面工程
    会话.记录构建(载荷, 方向)
    return html


def _初始页面():
    """按启动参数决定首屏：空页面（默认）或示例页面（--demo）。"""
    if 用示例启动:
        构建示例页面()
    else:
        构建空页面()


def 构建示例页面():
    """用内置示例工程构建页面（仅 --demo 或自检时用）。"""
    载荷, 快照 = 构建模块.读缓存数据()
    方向 = 构建模块.读方向()
    时长 = 载荷.get("audio", {}).get("duration", 0)
    工程 = {
        "已导入": False,          # 显式声明，不依赖「字段缺失即假值」
        "flp": str(根 / "data" / "projects" / "nujabes" / "project_snapshot.json"),
        "audio": "",
        "name": 载荷.get("projectName", "nujabes"),
        "duration": 时长,
        # 工程全长（可能长于音频）—— 导出面板据此提示「音频结束后静音」
        "projectDuration": 载荷.get("projectDuration") or 时长,
        "示例": True,
    }
    html = 构建模块.构建页面(载荷, 方向, "sumi", 工程信息=工程,
                           服务模式=True, 语言=设置模块.生效语言(),
                           待恢复=会话.待恢复)
    会话.页面 = html
    # 会话状态必须与页面里的 __PROJECT__ 是**同一份** ——
    # 否则保存工程时会拿不到 flp/audio，存出打不开的文件。
    会话.工程 = dict(工程)
    会话.记录构建(载荷, 方向)
    return html




# ---------------------------------------------------------------- 无边框窗口

def _窗口接口(body):
    """窗口命令分发。

    动作：
        detect   检测是否支持（页面据此决定要不要显示自绘标题栏）
        minimize / maximize / restore / toggle / close
        drag     开始拖动（drag region 由页面处理，这里只回报成功）
        state    是否最大化

    只走 pywebview。Edge --app 回退模式下返回「不可用」，
    页面据此不显示自绘标题栏（那种模式自带一条去不掉的标题栏）。
    """
    动作 = body.get("动作") or "state"

    try:
        from src import webview_host as 宿
    except Exception:
        return {"ok": False, "可用": False, "宿主": "none"}

    if 动作 == "detect":
        # 只判断「pywebview 是否可用」，**不要求窗口对象已注册** ——
        # 页面加载时 Python 侧的窗口对象可能还没赋值，
        # 那样会误判为不可用，导致自绘标题栏不显示。
        可用 = 宿.可用()
        return {"ok": True, "可用": 可用,
                "宿主": "pywebview" if 可用 else "none"}

    if not 宿.可用():
        return {"ok": False, "错误": "pywebview 不可用"}

    if 动作 == "state":
        return {"ok": True, "最大化": bool(宿.是否最大化())}

    if 动作 == "deframe":
        # pywebview 的窗口本来就是无边框，无需处理
        return {"ok": True, "宿主": "pywebview"}

    结果 = 宿.执行命令(动作)
    if 结果 is None:
        return {"ok": False, "错误": "窗口尚未创建"}
    return {"ok": bool(结果),
            "最大化": bool(宿.是否最大化()),
            "宿主": "pywebview"}

def 启动pywebview(端口=0):
    """起服务 + pywebview 无边框窗口（阻塞直到窗口关闭）。"""
    构建空页面()
    服务器 = ThreadingHTTPServer(("127.0.0.1", 端口), 处理)
    实际端口 = 服务器.server_address[1]
    地址 = "http://127.0.0.1:%d/" % 实际端口

    print("Audiovis 已启动")
    print("  地址 %s" % 地址)
    print("  窗口 pywebview（无边框）")

    threading.Thread(target=服务器.serve_forever, daemon=True).start()

    try:
        from src.webview_host import 启动窗口
        启动窗口(实际端口)
    except Exception as e:
        print("  pywebview 启动失败：%s" % e)
        print("  退回浏览器方式…")
        import time as _t
        import webbrowser
        webbrowser.open(地址)
        try:
            while True:
                _t.sleep(1)
        except KeyboardInterrupt:
            pass
    finally:
        服务器.shutdown()
        服务器.server_close()
    return 0


# ---------------------------------------------------------------- 空载荷

def 空载荷():
    """没有工程时用的最小数据。

    **必须与真实载荷的结构完全一致**（键名、类型、嵌套层级）。
    因为 src/app/bindings.js 在模块顶层就读这些字段：
        const VS_L = decodeI16(VS.left);   ← 缺 left 会 atob(undefined) 崩
        const PPQ = TL.ppq;                ← timeline 必须是 dict
    任何缺失都会让整个脚本中断，表现为「页面正常但所有交互失效」。

    本函数由 tools 脚本从真实缓存推导生成，不是手写的。
    """
    return     {
     "audio": {
      "duration": 0.0,
      "projectDuration": 0.0,
      "sr": 44100,
      "channels": 2
     },
     "waveform": {
      "peak": [],
      "rms": []
     },
     "spectrogram": {
      "fps": 12,
      "bands": 96,
      "frames": 0,
      "fmin": 30,
      "fmax": 16000,
      "calibration": 0,
      "data": ""
     },
     "vectorscope": {
      "rate": 2205,
      "count": 0,
      "windowSec": 0.85,
      "left": "",
      "right": ""
     },
     "events": {
      "buckets": [],
      "maxTick": 0,
      "total": 0,
      "ppq": 96
     },
     "timeline": {
      "ppq": 96,
      "tempo": 120.0,
      "tracks": [],
      "maxTick": 0,
      "markers": [],
      "meta": {}
     },
     "patternNotes": {
      "1": [],
      "2": [],
      "3": [],
      "4": [],
      "5": [],
      "6": [],
      "7": [],
      "8": [],
      "9": [],
      "10": [],
      "11": [],
      "12": [],
      "13": [],
      "14": [],
      "15": [],
      "17": [],
      "20": [],
      "21": [],
      "22": [],
      "23": [],
      "24": []
     },
     "patternShapes": {
      "1": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "2": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "3": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "4": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "5": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "6": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "7": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "8": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "9": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "10": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "11": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "12": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "13": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "14": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "15": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "17": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "20": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "21": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "22": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "23": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      },
      "24": {
       "notes": [],
       "kind": "",
       "uniquePitches": 0,
       "range": [],
       "velRange": [],
       "length": 0,
       "channels": []
      }
     },
     "pitchHistogram": [],
     "pitchRange": [
      0,
      0
     ],
     "patternUsage": {
      "23": [],
      "13": [],
      "12": [],
      "22": [],
      "15": [],
      "2": [],
      "3": [],
      "5": [],
      "6": [],
      "7": [],
      "8": [],
      "9": [],
      "10": [],
      "11": [],
      "20": []
     },
     "features": {
      "fps": 12,
      "frames": 0,
      "rmsDb": [],
      "rmsNorm": [],
      "centroidHz": [],
      "centroidNorm": [],
      "flux": [],
      "fluxNorm": [],
      "width": [],
      "calibration": {
       "rmsDb": [],
       "centroidHz": [],
       "flux": []
      }
     },
     "sections": [],
     "trackActivity": {
      "buckets": 0,
      "maxTick": 0,
      "ppq": 96,
      "rows": []
     },
     "patternMatrix": {
      "segments": 26,
      "maxTick": 0,
      "ppq": 96,
      "patterns": []
     },
     "drumGroups": [],
     "drumStats": {
      "总pattern数": 0,
      "纳入": 0,
      "按关键词": 0,
      "按音高": 0,
      "按节奏": 0,
      "按后缀": 0,
      "跳过高音种类": 0,
      "未纳入候选数": 0
     },
     "drumMissed": [],
     "drumAudio": {
      "音频命中": 0
     },
     "_channelSource": "",
     "drumUsage": {
      "22": [],
      "2": [],
      "3": [],
      "5": [],
      "6": [],
      "7": [],
      "8": [],
      "9": [],
      "10": [],
      "11": []
     },
     "projectName": "",
     "previewTime": 0,
     "projectDuration": 0
    }


def _原生对话框(kind):
    """用 Win32 原生对话框选文件。返回路径或空串。

    kind:
        flp      打开 FLP
        audio    打开音频
        project  打开 .flvproj
        out      保存 mp4
        save     保存（通用）
    """
    import ctypes
    from ctypes import wintypes

    class OPENFILENAMEW(ctypes.Structure):
        _fields_ = [
            ("lStructSize", wintypes.DWORD),
            ("hwndOwner", wintypes.HWND),
            ("hInstance", wintypes.HINSTANCE),
            ("lpstrFilter", wintypes.LPCWSTR),
            ("lpstrCustomFilter", wintypes.LPWSTR),
            ("nMaxCustFilter", wintypes.DWORD),
            ("nFilterIndex", wintypes.DWORD),
            ("lpstrFile", wintypes.LPWSTR),
            ("nMaxFile", wintypes.DWORD),
            ("lpstrFileTitle", wintypes.LPWSTR),
            ("nMaxFileTitle", wintypes.DWORD),
            ("lpstrInitialDir", wintypes.LPCWSTR),
            ("lpstrTitle", wintypes.LPCWSTR),
            ("Flags", wintypes.DWORD),
            ("nFileOffset", wintypes.WORD),
            ("nFileExtension", wintypes.WORD),
            ("lpstrDefExt", wintypes.LPCWSTR),
            ("lCustData", wintypes.LPARAM),
            ("lpfnHook", wintypes.LPVOID),
            ("lpTemplateName", wintypes.LPCWSTR),
            ("pvReserved", wintypes.LPVOID),
            ("dwReserved", wintypes.DWORD),
            ("FlagsEx", wintypes.DWORD),
        ]

    # ---- 让对话框前置弹出 ----
    # 没有 owner 的对话框是「无主窗口」，Windows 不保证带到前台，
    # 用户会遇到「要从任务栏点出来」。故显式找 owner 并强制置前。
    try:
        user32 = ctypes.windll.user32
        前台 = user32.GetForegroundWindow()
        属于本程序 = False
        if 前台:
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(前台, ctypes.byref(pid))
            属于本程序 = (pid.value == os.getpid())
        # 优先用本程序的前台窗口；否则用任意前台窗口当 owner，
        # 也比 None 好（至少有个父窗口能把对话框带上来）
        宿主 = 前台 if 前台 else None
    except Exception:
        宿主 = None
        user32 = None

    OFN_OVERWRITEPROMPT = 0x00000002
    OFN_FILEMUSTEXIST = 0x00001000
    OFN_PATHMUSTEXIST = 0x00000800
    OFN_NOCHANGEDIR = 0x00000008
    OFN_EXPLORER = 0x00080000

    配置 = {
        "flp": ("选择 FLP 工程",
                "FL Studio 工程\0*.flp\0全部文件\0*.*\0\0", "flp", False,
                "flp"),
        "audio": ("选择音频",
                  "音频\0*.mp3;*.wav;*.flac;*.m4a;*.ogg;*.aiff\0"
                  "全部文件\0*.*\0\0", "mp3", False, "audio"),
        "project": ("打开工程",
                    "Audiovis 工程\0*.flvproj\0全部文件\0*.*\0\0",
                    "flvproj", False, "project"),
        "out": ("选择输出位置",
                "MP4 视频\0*.mp4\0全部文件\0*.*\0\0", "mp4", True, "out"),
        "save": ("保存", "全部文件\0*.*\0\0", "", True, "save"),
    }
    说明, 过滤器, 默认扩展, 是否保存, _ = 配置.get(kind, 配置["save"])

    缓冲 = ctypes.create_unicode_buffer(32768)
    ofn = OPENFILENAMEW()
    ofn.lStructSize = ctypes.sizeof(OPENFILENAMEW)
    ofn.hwndOwner = 宿主
    ofn.lpstrFilter = 过滤器
    ofn.nFilterIndex = 1
    ofn.lpstrFile = ctypes.cast(缓冲, wintypes.LPWSTR)
    ofn.nMaxFile = 32768
    ofn.lpstrTitle = 说明
    ofn.lpstrDefExt = 默认扩展 or None
    ofn.Flags = (OFN_EXPLORER | OFN_NOCHANGEDIR | OFN_PATHMUSTEXIST |
                 (OFN_OVERWRITEPROMPT if 是否保存 else OFN_FILEMUSTEXIST))

    fn = (ctypes.windll.comdlg32.GetSaveFileNameW if 是否保存
          else ctypes.windll.comdlg32.GetOpenFileNameW)
    ofn.lpstrFile = ctypes.cast(缓冲, wintypes.LPWSTR)

    # 调之前先把宿主窗口提到最前 —— 对话框会随它出现
    if 宿主 and user32:
        try:
            user32.SetForegroundWindow(宿主)
            user32.BringWindowToTop(宿主)
        except Exception:
            pass

    ok = fn(ctypes.byref(ofn))

    # 关闭后把焦点还回去，避免用户切到别的程序去了
    if 宿主 and user32:
        try:
            user32.SetForegroundWindow(宿主)
        except Exception:
            pass
    if not ok:
        return ""
    return 缓冲.value or ""


def 选文件(kind):
    """选文件。Windows 用原生对话框；其它平台退回 tkinter。"""
    import sys as _sys
    if _sys.platform == "win32":
        try:
            return _原生对话框(kind)
        except Exception as e:
            # 原生对话框失败时退回旧方式，不让功能整体不可用
            print("[dialog] 原生对话框失败：%s" % e)
    # 非 Windows：没有等价的轻量方案。
    # 这里不再退回「sys.executable -c 脚本」——
    # 打包后 sys.executable 是 exe，会重启一个实例而不是弹对话框。
    print("[dialog] 当前平台不支持原生对话框（仅 Windows）")
    return ""


# ---------------------------------------------------------------- 自动保存

def _自动保存文件():
    目录 = 设置模块.缓存目录() / "autosave"
    目录.mkdir(parents=True, exist_ok=True)
    return 目录 / "recovery.json"


def _丢弃自动保存():
    """把当前恢复文件改名保留，而不是删除。

    名固定为 recovery.discarded.json —— 多次丢弃只保留最后一份，
    不累积。需要时用户可以手工从该文件还原画布。
    """
    f = _自动保存文件()
    if not f.is_file():
        return
    备 = f.with_name("recovery.discarded.json")
    try:
        if 备.is_file():
            备.unlink()
        f.rename(备)
    except Exception:
        # 改名失败才退回删除（至少不阻塞用户操作）
        try:
            f.unlink(missing_ok=True)
        except Exception:
            pass


def _写自动保存(body):
    """写恢复文件。内容与工程元数据同形，便于直接还原。"""
    import time
    工 = 会话.工程 or {}
    d = {
        "时间": time.time(),
        "名称": body.get("名称") or 工.get("name") or "未命名",
        "flp": 工.get("flp"),
        "audio": 工.get("audio"),
        "布局": body.get("布局") or {"组件": []},
        "主题": body.get("主题") or "sumi",
        "静帧秒": body.get("静帧秒") or 48.0,
    }
    f = _自动保存文件()
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    tmp.replace(f)
    return {"ok": True, "组件数": len((d["布局"] or {}).get("组件") or [])}


# ---------------------------------------------------------------- 音频配对

音频扩展名 = (".mp3", ".wav", ".flac", ".ogg", ".aiff", ".m4a")


def _配对音频(flp):
    """在 FLP 所在目录找配套音频。

    返回 { ok, 音频:{路径,名称} | None, 候选:[策略说明...] }

    没有候选时返回 音频=None 与空候选 —— 前端据此提示「请一并拖入」。
    """
    if not flp:
        return {"ok": False, "错误": "未指定 FLP", "音频": None, "候选": []}

    f = pathlib.Path(flp)
    if not f.is_file():
        return {"ok": False, "错误": "FLP 不存在：%s" % flp,
                "音频": None, "候选": []}

    目录 = f.parent
    stem = f.stem

    try:
        全部 = [x for x in 目录.iterdir()
                if x.is_file() and x.suffix.lower() in 音频扩展名]
    except OSError as e:
        return {"ok": False, "错误": "无法读取目录：%s" % e,
                "音频": None, "候选": []}

    if not 全部:
        return {"ok": True, "音频": None, "候选": [],
                "说明": "该目录下没有音频文件"}

    # 1) 同名优先
    同名 = [x for x in 全部 if x.stem.lower() == stem.lower()]
    if len(同名) == 1:
        return {"ok": True,
                "音频": {"路径": str(同名[0]), "名称": 同名[0].name},
                "候选": [], "依据": "同名"}

    # 2) 目录里唯一音频
    if not 同名 and len(全部) == 1:
        return {"ok": True,
                "音频": {"路径": str(全部[0]), "名称": 全部[0].name},
                "候选": [], "依据": "目录唯一"}

    # 3) 多个候选：不猜，交给用户
    return {"ok": True, "音频": None, "依据": "多候选",
            "候选": [{"路径": str(x), "名称": x.name}
                     for x in sorted(全部)[:20]],
            "说明": "找到 %d 个音频文件，请选择" % len(全部)}


# ---------------------------------------------------------------- 文件上传

上传上限 = 500 * 1024 * 1024        # 500 MB
允许扩展名 = {".flp", ".mp3", ".wav", ".flac", ".ogg", ".aiff", ".m4a"}


def _上传目录():
    """上传落盘位置。

    放在设置的缓存目录下 —— 与缓存一起清理，不会越积越多。
    """
    d = 设置模块.缓存目录() / "uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ---------------------------------------------------------------- 工程辅助

最近上限 = 12


def _最近工程():
    """最近工程列表（按修改时间倒序，剔除已不存在的文件）。"""
    设置 = 设置模块.读设置()
    列表 = 设置.get("最近工程") or []
    有效 = [x for x in 列表 if pathlib.Path(x).is_file()]
    if len(有效) != len(列表):
        # 顺手清理失效项，避免列表越积越多
        设置模块.改设置({"最近工程": 有效})

    out = []
    for x in 有效[:最近上限]:
        try:
            out.append(工程模块.摘要(x))
        except Exception as e:
            out.append({"路径": x, "名称": pathlib.Path(x).stem,
                        "错误": str(e)[:80]})
    return out


def _记入最近(路径):
    设置 = 设置模块.读设置()
    列表 = [x for x in (设置.get("最近工程") or [])
            if pathlib.Path(x).resolve() != pathlib.Path(路径).resolve()]
    列表.insert(0, str(路径))
    设置模块.改设置({"最近工程": 列表[:最近上限]})


def _保存工程(body):
    """保存当前会话为 .flvproj。

    body:
      名称       工程名（决定默认文件名）
      路径       可选，完整路径；不传则用 设置.工程目录/名称.flvproj
      布局       前端的 取布局() 结果
      主题
      导出设置
      静帧秒
      分析数据   可选，传入则一并打包（避免服务端重复分析）
      缩略图     base64 PNG（可选）
    """
    import base64

    名称 = (body.get("名称") or "未命名工程").strip() or "未命名工程"
    路径 = body.get("路径")
    if 路径:
        目标 = pathlib.Path(路径)
    else:
        目录 = 设置模块.工程目录()
        目标 = 目录 / 名称

    工 = 会话.工程 or {}
    # body 可显式指定（前端更可靠）；否则用会话里的
    flp = body.get("flp") or 工.get("flp") or ""
    audio = body.get("audio") or 工.get("audio") or ""

    # 保存前校验：引用缺失或不存在时**拒绝保存**。
    # 存出一个打不开的工程比存不出来更糟 —— 用户以为存好了。
    if not flp:
        raise 工程模块.工程错误(
            "当前没有关联 FLP，无法保存工程。请先导入 FLP 与音频。")
    if not pathlib.Path(flp).is_file():
        raise 工程模块.工程错误(
            "FLP 文件不存在，无法保存：%s" % flp)
    if not audio:
        raise 工程模块.工程错误(
            "当前没有关联音频，无法保存工程。请先导入音频。")
    if not pathlib.Path(audio).is_file():
        raise 工程模块.工程错误(
            "音频文件不存在，无法保存：%s" % audio)

    # 分析数据：优先用传入的，否则用会话里已算好的
    分析 = body.get("分析数据") or 会话.分析数据

    缩略图 = None
    if body.get("缩略图"):
        try:
            缩略图 = base64.b64decode(body["缩略图"])
        except Exception:
            缩略图 = None

    元数据 = 工程模块.新建元数据(
        名称=名称, flp=flp, audio=audio,
        布局=body.get("布局") or {"组件": []},
        主题=body.get("主题") or "sumi",
        导出设置=body.get("导出设置") or {},
        静帧秒=body.get("静帧秒") or 48.0,
    )
    写 = 工程模块.打包(目标, 元数据, 分析, 缩略图)

    会话.工程路径 = 写
    会话.脏 = False
    _记入最近(写)

    return {
        "ok": True,
        "路径": str(写),
        "名称": 写.stem,
        "大小字节": 写.stat().st_size,
        "含分析": 分析 is not None,
        "含缩略图": 缩略图 is not None,
    }


def _打开工程(路径):
    """打开 .flvproj 并恢复会话。

    返回 { ok, 元数据, 引用, 有分析, 有缩略图 }
    """
    if not 路径:
        raise 工程模块.工程错误("未指定工程文件")

    读 = 工程模块.读取(路径)
    元数据 = 读["元数据"]
    引用 = 工程模块.检查引用(元数据)

    if not 引用["flp"]["存在"]:
        raise 工程模块.工程错误(
            "工程引用的 FLP 已不存在：%s\n请把原始文件放回该位置，"
            "或重新导入工程。" % (元数据.get("flp") or "(空)"))
    if not 引用["audio"]["存在"]:
        raise 工程模块.工程错误(
            "工程引用的音频已不存在：%s\n请把原始文件放回该位置，"
            "或重新导入工程。" % (元数据.get("audio") or "(空)"))

    # 恢复分析数据（有缓存则免重算）
    分析 = 读["分析"]
    if 分析:
        会话.分析数据 = 分析

    # 恢复工程信息
    会话.工程 = {
        "已导入": True,
        "flp": 元数据.get("flp"),
        "audio": 元数据.get("audio"),
        "name": 元数据.get("name"),
        "duration": (分析 or {}).get("audio", {}).get("duration", 0),
        "projectDuration": (分析 or {}).get("audio",
                                            {}).get("projectDuration", 0),
    }
    会话.工程路径 = pathlib.Path(路径)
    会话.脏 = False
    _记入最近(路径)

    # 重建页面：把工程的布局与主题带进页面
    会话.页面 = None    # 触发下次 GET / 时用新数据重建
    _待恢复布局 = {
        "布局": 元数据.get("布局") or {"组件": []},
        "主题": 元数据.get("主题") or "sumi",
        "静帧秒": 元数据.get("静帧秒") or 48.0,
        "导出设置": 元数据.get("导出设置") or {},
    }
    with 会话.锁:
        会话.待恢复 = _待恢复布局

    return {
        "ok": True,
        "路径": str(路径),
        "名称": 元数据.get("name") or pathlib.Path(路径).stem,
        "主题": 元数据.get("主题"),
        "组件数": len((元数据.get("布局") or {}).get("组件") or []),
        "有分析": 分析 is not None,
        "有缩略图": 读["缩略图"] is not None,
        "引用": 引用,
    }


# ---------------------------------------------------------------- 设置辅助

def _设置快照(设置=None):
    """返回给前端的设置：原始值 + 生效语言 + 解析后的路径。

    为什么要给「解析后的路径」：
    设置里存空串表示「用系统默认」，前端没法自己算默认路径，
    必须由服务端解析后一并返回，否则界面上显示空白。
    """
    s = 设置 or 设置模块.读设置()
    return {
        "设置": s,
        "生效语言": 设置模块.生效语言(s),
        "系统语言": 设置模块.系统语言(),
        "路径": {
            "工程目录": str(设置模块.工程目录(s)),
            "导出目录": str(设置模块.导出目录(s)),
            "缓存目录": str(设置模块.缓存目录(s)),
        },
        "配置文件": str(设置模块.配置文件()),
    }


def _目录大小(p):
    """目录占用字节数（递归）。不存在或无权访问返回 0。"""
    总 = 0
    try:
        p = pathlib.Path(p)
        if not p.exists():
            return 0
        for f in p.rglob("*"):
            try:
                if f.is_file():
                    总 += f.stat().st_size
            except OSError:
                pass
    except Exception:
        pass
    return 总


def _目录状态():
    """各目录是否存在、是否可写、占用大小。"""
    out = {}
    for 名, 路径 in (
            ("工程目录", 设置模块.工程目录()),
            ("导出目录", 设置模块.导出目录()),
            ("缓存目录", 设置模块.缓存目录()),
    ):
        存在 = 路径.exists()
        可写 = False
        if 存在:
            可写 = os.access(str(路径), os.W_OK)
        else:
            # 不存在：沿路径向上找第一个存在的祖先，
            # 只要它可写就能逐级创建。
            # 只看直接父目录会误判 —— 实测缓存目录的父目录
            # (%LOCALAPPDATA%/FLVisualizer) 本身也不存在，
            # 于是显示「不可写」，但实际完全能创建。
            祖 = 路径
            for _ in range(32):
                祖 = 祖.parent
                if 祖 == 祖.parent:
                    break
                if 祖.exists():
                    break
            可写 = 祖.exists() and os.access(str(祖), os.W_OK)
        out[名] = {
            "路径": str(路径),
            "存在": 存在,
            "可写": 可写,
            "字节": _目录大小(路径) if 存在 else 0,
        }
    return out


def 跑导入(ident, flp, audio):
    """解析 FLP + 分析音频 + 重建页面。"""
    import time as _t
    from src.parser import flp as flp模块
    from src.parser import snapshot as 快照模块
    from src.audio import analyze as 分析模块

    try:
        会话.更新(ident, 阶段="解析 FLP", 进度=0.05, 消息=pathlib.Path(flp).name)
        if 会话.已取消(ident):
            raise RuntimeError("已取消")
        原始 = flp模块.解析(flp)
        快照 = 快照模块.规范化(原始)
        统计 = 快照模块.统计(快照)

        if 会话.已取消(ident):
            raise RuntimeError("已取消")
        工作 = 会话.输出目录 / ("session_" + ident)
        工作.mkdir(parents=True, exist_ok=True)
        快照模块.保存(快照, 工作 / "project_snapshot.json")

        会话.更新(ident, 阶段="分析音频", 进度=0.20,
                 消息="%d 轨道 · %d clip · %d 音符" % (
                     统计["有内容轨道"], 统计["clip总数"], 统计["音符总数"]))
        分析数据 = 分析模块.构建(audio, 工作 / "project_snapshot.json")

        if 会话.已取消(ident):
            raise RuntimeError("已取消")
        会话.更新(ident, 阶段="组装页面", 进度=0.90)
        载荷 = dict(分析数据)
        载荷["projectName"] = 快照["metadata"].get("title") or \
            pathlib.Path(flp).stem
        载荷["previewTime"] = 载荷.get("previewTime", 0) or 0
        方向 = 构建模块.读方向()
        # 已导入 必须在**构建页面之前**就放进工程信息里。
        # 初版是构建完再往 会话.工程 里补 —— 于是页面里的
        # __PROJECT__ 没有这个字段，前端误判为「尚未导入」，
        # 按钮一直是「解析并进入编辑器」，点一次解析一次，
        # 永远进不去编辑器（用户实测卡住）。
        工程 = {
            "已导入": True,
            "flp": str(flp), "audio": str(audio),
            "name": 载荷["projectName"],
            "duration": 载荷.get("audio", {}).get("duration", 0),
            # 工程长度：导出默认按它，避免音频比工程短时被截断
            "projectDuration": 载荷.get("audio", {}).get("projectDuration", 0),
        }
        html = 构建模块.构建页面(载荷, 方向, "sumi", 工程信息=工程,
                              服务模式=True, 语言=设置模块.生效语言(),
                              待恢复=会话.待恢复)

        with 会话.锁:
            会话.页面 = html
            会话.工程 = dict(工程)
            会话.快照路径 = 工作 / "project_snapshot.json"
            # 存下来供渲染复用，避免重复分析
            会话.快照 = 快照
            会话.分析数据 = 分析数据
            会话.记录构建(载荷, 方向)

        会话.更新(ident, 状态="完成", 阶段="完成", 进度=1.0,
                 产物={"工程": 会话.工程})
    except BaseException as e:
        # 必须是 BaseException ——
        # 解析器/分析器用 raise SystemExit 报错，而 SystemExit 继承自
        # BaseException，except Exception 捕不到。
        # 后果：线程静默死掉、任务状态永远停在「运行中」，
        # 前端无限轮询（实测踩到，卡了 6 分钟没有任何反馈）。
        会话.更新(ident, 状态="失败", 错误=("%s: %s" % (type(e).__name__, e))[:500])

def 跑渲染(ident, 参数):
    """写布局文件 + 调渲染管线。"""
    try:
        from src.parser import flp as flp模块
        from src.parser import snapshot as 快照模块
        from src.audio import analyze as 分析模块
        from src.render import render as 渲染模块
        # cli 在 src/ 下（不是顶层），须按包导入
        from src import cli

        工作 = 会话.输出目录 / ("render_" + ident)
        工作.mkdir(parents=True, exist_ok=True)

        # 布局文件
        布局路径 = 工作 / "layout.json"
        布局路径.write_text(json.dumps({
            "版本": 1,
            "画布": 参数.get("画布") or {"w": 1920, "h": 1080},
            "主题": 参数.get("主题", "sumi"),
            "组件": 参数.get("组件", []),
        }, ensure_ascii=False, indent=1), encoding="utf-8")

        flp = 参数.get("flp")
        audio = 参数.get("audio")

        # ---- 复用导入时算好的结果 ----
        # 导入与渲染用的是同一个工程时，不必再解析与再分析一遍。
        # 长工程的分析要数分钟，重复一次是纯浪费。
        复用 = (会话.分析数据 is not None and 会话.快照 is not None
                and 会话.工程.get("flp") == flp
                and 会话.工程.get("audio") == audio)
        if 复用:
            会话.更新(ident, 阶段="复用已分析数据", 进度=0.06,
                     消息="跳过重复解析与分析")
            快照 = 会话.快照
            分析数据 = 会话.分析数据
        else:
            if not flp or not pathlib.Path(flp).is_file():
                raise RuntimeError("尚未导入工程，或 FLP 路径失效：%s" % flp)
            if not audio or not pathlib.Path(audio).is_file():
                raise RuntimeError("音频路径失效：%s" % audio)

            会话.更新(ident, 阶段="解析 FLP", 进度=0.02)
            原始 = flp模块.解析(flp)
            快照 = 快照模块.规范化(原始)
            # 必须先落盘：分析模块需要读快照文件
            # （初版漏了这步，分析直接抛「缺少快照」，任务卡死）
            快照模块.保存(快照, 工作 / "project_snapshot.json")

            会话.更新(ident, 阶段="分析音频", 进度=0.06)
            分析数据 = 分析模块.构建(audio, 工作 / "project_snapshot.json")

        会话.更新(ident, 阶段="组装渲染页", 进度=0.10)
        主题 = 参数.get("主题", "sumi")
        页面 = cli._组装页面(快照, 分析数据, 主题, 工作)

        # 默认按**工程长度**，不是音频长度 ——
        # 音频可能比工程短得多（island: 80.6s vs 165.9s），
        # 按音频会截掉后半段。音频不足处 ffmpeg 自动静音。
        默认时长 = (分析数据["audio"].get("projectDuration")
                    or 分析数据["audio"]["duration"])
        时长 = float(参数.get("时长") or 默认时长)
        起点 = float(参数.get("起点") or 0.0)
        帧率 = int(参数.get("帧率") or 30)

        # 起点 + 时长必须落在工程总长内。
        # ------------------------------------------------------------
        # 不 clamp 的话：起点 60 + 时长 120（工程 120 秒）会渲染
        # 60~180 秒，而 t>120 之后页面已无数据 —— 后 60 秒是同一张
        # 静止画面，用户看到的是「导出了 120 秒但后半段不动」。
        #
        # 前端已经做了 clamp 与提示，这里再拦一次：
        # /api/render 可被直接调用（cli、脚本、测试），不能只靠界面。
        总长 = float(默认时长)
        时长收窄 = None
        if 总长 > 0:
            if 起点 < 0:
                起点 = 0.0
            if 起点 >= 总长:
                # app_server 没有 渲染错误 这个类（它定义在 render.py）。
                # 用 RuntimeError：外层 except BaseException 能捕到，
                # 用户看到的错误信息也清楚。
                raise RuntimeError(
                    "起点 %.2f 秒超出工程长度 %.2f 秒" % (起点, 总长))
            剩余 = 总长 - 起点
            if 时长 > 剩余 + 0.01:
                时长收窄 = (时长, 剩余)
                时长 = 剩余
        # 至少一帧，否则 总帧数 会是 0
        时长 = max(时长, 1.0 / max(1, 帧率))

        def 进度回调(已渲, 总):
            p = 0.10 + 0.75 * (已渲 / max(1, 总))
            会话.更新(ident, 进度=round(p, 3), 阶段="渲染帧",
                     消息="%d / %d 帧" % (已渲, 总))
            if 会话.已取消(ident):
                raise RuntimeError("已取消")

        会话.更新(ident, 阶段="渲染帧", 进度=0.10)
        结果 = 渲染模块.渲染视频(
            页面路径=页面,
            输出路径=参数.get("输出") or (工作 / "out.mp4"),
            时长秒=时长,
            起始秒=起点,
            帧率=帧率,
            # GUI 发的是 画布:{w,h}（与布局文件同一形状），
            # 不是扁平的 宽/高。初版读错键名 → 静默回退 1920×1080，
            # 竖屏请求被无声地变成横屏（验收测试抓到）。
            宽=int((参数.get("画布") or {}).get("w")
                   or 参数.get("宽") or 1920),
            高=int((参数.get("画布") or {}).get("h")
                   or 参数.get("高") or 1080),
            码率=参数.get("码率"),
            预设=参数.get("预设") or "medium",
            音频路径=None if 参数.get("无音频") else audio,
            并行度=参数.get("并行度"),
            布局路径=布局路径,
            主题=主题,
            进度回调=进度回调,
        )
        # 键名是「输出」（render.py 的返回结构），不是「输出路径」。
        # 写错会得到字符串 "None" —— 它是真值，
        # 于是 /api/video 拿到一个不存在的路径才报 404，很难一眼看出。
        视频路径 = 结果.get("输出")
        会话.更新(ident, 状态="完成", 阶段="完成", 进度=1.0,
                 消息="", 产物={"视频": 视频路径,
                                "存在": bool(视频路径 and
                                           pathlib.Path(视频路径).is_file()),
                                "耗时": 结果.get("总耗时秒")},
                 结果=结果)
    except BaseException as e:
        # 同上：解析与渲染各层都用 raise SystemExit 报错，
        # 而 SystemExit 是 BaseException，except Exception 捕不到。
        会话.更新(ident, 状态="失败",
                 错误=("%s: %s" % (type(e).__name__, e))[:800])


# ---------------------------------------------------------------- HTTP

class 处理(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):
        # 安静一点：只记录错误
        if "40" in (fmt % a) or "50" in (fmt % a):
            sys.stderr.write("[http] " + (fmt % a) + "\n")

    def _发(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def _收(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return {}

    # ---- GET ----

    def _接收上传(self):
        """接收一个上传文件。

        请求头：
            X-File-Name    原始文件名（UTF-8，前端 encodeURIComponent 过）
            Content-Length 字节数
        请求体：文件原始字节

        返回 { ok, 路径, 名称, 字节 }
        """
        from urllib.parse import unquote

        原始名 = unquote(self.headers.get("X-File-Name") or "unnamed")
        # 只取 basename，防目录穿越
        名 = pathlib.Path(原始名.replace("\\", "/")).name
        if not 名:
            raise ValueError("文件名为空")

        扩展 = pathlib.Path(名).suffix.lower()
        if 扩展 not in 允许扩展名:
            raise ValueError(
                "不支持的文件类型：%s（只接受 %s）"
                % (扩展 or "(无扩展名)", "、".join(sorted(允许扩展名))))

        try:
            总长 = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            总长 = 0
        if 总长 <= 0:
            raise ValueError("缺少 Content-Length")
        if 总长 > 上传上限:
            raise ValueError("文件过大（%.0f MB，上限 %d MB）"
                             % (总长 / 1e6, 上传上限 // (1024 * 1024)))

        # 同名文件已存在时加序号，避免覆盖用户之前的导入
        目录 = _上传目录()
        目标 = 目录 / 名
        序 = 1
        while 目标.exists():
            目标 = 目录 / ("%s_%d%s" % (pathlib.Path(名).stem, 序, 扩展))
            序 += 1

        # 分块读边写，避免大文件读进内存
        剩 = 总长
        块 = 1024 * 256
        临时 = 目标.with_suffix(目标.suffix + ".part")
        try:
            with open(临时, "wb") as f:
                while 剩 > 0:
                    data = self.rfile.read(min(块, 剩))
                    if not data:
                        break
                    f.write(data)
                    剩 -= len(data)
            if 剩 != 0:
                raise ValueError("传输不完整（还差 %d 字节）" % 剩)
            临时.replace(目标)
        except Exception:
            try:
                临时.unlink(missing_ok=True)
            except Exception:
                pass
            raise

        return {
            "ok": True,
            "路径": str(目标),
            "名称": 目标.name,
            "字节": 目标.stat().st_size,
             "扩展": 扩展,
        }

    def do_GET(self):
        p = self.path.split("?")[0]
        if p in ("/", "/index.html"):
            if 会话.页面 is None:
                # 有已导入的工程就必须用它重建 ——
                # 否则打开工程后页面会变成「未导入」的空壳，
                # 组件没有数据、导出总长为 0（真实 bug）。
                工 = 会话.工程 or {}
                if 工.get("已导入") and 会话.分析数据:
                    构建工程页面()
                else:
                    构建空页面()
            elif 会话.需重建():
                # 模板被改过 —— 用同一份数据重建，避免一直返回旧页
                try:
                    会话.重构建()
                    sys.stderr.write("[页面] 模板已更新，已自动重建\n")
                except Exception as e:
                    sys.stderr.write("[页面] 重建失败：%s\n" % e)
            self._发(200, 会话.页面, "text/html; charset=utf-8")
            return
        if p == "/api/autosave":
            f = _自动保存文件()
            if not f.is_file():
                self._发(200, json.dumps({"有": False}, ensure_ascii=False))
                return
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
                self._发(200, json.dumps({
                    "有": True,
                    "时间": d.get("时间"),
                    "名称": (d.get("布局") and d.get("名称")) or
                            d.get("名称"),
                    "组件数": len((d.get("布局") or {}).get("组件") or []),
                }, ensure_ascii=False))
            except Exception:
                self._发(200, json.dumps({"有": False}, ensure_ascii=False))
            return

        if p == "/api/project/recent":
            self._发(200, json.dumps(
                {"工程": _最近工程()}, ensure_ascii=False))
            return

        if p == "/api/settings":
            self._发(200, json.dumps(_设置快照(), ensure_ascii=False))
            return

        if p == "/api/settings/dirs":
            self._发(200, json.dumps(_目录状态(), ensure_ascii=False))
            return

        if p == "/api/session":
            self._发(200, json.dumps(会话.工程, ensure_ascii=False))
            return
        if p == "/api/layout/list":
            目录 = 会话.输出目录 / "layouts"
            项 = []
            if 目录.is_dir():
                for f in sorted(目录.glob("*.json")):
                    项.append({"名称": f.name,
                              "大小": f.stat().st_size,
                              "时间": f.stat().st_mtime})
            self._发(200, json.dumps({"布局": 项}, ensure_ascii=False))
            return
        if p == "/api/job":
            q = self.path.split("?id=")
            t = 会话.取任务(q[1]) if len(q) > 1 else None
            self._发(200 if t else 404,
                     json.dumps(t or {"错误": "无此任务"}, ensure_ascii=False))
            return
        if p == "/api/video":
            q = self.path.split("?id=")
            t = 会话.取任务(q[1]) if len(q) > 1 else None
            if not t or not t.get("产物") or not t["产物"].get("视频"):
                self._发(404, json.dumps({"错误": "无产物"}, ensure_ascii=False))
                return
            f = pathlib.Path(t["产物"]["视频"])
            if not f.is_file():
                self._发(404, json.dumps({"错误": "文件不存在"}, ensure_ascii=False))
                return
            data = f.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self._发(404, json.dumps({"错误": "未知路径 " + p}, ensure_ascii=False))

    # ---- POST ----
    def do_POST(self):
        p = self.path.split("?")[0]

        # ---- 上传必须先于读 body ----
        # /api/upload 的请求体是文件原始字节，不是 JSON。
        # 若先调 self._收()，整个请求体已被当成 JSON 读走，
        # 上传处理再读时已无数据，请求会挂住到超时。
        if p == "/api/upload":
            try:
                结果 = self._接收上传()
                self._发(200, json.dumps(结果, ensure_ascii=False))
            except Exception as e:
                self._发(400, json.dumps(
                    {"ok": False, "错误": str(e)[:200]}, ensure_ascii=False))
            return

        body = self._收()

        if p == "/api/window":
            try:
                self._发(200, json.dumps(_窗口接口(body),
                                        ensure_ascii=False))
            except Exception as e:
                self._发(500, json.dumps(
                    {"ok": False, "错误": str(e)[:200]}, ensure_ascii=False))
            return

        if p == "/api/autosave":
            try:
                self._发(200, json.dumps(
                    _写自动保存(body), ensure_ascii=False))
            except Exception as e:
                self._发(500, json.dumps(
                    {"ok": False, "错误": str(e)[:200]}, ensure_ascii=False))
            return

        if p == "/api/autosave/restore":
            try:
                f = _自动保存文件()
                if not f.is_file():
                    raise ValueError("没有可恢复的自动保存")
                d = json.loads(f.read_text(encoding="utf-8"))

                # 与「打开工程」共用一套还原机制
                会话.待恢复 = {
                    "布局": d.get("布局") or {"组件": []},
                    "主题": d.get("主题") or "sumi",
                    "静帧秒": d.get("静帧秒") or 48.0,
                }
                会话.页面 = None      # 触发下次 GET / 重建

                # 引用可能还在，尽量把工程信息也接上
                工 = 会话.工程 or {}
                if not 工.get("flp") and d.get("flp"):
                    工 = dict(工)
                    工["flp"] = d.get("flp")
                    工["audio"] = d.get("audio")
                    会话.工程 = 工

                self._发(200, json.dumps({
                    "ok": True,
                    "组件数": len((d.get("布局") or {}).get("组件") or []),
                }, ensure_ascii=False))
            except Exception as e:
                self._发(500, json.dumps(
                    {"ok": False, "错误": str(e)[:200]}, ensure_ascii=False))
            return

        if p == "/api/autosave/clear":
            try:
                # **不要 unlink** —— 改成改名保留。
                # 用户点「取消」也会走这里，而自动保存里可能是
                # 尚未保存进 .flvproj 的最新画布状态。
                # 真实事故：误点一次就永久丢了 9 个组件的改动。
                # 只保留最近一份丢弃副本，不会无限累积。
                _丢弃自动保存()
                self._发(200, json.dumps({"ok": True}, ensure_ascii=False))
            except Exception as e:
                self._发(500, json.dumps(
                    {"ok": False, "错误": str(e)[:200]}, ensure_ascii=False))
            return

        if p == "/api/pair/audio":
            try:
                self._发(200, json.dumps(
                    _配对音频(body.get("flp")), ensure_ascii=False))
            except Exception as e:
                self._发(500, json.dumps(
                    {"ok": False, "错误": str(e)[:200]}, ensure_ascii=False))
            return

        if p == "/api/session/reset":
            try:
                会话.工程 = None
                会话.工程路径 = None
                会话.脏 = False
                会话.分析数据 = None
                会话.页面 = None
                会话.待恢复 = None
                with 会话.锁:
                    会话.工程 = None
                # 立即重建空页面，保证下次 GET / 就是干净的导入界面
                构建空页面()
                self._发(200, json.dumps(
                    {"ok": True, "会话": 会话.工程}, ensure_ascii=False))
            except Exception as e:
                self._发(500, json.dumps(
                    {"ok": False, "错误": str(e)[:200]}, ensure_ascii=False))
            return

        if p == "/api/project/pick":
            选 = 选文件("project")
            self._发(200, json.dumps(选, ensure_ascii=False))
            return

        if p == "/api/project/save":
            try:
                结果 = _保存工程(body)
                self._发(200, json.dumps(结果, ensure_ascii=False))
            except Exception as e:
                self._发(500, json.dumps(
                    {"ok": False, "错误": str(e)[:300]}, ensure_ascii=False))
            return

        if p == "/api/project/open":
            try:
                结果 = _打开工程(body.get("路径"))
                self._发(200, json.dumps(结果, ensure_ascii=False))
            except Exception as e:
                self._发(500, json.dumps(
                    {"ok": False, "错误": str(e)[:300]}, ensure_ascii=False))
            return

        if p == "/api/project/forget":
            路径 = body.get("路径") or ""
            设置 = 设置模块.读设置()
            最近 = [x for x in (设置.get("最近工程") or [])
                    if pathlib.Path(x).resolve() !=
                    pathlib.Path(路径).resolve()] if 路径 else []
            设置模块.改设置({"最近工程": 最近})
            self._发(200, json.dumps({"ok": True}, ensure_ascii=False))
            return

        if p == "/api/settings":
            补丁 = body.get("补丁") or body
            try:
                新设置 = 设置模块.改设置(补丁)
                # 语言改了**不重建页面** —— 前端 切换语言() 即时生效。
                # 重建会用空页面覆盖，丢掉已导入的工程（真实 bug）。
                self._发(200, json.dumps({
                    "ok": True, "设置": _设置快照(新设置),
                }, ensure_ascii=False))
            except Exception as e:
                self._发(500, json.dumps({"ok": False, "错误": str(e)},
                                        ensure_ascii=False))
            return

        if p == "/api/settings/reset":
            组 = body.get("组")
            try:
                新设置 = 设置模块.恢复默认(组)
                # **不要**置 会话.页面 = None —— 那会触发用「空页面」
                # 重建，把已导入的工程冲掉（真实 bug：点「恢复默认」
                # 后画布变空）。设置变更由前端即时应用，无需重建。
                self._发(200, json.dumps({
                    "ok": True, "设置": _设置快照(新设置),
                }, ensure_ascii=False))
            except Exception as e:
                self._发(500, json.dumps({"ok": False, "错误": str(e)},
                                        ensure_ascii=False))
            return

        if p == "/api/pick":
            # 返回 {"path": ...} 而不是裸字符串 ——
            # 前端读的是 r.path，格式不符会被当成「用户取消」，
            # 表现为「选了文件但没反应」。
            try:
                选中 = 选文件(body.get("kind", "flp"))
                self._发(200, json.dumps(
                    {"path": 选中 or ""}, ensure_ascii=False))
            except Exception as e:
                self._发(200, json.dumps(
                    {"error": str(e)[:200]}, ensure_ascii=False))
            return

        if p == "/api/import":
            flp, audio = body.get("flp"), body.get("audio")
            if not flp or not pathlib.Path(flp).is_file():
                self._发(400, json.dumps({"错误": "FLP 文件不存在：%s" % flp},
                                        ensure_ascii=False))
                return
            if not audio or not pathlib.Path(audio).is_file():
                self._发(400, json.dumps({"错误": "音频文件不存在：%s" % audio},
                                        ensure_ascii=False))
                return
            ident = 会话.建任务("导入", pathlib.Path(flp).name)
            threading.Thread(target=跑导入, args=(ident, flp, audio),
                             daemon=True).start()
            self._发(200, json.dumps({"id": ident}, ensure_ascii=False))
            return

        if p == "/api/render":
            ident = 会话.建任务("渲染", "导出视频")
            threading.Thread(target=跑渲染, args=(ident, body),
                             daemon=True).start()
            self._发(200, json.dumps({"id": ident}, ensure_ascii=False))
            return

        if p == "/api/cancel":
            ident = body.get("id")
            会话.更新(ident, 取消=True, 阶段="取消中")
            self._发(200, json.dumps({"ok": True}, ensure_ascii=False))
            return

        # ---- 布局存取 ----
        # 浏览器不能读写任意路径，故由服务代劳。
        # 只取文件名（Path.name）防止越出布局目录。
        if p == "/api/layout/save":
            名称 = pathlib.Path(body.get("名称") or "layout").name
            if not 名称.endswith(".json"):
                名称 += ".json"
            目录 = 会话.输出目录 / "layouts"
            目录.mkdir(parents=True, exist_ok=True)
            f = 目录 / 名称
            f.write_text(json.dumps(body.get("布局") or {},
                                   ensure_ascii=False, indent=1),
                         encoding="utf-8")
            self._发(200, json.dumps({"ok": True, "路径": str(f),
                                     "名称": 名称}, ensure_ascii=False))
            return

        if p == "/api/layout/load":
            名称 = pathlib.Path(body.get("名称") or "").name
            # 与保存对称：允许不带扩展名（否则读回必然 404）
            if 名称 and not 名称.endswith(".json"):
                名称 += ".json"
            f = 会话.输出目录 / "layouts" / 名称
            if not f.is_file():
                self._发(404, json.dumps({"错误": "没有这个布局：%s" % 名称},
                                        ensure_ascii=False))
                return
            self._发(200, f.read_text(encoding="utf-8"),
                    "application/json; charset=utf-8")
            return

        if p == "/api/layout/delete":
            名称 = pathlib.Path(body.get("名称") or "").name
            if 名称 and not 名称.endswith(".json"):
                名称 += ".json"
            f = 会话.输出目录 / "layouts" / 名称
            if f.is_file():
                f.unlink()
            self._发(200, json.dumps({"ok": True}, ensure_ascii=False))
            return

        self._发(404, json.dumps({"错误": "未知路径 " + p}, ensure_ascii=False))


def 启动应用模式(端口=0, 打开窗口=None):
    """起服务后用「应用窗口」打开（无地址栏的独立窗口）。

    与 启动() 的区别只在如何呈现：
      启动()          用默认浏览器开一个标签页
      启动应用模式()  调用 打开窗口(端口) —— 通常是浏览器的 --app 模式

    为什么把打开方式做成回调：
      自检/测试时不想真的弹窗口，传 None 即可只起服务。
    """
    _初始页面()
    服务器 = ThreadingHTTPServer(("127.0.0.1", 端口), 处理)
    实际端口 = 服务器.server_address[1]
    地址 = "http://127.0.0.1:%d/" % 实际端口

    print("Audiovis 已启动")
    print("  地址 %s" % 地址)
    print("  工程 %s" % (会话.工程.get("name") or "（未导入）"))
    print("  按 Ctrl+C 退出（关闭窗口不会退出服务）")
    print()

    if 打开窗口:
        # 等服务真正开始监听再开窗口，否则窗口会显示「无法访问」
        def _开():
            import time
            time.sleep(0.8)
            try:
                打开窗口(实际端口)
            except Exception as e:
                print("  打开窗口失败：%s" % e)
                import webbrowser
                webbrowser.open(地址)
        threading.Thread(target=_开, daemon=True).start()

    try:
        服务器.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出")
    finally:
        服务器.server_close()
    return 0


def 启动(端口=0, 自动打开=True):
    _初始页面()
    服务器 = ThreadingHTTPServer(("127.0.0.1", 端口), 处理)
    实际端口 = 服务器.server_address[1]
    地址 = "http://127.0.0.1:%d/" % 实际端口
    print("Audiovis 已启动")
    print("  地址 %s" % 地址)
    print("  工程 %s" % (会话.工程.get("name") or "（未导入）"))
    print("  按 Ctrl+C 退出")
    if 自动打开:
        threading.Timer(0.6, lambda: webbrowser.open(地址)).start()
    try:
        服务器.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出")
    finally:
        服务器.server_close()
    return 0


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Audiovis 本地服务")
    ap.add_argument("--port", type=int, default=0, help="端口（0=自动）")
    ap.add_argument("--no-open", action="store_true", help="不自动打开浏览器")
    ap.add_argument("--demo", action="store_true",
                    help="用内置示例工程启动（开发对照用）")
    a = ap.parse_args()
    # 模块级赋值，不能用 global（那是函数内才需要的）
    用示例启动 = a.demo
    sys.exit(启动(a.port, not a.no_open))
