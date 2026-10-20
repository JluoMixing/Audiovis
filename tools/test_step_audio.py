"""island 端到端：#step 音频 + 第三层判据 + 界面提示。"""
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))
import imageio_ffmpeg  # noqa: E402

端口 = int(sys.argv[1]) if len(sys.argv) > 1 else 8840
基址 = "http://127.0.0.1:%d" % 端口
工程 = pathlib.Path(r"E:\FL_Project\island")
输出 = 根 / "out" / "island_step.mp4"

通过 = 0
失败 = 0


def 断言(名, 条件, 详情=""):
    global 通过, 失败
    if 条件:
        通过 += 1
        print("  ✓ " + 名)
    else:
        失败 += 1
        print("  ✗ " + 名 + ("  → " + str(详情) if 详情 else ""))


def 发(路径, 数据):
    req = urllib.request.Request(
        基址 + 路径, data=json.dumps(数据).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode("utf-8"))


def 取(路径):
    with urllib.request.urlopen(基址 + 路径, timeout=180) as r:
        return json.loads(r.read().decode("utf-8"))


def 等任务(ident, 超时=1800):
    起 = time.time()
    while time.time() - 起 < 超时:
        t = 取("/api/job?id=" + ident)
        if t["状态"] != "运行中":
            return t
        time.sleep(4)
    return {"状态": "超时"}


print("=" * 74)
print("island：#step 音频 + 自动识别")
print("=" * 74)
print()

print("[1] 导入")
r = 发("/api/import", {"flp": str(工程 / "island.flp"),
                      "audio": str(工程 / "island.mp3")})
t = 等任务(r["id"])
断言("导入完成", t["状态"] == "完成", t.get("错误"))
print()

# 从页面里读诊断字段
html = urllib.request.urlopen(基址 + "/", timeout=240).read().decode("utf-8")
import re  # noqa: E402

m = re.search(r'"drumStats":(\{[^}]*\})', html)
stats = json.loads(m.group(1)) if m else {}
ma = re.search(r'"drumAudio":(\{[^}]*\})', html)
audio = json.loads(ma.group(1)) if ma else {}
mm = re.search(r'"drumMissed":(\[.*?\])\s*,\s*"drumAudio"', html, re.S)
missed = json.loads(mm.group(1)) if mm else []

print("[2] 鼓组统计")
print("    " + json.dumps(stats, ensure_ascii=False))
print("    音频: " + json.dumps(audio, ensure_ascii=False))
print("    未纳入候选: %d 个" % len(missed))
for x in missed[:5]:
    print("       P%-4s %-28s 音符%-4d 音高%-3d 重复%.1f 对齐%.2f" % (
        x.get("id"), (x.get("name") or "")[:28], x.get("notes", 0),
        x.get("pitches", 0), x.get("repeat", 0), x.get("align", 0)))
print()

断言("识别到 pattern", (stats.get("纳入") or 0) > 0, stats)
断言("有按节奏识别的（第三层生效）", (stats.get("按节奏") or 0) > 0, stats)
断言("音频 #step 被纳入", (audio.get("音频命中") or 0) > 0, audio)
断言("未纳入候选已收集（可提示用户）", len(missed) > 0, len(missed))
print()

print("[3] 界面提示是否显示")
断言("页面含 drumNotice 容器", 'id="drumNotice"' in html)
断言("页面含提示函数", "function 显示鼓组提示" in html)
断言("提示文案含 #step", "#step" in html)
print()

print("[4] 渲染（起点 330 秒 —— #step 音频所在区域）")
布局 = {
    "flp": str(工程 / "island.flp"),
    "audio": str(工程 / "island.mp3"),
    "主题": "sumi",
    "画布": {"w": 960, "h": 360},
    "帧率": 24, "时长": 12.0, "起点": 140.0,
    "预设": "ultrafast", "并行度": 4, "无音频": True,
    "输出": str(输出),
    "组件": [{"id": "stepper", "x": 0, "y": 0, "w": 960, "h": 360, "z": 1}],
}
r = 发("/api/render", 布局)
t = 等任务(r["id"])
断言("渲染完成", t["状态"] == "完成", t.get("错误"))
print()

if 输出.is_file():
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    for 秒 in [1, 6, 11]:
        帧 = 输出.with_name("island_step_%02d.png" % 秒)
        subprocess.run([ff, "-ss", str(秒), "-i", str(输出),
                        "-vframes", "1", "-y", str(帧)], capture_output=True)
        print("    抽帧 %2ds: %s" % (秒, 帧.name if 帧.is_file() else "失败"))

print()
print("=" * 74)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 74)
sys.exit(1 if 失败 else 0)
