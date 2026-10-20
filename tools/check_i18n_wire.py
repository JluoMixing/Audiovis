import pathlib
import re

h = (pathlib.Path(r"D:\FL_VISUAL_TEST") / "preview" / "gui" / "index.html"
     ).read_text(encoding="utf-8")

print("data-i18n 属性总数:", len(re.findall(r"data-i18n=", h)))
print("data-i18n-placeholder:", len(re.findall(r"data-i18n-placeholder=", h)))
print("data-i18n-title:", len(re.findall(r"data-i18n-title=", h)))
print()

for m in list(re.finditer(r'<[^>]*data-i18n="[^"]*"[^>]*>[^<]*', h))[:8]:
    print("  " + m.group(0)[:104])

print()
# 有多少元素带 data-i18n 但其文本不是中文（说明替换错位）
坏 = 0
for m in re.finditer(r'data-i18n="([^"]*)">([^<]*)', h):
    键, 文本 = m.group(1), m.group(2)
    if not re.search(r"[\u4e00-\u9fff]", 文本):
        坏 += 1
        if 坏 <= 5:
            print("  ⚠ 键=%s 文本=%r" % (键, 文本[:30]))
print("可疑替换:", 坏)
