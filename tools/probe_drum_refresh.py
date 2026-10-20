"""任务1-b（续）：鼓组提示改为实时取当前工程数据。

## 根因

鼓组提示在页面加载时执行一次：
    显示鼓组提示(DATA.drumStats, DATA.drumMissed, DATA.drumAudio)
`DATA` 是**构建期注入的**（示例工程的 nujabes 数据）。
用户导入自己的工程后页面会 reload，但……

等等 —— 导入后确实会 reload，那 DATA 应该换成新工程的数据才对。
用户看到「没刷新」，真实原因需要确认。

可能是：`/api/import` 完成后页面 reload，但 `do_GET` 返回的仍是
`会话.页面` 里缓存的旧 HTML（没清缓存）。

先查这一点，再决定改法。
"""
import pathlib
import re

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")

print("=" * 74)
print("鼓组提示不刷新的真实原因")
print("=" * 74)
print()

s = (根 / "app_server.py").read_text(encoding="utf-8")
lines = s.split("\n")

print("【1】跑导入 完成后做了什么")
i = s.find("def 跑导入(")
if i > 0:
    ln = s[:i].count("\n") + 1
    for j in range(ln - 1, min(len(lines), ln + 70)):
        print("  %4d %s" % (j + 1, lines[j][:96]))
