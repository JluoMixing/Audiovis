"""查：island 的 EZdrummer pattern 为何没被「按音高」纳入。"""
import pathlib
import sys

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

from src.parser import flp as flp模块  # noqa: E402
from src.parser import snapshot as 快照模块  # noqa: E402
from src.audio import drums as D  # noqa: E402

工程 = pathlib.Path(r"E:\FL_Project\island")
快照 = 快照模块.规范化(flp模块.解析(str(工程 / "island.flp")))
通道表 = {c["iid"]: c for c in (快照.get("channels") or [])}

print("=" * 80)
print("含 EZdrummer(ch24/ch37) 的 pattern 的纳入判定细节")
print("=" * 80)
print()

目标通道 = {24, 37}
for p in 快照["patterns"]:
    音 = []
    for n in p["notes"]:
        cid = (n.get("channel_id") or {}).get("value")
        if cid not in 目标通道:
            continue
        pv = n.get("pitch")
        raw = pv.get("value") if isinstance(pv, dict) else pv
        midi = D.音名到midi(raw)
        音.append({"raw": raw, "midi": midi, "ch": cid})
    if not 音:
        continue

    pname = p.get("name")
    if isinstance(pname, dict):
        pname = pname.get("value")

    有音高 = [x for x in 音 if x["midi"] is not None]
    命中 = [x for x in 有音高 if D.是打击音高(x["midi"])]
    种类 = len(set(x["midi"] for x in 有音高))

    print("  Pattern %-4s 「%s」" % (p.get("id"), str(pname or "")[:30]))
    print("      EZ 音符 %d  有音高 %d  在GM范围 %d  音高种类 %d" % (
        len(音), len(有音高), len(命中), 种类))
    print("      音高: %s" % sorted(set(x["midi"] for x in 有音高)))
    print("      原始值样例: %s" % [x["raw"] for x in 音[:4]])

    # 关键：这个 pattern 里**全部**音符（不只 EZ 通道）的情况
    全部 = []
    for n in p["notes"]:
        pv = n.get("pitch")
        raw = pv.get("value") if isinstance(pv, dict) else pv
        全部.append(D.音名到midi(raw))
    有 = [m for m in 全部 if m is not None]
    print("      该 pattern 全部音符 %d  有音高 %d  种类 %d" % (
        len(全部), len(有), len(set(有))))
    命中全 = [m for m in 有 if D.是打击音高(m)]
    print("      全部音符里在 GM 范围的: %d / %d" % (len(命中全), len(有)))
    print()
