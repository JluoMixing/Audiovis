import base64
import io
import pathlib
import re

from PIL import Image

h = (pathlib.Path(r"D:\FL_VISUAL_TEST") / "preview" / "gui_prototype.html"
     ).read_text(encoding="utf-8")

m = re.search(r'<link rel="icon"[^>]*>', h)
if m:
    t = m.group(0)
    print("  标签长度: %d 字符" % len(t))
    print("  开头: %s..." % t[:80])
    b = re.search(r"base64,([A-Za-z0-9+/=]+)", t)
    if b:
        im = Image.open(io.BytesIO(base64.b64decode(b.group(1))))
        print("  图片: %dx%d %s" % (im.width, im.height, im.mode))
else:
    print("  ✗ 未找到 favicon")
