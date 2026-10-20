"""离线渲染器：Snapshot + 音频分析 → 逐帧画面 → 视频。

架构：
  Python 侧（本模块）
    · 组装渲染数据
    · 启动无头浏览器（可多进程分片）
    · 逐帧取回图像
    · 调用 ffmpeg 编码（并混流音轨）
  JS 侧（src/render/capture_v2.mjs）
    · 复用已验证的组件代码
    · 按帧号渲染指定时刻
    · 通过 HTTP 直传二进制帧（避免 base64 与 CDP 序列化）

性能设计（均有实测依据，见 docs/PERF_AUDIT.md）：
  · **HTTP 二进制传输** —— 实测 32.2 ms/帧，对比 CDP+base64 的 66.2 ms/帧
  · **多进程分片** —— 实测 4 路 1.89×（非线性，6 路反而下降）
  · 时间由**帧号**换算，不由实际耗时决定 —— 保证输出的确定性
  · 编码预设可调 —— ultrafast 比 medium 快 1.68×
"""
import json
import pathlib
import shutil
import subprocess
import sys

# Windows 上启动控制台子进程时**不弹窗口**。
# ------------------------------------------------------------
# 打包版是 console=False 的 GUI 进程，它启动的每个控制台子进程
# （node.exe / ffmpeg.exe）默认会新开一个黑色窗口 —— 用户明确不能接受。
#
# 用 CREATE_NO_WINDOW（0x08000000）而不是 DETACHED_PROCESS：
# 后者会让子进程完全脱离，capture_output 的管道可能失效。
_无窗口 = getattr(subprocess, "CREATE_NO_WINDOW", 0) \
    if sys.platform == "win32" else 0
import sys as _sys
import sys
import tempfile
import time

根 = pathlib.Path(__file__).resolve().parents[2]


class 渲染错误(Exception):
    pass


def _找浏览器():
    """定位无头浏览器。优先 Chrome，回退 Edge。"""
    候选 = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for c in 候选:
        if pathlib.Path(c).is_file():
            return c
    raise 渲染错误(
        "未找到 Chrome 或 Edge。渲染需要其中之一。\n"
        "已查找：\n  " + "\n  ".join(候选))


def _找ffmpeg():
    """定位 ffmpeg。

    统一走 `runtime.ffmpeg路径()` —— 它处理了打包版
    （模块在 PYZ 里时 `imageio_ffmpeg.get_ffmpeg_exe()` 的返回值不可靠，
    需显式到已知目录 glob）。只保留一份查找实现，避免两处分叉。
    """
    try:
        from src.runtime import ffmpeg路径
        p = ffmpeg路径()
        if p:
            return p
    except Exception:
        pass

    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    p = shutil.which("ffmpeg")
    if p:
        return p
    raise 渲染错误(
        "未找到 ffmpeg。请安装：pip install imageio-ffmpeg\n"
        "（该包自带 ffmpeg 二进制，无需单独安装）")


