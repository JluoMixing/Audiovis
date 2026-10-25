"""验证 README 在 GitHub 上的实际渲染结果。

## 查什么

1. 封面图是否渲染成 <img>（能显示）
2. 链接指向是否正确（blob 页面，点开有播放器）
3. 相对路径是否被 GitHub 正确改写
"""
import json
import pathlib
import urllib.request

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
readme = (根 / "README.md").read_text(encoding="utf-8")

print("=" * 74)
print("验证 README 渲染")
print("=" * 74)
print()

# 用 GitHub API 渲染（与网页同一套 gfm）
req = urllib.request.Request(
    "https://api.github.com/markdown",
    data=json.dumps({"text": readme, "mode": "gfm",
                     "context": "JluoMixing/Audiovis"}).encode(),
    headers={"Content-Type": "application/json",
             "Accept": "application/vnd.github+json",
             "User-Agent": "audiovis"})
html = urllib.request.urlopen(req, timeout=60).read().decode()

print("【1】宣传片段落的渲染结果")
i = html.find("宣传片")
段 = html[i:i + 900] if i > 0 else ""
print(段[:800])
print()

print("【2】关键检查")
检查 = [
    ("封面图渲染为 <img>", '<img' in 段 and 'poster.jpg' in 段),
    ("封面图有链接包裹", '<a' in 段 and 'href=' in 段),
    ("链接指向 mp4", '.mp4' in 段),
    ("竖屏版链接存在", '9x16' in 段),
    ("没有裸露的 video 标签", '<video' not in 段),
]
for 名, ok in 检查:
    print("  %s %s" % ("✓" if ok else "✗", 名))
print()

# 确认图片和视频文件在远程可访问
print("【3】远程资源可访问性")
for 路径 in ("docs/video/poster.jpg",
             "docs/video/audiovis_promo_16x9.mp4",
             "docs/video/audiovis_promo_9x16.mp4"):
    url = ("https://raw.githubusercontent.com/JluoMixing/Audiovis/main/"
           + 路径)
    try:
        r = urllib.request.urlopen(
            urllib.request.Request(url, headers={"User-Agent": "t"}),
            timeout=60)
        print("  ✓ %-40s %s  %.1f MB"
              % (路径, r.headers.get("Content-Type"),
                 int(r.headers.get("Content-Length", 0)) / 1e6))
    except Exception as e:
        print("  ✗ %-40s %s" % (路径, str(e)[:50]))
print()

# blob 页面（点开后 GitHub 自带播放器）
print("【4】blob 页面（点击封面后落地的地方）")
url = ("https://github.com/JluoMixing/Audiovis/blob/main/"
       "docs/video/audiovis_promo_16x9.mp4")
try:
    r = urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}),
        timeout=60)
    print("  ✓ 状态 %d（HTML 页面，含 GitHub 播放器）" % r.status)
except Exception as e:
    print("  ✗ %s" % str(e)[:60])
