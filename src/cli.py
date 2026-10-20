"""FL Studio Music Project Visualizer · 命令行入口

一条命令完成：FLP + 音频 → 视频。

用法：
    python -m src.cli render --flp <工程.flp> --audio <音频> --out <输出.mp4>
    python -m src.cli render --flp x.flp --audio y.mp3 --theme sumi --fps 30
    python -m src.cli snapshot --flp <工程.flp> --out snapshot.json
    python -m src.cli themes          # 列出可用主题
    python -m src.cli components      # 列出可用组件

设计：
  · 子命令清晰分离：解析、分析、渲染可单独调用
  · 中间产物可保存（便于调试与复用）
  · 失败时给出可操作的错误信息，不静默
"""
import argparse
import json
import pathlib
import sys
import time

# 让 src 成为可导入包
根 = pathlib.Path(__file__).resolve().parents[1]
if str(根) not in sys.path:
    sys.path.insert(0, str(根))

from src.parser import flp as flp模块
from src.parser import snapshot as 快照模块


def 命令_snapshot(参数):
    """只做解析：FLP → Snapshot JSON。"""
    起 = time.perf_counter()
    print("[1/2] 解析 FLP: %s" % 参数.flp)
    原始 = flp模块.解析(参数.flp)
    项目 = 原始["项目"]
    print("      版本=%s  PPQ=%s  Tempo=%s" % (
        项目["fl_version"], 项目["ppq"], 项目["tempo"]))

    print("[2/2] 规范化")
    快照 = 快照模块.规范化(原始)
    输出 = pathlib.Path(参数.out)
    快照模块.保存(快照, 输出)

    统计 = 快照模块.统计(快照)
    统计["耗时秒"] = round(time.perf_counter() - 起, 2)
    统计["输出"] = str(输出)
    print(json.dumps(统计, ensure_ascii=False, indent=1))


def 命令_themes(参数):
    """列出可用主题。"""
    方向文件 = 根 / "preview" / "themes" / "artdirections.json"
    if not 方向文件.is_file():
        sys.exit("找不到主题定义：%s" % 方向文件)
    数据 = json.loads(方向文件.read_text(encoding="utf-8"))
    print("可用主题（%d 个）：\n" % len(数据["order"]))
    for 键 in 数据["order"]:
        项 = 数据["directions"][键]
        print("  %-14s %-12s %s" % (键, 项["name"], 项["concept"][:44]))
    print("\n用法：--theme <键>")


def 命令_components(参数):
    """列出可用组件。"""
    # 从构建产物中提取组件清单（避免重复维护）
    产物 = 根 / "dist" / "components.html"
    if not 产物.is_file():
        sys.exit("找不到构建产物，请先运行：python src/build/build.py")
    文本 = 产物.read_text(encoding="utf-8")
    import re
    项 = re.findall(
        r"register\(\{\s*id:'([^']+)',\s*name:'([^']+)',\s*w:(\d+),\s*h:(\d+),"
        r"\s*group:'([^']+)'", 文本)
    if not 项:
        sys.exit("未能从构建产物中解析组件清单")
    print("可用组件（%d 个）：\n" % len(项))
    当前组 = None
    for cid, name, w, h, group in 项:
        if group != 当前组:
            print("  [%s]" % group)
            当前组 = group
        print("    %-14s %-10s %sx%s" % (cid, name, w, h))


