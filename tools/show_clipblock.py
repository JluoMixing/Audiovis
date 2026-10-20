import pathlib

s = (pathlib.Path(r"D:\FL_VISUAL_TEST") / "out" / "y2k_variants.html"
     ).read_text(encoding="utf-8")

i = s.find("TR.clip === 'ascii'")
print("位置:", i)
print("--- 上下文 ---")
print(s[max(0, i - 500):i + 800])
