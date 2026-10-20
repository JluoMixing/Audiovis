"""查页面 JS 是否报错。

用 CDP 抓 Runtime.exceptionThrown。
"""
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 10500

# 直接用构建好的导出页（有真实数据）
页 = 根 / "out" / "render_f8dfc4f879c5" / "page.html"
if not 页.is_file():
    # 找最近的
    候选 = sorted((根 / "out").glob("render_*/page.html"),
                  key=lambda p: p.stat().st_mtime, reverse=True)
    if 候选:
        页 = 候选[0]

print("页面:", 页)
if not 页.is_file():
    print("找不到导出页")
    sys.exit(1)

p = subprocess.Popen([
    EDGE, "--headless=new", "--disable-gpu", "--no-sandbox",
    "--remote-debugging-port=%d" % PORT,
    "--user-data-dir=%s" % (根 / ".testtmp" / "jschk"),
    "--window-size=1200,800",
    "file:///" + str(页).replace("\\", "/"),
], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def 取(path):
    try:
        with urllib.request.urlopen(
                "http://127.0.0.1:%d%s" % (PORT, path), timeout=5) as r:
            return json.loads(r.read())
    except Exception:
        return None


try:
    t = None
    for _ in range(60):
        t = 取("/json/list")
        if t and len(t):
            break
        time.sleep(0.5)

    page = [x for x in t if x.get("type") == "page"][0]
    ws_url = page["webSocketDebuggerUrl"]

    # 用 node 的 ws 太重，改用简单的 websocket 客户端
    try:
        from websocket import create_connection
        ws = create_connection(ws_url, timeout=20)
        ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
        ws.send(json.dumps({"id": 2, "method": "Log.enable"}))
        ws.send(json.dumps({"id": 3, "method": "Page.enable"}))
        time.sleep(3)
        ws.send(json.dumps({"id": 4, "method": "Runtime.evaluate",
                            "params": {"expression":
                                       "typeof window.__READY__"}}))
        错误 = []
        结果 = None
        for _ in range(80):
            try:
                m = json.loads(ws.recv())
            except Exception:
                break
            if m.get("method") == "Runtime.exceptionThrown":
                d = m["params"]["exceptionDetails"]
                desc = ""
                if d.get("exception"):
                    desc = d["exception"].get("description", "")
                错误.append((d.get("text"), d.get("lineNumber"), desc))
            if m.get("method") == "Log.entryAdded":
                e = m["params"]["entry"]
                if e.get("level") == "error":
                    错误.append(("log", e.get("lineNumber"),
                                e.get("text", "")))
            if m.get("id") == 4:
                结果 = m.get("result", {}).get("result", {}).get("value")
                break
        ws.close()

        print()
        print("=== 错误 ===")
        if not 错误:
            print("  无")
        for 类, 行, desc in 错误[:10]:
            print("  [%s] L%s" % (类, 行))
            print("    " + (desc or "")[:400].replace("\n", "\n    "))
        print()
        print("__READY__ =", 结果)
    except ImportError:
        print("没有 websocket 模块")
finally:
    p.terminate()
    try:
        p.wait(timeout=5)
    except Exception:
        p.kill()
