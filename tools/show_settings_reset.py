import pathlib

s = (pathlib.Path(r"D:\FL_VISUAL_TEST") / "app_server.py").read_text(
    encoding="utf-8")

i = s.find('if p == "/api/settings/reset":')
if i > 0:
    print(s[i:i + 700])
else:
    print("未找到")
