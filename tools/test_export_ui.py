"""验证导出 UI 改动：成功提示与等待提示。

## 测什么

1. 页面上有「3-4 分钟」等待提示，且导出前隐藏
2. 导出中显示，成功后被隐藏（加 done 类）
3. 成功后显示「已保存到 {路径}」，且不再有下载链接
"""
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
端口 = 11500

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


def 请求(路径, 数据=None, 超时=600):
    url = "http://127.0.0.1:%d%s" % (端口, 路径)
    b = json.dumps(数据).encode() if 数据 is not None else None
    req = urllib.request.Request(
        url, data=b, method="POST" if b else "GET",
        headers={"Content-Type": "application/json"} if b else {})
    with urllib.request.urlopen(req, timeout=超时) as r:
        return json.loads(r.read())


print("=" * 70)
print("验证导出 UI 改动")
print("=" * 70)
print()

# ---- 静态检查 ----
print("【1】产物内容")
h = (根 / "preview" / "gui_prototype.html").read_text(encoding="utf-8")
断言("有等待提示元素", 'id="exSlow"' in h)
断言("提示文案含 3-4 分钟", "3-4 分钟" in h)
断言("有 export.saved 文案", "export.saved" in h)
断言("下载链接已移除", ">下载</a>" not in h)
断言("有 done 类的 CSS", "#exProg.done .mSlow" in h)
print()

# ---- 起服务 ----
print("【2】启动服务")
subprocess.run(["powershell", "-NoProfile", "-Command",
                "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" "
                "| Where-Object { $_.CommandLine -match 'run\\.py' } "
                "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force "
                "-ErrorAction SilentlyContinue }"],
               capture_output=True, timeout=60)
time.sleep(2)

p = subprocess.Popen([sys.executable, "run.py", "--port", str(端口),
                      "--no-open"],
                     cwd=str(根),
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
会话 = None
for _ in range(40):
    time.sleep(1)
    try:
        会话 = 请求("/api/session", 超时=5)
        break
    except Exception:
        pass
断言("服务就绪", 会话 is not None)
if not 会话:
    p.terminate()
    sys.exit(1)

if not 会话.get("已导入"):
    print("  导入…")
    工程 = pathlib.Path(r"E:\FL_Project\amapiano")
    r = 请求("/api/import", {"flp": str(工程 / "amapiano.flp"),
                           "audio": str(工程 / "amapiano.mp3")})
    for _ in range(400):
        time.sleep(1.5)
        t = 请求("/api/job?id=" + r["id"])
        if t.get("状态") != "运行中":
            break
    print("  " + str(t.get("状态")))
    会话 = 请求("/api/session")
print()

# ---- 真实渲染，检查产物字段 ----
print("【3】渲染并检查返回的产物字段")
ts = json.loads((根 / "preview" / "templates.json").read_text(encoding="utf-8"))
组件 = [x for x in ts if x.get("name") == "基础"][0]["land"]
out = 根 / "out" / "_ui_test.mp4"
if out.exists():
    out.unlink()

r = 请求("/api/render", {
    "flp": 会话.get("flp"), "audio": 会话.get("audio"),
    "主题": "sumi", "画布": {"w": 1920, "h": 1080},
    "帧率": 6, "时长": 1, "起点": 20,
    "输出": str(out), "预设": "ultrafast", "并行度": 2,
    "组件": 组件,
})
t = {}
for _ in range(400):
    time.sleep(1.5)
    t = 请求("/api/job?id=" + str(r["id"]))
    if t.get("状态") != "运行中":
        break

断言("渲染完成", t.get("状态") == "完成", (t.get("错误") or "")[:200])
产 = t.get("产物") or {}
断言("产物有「视频」字段（成功提示要用）", "视频" in 产, list(产.keys()))
断言("视频路径与请求一致", 产.get("视频") == str(out), 产.get("视频"))
断言("文件确实写到该路径", out.is_file())
print()

# ---- 清理 ----
print("【4】清理")
if out.exists():
    out.unlink()
p.terminate()
try:
    p.wait(timeout=10)
except Exception:
    p.kill()
print("  已停止服务")
print()

print("=" * 70)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 70)
sys.exit(1 if 失败 else 0)
