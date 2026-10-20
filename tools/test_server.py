"""服务端接口验证：导入 → 渲染 → 取回视频。

用真实工程（不是内置示例），走完整的 HTTP 接口，
确认「GUI 点导出能出 mp4」这条链路的服务端部分是通的。
"""
import json
import pathlib
import sys
import time
import urllib.request

端口 = int(sys.argv[1]) if len(sys.argv) > 1 else 8794
基址 = "http://127.0.0.1:%d" % 端口

工程 = pathlib.Path(r"E:\FL_Project\amapiano")
FLP = str(工程 / "amapiano.flp")
音频 = str(工程 / "amapiano.mp3")
输出 = r"D:\FL_VISUAL_TEST\out\server_render.mp4"

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


def 取(路径, 原始=False):
    with urllib.request.urlopen(基址 + 路径, timeout=60) as r:
        body = r.read()
        return r.status, body if 原始 else json.loads(body.decode("utf-8"))


def 取JSON(路径):
    return 取(路径)[1]


def 发(路径, 数据):
    req = urllib.request.Request(
        基址 + 路径, data=json.dumps(数据).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


def 等任务(ident, 超时=600, 静默=False):
    起 = time.time()
    上次 = None
    while time.time() - 起 < 超时:
        t = 取JSON("/api/job?id=" + ident)
        if not 静默:
            行 = "    %5.0fs  %-6s %-12s %4.0f%%  %s" % (
                time.time() - 起, t["状态"], t["阶段"],
                t["进度"] * 100, t.get("消息") or "")
            if 行 != 上次:
                print(行)
                上次 = 行
        if t["状态"] != "运行中":
            return t
        time.sleep(2)
    return {"状态": "超时"}


print("=" * 74)
print("服务端接口验证（端口 %d）" % 端口)
print("=" * 74)
print()

print("【1】/api/session 初始状态")
st, d = 取("/api/session")
断言("返回 200", st == 200)
断言("有工程信息", "name" in d, d)
print()

print("【2】错误参数应被拒绝（不能把坏路径塞进去）")
st, d = 发("/api/import", {"flp": "不存在.flp", "audio": 音频})
断言("坏的 FLP 路径返回 400", st == 400, st)
st, d = 发("/api/import", {"flp": FLP, "audio": "不存在.mp3"})
断言("坏的音频路径返回 400", st == 400, st)
print()

print("【3】真实导入 %s" % 工程.name)
st, d = 发("/api/import", {"flp": FLP, "audio": 音频})
断言("已受理", st == 200 and "id" in d, d)
导入任务 = 等任务(d["id"])
断言("导入完成", 导入任务["状态"] == "完成", 导入任务.get("错误"))
断言("返回了错误信息字段（管道健全）", "错误" in 导入任务)
print()

st, 会话 = 取("/api/session")
断言("会话已标记为已导入", 会话.get("已导入") is True, 会话)
断言("工程名已更新", 会话.get("name") and 会话["name"] != "nujabes", 会话)
print("    工程：%s  时长 %.1fs" % (会话["name"], 会话.get("duration", 0)))
print()

print("【4】渲染（复用导入时算好的分析结果）")
布局 = {
    "flp": FLP, "audio": 音频, "主题": "sumi",
    "画布": {"w": 1920, "h": 1080}, "帧率": 30,
    "时长": 1.5, "起点": 6.0, "预设": "ultrafast", "并行度": 2,
    "无音频": True, "输出": 输出,
    "组件": [
        {"id": "playlist", "x": 96, "y": 96, "w": 1292, "h": 657},
        {"id": "stepper", "x": 96, "y": 802, "w": 443, "h": 166},
        {"id": "spectrum", "x": 583, "y": 802, "w": 532, "h": 166},
        {"id": "waveform", "x": 1159, "y": 802, "w": 665, "h": 166},
        {"id": "text", "x": 1698, "y": 112, "w": 126, "h": 32,
         "样式": {"内容": "{title}", "字号": 31, "角色": "display",
                  "大写": True}},
    ],
}
st, d = 发("/api/render", 布局)
断言("已受理", st == 200 and "id" in d, d)
渲染任务 = 等任务(d["id"])
断言("渲染完成", 渲染任务["状态"] == "完成", 渲染任务.get("错误"))
# 注意：不能只判断路径字符串非空 —— 写错键名会得到字符串 "None"，
#     它是真值，断言照样通过（实测被这个骗过一次）。
#     必须落到「文件真的存在」。
产物 = 渲染任务.get("产物") or {}
视频路径 = 产物.get("视频")
断言("产出了视频路径且文件存在",
     bool(视频路径) and 视频路径 != "None" and pathlib.Path(视频路径).is_file(),
     产物)
print()

视频 = pathlib.Path(输出)
断言("视频文件存在", 视频.is_file(), 输出)
if 视频.is_file():
    大小 = 视频.stat().st_size
    print("    %s  %.2f MB" % (视频.name, 大小 / 1e6))
    断言("视频非空（> 50 KB）", 大小 > 50_000, "%d 字节" % 大小)
print()

print("【5】/api/video 取回产物")
st, body = 取("/api/video?id=" + 渲染任务["id"], 原始=True)
断言("返回 200", st == 200)
断言("是 mp4（含 ftyp box）", body[4:8] == b"ftyp", body[4:12])
断言("长度与文件一致", len(body) == 视频.stat().st_size,
     "%d vs %d" % (len(body), 视频.stat().st_size))
print()

print("=" * 74)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 74)
sys.exit(1 if 失败 else 0)
