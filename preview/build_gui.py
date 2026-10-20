"""构建 GUI 页面：**直接从 src/ 组装**，不再从旧渲染页提取。

## 修正的问题

之前的做法是从 out/work_nujabes/render_page.html 提取组件代码。
那个文件是若干轮前生成的**旧产物**，里面的 theme.js 是旧版
（panelBackground 只有 182 字符，无边缘柔化）。

后果：我修改了 src/core/theme.js 加入柔化，但 GUI 原型里根本没生效 ——
用户看不到柔化，而我还以为已经改好了。

现在改为：用与 build.py 相同的模块清单，直接从 src/ 组装。
这样源码一改，GUI 立即反映，不存在"旧产物"这个中间层。

## 本文件既是脚本也是模块

  直接运行          构建示例工程（nujabes）的 GUI → preview/gui_prototype.html
  导入后调用 构建页面()  用任意工程的快照/分析数据构建 —— 供本地服务使用

根目录不再写死，改为从 __file__ 推导（服务端可能在别处启动）。
"""
import importlib
import json
import pathlib
import re
import sys

_初始根 = pathlib.Path(__file__).resolve().parent.parent
try:
    import sys as _s
    if str(_初始根) not in _s.path:
        _s.path.insert(0, str(_初始根))
    from src.runtime import 资源根 as _资源根
    根 = _资源根()
except Exception:
    根 = _初始根
SRC = 根 / "src"
# 模块化后的入口（G0-2）。旧的单体模板保留，供对照与回退。
模板文件 = 根 / "preview" / "gui" / "index.html"
模板文件_单体 = 根 / "preview" / "gui_v2_template.html"
输出 = 根 / "preview" / "gui_prototype.html"

# 复用 build.py 的模块清单，保证与 dist/ 产物完全一致。
# 按**文件路径**加载而不是 `import build`：
# build 是个太常见的名字，打包后会撞到别的模块
# （实测 AttributeError: module 'build' has no attribute 'collect'）。
import importlib.util as _ilu

_构建脚本 = SRC / "build" / "build.py"
_spec = _ilu.spec_from_file_location("flv_build", _构建脚本)
if _spec is None or _spec.loader is None:
    raise SystemExit("找不到构建脚本：%s" % _构建脚本)
build = _ilu.module_from_spec(_spec)
sys.modules["flv_build"] = build
_spec.loader.exec_module(build)


def 读取清单():
    return {
        "canvas-kit": build.collect(["canvas-kit.js"], SRC / "core"),
        "bindings": build.collect(build.PRE_FILES, SRC / "app"),
        "core": build.collect(
            [f for f in build.CORE_FILES if f != "canvas-kit.js"], SRC / "core"),
        "bloom": build.collect(build.BLOOM_FILES, SRC / "bloom"),
        "components": build.collect(build.COMPONENT_FILES, SRC / "components"),
    }


def 读缓存数据():
    """从缓存读取分析数据（与 build.py 相同来源）。"""
    缓存 = 根 / "preview" / ".cache" / "analysis.json"
    if not 缓存.is_file():
        raise SystemExit("缺少分析缓存，请先运行 preview/audio_analysis.py")
    数据 = json.loads(缓存.read_text(encoding="utf-8"))["data"]

    快照 = json.loads(
        (根 / "data" / "projects" / "nujabes" / "project_snapshot.json")
        .read_text(encoding="utf-8"))

    载荷 = {
        "audio": 数据["audio"],
        "waveform": 数据["waveform"],
        "spectrogram": 数据["spectrogram"],
        "vectorscope": 数据["vectorscope"],
        "timeline": 数据["timeline"],
        "patternShapes": 数据["patternShapes"],
        "pitchHistogram": 数据["pitchHistogram"],
        "pitchRange": 数据["pitchRange"],
        "patternUsage": 数据["patternUsage"],
        "features": 数据["features"],
        "sections": 数据["sections"],
        "trackActivity": 数据["trackActivity"],
        "patternMatrix": 数据["patternMatrix"],
        "drumGroups": 数据["drumGroups"],
        "drumUsage": 数据["drumUsage"],
        "drumStats": 数据.get("drumStats") or {},
        # 疑似鼓组但未纳入 —— 界面据此提示用户「加 #step」
        "drumMissed": 数据.get("drumMissed") or [],
        "drumAudio": 数据.get("drumAudio") or {},
        "previewTime": 48.0,
        "projectName": 快照.get("metadata", {}).get("title") or "nujabes",
    }
    return 载荷, 快照


def 读方向():
    方向文件 = 根 / "preview" / "themes" / "artdirections.json"
    return json.loads(方向文件.read_text(encoding="utf-8"))


