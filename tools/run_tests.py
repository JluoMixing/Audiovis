"""统一跑批测试，并在每个测试后清理残留浏览器进程。

## 为什么要这个工具

22 个测试依次跑时会卡住。实测：
  · 单独跑 test_interaction：15.8 秒通过
  · 连跑一批后：46 个 msedge 进程堆积，测试卡死

原因：测试脚本里 `child.kill()` 只杀浏览器**父进程**，
渲染子进程留在后台。跑几十个测试后进程数爆炸，机器资源耗尽。

## 做法

  · 顺序跑每个测试
  · 每个测试结束后，杀掉命令行含本项目测试 profile 的 msedge
  · 汇总通过/失败

## 用法

    python tools/run_tests.py                 # 跑全部
    python tools/run_tests.py test_gui test_parity
    python tools/run_tests.py --server 9400   # 指定服务端口给需要服务的测试
"""
import pathlib
import re
import subprocess
import sys
import time

根 = pathlib.Path(__file__).resolve().parent.parent
PORT_PROFILE = str(根 / ".testtmp").replace("\\", "\\\\")



def 清理磁盘残留(尽力=True, 阈值秒=60):
    """清掉 Edge 的 scoped_dir 与项目 .testtmp。

    实测：Edge 即使被指定了 --user-data-dir，仍会在 %TEMP% 建
    scoped_dir（每个 121 MB）且退出后不删。405 个累积 3.89 GB，
    把 C 盘撑到 0 字节，导致后续所有写操作 ENOSPC。
    """
    import importlib.util
    try:
        spec = importlib.util.spec_from_file_location(
            "cleanup_disk", 根 / "tools" / "cleanup_disk.py")
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        # 跑批中途用 60 秒阈值（避开正在用的），安静模式只在删了东西时打一行
        m.main(quiet=True, 阈值秒=阈值秒)
    except Exception as e:
        if not 尽力:
            raise
        print("  [warn] 磁盘清理失败：%s" % e)


def 杀残留浏览器():
    """只杀带本项目测试 profile 的 headless 浏览器。

    绝不碰用户自己的浏览器 —— 命令行必须同时含 testtmp 与 headless。
    """
    try:
        ps = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | "
             "Where-Object { $_.CommandLine -match 'testtmp' -and "
             "$_.CommandLine -match 'headless' } | "
             "ForEach-Object { Stop-Process -Id $_.ProcessId -Force "
             "-ErrorAction SilentlyContinue; $_.ProcessId }"],
            capture_output=True, text=True, timeout=60)
        return len([x for x in (ps.stdout or "").split() if x.strip().isdigit()])
    except Exception:
        return 0


def 需要端口(名):
    """测试是否需要端口参数 —— 运行时扫描，不依赖手写清单。

    判据：脚本里出现 `process.argv[2]`（Node）或 `sys.argv[1]`（Python）。
    手写清单已经漏过一次（新增测试后忘记更新），故改为现算。
    """
    脚本, _ = 找脚本(名)
    if 脚本 is None:
        return False
    try:
        s = 脚本.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    # 先剥掉注释与字符串字面量，只按**代码**判断。
    # 否则注释里提到 `sys.argv[1]` 也会命中（实测发生过）。
    if 脚本.suffix == ".py":
        代码 = re.sub(r"#[^\n]*", "", s)
    else:
        代码 = re.sub(r"//[^\n]*", "", s)
        代码 = re.sub(r"/\*[\s\S]*?\*/", "", 代码)
    # 注意：字符类里必须排除 \n，否则一个孤立引号会跨行配对，
    # 把中间大段代码删掉（实测把一行端口判断吞了）。
    代码 = re.sub(r'"(?:[^"\\\n]|\\.)*"', '""', 代码)
    代码 = re.sub(r"'(?:[^'\\\n]|\\.)*'", "''", 代码)

    # 排除切片写法：`sys.argv[1:]` 是遍历参数，不是取端口。
    if re.search(r"process\.argv\[2\](?![\]:])", 代码):
        return True
    if re.search(r"sys\.argv\[1\](?![\]:])", 代码):
        return True
    return False


