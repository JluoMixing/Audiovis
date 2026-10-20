"""检查：导出时刻 10s 时，为什么只有 2 个鼓组 clip 活着。

对比预览（GUI 用 静帧秒 48）与导出（起点 10s）。
"""
import json
import pathlib
import sys

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

快照 = json.loads((根 / "data" / "projects" / "nujabes" /
                   "project_snapshot.json").read_text(encoding="utf-8"))
PPQ = 快照["metadata"]["ppq"]
tempo = (快照["metadata"]["tempo"] or {}).get("value") or 95.246

鼓组id = {2, 3, 4, 5, 6, 7, 8, 9, 10, 11}

clips = []
for tr in 快照["arrangement"]["tracks"]:
    for c in tr.get("clips") or []:
        if c.get("type") != "pattern":
            continue
        pid = (c.get("source") or {}).get("id")
        if pid not in 鼓组id:
            continue
        clips.append({
            "pid": pid,
            "start": (c.get("start") or {}).get("value"),
            "end": (c.get("end") or {}).get("value"),
            "track": tr.get("index"),
        })

print("=" * 74)
print("鼓组 clip 覆盖检查")
print("=" * 74)
print("PPQ=%s  tempo=%.3f BPM   1 拍 = %.4f 秒" % (
    PPQ, tempo, 60.0 / tempo))
print("共 %d 个鼓组 clip" % len(clips))
print()


def 秒到tick(sec):
    return sec * tempo / 60.0 * PPQ


for 秒 in [0, 5, 10, 20, 40, 48]:
    t = 秒到tick(秒)
    活 = [c for c in clips if c["start"] <= t < c["end"]]
    pids = sorted({c["pid"] for c in 活})
    print("  %2ds (tick %8.0f): %d 个 clip 活着 → P%s" % (
        秒, t, len(活), ",".join(map(str, pids)) if pids else "(无)"))
print()

# 每个 pattern 的覆盖时长
print("各 pattern 的总覆盖（tick）与对应秒：")
for pid in sorted(鼓组id):
    cs = [c for c in clips if c["pid"] == pid]
    if not cs:
        continue
    总 = sum(c["end"] - c["start"] for c in cs)
    最早 = min(c["start"] for c in cs)
    最晚 = max(c["end"] for c in cs)
    print("  P%-3s %2d 个 clip  覆盖 %7d tick (%6.1fs)  %.1fs ~ %.1fs" % (
        pid, len(cs), 总, 总 / PPQ * 60 / tempo,
        最早 / PPQ * 60 / tempo, 最晚 / PPQ * 60 / tempo))
