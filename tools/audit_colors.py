"""查各组件实际用了哪些色板颜色。"""
import pathlib
import re

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")

组件 = ["spectrum", "waveform", "transient", "pianoroll",
        "vectorscope", "loudness", "brightness", "pitchwheel", "transport"]

for cid in 组件:
    p = 根 / "src" / "components" / (cid + ".js")
    if not p.is_file():
        continue
    s = p.read_text(encoding="utf-8")
    # 统计 P.xxx 使用
    用 = {}
    for m in re.finditer(r"P\.(\w+)", s):
        用[m.group(1)] = 用.get(m.group(1), 0) + 1
    print("=== %s ===" % cid)
    print("  色板使用: " + ", ".join("%s×%d" % (k, v)
                                     for k, v in sorted(用.items(),
                                                        key=lambda x: -x[1])))
    # 找 accent 出现在哪些行
    for i, line in enumerate(s.split("\n"), 1):
        if "P.accent" in line:
            print("    L%-4d %s" % (i, line.strip()[:82]))
    if "P.accent" not in s:
        print("    ** 完全没有用 accent **")
    print()
