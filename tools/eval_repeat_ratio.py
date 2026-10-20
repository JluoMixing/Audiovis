"""探索：有没有比「GM 音高范围」更普适的软音源鼓组判据？

思路：鼓组软音源 pattern 的共同特征是
  · 音高种类少（一个软音源里的鼓件数，通常 3~10）
  · 节奏规整（落在 16 分格上）
  · 音符密集（鼓组 pattern 通常音符多）
  · **音高种类虽少但音符多**（每个音高重复很多次）

而旋律 pattern 的特征是
  · 音高种类多、每种重复次数少
  · 节奏自由（不一定落在 16 分格）

关键区分量：**平均每个音高出现多少次**（重复度）
  鼓组：一个音高（如 hihat）会重复几十次
  旋律：一个音高通常只出现 1~3 次

在真实工程上验证这个指标。
"""
import pathlib
import sys

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

from src.parser import flp as flp模块  # noqa: E402
from src.parser import snapshot as 快照模块  # noqa: E402
from src.audio import drums as D  # noqa: E402

工程列表 = [
    ("nujabes", "nujabes.flp"),
    ("island", "island.flp"),
    ("amapiano", "amapiano.flp"),
    ("guitar_birth", "guitar_birth.flp"),
    ("jazzboombap", "jazzboombap.flp"),
    ("rage", "rage.flp"),
    ("drill", "drill.flp"),
]

print("=" * 96)
print("判据探索：平均每音高重复次数（鼓组高、旋律低）")
print("=" * 96)
print()
print("  %-12s %-30s %5s %5s %7s %8s %s" % (
    "工程", "pattern", "音符", "种类", "重复度", "16分对齐", "判定"))
print("  " + "-" * 92)

鼓组样本 = []
旋律样本 = []

for 目录, 文件名 in 工程列表:
    p = pathlib.Path(r"E:\FL_Project") / 目录 / 文件名
    if not p.is_file():
        continue
    try:
        快照 = 快照模块.规范化(flp模块.解析(str(p)))
    except Exception:
        continue
    PPQ = 快照["metadata"]["ppq"]
    格长 = PPQ / 4

    for pt in 快照["patterns"]:
        if not pt["notes"]:
            continue
        pname = pt.get("name")
        if isinstance(pname, dict):
            pname = pname.get("value")
        pname = str(pname or "")

        音高 = []
        for n in pt["notes"]:
            pv = n.get("pitch")
            v = pv.get("value") if isinstance(pv, dict) else pv
            m = D.音名到midi(v)
            if m is not None:
                音高.append(m)
        if len(音高) < 6:
            continue

        种类 = len(set(音高))
        重复度 = len(音高) / 种类

        # 16 分对齐率
        对齐 = 0
        for n in pt["notes"]:
            t = (n.get("start") or {}).get("value")
            if t is None:
                continue
            if abs(t / 格长 - round(t / 格长)) < 0.02:
                对齐 += 1
        对齐率 = 对齐 / max(1, len(pt["notes"]))

        # 粗判定：重复度高 + 对齐率高 → 鼓组
        似鼓 = (重复度 >= 4.0 and 对齐率 >= 0.9)

        # 用 pattern 名做人工标注参考（仅用于本次探索）
        名字 = pname.lower()
        显然鼓 = any(k in 名字 for k in
                    ["drum", "kick", "snare", "hat", "clap", "perc",
                     "amen", "hh", "808"])
        显然旋律 = any(k in 名字 for k in
                     ["melody", "chord", "arp", "bass", "lead", "pad",
                      "flute", "sax", "vocal", "piano", "string", "vibe"])

        标注 = "鼓?" if 显然鼓 else ("旋律?" if 显然旋律 else "")
        if 显然鼓:
            鼓组样本.append((似鼓, 重复度, 对齐率))
        elif 显然旋律:
            旋律样本.append((似鼓, 重复度, 对齐率))

        if 显然鼓 or 显然旋律 or (似鼓 != 显然旋律 and 名字):
            print("  %-12s %-30s %5d %5d %7.2f %7.0f%% %s%s" % (
                目录, pname[:30] or "(无名)", len(音高), 种类, 重复度,
                对齐率 * 100, "似鼓" if 似鼓 else "似旋律",
                "  [" + 标注 + "]" if 标注 else ""))

print()
print("=" * 96)
print("汇总")
print("=" * 96)
if 鼓组样本:
    命中 = sum(1 for x in 鼓组样本 if x[0])
    print("  人工标注为「鼓」的 pattern: %d 个，判据命中 %d 个 (%.0f%%)" % (
        len(鼓组样本), 命中, 命中 / len(鼓组样本) * 100))
if 旋律样本:
    误判 = sum(1 for x in 旋律样本 if x[0])
    print("  人工标注为「旋律」的 pattern: %d 个，被误判成鼓 %d 个 (%.0f%%)" % (
        len(旋律样本), 误判, 误判 / len(旋律样本) * 100))
