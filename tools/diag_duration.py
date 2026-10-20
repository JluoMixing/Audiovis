"""诊断：现在的视频时长是怎么定的（为什么只到 80s）。"""
import pathlib
import sys

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

print("=" * 76)
print("时长来源查找")
print("=" * 76)
print()

import re  # noqa: E402

# 1) 服务端
p = 根 / "app_server.py"
s = p.read_text(encoding="utf-8")
print("【app_server.py】")
for m in re.finditer(r".*时长.*", s):
    ln = s[:m.start()].count("\n") + 1
    line = m.group(0).strip()
    if line and not line.startswith("#"):
        print("  L%-4d %s" % (ln, line[:90]))
print()

# 2) CLI
p = 根 / "src" / "cli.py"
s = p.read_text(encoding="utf-8")
print("【src/cli.py】")
for m in re.finditer(r".*时长.*", s):
    ln = s[:m.start()].count("\n") + 1
    line = m.group(0).strip()
    if line and not line.startswith("#"):
        print("  L%-4d %s" % (ln, line[:90]))
print()

# 3) GUI
p = 根 / "preview" / "gui_v2_template.html"
s = p.read_text(encoding="utf-8")
print("【gui_v2_template.html】exDur / duration 相关")
for m in re.finditer(r".*(exDur|pm\.duration|DATA\.audio\.duration).*", s):
    ln = s[:m.start()].count("\n") + 1
    line = m.group(0).strip()
    if line:
        print("  L%-4d %s" % (ln, line[:90]))
