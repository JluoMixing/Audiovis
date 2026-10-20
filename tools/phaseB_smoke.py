"""阶段 B：多工程端到端冒烟测试。

对每个工程渲染一个短片段，验证：
  · 解析成功
  · 音频分析成功
  · 渲染 + 编码产出有效视频
  · 记录每帧耗时（用于全片外推）

不做完整渲染（太慢），只渲染 2 秒验证链路。
"""
import json
import pathlib
import subprocess
import sys
import time

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
工程根 = pathlib.Path(r"E:\FL_Project")

# (目录名, 音频文件名或 None 表示自动查找)
# 注：drill 与 jungle 目录下没有混音音频（只有单个采样 wav），
#     故不纳入端到端测试 —— 这不是解析问题，是缺少输入。
工程列表 = [
    ("amapiano", "amapiano.mp3"),
    ("rage", "rage.mp3"),
    ("island", "island.mp3"),
    ("nujabes", "nujabes.mp3"),
    ("goodnight", None),
]

输出目录 = 根 / "out" / "smoke"
输出目录.mkdir(parents=True, exist_ok=True)

结果 = []
for 目录名, 音频名 in 工程列表:
    目录 = 工程根 / 目录名
    flp = 目录 / (目录名 + ".flp")
    if not flp.is_file():
        结果.append({"工程": 目录名, "状态": "FLP缺失"})
        continue

    # 找音频
    if 音频名:
        音频 = 目录 / 音频名
    else:
        # 找同名 mp3，否则取第一个 mp3
        候选 = sorted(目录.glob("*.mp3"))
        同名 = [c for c in 候选 if c.stem == 目录名]
        音频 = 同名[0] if 同名 else (候选[0] if 候选 else None)

    if not 音频 or not 音频.is_file():
        结果.append({"工程": 目录名, "状态": "音频缺失",
                     "已找到": [c.name for c in 目录.glob("*.mp3")][:3]})
        continue

    项 = {"工程": 目录名, "音频": 音频.name}
    print("=" * 68)
    print("【%s】%s" % (目录名, 音频.name))
    print("=" * 68)

    起 = time.perf_counter()
    命令 = [
        sys.executable, "-m", "src.cli", "render",
        "--flp", str(flp), "--audio", str(音频),
        "--out", str(输出目录 / ("%s.mp4" % 目录名)),
        "--theme", "sumi", "--fps", "30",
        "--duration", "2", "--start", "10",
        "--workdir", str(输出目录 / ("work_%s" % 目录名)),
    ]
    进程 = subprocess.run(命令, capture_output=True, timeout=600, cwd=str(根))
    stderr = 进程.stderr.decode("utf-8", "replace")
    stdout = 进程.stdout.decode("utf-8", "replace")

    if 进程.returncode != 0:
        项["状态"] = "失败"
        项["错误"] = stderr.strip().splitlines()[-1][:160] if stderr.strip() else "未知"
        print("  ✗ %s" % 项["错误"])
        结果.append(项)
        continue

    # 解析统计：CLI 输出中夹着进度行，需提取最后一个完整 JSON 对象
    try:
        import re
        # 找最后一个 "{" 到末尾，并逐步回退直到能解析
        统计 = None
        for m in re.finditer(r"^\{", stdout, re.M):
            片段 = stdout[m.start():]
            try:
                统计 = json.loads(片段)
                break
            except json.JSONDecodeError:
                continue
        if 统计 is None:
            raise ValueError("未找到可解析的 JSON")
        项.update({
            "状态": "成功",
            "帧数": 统计["总帧数"],
            "文件MB": 统计["文件MB"],
            "渲染每帧ms": 统计["渲染每帧ms"],
            "编码每帧ms": 统计["编码每帧ms"],
            "墙钟秒": round(time.perf_counter() - 起, 2),
        })
        print("  ✓ %d 帧  %.2f MB  渲染 %.1f ms/帧  编码 %.1f ms/帧" % (
            统计["总帧数"], 统计["文件MB"],
            统计["渲染每帧ms"], 统计["编码每帧ms"]))
    except Exception as e:
        项["状态"] = "统计解析失败"
        项["错误"] = str(e)[:120]
        print("  ⚠ 统计解析失败: %s" % e)

    结果.append(项)

print()
print("=" * 68)
print("汇总")
print("=" * 68)
成功 = [r for r in 结果 if r.get("状态") == "成功"]
for r in 结果:
    if r.get("状态") == "成功":
        print("  ✓ %-12s %2d 帧  %5.2f MB  渲染 %5.1f ms/帧" % (
            r["工程"], r["帧数"], r["文件MB"], r["渲染每帧ms"]))
    else:
        print("  ✗ %-12s %s %s" % (
            r["工程"], r.get("状态"), r.get("错误", "")[:60]))

print()
print("%d/%d 成功" % (len(成功), len(结果)))
if 成功:
    平均渲染 = sum(r["渲染每帧ms"] for r in 成功) / len(成功)
    平均编码 = sum(r["编码每帧ms"] for r in 成功) / len(成功)
    print("平均: 渲染 %.1f ms/帧，编码 %.1f ms/帧，合计 %.1f ms/帧" % (
        平均渲染, 平均编码, 平均渲染 + 平均编码))

out = 根 / "tools" / "phaseB_smoke.json"
out.write_text(json.dumps(结果, ensure_ascii=False, indent=1), encoding="utf-8")
print("已记录:", out)
