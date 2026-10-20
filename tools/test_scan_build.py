"""验证扫目录后的构建产物与之前等价。

## 关键

顺序变了（主题从「sumi 优先」变成字母序，组件从设计顺序变成字母序），
需要确认：
  1. 文件数量一致
  2. 产物能正常加载（无 JS 错误）
  3. 主题数量、组件数量一致
"""
import json
import pathlib
import re
import subprocess
import sys

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
通过 = 0
失败 = 0


def 断言(名, 条件, 详情=""):
    global 通过, 失败
    if 条件:
        通过 += 1
        print("  ✓ " + 名)
    else:
        失败 += 1
        print("  ✗ " + 名 + ("  → " + str(详情) if 详情 else ""))


print("=" * 70)
print("扫目录后的产物验证")
print("=" * 70)
print()

# 先重建
r = subprocess.run([sys.executable, str(根 / "preview" / "build_gui.py")],
                   capture_output=True, text=True, encoding="utf-8",
                   cwd=str(根))
断言("重建完成", '"状态": "完成"' in (r.stdout or ""),
     (r.stdout or "")[-200:])

html = (根 / "preview" / "gui_prototype.html").read_text(encoding="utf-8")
print()

# ---- 1) 组件数 ----
print("【1】组件与主题数量")
注册 = re.findall(r"register\(\{\s*id:\s*'(\w+)'", html)
断言("组件 12 个", len(注册) == 12, len(注册))

主题函数 = re.findall(r"BLOOM\.(\w+)\s*=", html)
断言("主题 8 个", len(主题函数) == 8, 主题函数)
print()

# ---- 2) 关键组件都在 ----
print("【2】关键组件都在")
for cid in ("text", "playlist", "stepper", "spectrum", "waveform",
            "vectorscope", "loudness", "brightness", "transient",
            "transport", "pianoroll", "pitchwheel"):
    断言("有 %s" % cid, "id: '%s'" % cid in html or "id:'%s'" % cid in html)
print()

# ---- 3) 关键主题都在 ----
print("【3】关键主题都在")
for t in ("sumi", "blueprint", "longexposure", "construct",
          "tape", "staratlas", "weave", "risograph"):
    断言("有主题 %s" % t, "BLOOM.%s" % t in html)
print()

# ---- 4) 语法检查 ----
print("【4】JS 语法")
块 = re.findall(r"<script>(.*?)</script>", html, re.S)
断言("script 块数正常", 2 <= len(块) <= 6, len(块))
全部OK = True
for i, b in enumerate(块):
    f = 根 / "out" / ("scan_chk%d.js" % i)
    f.write_text(b, encoding="utf-8")
    rr = subprocess.run(["node", "--check", str(f)],
                        capture_output=True, text=True)
    if rr.returncode != 0:
        全部OK = False
        print("    块%d 错误: %s" % (i, rr.stderr[:200]))
断言("所有 script 块语法正确", 全部OK)
print()

# ---- 5) 顺序依赖 ----
print("【5】顺序依赖")
# declare.js 必须在 themes 之前
i_declare = html.find("BLOOM = {")
# 注意：产物里是 `BLOOM.sumi` 后面不一定紧跟 `=`（可能换行/空格）
_位置 = [html.find("BLOOM.%s" % t) for t in
         ("sumi", "blueprint", "construct", "tape")]
_位置 = [x for x in _位置 if x > 0]
i_first_theme = min(_位置) if _位置 else -1
断言("declare 在主题之前",
     0 < i_declare < i_first_theme,
     "declare=%d first_theme=%d" % (i_declare, i_first_theme))

# text.js 必须在其它组件之前
# 用正则找，因为产物里 register({ 与 id: 之间可能有换行
_注册位 = {}
for _m in re.finditer(r"id:\s*[\x27\x22](\w+)[\x27\x22]", html):
    _注册位.setdefault(_m.group(1), _m.start())
i_text = _注册位.get("text", -1)
_其它 = [v for k, v in _注册位.items() if k != "text"]
i_other = min(_其它) if _其它 else -1
断言("text 在其它组件之前",
     0 < i_text < i_other,
     "text=%d 最早的其它=%d" % (i_text, i_other))
print()

print("=" * 70)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 70)
sys.exit(1 if 失败 else 0)