def 找脚本(名):
    """按实际存在的扩展名找脚本。两个都在则报歧义。"""
    py = 根 / "tools" / (名 + ".py")
    mjs = 根 / "tools" / (名 + ".mjs")
    if py.is_file() and mjs.is_file():
        raise RuntimeError("测试 %s 同时存在 .py 与 .mjs，请删除一个" % 名)
    if py.is_file():
        return py, "py"
    if mjs.is_file():
        return mjs, "mjs"
    return None, None


def 重置会话(端口):
    """把服务会话恢复成示例工程。

    测试之间共享服务会话会互相污染 —— 实测 test_project 导入工程后，
    后面的 test_row_stability 分析的是另一个工程，断言失败。
    每个服务测试前重置，保证从已知状态开始。
    """
    if not 端口:
        return
    try:
        import json as _json
        import urllib.request as _req
        r = _req.Request("http://127.0.0.1:%d/api/session/reset" % 端口,
                         data=b"{}", method="POST",
                         headers={"Content-Type": "application/json"})
        _req.urlopen(r, timeout=180).read()
    except Exception as e:
        print("  [warn] 会话重置失败：%s" % e)


def 跑一个(名, 端口):
    脚本, 类型 = 找脚本(名)
    if 脚本 is None:
        return 0, 0, 0.0, "找不到测试脚本：%s" % 名

    if 类型 == "py":
        命令 = [sys.executable, str(脚本)]
    else:
        命令 = ["node", str(脚本)]
    if 需要端口(名):
        if 端口:
            命令.append(str(端口))
            # 重置会话：避免上一个测试改过的状态污染本测试
            if 名 not in ("test_settings_ui", "test_settings"):
                重置会话(端口)

    t0 = time.time()
    try:
        r = subprocess.run(命令, capture_output=True, text=True,
                           encoding="utf-8", errors="replace",
                           cwd=str(根), timeout=900)
        out = (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired as e:
        out = ((e.stdout or "") if isinstance(e.stdout, str) else "") + "\n[TIMEOUT]"
    finally:
        杀残留浏览器()
        # 每个测试都会留下 Edge scoped_dir，不清会累积
        清理磁盘残留()

    耗时 = time.time() - t0
    m = re.search(r"通过 (\d+) / (\d+)", out)
    if m:
        return int(m.group(1)), int(m.group(2)), 耗时, out
    return 0, 0, 耗时, out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    端口 = None
    for a in sys.argv[1:]:
        if a.startswith("--server="):
            端口 = int(a.split("=", 1)[1])
        elif a == "--server":
            i = sys.argv.index(a)
            if i + 1 < len(sys.argv):
                端口 = int(sys.argv[i + 1])
                args = [x for x in args if x != str(端口)]

    if args:
        名单 = args
    else:
        名单 = sorted(set(
            [f.stem for f in (根 / "tools").glob("test_*.mjs")] +
            [f.stem for f in (根 / "tools").glob("test_*.py")]
        ))

    print("=" * 72)
    print("测试跑批：%d 个" % len(名单))
    print("=" * 72)
    print()

    # 先清一次历史残留 —— 否则跑到一半就没磁盘空间
    清理磁盘残留()

    通过 = 失败 = 0
    详情 = []
    for 名 in 名单:
        p, n, 耗时, out = 跑一个(名, 端口)
        if n == 0:
            状态 = "???"
            失败 += 1
        elif p == n:
            状态 = "OK  "
            通过 += p
        else:
            状态 = "FAIL"
            通过 += p
            失败 += (n - p)
        print("%s %-22s %3d / %-3d  %5.1fs" % (状态, 名, p, n, 耗时))
        if 状态 != "OK  ":
            详情.append((名, out))

    print()
    print("=" * 72)
    print("合计：%d 项通过，%d 项失败" % (通过, 失败))
    print("=" * 72)

    # 跑批结束：阈值 0，把本轮产生的残留全部清掉
    清理磁盘残留(阈值秒=0)

    for 名, out in 详情:
        print()
        print("---- %s 输出（末 20 行）----" % 名)
        for line in out.strip().split("\n")[-20:]:
            print("  " + line)

    return 1 if 失败 else 0


if __name__ == "__main__":
    sys.exit(main())