def 构建页面(载荷, 方向, 主题键="sumi", 模板路径=None,
             工程信息=None, 服务模式=False, 语言="zh", 待恢复=None):
    """用给定的数据构建 GUI HTML，返回字符串。

    载荷      分析数据（含 projectName / timeline 等，形状同 build.py 的载荷）
    方向      artdirections.json 的内容
    主题键    初始主题
    工程信息  可选 {flp, audio, name, duration}，注入给导出面板用
    服务模式  True 时页面知道自己在服务下运行（显示导入/导出面板）
    """
    模块 = 读取清单()
    模板路径 = 模板路径 or 模板文件

    头部 = [
        "const DATA = %s;" % json.dumps(
            载荷, ensure_ascii=False, separators=(",", ":")),
        "const DIRECTIONS = %s;" % json.dumps(
            方向, ensure_ascii=False, separators=(",", ":")),
        "window.__THEME__ = DIRECTIONS.directions[%s];" % json.dumps(主题键),
        "window.__THEME_KEY__ = %s;" % json.dumps(主题键),
    ]
    if 工程信息 is not None:
        头部.append("window.__PROJECT__ = %s;" % json.dumps(
            工程信息, ensure_ascii=False, separators=(",", ":")))
    头部.append("window.__APP_MODE__ = %s;" % json.dumps(bool(服务模式)))
    # 语言：由调用方从 settings.json 读出后传入（不传则中文）
    头部.append("window.__LANG__ = %s;" % json.dumps(语言 or "zh"))
    # 打开工程时带进来的布局：前端据此还原画布
    if 待恢复:
        头部.append("window.__RESTORE__ = %s;" % json.dumps(
            待恢复, ensure_ascii=False, separators=(",", ":")))

    脚本 = "\n\n".join(头部 + [
        模块["canvas-kit"],
        模块["bindings"],
        模块["core"],
        模块["bloom"],
        模块["components"],
    ])

    结果 = 模板路径.read_text(encoding="utf-8")

    # ---- 内联外链的 CSS / JS ----
    # 产物保持单文件（服务端直接发字符串、测试用 file:// 打开、
    # 与导出页 src/render/page.html 的形态一致）。
    结果 = _内联资源(结果, 模板路径.parent)

    结果 = 结果.replace("/*__COMPONENT_CODE__*/", 脚本)

    模板json = 根 / "preview" / "templates.json"
    if not 模板json.is_file():
        raise SystemExit("找不到 templates.json，请先运行 preview/design_templates.py")
    结果 = 结果.replace("/*__TEMPLATES__*/", 模板json.read_text(encoding="utf-8"))
    return 结果


def _内联资源(html, 基准目录):
    """把 <link rel=stylesheet href=...> 与 <script src=...> 换成内联内容。

    顺序必须保持原样 —— CSS 的层叠与 JS 的执行顺序都依赖它。
    找不到文件时保留原标签并告警，不静默失败
    （静默失败会表现为「样式丢了但页面还能开」，极难排查）。
    """
    import re as _re

    def 换样式(m):
        href = m.group(1)
        f = (基准目录 / href).resolve()
        if not f.is_file():
            print("[build_gui] 警告：样式不存在 %s" % f)
            return m.group(0)
        return "<style>\n" + f.read_text(encoding="utf-8") + "\n</style>"

    结果 = _re.sub(
        r'<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>', 换样式, html)

    def 换脚本(m):
        src = m.group(1)
        f = (基准目录 / src).resolve()
        if not f.is_file():
            print("[build_gui] 警告：脚本不存在 %s" % f)
            return m.group(0)
        return "<script>\n" + f.read_text(encoding="utf-8") + "\n</script>"

    结果 = _re.sub(r'<script[^>]+src="([^"]+)"[^>]*></script>', 换脚本, 结果)
    return 结果


def 自检(结果):
    return {
        "含组件代码": "register({" in 结果,
        "组件数": len(re.findall(r"register\(\{", 结果)),
        "**含边缘柔化**": "createLinearGradient" in 结果 and "EDGE_FADE" in 结果,
        "含 setActiveTheme": "function setActiveTheme" in 结果,
        "含 bloomFor": "function bloomFor" in 结果,
        "含 绘制组件实例": "function 绘制组件实例" in 结果,
        "模板数": 结果.count('"land":'),
        "未替换占位符": ("/*__COMPONENT_CODE__*/" not in 结果
                    and "/*__TEMPLATES__*/" not in 结果),
    }


if __name__ == "__main__":
    import sys as _sys

    # --legacy：用旧的单体模板构建到 gui_legacy.html
    # 用途：拆分等价性验证（新旧模板同数据构建 → 逐像素比对）
    _legacy = "--legacy" in _sys.argv
    _输出 = 输出.parent / "gui_legacy.html" if _legacy else 输出
    _模板 = 模板文件_单体 if _legacy else 模板文件

    载荷, 快照 = 读缓存数据()
    方向 = 读方向()
    结果 = 构建页面(载荷, 方向, 模板路径=_模板)
    _输出.write_text(结果, encoding="utf-8")
    输出 = _输出

    检查 = 自检(结果)
    print(json.dumps({
        "状态": "完成" if all(v is not False and v != 0
                          for v in 检查.values()) else "有警告",
        "输出": str(输出),
        "大小MB": round(输出.stat().st_size / 1e6, 2),
        "自检": 检查,
    }, ensure_ascii=False, indent=1))
