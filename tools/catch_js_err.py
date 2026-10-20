"""抓页面 JS 错误。"""
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 10400

p = subprocess.Popen([
    EDGE, "--headless=new", "--disable-gpu", "--no-sandbox",
    "--remote-debugging-port=%d" % PORT,
    "--user-data-dir=%s" % (根 / ".testtmp" / "errchk"),
    "--window-size=1400,900",
    "file:///D:/FL_VISUAL_TEST/out/y2k_variants.html",
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
    print("页面:", page.get("url"))
    print("ws:", page.get("webSocketDebuggerUrl")[:60])

    # 用 websocket 连
    try:
        from websocket import create_connection
    except ImportError:
        print("没有 websocket 模块，改用 node")
        sys.exit(0)

    ws = create_connection(page["webSocketDebuggerUrl"], timeout=15)
    ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
    ws.send(json.dumps({"id": 2, "method": "Log.enable"}))
    time.sleep(2)
    ws.send(json.dumps({"id": 3, "method": "Runtime.evaluate",
                        "params": {"expression":
                                   "JSON.stringify(window.__ERR__||null)"}}))
    for _ in range(30):
        try:
            m = json.loads(ws.recv())
        except Exception:
            break
        if m.get("method") == "Runtime.exceptionThrown":
            d = m["params"]["exceptionDetails"]
            print("异常:", d.get("text"), d.get("url"), d.get("lineNumber"))
            if d.get("exception"):
                print("   ", d["exception"].get("description", "")[:400])
        if m.get("method") == "Log.entryAdded":
            e = m["params"]["entry"]
            if e.get("level") == "error":
                print("日志错误:", e.get("text", "")[:300])
        if m.get("id") == 3:
            print("结果:", m.get("result", {}).get("result", {}).get("value"))
            break
    ws.close()
finally:
    p.terminate()
    try:
        p.wait(timeout=5)
    except Exception:
        p.kill()
