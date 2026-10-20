"""island 的鼓组识别诊断：通道名、分类、pattern 类型。"""
import json
import pathlib
import sys

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

from src.parser import flp as flp模块  # noqa: E402
from src.parser import snapshot as 快照模块  # noqa: E402
from src.audio.analyze import _鼓组分类  # noqa: E402

工程 = pathlib.Path(r"E:\FL_Project\island")
原始 = flp模块.解析(str(工程 / "island.flp"))
快照 = 快照模块.规范化(原始)
PPQ = 快照["metadata"]["ppq"]
tempo = (快照["metadata"]["tempo"] or {}).get("value") or 120.0

通道表 = {c["iid"]: c for c in (快照.get("channels") or [])}

# 每个通道的音符数
音符数 = {}
for p in 快照["patterns"]:
    for n in p["notes"]:
        cid = (n.get("channel_id") or {}).get("value")
        if cid is not None:
            音符数[cid] = 音符数.get(cid, 0) + 1

print("=" * 84)
print("island 通道分类")
print("=" * 84)
print()
print("  %-5s %-34s %-10s %8s" % ("ch", "名称", "分类", "音符数"))
print("  " + "-" * 76)

统计 = {}
for cid in sorted(通道表, key=lambda c: -音符数.get(c, 0)):
    info = 通道表[cid]
    名 = info.get("name") or info.get("internal_name") or ""
    if not 名 and info.get("sample_path"):
        名 = str(info["sample_path"]).replace("/", "\\").split("\\")[-1]
    类, _ = _鼓组分类(名)
    统计[类] = 统计.get(类, 0) + 1
    n = 音符数.get(cid, 0)
    if n > 0 or 类 != "other":
        print("  %-5s %-34s %-10s %8d" % (
            cid, (名 or "(无名)")[:34], 类, n))
    快照.setdefault("_x", None)

print()
print("  分类汇总: " + ", ".join("%s=%d" % (k, v) for k, v in sorted(统计.items())))
print()

# ---- pattern 判定 ----
print("=" * 84)
print("Pattern 是否被判为鼓组")
print("=" * 84)
print()

def _midi(v):
    return v.get("value") if isinstance(v, dict) else v

判定鼓组 = []
for p in 快照["patterns"]:
    音符 = []
    for n in p["notes"]:
        起 = (n.get("start") or {}).get("value")
        if 起 is None:
            continue
        通道 = (n.get("channel_id") or {}).get("value")
        音符.append({"t": 起, "ch": 通道})
    if not 音符:
        continue
    音高 = [_midi(n.get("pitch")) for n in p["notes"] if n.get("pitch")]
    音高 = [m for m in 音高 if m is not None]
    唯一 = len(set(音高))

    分组 = {}
    for x in 音符:
        分组.setdefault(x["ch"], []).append(x)
    打击 = 0
    名集 = []
    for cid in 分组:
        info = 通道表.get(cid) or {}
        名 = info.get("name") or info.get("internal_name") or ""
        if not 名 and info.get("sample_path"):
            名 = str(info["sample_path"]).replace("/", "\\").split("\\")[-1]
        类, _ = _鼓组分类(名)
        if 类 != "other":
            打击 += 1
        名集.append((名[:20], 类))

    是鼓组 = (唯一 <= 2) or (打击 == len(分组) and 打击 > 0)
    pname = (p.get("name") or {}).get("value") if isinstance(p.get("name"), dict) else p.get("name")
    if 是鼓组:
        判定鼓组.append(p)

print("  被判为鼓组的 pattern：%d 个" % len(判定鼓组))
for p in 判定鼓组:
    pname = p.get("name")
    if isinstance(pname, dict):
        pname = pname.get("value")
    名字 = str(pname or "")[:44]
    行 = []
    for n in p["notes"][:1]:
        cid = (n.get("channel_id") or {}).get("value")
        类, _ = _鼓组分类((通道表.get(cid) or {}).get("name") or "")
        行.append(类)
    print("     P%-4s 「%-44s」" % (p.get("id"), 名字))
print()

# ---- 有多少 pattern 因为「是音频采样」而根本没进 patterns ----
print("=" * 84)
print("音频形式的鼓（采样 clip）")
print("=" * 84)
print()
音频源 = 快照.get("audio_sources") or {}
print("  audio_sources 数量: %d" % len(音频源))
for k, v in list(音频源.items())[:20]:
    名 = str(k).replace("/", "\\").split("\\")[-1]
    print("     id=%-4s %-40s 通道 %s" % (
        v.get("id"), 名[:40], v.get("channel_ids")))
print()
音频clip数 = 0
for tr in 快照["arrangement"]["tracks"]:
    for c in tr.get("clips") or []:
        if c.get("type") == "audio":
            音频clip数 += 1
print("  音频 clip 总数: %d" % 音频clip数)
