"""找出 pyflp 的第三方依赖，加进 spec 的 hiddenimports。

## 为什么

`pyflp` 是从磁盘 vendored 目录加载的，PyInstaller 分析不到它内部的
`import xxx`。于是它的依赖（如 sortedcontainers）不会被收集，
打包版一导入 FLP 就 ModuleNotFoundError。

必须把 pyflp 依赖的**第三方包**显式列进 hiddenimports。
"""
import pathlib
import re
import sys

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")

# Python 3.9 没有 stdlib_module_names
标准库 = set(getattr(sys, "stdlib_module_names", ())) or {
    "os", "sys", "re", "io", "abc", "json", "math", "time", "enum", "glob",
    "copy", "uuid", "types", "typing", "struct", "bisect", "codecs",
    "base64", "shutil", "socket", "sqlite3", "hashlib", "pathlib", "logging",
    "datetime", "tempfile", "traceback", "itertools", "functools",
    "collections", "contextlib", "dataclasses", "argparse", "warnings",
    "unicodedata", "weakref", "zlib", "gzip", "csv", "textwrap", "string",
}

模块 = set()
for 包目录 in ("PyFLP/pyflp", "construct/construct",
              "construct-typing/construct_typed", "fastenum/fastenum"):
    d = 根 / "research" / "vendor" / 包目录
    if not d.is_dir():
        continue
    for f in d.rglob("*.py"):
        try:
            txt = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for line in txt.split("\n"):
            m = re.match(r"\s*(?:from|import)\s+([A-Za-z_][\w.]*)", line)
            if not m:
                continue
            top = m.group(1).split(".")[0]
            if top in 标准库:
                continue
            if top in ("pyflp", "construct", "construct_typed", "fastenum"):
                continue
            if top.startswith("_"):
                continue
            模块.add(top)

print("pyflp 的第三方依赖：", sorted(模块))

# 过滤出真正已安装的（未安装的说明是可选依赖）
已装 = []
for m in sorted(模块):
    try:
        __import__(m)
        已装.append(m)
    except Exception:
        print("  （跳过未安装：%s）" % m)

print("需要打包：", 已装)

# 写进 spec
p = 根 / "packaging" / "FLVisualizer.spec"
s = p.read_text(encoding="utf-8")

旧 = '''    "build_gui",               # 动态导入，静态分析看不到'''
新 = '''    # vendored pyflp 的第三方依赖 —— pyflp 从磁盘加载，分析不到它的 import
    %s,
    "build_gui",               # 动态导入，静态分析看不到''' % (
    ",\n    ".join('"%s"' % m for m in 已装) if 已装 else "")

if "sortedcontainers" in s:
    print("spec 里已有这些依赖，跳过")
else:
    assert 旧 in s, "未找到隐藏导入段"
    s = s.replace(旧, 新, 1)
    p.write_text(s, encoding="utf-8")
    print("✓ spec 已加入 pyflp 依赖")
