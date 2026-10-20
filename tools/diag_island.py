"""诊断 island 工程：① 时长为何只到 80s  ② 鼓组识别为何大部分是 other"""
import json
import pathlib
import sys

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

from src.parser import flp as flp模块  # noqa: E402
from src.parser import snapshot as 快照模块  # noqa: E402
from src.audio.analyze import _鼓组分类  # noqa: E402

工程 = pathlib.Path(r"E:\FL_Project\island")
FLP = 工程 / "island.flp"
音频 = 工程 / "island.mp3"

print("=" * 80)
print("island 工程诊断")
print("=" * 80)
print()

原始 = flp模块.解析(str(FLP))
快照 = 快照模块.规范化(原始)
PPQ = 快照["metadata"]["ppq"]
tempo = (快照["metadata"]["tempo"] or {}).get("value") or 120.0

print("【1】基本参数")
print("   PPQ = %s    tempo = %.3f BPM" % (PPQ, tempo))
print("   1 拍 = %.4f 秒   1 小节 = %.4f 秒" % (60 / tempo, 240 / tempo))
print()

# ---- 音频时长 ----
import subprocess  # noqa: E402
sys.path.insert(0, str(根))
import imageio_ffmpeg  # noqa: E402
ff = imageio_ffmpeg.get_ffmpeg_exe()
r = subprocess.run([ff, "-i", str(音频)], capture_output=True, text=True,
                   encoding="utf-8", errors="replace")
for line in (r.stderr or "").splitlines():
    if "Duration" in line:
        print("【2】音频 " + line.strip())
print()

# ---- clip 的最远结束点 ----
最远 = 0
最远clip = None
计数 = 0
类型计数 = {}
for tr in 快照["arrangement"]["tracks"]:
    for c in tr.get("clips") or []:
        end = (c.get("end") or {}).get("value")
        if end is None:
            continue
        计数 += 1
        t = c.get("type")
        类型计数[t] = 类型计数.get(t, 0) + 1
        if end > 最远:
            最远 = end
            最远clip = c

print("【3】Playlist 里 clip 的最远结束点")
print("   clip 总数 = %d   类型分布 = %s" % (计数, 类型计数))
print("   最远 end = %s tick = %.2f 秒" % (最远, 最远 / PPQ * 60 / tempo))
if 最远clip:
    print("   该 clip: type=%s  source=%s" % (
        最远clip.get("type"), (最远clip.get("source") or {}).get("id")))
print()

# ---- 按类型看最远 ----
按类型 = {}
for tr in 快照["arrangement"]["tracks"]:
    for c in tr.get("clips") or []:
        end = (c.get("end") or {}).get("value")
        if end is None:
            continue
        t = c.get("type")
        按类型[t] = max(按类型.get(t, 0), end)
print("   按类型的最远 end：")
for t, v in sorted(按类型.items(), key=lambda x: -x[1]):
    print("      %-12s %8d tick = %7.2f 秒" % (t, v, v / PPQ * 60 / tempo))
print()

# ---- 逐轨道最远 ----
print("【4】各轨道最远结束点（仅列有 clip 的）")
轨道信息 = []
for tr in 快照["arrangement"]["tracks"]:
    cs = tr.get("clips") or []
    if not cs:
        continue
    m = max(((c.get("end") or {}).get("value") or 0) for c in cs)
    轨道信息.append((tr.get("index"), len(cs), m))
轨道信息.sort(key=lambda x: -x[2])
for idx, n, m in 轨道信息:
    print("   轨 %-3s %2d 个 clip   最远 %8d tick = %7.2f 秒" % (
        idx, n, m, m / PPQ * 60 / tempo))
print()
