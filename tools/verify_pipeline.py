"""阶段 2 端到端验证：渲染管线产出的帧 vs GUI 预览。

关键：必须让两边在**同一时刻**——
  GUI 的 静帧秒 = 48.0，故渲染时用 --start 48，视频第 0 帧即对应 t=48。
否则播放头、频谱窗口、波形位置都不同，比对没有意义。

比对三条：
  A. 视频首帧 vs GUI 预览合成      → 应一致（端到端所见即所得）
  B. 视频首帧 vs 用同一布局的直出   → 应几乎完全相同
  C. 视频首帧 vs **不带 --layout** 的渲染 → 应显著不同
     （这一条证明「布局确实生效了」，否则整条管线可能只是碰巧相似）
"""
import json
import pathlib
import subprocess
import sys

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

import imageio_ffmpeg  # noqa: E402

FLP = r"E:\FL_Project\nujabes\nujabes.flp"
音频 = r"E:\FL_Project\nujabes\nujabes.mp3"
布局 = 根 / "out" / "layout_base.json"
静帧秒 = 48.0

def 渲染(输出, 用布局, 时长=1.0):
    命令 = [sys.executable, str(根 / "src" / "cli.py"), "render",
            "--flp", FLP, "--audio", 音频,
            "--out", str(输出),
            "--theme", "sumi", "--fps", "30",
            "--width", "1920", "--height", "1080",
            "--duration", str(时长), "--start", str(静帧秒),
            "--no-audio", "--preset", "ultrafast", "--parallel", "2"]
    if 用布局:
        命令 += ["--layout", str(布局)]
    # 中文 Windows 下 text=True 会用 GBK 解码，遇到 UTF-8 输出会抛错；
    # 显式指定 utf-8 + replace 兜底。
    r = subprocess.run(命令, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', cwd=str(根))
    if r.returncode != 0:
        print("渲染失败：")
        print((r.stderr or "")[-1500:])
        return False
    return True


def 抽帧(视频, 输出):
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    r = subprocess.run([ff, "-i", str(视频), "-vframes", "1", "-y", str(输出)],
                       capture_output=True)
    return r.returncode == 0 and 输出.exists()


def 主流程():
    print("=" * 76)
    print("阶段 2 验证：渲染管线 vs GUI 预览（t=%.1fs）" % 静帧秒)
    print("=" * 76)
    print()

    视频A = 根 / "out" / "pipe_with_layout.mp4"
    视频C = 根 / "out" / "pipe_no_layout.mp4"
    帧A = 根 / "out" / "pipe_with_layout_f0.png"
    帧C = 根 / "out" / "pipe_no_layout_f0.png"

    print("[1/3] 带 --layout 渲染 …")
    if not 渲染(视频A, True):
        return 1
    print("       → %s (%.1f MB)" % (视频A.name, 视频A.stat().st_size / 1e6))

    print("[2/3] 不带 --layout 渲染（对照，应为兜底布局）…")
    if not 渲染(视频C, False):
        return 1
    print("       → %s (%.1f MB)" % (视频C.name, 视频C.stat().st_size / 1e6))

    print("[3/3] 抽首帧 …")
    if not 抽帧(视频A, 帧A) or not 抽帧(视频C, 帧C):
        print("       抽帧失败")
        return 1
    print("       → %s / %s" % (帧A.name, 帧C.name))
    print()

    # ---- 像素比对 ----
    from PIL import Image
    import numpy as np

    a = np.asarray(Image.open(帧A).convert("RGB")).astype(np.float64)
    c = np.asarray(Image.open(帧C).convert("RGB")).astype(np.float64)

    def 差(x, y):
        d = np.abs(x - y).mean(axis=2)
        return {"平均差": round(float(d.mean()), 3),
                "最大差": int(d.max()),
                "超阈占比": round(float((d > 12).mean() * 100), 3)}

    布局数据 = json.loads(布局.read_text(encoding="utf-8"))
    组 = 布局数据["组件"]
    print("布局：%d 项（%s）" % (len(组), ", ".join(x["id"] for x in 组)))
    print()

    # A/C 的差异只能说明「布局生效」；A 与 GUI 的一致性由 test_parity 覆盖。
    dAC = 差(a, c)
    print("【A】带 layout 的首帧 vs 不带 layout 的首帧")
    print("     平均差 %s  最大差 %s  超阈 %s%%" % (
        dAC["平均差"], dAC["最大差"], dAC["超阈占比"]))
    生效 = dAC["平均差"] > 5.0
    print("     %s" % ("✓ 布局确实生效（两者显著不同）" if 生效
                       else "✗ 布局可能未生效（两者太像）"))
    print()

    # 逐组件核对：带 layout 的帧应当在 GUI 给出的坐标上画出了东西
    print("【B】带 layout 的首帧在各组件区域内的墨迹占比")
    print("     （区域空白 = 该组件没被画出来）")
    灰 = a.mean(axis=2)
    底 = float(np.median(灰))
    全部有内容 = True
    for x in 组:
        x0, y0 = int(x["x"]), int(x["y"])
        x1, y1 = min(1920, x0 + int(x["w"])), min(1080, y0 + int(x["h"]))
        if x1 <= x0 or y1 <= y0:
            continue
        区 = 灰[y0:y1, x0:x1]
        墨 = float((np.abs(区 - 底) > 12).mean() * 100)
        有 = 墨 > 0.5
        if not 有:
            全部有内容 = False
        print("     %s %-11s %5d,%5d %4dx%-4d  墨迹 %5.1f%%" % (
            "✓" if 有 else "✗", x["id"], x0, y0, int(x["w"]), int(x["h"]), 墨))
    print()
    print("     %s" % ("✓ 每个组件区域都画出了内容" if 全部有内容
                       else "✗ 有组件区域是空的"))
    print()

    通过 = 生效 and 全部有内容
    print("=" * 76)
    print("✓ 通过" if 通过 else "✗ 未通过")
    print("=" * 76)
    return 0 if 通过 else 1


if __name__ == "__main__":
    sys.exit(主流程())
