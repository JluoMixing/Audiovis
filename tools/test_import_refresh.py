"""验证：导入真实工程后，鼓组提示是否按新工程数据刷新。"""
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.request

端口 = int(sys.argv[1]) if len(sys.argv) > 1 else 11000
工程 = pathlib.Path(r"E:\FL_Project\amapiano")

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


def 取(路径, 数据=None, 超时=300):
    url = "http://127.0.0.1:%d%s" % (端口, 路径)
    body = json.dumps(数据).encode() if 数据 is not None else None
    req = urllib.request.Request(
        url, data=body, method="POST" if body else "GET",
        headers={"Content-Type": "application/json"} if body else {})
    with urllib.request.urlopen(req, timeout=超时) as r:
        return r.read()


print("=" * 70)
print("导入后鼓组提示是否刷新")
print("=" * 70)
print()

# ---- 先重置成空状态 ----
# 别的测试可能已导入过工程，「导入前」就不是空的
try:
    取("/api/session/reset", {})
    print("已重置会话")
except Exception as e:
    print("重置失败（继续）:", e)
print()

# ---- 导入前 ----
h0 = 取("/").decode("utf-8", "replace")
d0 = json.loads(re.search(r"const DATA = (\{.*?\});\n", h0, re.S).group(1))
print("【1】导入前")
print("     projectName: %r" % d0.get("projectName"))
print("     drumStats:   %r" % (d0.get("drumStats"),))
print("     timeline:    %d 条" % len(d0.get("timeline") or []))
# 空载荷的 drumStats 是「全零字典」，不是空 dict
_ds = d0.get("drumStats") or {}
断言("导入前无鼓组数据（全为 0）",
     all(v == 0 for v in _ds.values()), _ds)
# timeline 是 dict，看 tracks 列表
_tl = d0.get("timeline") or {}
断言("导入前无时间轴", not (_tl.get("tracks") or []),
     len(_tl.get("tracks") or []))
print()

# ---- 导入 ----
print("【2】导入 amapiano")
r = json.loads(取("/api/import", {
    "flp": str(工程 / "amapiano.flp"),
    "audio": str(工程 / "amapiano.mp3"),
}))
任务 = r.get("id")
断言("导入已受理", bool(任务), r)
for _ in range(300):
    time.sleep(1.5)
    t = json.loads(取("/api/job?id=" + str(任务)))
    if t.get("状态") != "运行中":
        break
断言("导入完成", t.get("状态") == "完成", (t.get("错误") or "")[:200])
print()

# ---- 导入后 ----
print("【3】导入后")
h1 = 取("/").decode("utf-8", "replace")
d1 = json.loads(re.search(r"const DATA = (\{.*?\});\n", h1, re.S).group(1))
print("     projectName: %r" % d1.get("projectName"))
print("     drumStats:   %r" % (d1.get("drumStats"),))
print("     timeline:    %d 条" % len(d1.get("timeline") or []))
断言("工程名已变", d1.get("projectName") != d0.get("projectName"),
    "%r → %r" % (d0.get("projectName"), d1.get("projectName")))
断言("有鼓组数据", bool(d1.get("drumStats")), d1.get("drumStats"))
断言("有时间轴", bool(d1.get("timeline")), len(d1.get("timeline") or []))
print()

# ---- 页面里的提示文本 ----
m = re.search(r"window\.__PROJECT__ = (\{.*?\});", h1)
p1 = json.loads(m.group(1))
断言("__PROJECT__.已导入 为 true", p1.get("已导入") is True, p1)
断言("__PROJECT__ 有 flp 路径", bool(p1.get("flp")), p1.get("flp"))
print()

print("=" * 70)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 70)
sys.exit(1 if 失败 else 0)
