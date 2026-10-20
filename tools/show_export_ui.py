import pathlib

h = (pathlib.Path(r"D:\FL_VISUAL_TEST") / "preview" / "gui_prototype.html"
     ).read_text(encoding="utf-8")

i = h.find('id="exSlow"')
print("--- exSlow 元素 ---")
print(h[max(0, i - 260):i + 200])

print()
i2 = h.find("译('export.saved')")
print("--- 成功提示逻辑 ---")
print(h[max(0, i2 - 420):i2 + 260])
