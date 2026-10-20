"""清理测试残留的**磁盘目录**（进程清理见 cleanup_test_browsers.py）。

## 实测发现的泄漏

即使给 Edge 指定了 `--user-data-dir`，它仍会在 `%TEMP%` 建
`scoped_dir<pid>_<random>` 目录，每个约 **121 MB**，退出后**不自动删除**。

实测累积 **405 个、3.89 GB**，把 C 盘撑到 0 字节可用，
导致所有写操作 ENOSPC —— git、Python、测试截图全挂。

此外项目内 `.testtmp/`（测试浏览器 profile）每次跑批也会累积。

## 用法

    python tools/cleanup_disk.py            # 清理 5 分钟前的（默认）
    python tools/cleanup_disk.py --dry      # 只看不删
    python tools/cleanup_disk.py --all      # 连新的也删（Edge 全关时用）

## 安全

  · scoped_dir 是 Edge 自己的临时目录，删掉不影响用户数据
  · 默认只删 5 分钟前的，避免删掉正在运行的浏览器在用的
  · 不碰任何用户文件
"""
import os
import pathlib
import shutil
import sys
import time

项目根 = pathlib.Path(__file__).resolve().parent.parent

# 本项目测试用过的 TEMP profile 前缀
前缀 = (
    "flv2_", "i18nt", "i18nc", "i18nd", "sett", "eq1", "split",
    "winparam", "winstrict", "rollfade", "drumnew", "drumb",
    "audiodbg", "probe", "shotenter", "dbg", "guisrv", "guitest",
    "drumsize", "leftink", "rowkey", "rowstab", "righthot",
    "impflow", "propedit", "layoutexport", "final", "pairauto",
    "keys", "exparams", "drop", "diagppq", "cont", "rollprobe",
    "stepper", "drumt", "winsize", "eqold", "eqnew",
)


def 目录大小(p):
    n = 0
    try:
        for f in p.rglob("*"):
            try:
                if f.is_file():
                    n += f.stat().st_size
            except OSError:
                pass
    except OSError:
        pass
    return n


def 候选():
    项 = []
    temp = pathlib.Path(os.environ.get("TEMP") or "/tmp")
    if temp.is_dir():
        for d in temp.iterdir():
            if not d.is_dir():
                continue
            if d.name.startswith("scoped_dir"):
                项.append((d, "Edge scoped_dir"))
            elif any(d.name.startswith(p) for p in 前缀):
                项.append((d, "TEMP test-profile"))

    tt = 项目根 / ".testtmp"
    if tt.is_dir():
        for d in tt.iterdir():
            if d.is_dir():
                项.append((d, "project .testtmp"))
    return 项


def main(dry=None, all_=None, quiet=False, 阈值秒=None):
    """清理。

    参数（命令行等价写法）：
        dry      --dry   只报告
        all_     --all   连较新的也删
        阈值秒    -      只删早于 N 秒的（默认 300；--all 时 0）
        quiet    -      只在真的删了东西时打一行
    """
    if dry is None:
        dry = "--dry" in sys.argv
    if all_ is None:
        all_ = "--all" in sys.argv
    if 阈值秒 is None:
        阈值秒 = 0 if all_ else 300
    阈值 = time.time() - 阈值秒

    项 = 候选()
    if not 项:
        print("没有需要清理的残留目录")
        return 0

    按类 = {}
    for d, 类 in 项:
        按类.setdefault(类, []).append(d)

    总 = sum(目录大小(d) for d, _ in 项)

    if not quiet:
        print("找到 %d 个残留目录：\n" % len(项))
        for 类, 列表 in sorted(按类.items(), key=lambda x: -len(x[1])):
            print("  %-22s %3d 个  %7.2f GB"
                  % (类, len(列表), sum(目录大小(d) for d in 列表) / 1e9))
        print("\n合计 %.2f GB" % (总 / 1e9))

    if dry:
        if not quiet:
            print("（--dry，未删除）")
        return 0

    删 = 释放 = 0
    跳过 = 0
    for d, _ in 项:
        try:
            if d.stat().st_mtime > 阈值:
                跳过 += 1
                continue
            s = 目录大小(d)
            shutil.rmtree(d, ignore_errors=True)
            if not d.exists():
                删 += 1
                释放 += s
        except OSError:
            pass

    if 删 or not quiet:
        if quiet:
            print("  [清理] 删除 %d 个，释放 %.2f GB" % (删, 释放 / 1e9))
        else:
            print("\n已删除 %d 个，释放 %.2f GB（跳过 %d 个较新的）"
                  % (删, 释放 / 1e9, 跳过))

    if not quiet:
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
