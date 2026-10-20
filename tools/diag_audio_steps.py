"""查：#step 音频行在 collectDrums 里为何不显示音符。"""
import pathlib
import sys

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

from src.parser import flp as flp模块  # noqa: E402
from src.parser import snapshot as 快照模块  # noqa: E402
from src.audio.stepper import 提取_音频鼓, 提取_鼓组  # noqa: E402

工程 = pathlib.Path(r"E:\FL_Project\island")
快照 = 快照模块.规范化(flp模块.解析(str(工程 / "island.flp")))
PPQ = 快照["metadata"]["ppq"]
tempo = (快照["metadata"]["tempo"] or {}).get("value") or 155.0

通道表 = {c["iid"]: {
    "名称": c.get("name") or "",
    "内部名称": c.get("internal_name") or "",
    "sample_path": c.get("sample_path"),
} for c in (快照.get("channels") or [])}

音频 = 提取_音频鼓(快照, "#step")
print("=" * 76)
print("音频 #step 提取结果")
print("=" * 76)
print("stats: " + str(音频["stats"]))
print()
for g in 音频["groups"]:
    print("  group id=%s origin=%s basis=%s" % (
        g["id"], g["origin"], g["basis"]))
    for r in g["rows"]:
        print("     行 key=%s midi=%s score=%s 步数=%d" % (
            r["key"], r["midi"], r["score"], len(r["steps"])))
        print("        步: %s" % sorted(r["steps"].items())[:16])
print()

# 关键：origin 与 steps 的关系
print("=" * 76)
print("为什么按 330 秒看不到")
print("=" * 76)
print()
g = 音频["groups"][0]
origin = g["origin"]
print("  origin = %s tick = %.2f 秒" % (origin, origin / PPQ * 60 / tempo))
print()
print("  steps 是相对 origin 的步序（格长 = PPQ/4 = %s tick）" % (PPQ / 4))
print("  绝对 tick = clip 起点 + origin + 步序 × 格长  ← 前端这样算")
print()

# 前端 collectDrums 的算法
for r in g["rows"][:2]:
    步们 = sorted(r["steps"].keys())
    print("  行 %s: 首步 %s, 末步 %s" % (r["key"], 步们[0], 步们[-1]))
    # 前端：abs = item.iv.start + item.grp.origin + s * STEP
    # 但音频行的 steps 是「相对 origin」，而 origin 已是最早 clip 起点
    # → abs 算成 origin + origin + s*STEP → 偏了一整个 origin！
    实际起 = origin + 步们[0] * (PPQ / 4)
    print("     正确绝对 tick 应为 %s (%.2f 秒)" % (
        实际起, 实际起 / PPQ * 60 / tempo))
    前端算 = origin + origin + 步们[0] * (PPQ / 4)
    print("     若前端再加一次 origin → %s (%.2f 秒) ← 偏了" % (
        前端算, 前端算 / PPQ * 60 / tempo))
    print()

print("  → 音频行的 steps 已经相对 origin，前端又加了一次 origin，")
print("    导致所有音符被推到 origin×2 的位置。")