def 推荐并行度():
    """推荐的并行进程数。

    实测依据（600 帧测试，本机 8 物理核 / 16 逻辑核）：
      1 路 38.07 ms/帧  1.00×
      2 路 23.84 ms/帧  1.60×
      4 路 20.16 ms/帧  1.89×  ← 最优
      6 路 21.59 ms/帧  1.76×  ← 已下降

    故默认 4 路；核数不足时相应降低。
    """
    import os
    try:
        核 = os.cpu_count() or 4
    except Exception:
        核 = 4
    物理估计 = max(1, 核 // 2)
    return max(1, min(4, 物理估计))


def _解析渲染输出(stdout):
    """从 node 输出中提取 RESULT= 的 JSON。"""
    for 行 in stdout.splitlines():
        if 行.startswith("RESULT="):
            try:
                return json.loads(行[len("RESULT="):])
            except Exception:
                pass
    return {}


def _渲染单片(脚本, 浏览器, 页面路径, 帧目录, 总帧数, 帧率,
             宽, 高, 起始秒, 超时秒, 起点=None, 终点=None,
             布局路径=None, 主题=None):
    """渲染单个帧区间（单进程）。"""
    # node 路径：打包后在 bundles/ 里，源码运行时用系统的 PATH。
    # 不能用裸 "node" —— 打包后如果用户没装 Node 会 FileNotFoundError。
    from src.runtime import node路径
    _node = node路径()
    if not _node:
        raise 渲染错误(
            "找不到 Node.js。视频渲染需要它。\n"
            "若这是打包版，说明程序不完整；源码运行时请安装 Node.js。")

    命令 = [
        _node, str(脚本),
        "--page", str(页面路径),
        "--out", str(帧目录),
        "--frames", str(总帧数),
        "--fps", str(帧率),
        "--width", str(宽),
        "--height", str(高),
        "--start", str(起始秒),
        "--transport", "http",
        "--browser", 浏览器,
    ]
    if 起点 is not None and 终点 is not None:
        命令 += ["--range", "%d:%d" % (起点, 终点)]
    # 布局与主题：渲染端据此复现 GUI 的设计（缺省则用页面兜底布局）
    if 布局路径:
        命令 += ["--layout", str(布局路径)]
    if 主题:
        命令 += ["--theme", str(主题)]

    进程 = subprocess.run(命令, capture_output=True, timeout=超时秒,
                          creationflags=_无窗口)
    if 进程.returncode != 0:
        错误 = 进程.stderr.decode("utf-8", "replace")[-800:]
        raise 渲染错误("帧渲染失败（退出码 %d）：\n%s" % (进程.returncode, 错误))
    return _解析渲染输出(进程.stdout.decode("utf-8", "replace"))


def _渲染并行(脚本, 浏览器, 页面路径, 帧目录, 总帧数, 帧率,
             宽, 高, 起始秒, 并行, 超时秒, 布局路径=None, 主题=None):
    """多进程分片渲染。

    实测依据（600 帧，本机 8 物理核）：
      1 路 1.00× / 2 路 1.60× / 4 路 1.89× / 6 路 1.76×（下降）
    故默认上限 4 路，不追求更高并行度。
    """
    每份 = -(-总帧数 // 并行)      # 向上取整
    区间 = []
    for i in range(并行):
        a = i * 每份
        b = min(a + 每份, 总帧数)
        if a < b:
            区间.append((a, b))

    import concurrent.futures as 并发

    结果列表 = [None] * len(区间)
    with 并发.ThreadPoolExecutor(max_workers=len(区间)) as 池:
        任务 = {}
        for idx, (a, b) in enumerate(区间):
            任务[池.submit(_渲染单片, 脚本, 浏览器, 页面路径, 帧目录,
                          总帧数, 帧率, 宽, 高, 起始秒, 超时秒, a, b,
                          布局路径, 主题)] = idx
        for fut in 并发.as_completed(任务):
            idx = 任务[fut]
            结果列表[idx] = fut.result()   # 异常在此抛出

    # 汇总各片统计
    合计帧 = sum(r.get("received", 0) for r in 结果列表 if r)
    合计秒 = sum(r.get("seconds", 0) for r in 结果列表 if r)
    最慢 = max((r.get("seconds", 0) for r in 结果列表 if r), default=0)
    return {
        "并行度": len(区间),
        "各片": 结果列表,
        "合计帧": 合计帧,
        # 墙钟 ≈ 最慢的一片（并行执行）
        "seconds": round(最慢, 2),
        "msPerFrame": round(最慢 / max(1, 每份) * 1000, 2),
    }


def 渲染视频(
    页面路径,
    输出路径,
    时长秒,
    起始秒=0.0,
    帧率=30,
    宽=1920,
    高=1080,
    码率=None,
    预设="medium",
    帧目录=None,
    保留帧=False,
    音频路径=None,
    并行度=None,
    进度回调=None,
    超时秒=3600,
    布局路径=None,
    主题=None,
):
    """渲染视频。

    参数：
        页面路径    已构建的 HTML（含全部组件与数据）
        输出路径    目标 mp4
        时长秒      视频时长
        起始秒      起始时间（默认 0；用于渲染片段）
        帧率        帧率
        宽, 高      分辨率
        码率        可选，如 "12M"；None 则用 CRF 质量控制
        预设        x264 预设（ultrafast ~ veryslow）
        帧目录      可选，指定帧存放位置；None 则用临时目录
        保留帧      是否保留中间帧（调试用）
        音频路径    可选。提供则混流音轨；音频起点对齐起始秒
        并行度      渲染进程数。None 则用推荐值（实测最优 4 路）
        进度回调    可选，fn(已渲染帧数, 总帧数)
        超时秒      总超时
        布局路径    可选，GUI 导出的 layout.json。
                    **不传就会用页面内置的兜底布局** ——
                    与 GUI 里看到的设计不一致，故正式导出必须传。
        主题        可选，主题键（与 GUI 选中一致）；不传则用页面默认

    返回：dict，含耗时统计
    """
    页面路径 = pathlib.Path(页面路径)
    输出路径 = pathlib.Path(输出路径)
    if not 页面路径.is_file():
        raise 渲染错误("页面不存在：%s" % 页面路径)

    总帧数 = int(round(时长秒 * 帧率))
    if 总帧数 <= 0:
        raise 渲染错误("时长过短，总帧数为 0")

    浏览器 = _找浏览器()
    ffmpeg = _找ffmpeg()

    # 帧目录
    临时目录 = None
    if 帧目录 is None:
        临时目录 = tempfile.mkdtemp(prefix="flv_frames_")
        帧目录 = pathlib.Path(临时目录)
    else:
        帧目录 = pathlib.Path(帧目录)
        帧目录.mkdir(parents=True, exist_ok=True)

    输出路径.parent.mkdir(parents=True, exist_ok=True)

    # 渲染脚本（Node + CDP + HTTP 二进制传输）
    脚本 = 根 / "src" / "render" / "capture_v2.mjs"
    if not 脚本.is_file():
        raise 渲染错误("缺少渲染脚本：%s" % 脚本)

    起 = time.perf_counter()

    # ---- 阶段 1：渲染帧（可多进程分片） ----
    并行 = max(1, int(并行度 if 并行度 is not None else 推荐并行度()))
    并行 = min(并行, 总帧数)      # 帧数少于进程数时无意义

    if 并行 <= 1:
        渲染信息 = _渲染单片(脚本, 浏览器, 页面路径, 帧目录,
                            总帧数, 帧率, 宽, 高, 起始秒, 超时秒,
                            布局路径=布局路径, 主题=主题)
    else:
        渲染信息 = _渲染并行(脚本, 浏览器, 页面路径, 帧目录,
                            总帧数, 帧率, 宽, 高, 起始秒, 并行, 超时秒,
                            布局路径=布局路径, 主题=主题)

    渲染耗时 = time.perf_counter() - 起

    实际帧数 = len(list(帧目录.glob("*.png")))
    if 实际帧数 == 0:
        raise 渲染错误("未生成任何帧，请检查渲染脚本输出")
    if 实际帧数 < 总帧数:
        # 不静默接受缺帧 —— 缺帧会让视频时长错误
        raise 渲染错误(
            "帧数不足：期望 %d 帧，实际 %d 帧。\n"
            "可能原因：浏览器崩溃、磁盘空间不足、或并行分片失败。"
            % (总帧数, 实际帧数))

    # ---- 阶段 2：编码 ----
    编码起 = time.perf_counter()
    编码命令 = [
        ffmpeg, "-y", "-loglevel", "error",
        "-framerate", str(帧率),
        "-i", str(帧目录 / "frame_%06d.png"),
    ]

    # 音轨：与画面同起点。用 -ss 定位到起始秒，-t 限制时长，
    # 保证音画对齐（两者都以起始秒为 0）。
    if 音频路径:
        音频路径 = pathlib.Path(音频路径)
        if not 音频路径.is_file():
            raise 渲染错误("音频文件不存在：%s" % 音频路径)
        编码命令 += ["-ss", "%.6f" % 起始秒, "-i", str(音频路径)]

    编码命令 += [
        "-c:v", "libx264",
        "-preset", 预设,
        "-pix_fmt", "yuv420p",
    ]
    if 码率:
        编码命令 += ["-b:v", 码率]
    else:
        编码命令 += ["-crf", "18"]

    if 音频路径:
        # 音频重编码为 AAC 以保证兼容性。
        #
        # ## 不能用 -shortest（踩过）
        # 原注释写「让时长以画面为准」，实际**相反**：
        # -shortest 让输出取**最短的流**。音频比视频短时，
        # 后半段画面会被整段丢掉。
        # 实测 island：视频 166 秒、音频 80.6 秒 → 输出只有 80 秒。
        #
        # 改为显式 `-t 时长秒`：
        #   · 视频本来就按帧数决定长度
        #   · 音频不足的部分由 apad 补静音，保证容器时长等于视频长度
        编码命令 += [
            "-c:a", "aac", "-b:a", "192k",
            "-map", "0:v:0", "-map", "1:a:0",
            "-af", "apad",
            "-t", "%.6f" % 时长秒,
        ]

    编码命令 += ["-movflags", "+faststart", str(输出路径)]

    编码进程 = subprocess.run(编码命令, capture_output=True,
                            timeout=超时秒, creationflags=_无窗口)
    编码耗时 = time.perf_counter() - 编码起

    if 编码进程.returncode != 0:
        错误 = 编码进程.stderr.decode("utf-8", "replace")[-800:]
        raise 渲染错误("编码失败：\n%s" % 错误)
    if not 输出路径.is_file():
        raise 渲染错误("编码完成但输出文件不存在")

    # ---- 清理 ----
    if not 保留帧:
        if 临时目录:
            shutil.rmtree(临时目录, ignore_errors=True)
        else:
            for f in 帧目录.glob("*.png"):
                f.unlink()

    总耗时 = time.perf_counter() - 起
    大小 = 输出路径.stat().st_size

    return {
        "输出": str(输出路径),
        "总帧数": 实际帧数,
        "帧率": 帧率,
        "分辨率": "%dx%d" % (宽, 高),
        "时长秒": round(实际帧数 / 帧率, 3),
        "文件MB": round(大小 / 1e6, 2),
        "渲染耗时秒": round(渲染耗时, 2),
        "编码耗时秒": round(编码耗时, 2),
        "总耗时秒": round(总耗时, 2),
        "渲染每帧ms": round(渲染耗时 / 实际帧数 * 1000, 2),
        "编码每帧ms": round(编码耗时 / 实际帧数 * 1000, 2),
        "含音轨": bool(音频路径),
        "渲染详情": 渲染信息,
    }
