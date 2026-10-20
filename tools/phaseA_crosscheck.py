"""阶段 A-3：用 flpdiff（MIT，独立实现）交叉验证 7 个工程。

目的：PyFLP 是单点依赖，若它某个版本读错数据我们无从察觉。
flpdiff 是完全独立的实现，两者一致才说明数据可信。

只读操作：仅执行 info --format json。
"""
import hashlib
import json
import pathlib
import subprocess
import sys

根 = pathlib.Path(r"E:\FL_Project")
flpdiff = pathlib.Path(r"D:\FL_VISUAL_TEST\research\vendor\flpdiff-windows-x64.exe")

if not flpdiff.is_file():
    sys.exit("找不到 flpdiff：%s" % flpdiff)

工程列表 = ["amapiano", "drill", "guitar_birth", "half_fire_half_sea",
            "island", "jungle", "rage", "nujabes"]

结果 = []
for 名 in 工程列表:
    flp = 根 / 名 / (名 + ".flp")
    项 = {"工程": 名, "状态": None}
    if not flp.is_file():
        项["状态"] = "FLP缺失"
        结果.append(项)
        continue

    try:
        进程 = subprocess.run(
            [str(flpdiff), "info", "--format", "json", str(flp)],
            capture_output=True, timeout=120)
        if 进程.returncode != 0:
            项["状态"] = "flpdiff失败"
            项["stderr"] = 进程.stderr.decode("utf-8", "replace")[:200]
            结果.append(项)
            continue

        数据 = json.loads(进程.stdout.decode("utf-8", "replace"))
        元 = 数据.get("metadata", {})

        # 统计 placement（flpdiff 的结构：arrangements[].tracks[].items）
        placement = 0
        pattern放置 = 0
        通道放置 = 0
        轨道数 = 0
        有内容轨道 = 0
        for arr in 数据.get("arrangements", []):
            for tr in arr.get("tracks", []):
                轨道数 += 1
                条目 = tr.get("items") or tr.get("playlist_items") or []
                if 条目:
                    有内容轨道 += 1
                for it in 条目:
                    placement += 1
                    k = str(it.get("kind", it.get("type", ""))).lower()
                    if "pattern" in k:
                        pattern放置 += 1
                    else:
                        通道放置 += 1

        项["状态"] = "成功"
        项["ppq"] = 元.get("ppq")
        项["tempo"] = 元.get("tempo")
        项["版本"] = 元.get("version")
        项["placement总数"] = placement
        项["Pattern放置"] = pattern放置
        项["通道放置"] = 通道放置
        项["轨道数"] = 轨道数
        项["有内容轨道"] = 有内容轨道
        项["通道数"] = len(数据.get("channels", []))
        项["Pattern数"] = len(数据.get("patterns", []))

    except subprocess.TimeoutExpired:
        项["状态"] = "超时"
    except Exception as e:
        项["状态"] = "异常"
        项["错误"] = "%s: %s" % (type(e).__name__, str(e)[:150])

    结果.append(项)

# ---- 与 PyFLP 结果对比 ----
pyflp_file = pathlib.Path(r"D:\FL_VISUAL_TEST\tools\phaseA_parse_results.json")
pyflp结果 = {}
if pyflp_file.is_file():
    for x in json.loads(pyflp_file.read_text(encoding="utf-8")):
        # 目录名 → 结果
        键 = x.get("目录") or x.get("工程")
        pyflp结果[键] = x

print("=" * 82)
print("阶段 A：PyFLP vs flpdiff 交叉验证")
print("=" * 82)
print("%-20s %8s %8s %8s %10s %10s %8s" % (
    "工程", "PPQ(P/F)", "Tempo(P/F)", "轨道", "Placement(P)", "Placement(F)", "一致"))
print("-" * 82)

一致数 = 0
可比数 = 0
for 项 in 结果:
    名 = 项["工程"]
    p = pyflp结果.get(名, {})
    if 项["状态"] != "成功":
        print("%-20s  flpdiff %s" % (名, 项["状态"]))
        continue
    if p.get("状态") != "成功":
        print("%-20s  PyFLP 不可比" % 名)
        continue

    可比数 += 1
    ppq一致 = str(p.get("ppq")) == str(项.get("ppq"))
    tempo一致 = abs(float(p.get("tempo", 0) or 0) - float(项.get("tempo", 0) or 0)) < 0.01
    place一致 = p.get("placement总数") == 项.get("placement总数")
    if ppq一致 and tempo一致 and place一致:
        一致数 += 1

    print("%-20s %8s %8s %8d %10s %10s %8s" % (
        名,
        "%s/%s" % (p.get("ppq"), 项.get("ppq")),
        "%.2f/%.2f" % (float(p.get("tempo", 0) or 0), float(项.get("tempo", 0) or 0)),
        项.get("轨道数", 0),
        p.get("placement总数"), 项.get("placement总数"),
        "✓" if (ppq一致 and tempo一致 and place一致) else "✗"))

print()
print("汇总：%d/%d 工程在两个 parser 间完全一致" % (一致数, 可比数))

# 差异明细
差异 = []
for 项 in 结果:
    p = pyflp结果.get(项["工程"], {})
    if 项["状态"] != "成功" or p.get("状态") != "成功":
        continue
    d = []
    if str(p.get("ppq")) != str(项.get("ppq")):
        d.append("PPQ: %s vs %s" % (p.get("ppq"), 项.get("ppq")))
    if abs(float(p.get("tempo", 0) or 0) - float(项.get("tempo", 0) or 0)) >= 0.01:
        d.append("Tempo: %s vs %s" % (p.get("tempo"), 项.get("tempo")))
    if p.get("placement总数") != 项.get("placement总数"):
        d.append("Placement: %s vs %s" % (p.get("placement总数"), 项.get("placement总数")))
    if d:
        差异.append((项["工程"], d))

if 差异:
    print()
    print("差异明细：")
    for 名, d in 差异:
        print("  %s:" % 名)
        for x in d:
            print("     %s" % x)

out = pathlib.Path(r"D:\FL_VISUAL_TEST\tools\phaseA_flpdiff_results.json")
out.write_text(json.dumps(结果, ensure_ascii=False, indent=1), encoding="utf-8")
print()
print("已记录:", out)
