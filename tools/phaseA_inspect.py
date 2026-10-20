"""阶段 A-1：核实指定工程的实际结构。

不假设目录结构，逐一检查 FLP 与配套音频是否存在、大小、SHA-256。
"""
import hashlib
import json
import pathlib

根 = pathlib.Path(r"E:\FL_Project")
指定 = ["amapiano", "drill", "guitar birth", "half fire half sea",
        "island", "jungle", "rage"]

结果 = []
for 名称 in 指定:
    目录 = 根 / 名称
    项 = {"工程": 名称, "目录存在": 目录.is_dir(), "flp": None, "音频": []}
    if not 目录.is_dir():
        结果.append(项)
        continue

    # FLP：优先同名，否则取目录下第一个
    同名 = 目录 / (名称 + ".flp")
    if 同名.is_file():
        flp = 同名
    else:
        cands = sorted(目录.glob("*.flp"))
        flp = cands[0] if cands else None

    if flp:
        data = flp.read_bytes()
        项["flp"] = {
            "路径": str(flp),
            "名称": flp.name,
            "字节": len(data),
            "sha256": hashlib.sha256(data).hexdigest()[:16],
            "是否同名": flp.name == 名称 + ".flp",
        }
        # 同目录下的音频（可能有多个）
        for ext in ("*.mp3", "*.wav"):
            for a in sorted(目录.glob(ext)):
                项["音频"].append({
                    "名称": a.name, "字节": a.stat().st_size,
                    "扩展名": a.suffix.lower(),
                })
    # 其他 flp（用于判断是否多版本）
    项["其他flp"] = [p.name for p in sorted(目录.glob("*.flp"))
                     if not flp or p.name != flp.name]
    结果.append(项)

print("=" * 74)
for 项 in 结果:
    print("工程: %s" % 项["工程"])
    if not 项["目录存在"]:
        print("    ✗ 目录不存在")
        continue
    if 项["flp"]:
        f = 项["flp"]
        print("    FLP: %s  %.2f MB  sha=%s  %s" % (
            f["名称"], f["字节"] / 1e6, f["sha256"],
            "(同名)" if f["是否同名"] else "(非同名，取首个)"))
    else:
        print("    ✗ 未找到 FLP")
    if 项["音频"]:
        for a in 项["音频"][:4]:
            print("    音频: %-44s %6.2f MB" % (a["名称"][:44], a["字节"] / 1e6))
        if len(项["音频"]) > 4:
            print("          ... 另有 %d 个音频" % (len(项["音频"]) - 4))
    else:
        print("    ⚠ 同目录无音频（可能需从别处取）")
    if 项["其他flp"]:
        print("    其他 FLP: %s" % ", ".join(项["其他flp"][:4]))
    print()

# 汇总
有flp = [x for x in 结果 if x.get("flp")]
有音频 = [x for x in 结果 if x.get("音频")]
print("=" * 74)
print("汇总：%d/%d 有 FLP，%d/%d 有配套音频" % (
    len(有flp), len(结果), len(有音频), len(结果)))

out = pathlib.Path(r"D:\FL_VISUAL_TEST\tools\phaseA_projects.json")
out.write_text(json.dumps(结果, ensure_ascii=False, indent=1), encoding="utf-8")
print("已记录:", out)
