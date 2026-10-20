"""诊断：nujabes 工程的鼓通道名与分类结果。

回答一个具体问题：为什么步进器里只有 hihat，没有 kick / snare。
"""
import json
import pathlib
import sys

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

from src.audio.analyze import _鼓组分类, _midi  # noqa: E402

快照路径 = 根 / "data" / "projects" / "nujabes" / "project_snapshot.json"
原始路径 = 根 / "research" / "results" / "parser_snapshot.json"

快照 = json.loads(快照路径.read_text(encoding="utf-8"))
原始 = json.loads(原始路径.read_text(encoding="utf-8"))
通道表 = {c["iid"]: c for c in 原始["channels"]}

print("=" * 78)
print("nujabes 鼓通道分类诊断")
print("=" * 78)
print()

# ---- 1) 所有通道 + 分类 ----
print("【1】全部通道及其分类")
print("  %-6s %-34s %-10s %s" % ("ch", "名称", "分类", "音符数"))
print("  " + "-" * 72)
统计 = {}
音符数 = {}
for p in 快照["patterns"]:
    for n in p["notes"]:
        if n.get("channel_id") and n["channel_id"].get("value") is not None:
            cid = n["channel_id"]["value"]
            音符数[cid] = 音符数.get(cid, 0) + 1

for cid in sorted(通道表, key=lambda c: -(音符数.get(c, 0))):
    info = 通道表[cid]
    名 = info.get("名称") or info.get("内部名称") or ""
    if not 名 and info.get("sample_path"):
        名 = str(info["sample_path"]).replace("/", "\\").split("\\")[-1]
    类别, 置信 = _鼓组分类(名)
    统计[类别] = 统计.get(类别, 0) + 1
    if 音符数.get(cid, 0) > 0 or 类别 != "other":
        print("  %-6s %-34s %-10s %d" % (
            cid, (名 or "(无名)")[:34], 类别, 音符数.get(cid, 0)))
print()
print("  分类汇总: " + ", ".join("%s=%d" % (k, v) for k, v in
                              sorted(统计.items())))
print()

# ---- 2) 哪些 pattern 会被判为鼓组 ----
print("【2】被判为鼓组的 Pattern，以及其中的通道")
print()
PPQ = 快照["metadata"]["ppq"]
格长 = PPQ / 4
for p in 快照["patterns"]:
    音符 = []
    for n in p["notes"]:
        起 = n["start"]["value"]
        if 起 is None:
            continue
        通道 = n["channel_id"]["value"] if n["channel_id"] else None
        音符.append({"t": 起, "ch": 通道,
                     "vel": n["velocity"]["value"] if n["velocity"] else None})
    if not 音符:
        continue
    音高 = [_midi(n["pitch"]["value"]) for n in p["notes"] if n["pitch"]]
    音高 = [m for m in 音高 if m is not None]
    唯一 = len(set(音高))

    分组 = {}
    for x in 音符:
        分组.setdefault(x["ch"], []).append(x)
    通道信息 = []
    打击 = 0
    for cid, 列表 in sorted(分组.items(), key=lambda kv: -len(kv[1])):
        信息 = 通道表.get(cid) or {}
        名 = (信息.get("名称") or 信息.get("内部名称") or "")
        if not 名 and 信息.get("sample_path"):
            名 = str(信息["sample_path"]).replace("/", "\\").split("\\")[-1]
        类别, _ = _鼓组分类(名)
        if 类别 != "other":
            打击 += 1
        通道信息.append((cid, 名, 类别, len(列表)))

    是鼓组 = (唯一 <= 2) or (打击 == len(通道信息) and 打击 > 0)
    if not 是鼓组:
        continue

    print("  Pattern %-4s 「%s」" % (p.get("index"),
                                  str(p.get("name") or "")[:38]))
    print("      音高种类 %d · 通道 %d · 被判打击 %d" % (
        唯一, len(通道信息), 打击))
    for cid, 名, 类别, 数 in 通道信息:
        标记 = "✓" if 类别 != "other" else "✗"
        print("        %s %-6s %-30s → %-8s (%d 音符)" % (
            标记, cid, (名 or "(无名)")[:30], 类别, 数))
    print()
