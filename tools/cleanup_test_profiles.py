"""测试用浏览器 profile 的自动清理。

## 问题（实测踩到）

每个测试脚本都用固定的 `--user-data-dir` 启动 headless 浏览器。
跑 100+ 次后累积了 **125 个 profile、3.77 GB**，
把 C 盘（系统盘 + TEMP 所在盘）撑到 **0 字节可用**，
导致后续所有写操作失败：`ENOSPC: no space left on device`。

这不是一次性问题 —— 只要继续跑测试就会持续发生。

## 做法

在 test 脚本启动浏览器时统一调用 `启动浏览器()`，
它负责：
  1. 用**统一的临时根目录**（%TEMP%/flvtest/<name>）
  2. 启动前清理该目录（避免旧 profile 干扰）
  3. 进程退出时删除

由于测试脚本很多、逐个改不现实，这里提供一个
**独立的清理工具**，并建议在每次测试批次后调用。

## 用法

    python tools/cleanup_test_profiles.py          # 清理并报告
    python tools/cleanup_test_profiles.py --dry    # 只报告
"""
import os
import pathlib
import shutil
import sys

# 本项目测试用过的 profile 前缀（从各测试脚本收集）
前缀 = [
    "flv2_", "i18nt", "i18nc", "i18nd", "sett", "eq100", "eq101",
    "split", "winparam", "winstrict", "rollfade", "rollw", "drumnew",
    "drumb", "audiodbg", "probe", "shotenter", "dbg", "guisrv",
    "guitest", "drumsize", "leftink", "rowkey", "rowstab", "righthot",
    "impflow", "propedit", "layoutexport", "cont", "eq_", "rollprobe",
    "stepper", "winstrict", "drumt", "winsize", "eqold", "eqnew",
]


def 候选目录():
    temp = pathlib.Path(os.environ.get("TEMP") or "/tmp")
    if not temp.is_dir():
        return []
    out = []
    for d in temp.iterdir():
        if not d.is_dir():
            continue
        if any(d.name.startswith(p) for p in 前缀):
            out.append(d)
    return out


def 目录大小(d):
    total = 0
    try:
        for f in d.rglob("*"):
            try:
                if f.is_file():
                    total += f.stat().st_size
            except OSError:
                pass
    except OSError:
        pass
    return total


def main():
    dry = "--dry" in sys.argv
    目录 = 候选目录()
    if not 目录:
        print("没有需要清理的测试 profile")
        return 0

    print("找到 %d 个测试 profile：" % len(目录))
    总 = 0
    for d in sorted(目录):
        s = 目录大小(d)
        总 += s
        print("  %-24s %8.1f MB" % (d.name, s / 1e6))

    print()
    print("合计 %.2f GB" % (总 / 1e9))

    if dry:
        print("（--dry 模式，未删除）")
        return 0

    print()
    删 = 0
    for d in 目录:
        try:
            shutil.rmtree(d, ignore_errors=True)
            if not d.exists():
                删 += 1
        except Exception:
            pass
    print("已删除 %d / %d 个" % (删, len(目录)))

    # 报告 C 盘可用空间
    try:
        if sys.platform == "win32":
            import ctypes
            free = ctypes.c_ulonglong(0)
            ctypes.windll.kernel32.GetDiskFreeSpaceExW(
                ctypes.c_wchar_p("C:\\"), None, None, ctypes.byref(free))
            print("C 盘可用：%.2f GB" % (free.value / 1e9))
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