def 命令_render(参数):
    """完整流程：解析 → 分析 → 渲染 → 编码。"""
    from src.audio import analyze as 分析模块
    from src.render import render as 渲染模块

    起 = time.perf_counter()
    工作目录 = pathlib.Path(参数.workdir) if 参数.workdir else None
    if 工作目录:
        工作目录.mkdir(parents=True, exist_ok=True)

    # ---- 1. 解析 ----
    print("[1/5] 解析 FLP")
    原始 = flp模块.解析(参数.flp)
    快照 = 快照模块.规范化(原始)
    统计 = 快照模块.统计(快照)
    print("      PPQ=%s Tempo=%s 轨道=%d clip=%d pattern=%d 音符=%d" % (
        统计["ppq"], 统计["tempo"], 统计["有内容轨道"],
        统计["clip总数"], 统计["pattern数"], 统计["音符总数"]))

    if 工作目录:
        快照模块.保存(快照, 工作目录 / "project_snapshot.json")
        print("      → %s" % (工作目录 / "project_snapshot.json"))

    # ---- 2. 音频分析 ----
    print("[2/5] 分析音频")
    分析起 = time.perf_counter()
    分析数据 = 分析模块.构建(参数.audio, 工作目录 / "project_snapshot.json"
                            if 工作目录 else _临时快照(快照))
    print("      时长=%.1fs 频谱帧=%d 鼓组=%d 耗时=%.1fs" % (
        分析数据["audio"]["duration"],
        分析数据["spectrogram"]["frames"],
        len(分析数据["drumGroups"]),
        time.perf_counter() - 分析起))

    # ---- 3. 组装页面 ----
    print("[3/5] 组装渲染页面")
    页面 = _组装页面(快照, 分析数据, 参数.theme, 工作目录)
    print("      → %s" % 页面)

    # ---- 4-5. 渲染 + 编码 ----
    # 默认按工程长度（音频可能比工程短）
    时长 = (参数.duration
            or 分析数据["audio"].get("projectDuration")
            or 分析数据["audio"]["duration"])
    起点 = 参数.start or 0.0
    print("[4/5] 渲染 %d 帧 @%dfps（%.1fs ~ %.1fs）" % (
        int(round(时长 * 参数.fps)), 参数.fps, 起点, 起点 + 时长))
    print("[5/5] 编码 H.264")

    结果 = 渲染模块.渲染视频(
        页面路径=页面,
        输出路径=参数.out,
        时长秒=时长,
        起始秒=起点,
        帧率=参数.fps,
        宽=参数.width,
        高=参数.height,
        码率=参数.bitrate,
        预设=参数.preset,
        保留帧=参数.keep_frames,
        音频路径=None if 参数.no_audio else 参数.audio,
        并行度=参数.parallel,
        # 布局：GUI 导出的 layout.json。
        # 不传则用页面内置兜底布局，导出结果与 GUI 所见不一致。
        布局路径=getattr(参数, "layout", None),
        主题=参数.theme,
    )

    结果["总耗时秒"] = round(time.perf_counter() - 起, 2)
    print()
    print(json.dumps(结果, ensure_ascii=False, indent=1))


def _临时快照(快照):
    """无工作目录时，把快照写到临时文件供分析模块读取。"""
    import tempfile
    p = pathlib.Path(tempfile.gettempdir()) / "flv_snapshot_tmp.json"
    快照模块.保存(快照, p)
    return p


def _组装页面(快照, 分析数据, 主题键, 工作目录):
    """把快照 + 分析数据 + 组件代码注入渲染页面模板。"""
    根目录 = pathlib.Path(__file__).resolve().parents[1]
    模板 = 根目录 / "src" / "render" / "page.html"
    if not 模板.is_file():
        sys.exit("缺少页面模板：%s" % 模板)

    方向文件 = 根目录 / "preview" / "themes" / "artdirections.json"
    方向 = json.loads(方向文件.read_text(encoding="utf-8"))
    if 主题键 not in 方向["directions"]:
        sys.exit("未知主题：%s（可用：%s）" % (
            主题键, ", ".join(方向["order"])))

    载荷 = dict(分析数据)
    载荷["timeline"] = _时间轴(快照, 分析数据)
    载荷["projectName"] = 快照["metadata"].get("title") or "project"

    # 复用 build.py 的模块清单，保证渲染页与预览台用**同一份**组件代码
    sys.path.insert(0, str(根目录 / "src" / "build"))
    import importlib
    build = importlib.import_module("build")

    js = "\n\n".join([
        build.collect(["canvas-kit.js"], 根目录 / "src" / "core"),
        build.collect(build.PRE_FILES, 根目录 / "src" / "app"),
        build.collect([f for f in build.CORE_FILES if f != "canvas-kit.js"],
                      根目录 / "src" / "core"),
        build.collect(build.BLOOM_FILES, 根目录 / "src" / "bloom"),
        build.collect(build.COMPONENT_FILES, 根目录 / "src" / "components"),
    ])

    内容 = 模板.read_text(encoding="utf-8")
    内容 = 内容.replace("__DATA__", json.dumps(
        载荷, ensure_ascii=False, separators=(",", ":")))
    内容 = 内容.replace("__DIRECTIONS__", json.dumps(
        方向, ensure_ascii=False, separators=(",", ":")))
    内容 = 内容.replace("__THEMEKEY__", json.dumps(主题键))
    内容 = 内容.replace("/*__SCRIPT__*/", js)

    输出 = (工作目录 / "render_page.html") if 工作目录 else \
        pathlib.Path(__import__("tempfile").gettempdir()) / "flv_page.html"
    输出.write_text(内容, encoding="utf-8")
    return 输出


