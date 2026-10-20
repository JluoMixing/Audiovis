"""评估「软音源鼓组」判定的可靠性边界。

对用户所有工程跑一遍，看：
  1) 现有规则能识别哪些软音源 pattern
  2) 哪些被漏掉（该纳入却没纳入）
  3) 哪些被误纳（不该纳入却纳入）
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
    ("popout", "popout.flp"),
    ("drill", "drill.flp"),
]

print("=" * 100)
print("各工程的「软音源鼓组」候选 pattern（按音高判定）")
print("=" * 100)
print()

总计 = {"候选": 0, "会纳入": 0, "会漏掉": 0}

for 目录, 文件名 in 工程列表:
    p = pathlib.Path(r"E:\FL_Project") / 目录 / 文件名
    if not p.is_file():
        print("  ✗ %s 不存在" % p)
        continue
    try:
        快照 = 快照模块.规范化(flp模块.解析(str(p)))
    except Exception as e:
        print("  ✗ %s 解析失败: %s" % (文件名, e))
        continue

    通道表 = {c["iid"]: {
        "名称": c.get("name") or "",
        "内部名称": c.get("internal_name") or "",
        "sample_path": c.get("sample_path"),
    } for c in (快照.get("channels") or [])}

    print("【%s】" % 目录)

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
        if not 音高:
            continue
        种类 = len(set(音高))
        在GM = sum(1 for m in 音高 if D.是打击音高(m))

        # 只看「音高种类少但音符多」的：这是鼓组 pattern 的典型特征
        if 种类 > 12 or len(音高) < 8:
            continue

        总计["候选"] += 1
        命中率 = 在GM / len(音高)
        会纳入 = (命中率 >= 0.85 and 种类 <= 8)
        if 会纳入:
            总计["会纳入"] += 1
        else:
            总计["会漏掉"] += 1

        标记 = "✓纳入" if 会纳入 else "✗漏掉"
        音高范围 = "%d..%d" % (min(音高), max(音高))
        print("    %s P%-4s %-34s 音符%-4d 种类%-3d 音高%-8s GM命中%3.0f%%" % (
            标记, pt.get("id"), pname[:34], len(音高), 种类, 音高范围,
            命中率 * 100))
        if not 会纳入:
            # 说明为什么漏
            理由 = []
            if 命中率 < 0.85:
                理由.append("GM 命中率 %.0f%% < 85%%" % (命中率 * 100))
            if 种类 > 8:
                理由.append("音高种类 %d > 8" % 种类)
            print("          → %s" % "; ".join(理由))
    print()

print("=" * 100)
print("汇总: 候选 %d 个, 会纳入 %d, 会漏掉 %d" % (
    总计["候选"], 总计["会纳入"], 总计["会漏掉"]))
print("=" * 100)
