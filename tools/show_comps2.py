import pathlib
import re

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")

for f in sorted((根 / "src" / "components").glob("*.js")):
    s = f.read_text(encoding="utf-8")
    m = re.search(
        r"register\(\{\s*id:\s*'(\w+)',\s*name:\s*'([^']+)',\s*"
        r"w:\s*(\d+),\s*h:\s*(\d+),\s*group:\s*'([^']+)'", s)
    if m:
        print("  %-12s %-10s %4sx%-4s %s"
              % (m.group(1), m.group(2), m.group(3), m.group(4),
                 m.group(5)))
    else:
        print("  %-12s (解析失败)" % f.stem)
