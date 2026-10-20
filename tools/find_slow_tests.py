"""快速找出卡住的测试。

## 做法

每个测试单独跑，设 90 秒上限。
超时的就是「会拖住跑批」的测试。
"""
import pathlib
import re
import subprocess
import sys
import time

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
超时 = 90

名单 = sorted([f.stem for f in (根 / "tools").glob("test_*.mjs")] +
              [f.stem for f in (根 / "tools").glob("test_*.py")])

# 需要端口的（扫代码判断，与 run_tests 同逻辑）
def 需要端口(名):
    for 扩展 in (".py", ".mjs"):
        f = 根 / "tools" / (名 + 扩展)
        if f.is_file():
            s = f.read_text(encoding="utf-8", errors="replace")
            s = re.sub(r"#[^\n]*", "", s)
            s = re.sub(r"//[^\n]*", "", s)
            s = re.sub(r'"(?:[^"\\\n]|\\.)*"', '""', s)
            s = re.sub(r"'(?:[^'\\\n]|\\.)*'", "''", s)
            return bool(re.search(r"process\.argv\[2\](?![\]:])", s)
                        or re.search(r"sys\.argv\[1\](?![\]:])", s))
    return False


print("共 %d 个测试，逐个跑（上限 %d 秒）" % (len(名单), 超时))
print()

慢的 = []
超时的 = []

for 名 in 名单:
    f_py = 根 / "tools" / (名 + ".py")
    if f_py.is_file():
        命令 = [sys.executable, str(f_py)]
    else:
        命令 = ["node", str(根 / "tools" / (名 + ".mjs"))]
    if 需要端口(名):
        命令.append("11000")

    t0 = time.time()
    try:
        r = subprocess.run(命令, capture_output=True, text=True,
                           encoding="utf-8", errors="replace",
                           cwd=str(根), timeout=超时)
        out = (r.stdout or "") + (r.stderr or "")
        耗时 = time.time() - t0
        m = re.search(r"通过 (\d+) / (\d+)", out)
        结果 = ("%s/%s" % (m.group(1), m.group(2))) if m else "无断言"
        if 耗时 > 20:
            慢的.append((名, 耗时, 结果))
            print("  慢  %-24s %5.1fs  %s" % (名, 耗时, 结果))
    except subprocess.TimeoutExpired:
        耗时 = time.time() - t0
        超时的.append((名, 耗时))
        print("  卡  %-24s >%ds   ← 会拖住跑批" % (名, 超时))
    finally:
        # 每个测试后清残留
        subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" "
             "| Where-Object { $_.CommandLine -match 'testtmp' -and "
             "$_.CommandLine -match 'headless' } "
             "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force "
             "-ErrorAction SilentlyContinue }"],
            capture_output=True, timeout=60)

print()
print("=" * 66)
if 超时的:
    print("卡住的测试（建议下次跳过）：")
    for 名, _ in 超时的:
        print("  " + 名)
else:
    print("没有卡住的测试")

if 慢的:
    print()
    print("耗时 > 20 秒的（共 %d 个）：" % len(慢的))
    for 名, 耗时, 结果 in sorted(慢的, key=lambda x: -x[1]):
        print("  %-24s %5.1fs  %s" % (名, 耗时, 结果))