def _时间轴(快照, 分析数据):
    """分析模块的 timeline 已含大部分内容；此处补齐 projectName 等。"""
    t = dict(分析数据["timeline"])
    t["projectName"] = 快照["metadata"].get("title") or "project"
    return t


def 主程序():
    ap = argparse.ArgumentParser(
        prog="flv",
        description="FL Studio Music Project Visualizer")
    子 = ap.add_subparsers(dest="命令", required=True)

    # snapshot
    p1 = 子.add_parser("snapshot", help="解析 FLP 并输出 Snapshot JSON")
    p1.add_argument("--flp", required=True, help="FLP 文件路径")
    p1.add_argument("--out", required=True, help="输出 JSON 路径")
    p1.set_defaults(函数=命令_snapshot)

    # themes
    p2 = 子.add_parser("themes", help="列出可用主题")
    p2.set_defaults(函数=命令_themes)

    # components
    p3 = 子.add_parser("components", help="列出可用组件")
    p3.set_defaults(函数=命令_components)

    # render
    p4 = 子.add_parser("render", help="完整流程：生成视频")
    p4.add_argument("--flp", required=True, help="FLP 文件路径")
    p4.add_argument("--audio", required=True, help="音频文件路径")
    p4.add_argument("--out", required=True, help="输出 mp4 路径")
    p4.add_argument("--theme", default="sumi", help="主题键（默认 sumi）")
    p4.add_argument("--fps", type=int, default=30, help="帧率（默认 30）")
    p4.add_argument("--width", type=int, default=1920, help="宽（默认 1920）")
    p4.add_argument("--height", type=int, default=1080, help="高（默认 1080）")
    p4.add_argument("--duration", type=float, default=None,
                    help="时长秒（默认取工程全长；工程比音频长时，音频结束后静音）")
    p4.add_argument("--start", type=float, default=0.0,
                    help="起始秒（默认 0，用于渲染指定片段）")
    p4.add_argument("--bitrate", default=None,
                    help="码率如 12M；默认用 CRF 质量控制")
    p4.add_argument("--preset", default="medium",
                    help="x264 预设（ultrafast~veryslow）。"
                         "实测 ultrafast 比 medium 快 1.68×")
    p4.add_argument("--parallel", type=int, default=None,
                    help="渲染进程数（默认自动，实测最优 4 路）。"
                         "实测 2 路 1.60×、4 路 1.89×、6 路 1.76×")
    p4.add_argument("--layout", default=None,
                    help="GUI 导出的 layout.json。不传则用页面内置兜底布局，导出结果与 GUI 所见不一致")
    p4.add_argument("--workdir", default=None,
                    help="中间产物目录（便于调试）")
    p4.add_argument("--keep-frames", action="store_true",
                    help="保留中间帧（调试用）")
    p4.add_argument("--no-audio", action="store_true",
                    help="不混流音轨（默认会混流）")
    p4.set_defaults(函数=命令_render)

    参数 = ap.parse_args()
    参数.函数(参数)


if __name__ == "__main__":
    主程序()
