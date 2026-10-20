"""布局存取验证：存 → 破坏 → 读 → 比对。

关键是要覆盖**容易被漏存的字段**：
  柔化 / 隐藏文字 / 文字样式 / 每个组件的尺寸与层序。
这些字段都曾经因为「序列化时没列上」而丢失过。
"""
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

端口 = int(sys.argv[1]) if len(sys.argv) > 1 else 8798
基址 = "http://127.0.0.1:%d" % 端口

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
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


print("=" * 74)
print("布局存取验证（端口 %d）" % 端口)
print("=" * 74)
print()

# ---- 构造一个「字段齐全」的布局 ----
布局 = {
    "版本": 1,
    "画布": {"w": 1080, "h": 1920},
    "主题": "construct",
    "帧率": 60,
    "静帧秒": 12.5,
    "工程": "单元测试",
    "组件": [
        {"id": "playlist", "x": 64, "y": 400, "w": 952, "h": 484,
         "z": 1, "hidden": False, "柔化": 0.0},
        {"id": "stepper", "x": 64, "y": 920, "w": 300, "h": 112,
         "z": 2, "hidden": False, "柔化": 0.42, "隐藏文字": True},
        {"id": "spectrum", "x": 380, "y": 920, "w": 380, "h": 119,
         "z": 3, "hidden": True},
        {"id": "text", "x": 64, "y": 330, "w": 300, "h": 40,
         "z": 4, "hidden": False,
         "样式": {"内容": "{title}", "角色": "display", "字号": 52,
                  "大写": True, "颜色": "accent", "字距": 3.5,
                  "行距": 1.1, "对齐": "left", "旋转": 0,
                  "背景": True, "自动换行": False}},
    ],
}

名称 = "单元测试布局_%d" % int(time.time())

print("【1】保存")
st, d = 发("/api/layout/save", {"名称": 名称, "布局": 布局})
断言("返回 200 且 ok", st == 200 and d.get("ok"), d)
路径 = pathlib.Path(d.get("路径", ""))
断言("文件已落盘", 路径.is_file(), str(路径))
print("    %s" % 路径)
print()

print("【2】列列表应能看到它")
with urllib.request.urlopen(基址 + "/api/layout/list", timeout=30) as r:
    列表 = json.loads(r.read().decode("utf-8"))
名集 = [x["名称"] for x in 列表.get("布局", [])]
断言("列表里含刚保存的布局", (名称 + ".json") in 名集,
     "共 %d 项" % len(名集))
print()

print("【3】读回并逐字段比对")
st, _ = 发("/api/layout/load", {"名称": 名称})
断言("读取返回 200", st == 200, st)
with urllib.request.urlopen(基址 + "/api/layout/list", timeout=30) as r:
    pass
req = urllib.request.Request(
    基址 + "/api/layout/load",
    data=json.dumps({"名称": 名称}).encode("utf-8"),
    headers={"Content-Type": "application/json"}, method="POST")
with urllib.request.urlopen(req, timeout=30) as r:
    读回 = json.loads(r.read().decode("utf-8"))

断言("画布一致", 读回.get("画布") == 布局["画布"], 读回.get("画布"))
断言("主题一致", 读回.get("主题") == 布局["主题"], 读回.get("主题"))
断言("帧率一致", 读回.get("帧率") == 布局["帧率"], 读回.get("帧率"))
断言("组件数一致", len(读回.get("组件", [])) == len(布局["组件"]),
     len(读回.get("组件", [])))

原 = {c["id"]: c for c in 布局["组件"]}
新 = {c["id"]: c for c in 读回.get("组件", [])}

for cid in 原:
    断言("%s 各几何字段一致" % cid,
         all(新.get(cid, {}).get(k) == 原[cid][k]
             for k in ("x", "y", "w", "h", "z", "hidden")),
         新.get(cid))

# 易漏字段专项
断言("柔化 0.0 被保留（0 是假值，容易漏）",
     新.get("playlist", {}).get("柔化") == 0.0,
      repr(新.get("playlist", {}).get("柔化")))
断言("柔化 0.42 被保留",
     新.get("stepper", {}).get("柔化") == 0.42,
      repr(新.get("stepper", {}).get("柔化")))
断言("隐藏文字 True 被保留",
     新.get("stepper", {}).get("隐藏文字") is True,
      repr(新.get("stepper", {}).get("隐藏文字")))
断言("组件 hidden 被保留",
     新.get("spectrum", {}).get("hidden") is True,
      repr(新.get("spectrum", {}).get("hidden")))
断言("文字样式被保留",
      isinstance(新.get("text", {}).get("样式"), dict) and
      len(新["text"]["样式"]) >= 8,
      新.get("text", {}).get("样式"))
断言("文字字号被保留",
     新.get("text", {}).get("样式", {}).get("字号") == 52,
      repr(新.get("text", {}).get("样式", {}).get("字号")))
断言("文字颜色被保留",
     新.get("text", {}).get("样式", {}).get("颜色") == "accent",
      repr(新.get("text", {}).get("样式", {}).get("颜色")))
print()

print("【4】错误路径")
st, d = 发("/api/layout/load", {"名称": "不存在的布局.json"})
断言("读不存在的布局返回 404", st == 404, st)
st, d = 发("/api/layout/save", {"名称": "../../逃逸", "布局": {"x": 1}})
断言("路径穿越被拦（只取文件名）", st == 200 and
     ".." not in d.get("名称", ""), d.get("名称"))
if st == 200:
    f = pathlib.Path(d["路径"])
    断言("落点仍在布局目录内",
         "layouts" in str(f) and f.parent.name == "layouts", str(f))
    if f.is_file():
        f.unlink()
print()

print("【5】清理")
st, d = 发("/api/layout/delete", {"名称": 名称})
断言("删除成功", st == 200 and d.get("ok"), d)
断言("文件已不存在", not 路径.is_file(), str(路径))
print()

print("=" * 74)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 74)
sys.exit(1 if 失败 else 0)
