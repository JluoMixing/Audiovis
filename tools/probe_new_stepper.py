"""验证新算法在 island / nujabes 上的表现。"""
import json
import pathlib
import sys

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

from src.parser import flp as flp模块  # noqa: E402
from src.parser import snapshot as 快照模块  # noqa: E402
from src.audio.stepper import 提取_鼓组  # noqa: E402


def 跑(名, flp):
    print("=" * 78)
    print("%s" % 名)
    print("=" * 78)
    快照 = 快照模块.规范化(flp模块.解析(str(flp)))
    通道表 = {c["iid"]: {
        "名称": c.get("name") or "",
        "内部名称": c.get("internal_name") or "",
        "sample_path": c.get("sample_path"),
    } for c in (快照.get("channels") or [])}

    r = 提取_鼓组(快照, 通道表)
    print("统计: " + json.dumps(r["stats"], ensure_ascii=False))
    print()

    for g in r["groups"]:
        print("  Pattern %-4s  依据=%-6s  行数=%d" % (
            g["id"], g["basis"], len(g["rows"])))
        print("      %-4s %-6s %-8s %-6s %s" % (
            "序", "midi", "freq", "分数", "节奏特征"))
        for i, row in enumerate(g["rows"]):
            f = row["features"]
            print("      %-4d %-6s %-8s %-6s 步数=%-3s 八分比=%.2f 正拍比=%.2f 反拍比=%.2f" % (
                i + 1, row["midi"], row["freq"], row["score"],
                f.get("覆盖步数"), f.get("八分比", 0),
                f.get("正拍比", 0), f.get("反拍比", 0)))
            print("            步: " + str(sorted(row["steps"].items())[:12]))
        print()

    # 总行数（跨所有 pattern 的行集合）
    所有midi = set()
    for g in r["groups"]:
        for row in g["rows"]:
            if row["midi"] is not None:
                所有midi.add(row["midi"])
    print("  出现的音高集合: %s" % sorted(所有midi))
    print()


跑("island", r"E:\FL_Project\island\island.flp")
跑("nujabes", r"E:\FL_Project\nujabes\nujabes.flp")
