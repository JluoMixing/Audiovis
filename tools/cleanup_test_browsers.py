"""安全清理：只终止**我自己创建的**测试浏览器进程。

为什么需要这个工具：
  早期为了清理测试残留，我用了 `Stop-Process chrome` 这类无差别杀进程，
  结果把用户正在看视频的浏览器也关掉了。这是不可接受的。

原则：
  · 只终止命令行中带**本工具已知临时 profile 前缀**的进程
  · 绝不触碰没有 --user-data-dir 参数的进程（那是用户的正常浏览器）
  · 默认 dry-run（只报告不终止），需显式 --kill 才真正执行

用法：
    python tools/cleanup_test_browsers.py            # 只报告
    python tools/cleanup_test_browsers.py --kill     # 实际清理
"""
import argparse
import json
import pathlib
import subprocess
import sys

# 我在测试脚本中使用过的临时 profile 前缀。
# 新增测试脚本时，若用了新的前缀，必须在此登记 —— 否则不会被清理
# （宁可留下残留，也不能误杀用户的浏览器）。
已知前缀 = [
    "flv_render_",      # render.py 的渲染进程
    "flv2_",            # capture_v2.mjs
    "flv_frames_",      # 帧临时目录
    "perf_prof_",       # perf_profile.mjs
    "perf_test",        # phaseA_perf.py
    "cdp_probe_",       # perf_cdp_probe.mjs
    "gputest_",         # perf_gpu_raster.mjs
    "incr_",            # perf_incremental.mjs
    "baseline_",        # capture_baseline.mjs
    "dbgpage",          # 早期调试脚本
    "guishot",          # GUI 截图
    "guitest",          # GUI 功能测试
    "tplshot",          # 模板截图
    "frame_export",     # phaseA_e2e.py
    "suction",          # 主时间轴诊断
    "stverify", "stverify2", "blverify", "blexp",  # 步进器/绽放验证
    "bpmchk", "fpsdiag", "fpsdiag2", "dist_cdp", "all_cdp",
    "enc_cmp_", "nvenc_", "amf_",
]

# 浏览器进程名
浏览器名 = {"chrome.exe", "msedge.exe"}


def 列出候选():
    """列出所有浏览器进程及其命令行。"""
    try:
        结果 = subprocess.run(
            ["wmic", "process", "where",
             "name='chrome.exe' or name='msedge.exe'",
             "get", "ProcessId,CommandLine", "/format:csv"],
            capture_output=True, timeout=30)
        文本 = 结果.stdout.decode("utf-8", "replace")
    except Exception as e:
        print("查询失败：%s" % e)
        return []

    进程 = []
    for 行 in 文本.splitlines():
        行 = 行.strip()
        if not 行 or "ProcessId" in 行 or 行.startswith("Node,"):
            continue
        # CSV: Node,CommandLine,ProcessId
        部分 = 行.split(",")
        if len(部分) < 3:
            continue
        try:
            pid = int(部分[-1])
        except ValueError:
            continue
        命令行 = ",".join(部分[1:-1])
        进程.append({"pid": pid, "cmd": 命令行})
    return 进程


def 是我的(命令行):
    """判断是否为我创建的测试进程。

    关键：**必须**带 --user-data-dir 且匹配已知前缀。
    没有该参数的进程一律视为用户浏览器，绝不动。
    """
    if "--user-data-dir" not in 命令行:
        return False, None
    for 前缀 in 已知前缀:
        if 前缀 in 命令行:
            return True, 前缀
    return False, None


def 主程序():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kill", action="store_true",
                    help="实际终止（默认只报告）")
    args = ap.parse_args()

    进程 = 列出候选()
    我的 = []
    用户的 = []

    for p in 进程:
        是, 前缀 = 是我的(p["cmd"])
        if 是:
            p["前缀"] = 前缀
            我的.append(p)
        else:
            用户的.append(p)

    # 按前缀分组统计（一个浏览器会派生多个进程，只报告不逐个列）
    分组 = {}
    for p in 我的:
        分组.setdefault(p["前缀"], []).append(p["pid"])

    print("=" * 70)
    print("测试浏览器进程清理")
    print("=" * 70)
    print()
    print("  浏览器进程总数: %d" % len(进程))
    print("  我的测试进程:   %d（%d 组）" % (len(我的), len(分组)))
    print("  用户的浏览器:   %d（不会触碰）" % len(用户的))
    print()

    if 分组:
        print("我的测试进程明细：")
        for 前缀, pids in sorted(分组.items()):
            print("  %-20s %d 个进程  pid=%s" % (
                前缀, len(pids), ",".join(str(x) for x in pids[:6]) +
                ("..." if len(pids) > 6 else "")))
        print()
    else:
        print("没有我的测试进程残留。")
        print()

    if 用户的:
        print("用户的浏览器（保持不动）：")
        for p in 用户的[:5]:
            # 只显示是否为默认 profile，不显示完整命令行（隐私）
            print("  pid=%d  %s" % (p["pid"], "默认 profile"))
        if len(用户的) > 5:
            print("  ... 另有 %d 个" % (len(用户的) - 5))
        print()

    if not args.kill:
        print("这是 **dry-run**（只报告）。")
        print("要实际清理，运行：python tools/cleanup_test_browsers.py --kill")
        return

    if not 我的:
        print("无需清理。")
        return

    print("正在终止我的测试进程...")
    成功 = 0
    失败 = 0
    for p in 我的:
        try:
            r = subprocess.run(["taskkill", "/PID", str(p["pid"]), "/T", "/F"],
                               capture_output=True, timeout=15)
            if r.returncode == 0:
                成功 += 1
            else:
                失败 += 1
        except Exception:
            失败 += 1

    print("  已终止 %d 个，失败 %d 个" % (成功, 失败))
    print()
    print("★ 注意：只终止了带已知临时 profile 的进程，")
    print("  用户的浏览器未受影响。")


if __name__ == "__main__":
    主程序()
