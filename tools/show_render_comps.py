import pathlib

s = (pathlib.Path(r"D:\FL_VISUAL_TEST") / "app_server.py").read_text(
    encoding="utf-8")

i = s.find('"组件"')
n = 0
while i > 0 and n < 4:
    print(s[max(0, i - 300):i + 220])
    print("=" * 60)
    i = s.find('"组件"', i + 1)
    n += 1
