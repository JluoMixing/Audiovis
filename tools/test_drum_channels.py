"""守住：导出路径的鼓组分类必须与预览一致。

## 踩过的坑

analyze.py 曾把通道表读自仓库里一个**写死的旧文件**
（research/results/parser_snapshot.json），那是某个特定工程的通道编号。
预览缓存恰好用它生成所以正常；导出时不管你导入哪个工程都读这一份，
真实工程的通道 iid 对不上 → 拿不到名字 → 全部判为 other
→ 步进器只剩「其它」一行（用户实测报的就是这个）。

本测试对比两条路径的分类结果，不一致就失败。
"""
import json
import pathlib
import sys

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

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


def 统计各族(组):
    """按行里的 family 字段统计。

    新方案下数据层不再输出 group / name（用户要求不显示行名），
    改为 family（关键词识别出的族别名，可能为 None）+ key（归并键）。
    """
    out = {}
    for g in 组:
        for r in g.get("rows", []):
            k = r.get("family") or "(无名)"
            out[k] = out.get(k, 0) + 1
    return out


print("=" * 74)
print("鼓组分类：快照自带通道表 & 两条路径一致")
print("=" * 74)
print()

# ---- 1) 快照必须带通道表 ----
print("【1】快照包含通道表")
快照路径 = 根 / "data" / "projects" / "nujabes" / "project_snapshot.json"
快照 = json.loads(快照路径.read_text(encoding="utf-8"))
ch = 快照.get("channels") or []
断言("快照有 channels 字段", "channels" in 快照, list(快照.keys()))
断言("通道数 > 0", len(ch) > 0, len(ch))
有名 = [c for c in ch if c.get("name")]
断言("多数通道有名称", len(有名) >= len(ch) * 0.5,
     "%d / %d" % (len(有名), len(ch)))
# 抽查几个关键鼓通道
按名 = {c.get("iid"): (c.get("name") or "") for c in ch}
断言("ch2 是 kick 类", "kick" in 按名.get(2, "").lower(), 按名.get(2))
断言("ch4 是 snare 类", "snare" in 按名.get(4, "").lower(), 按名.get(4))
断言("ch6 是 hat 类", "hat" in 按名.get(6, "").lower(), 按名.get(6))
print()

# ---- 2) analyze 用的是快照里的通道表 ----
print("【2】analyze 从快照读通道表（不是旧文件）")
from src.audio import analyze as 分析模块  # noqa: E402

数据 = 分析模块.构建(r"E:\FL_Project\nujabes\nujabes.mp3", 快照路径)
来源 = 数据.get("_channelSource")
断言("通道表来源是「快照」", 来源 == "快照", 来源)
组 = 数据.get("drumGroups") or []
各族 = 统计各族(组)
print("   各族行数: " + str(各族))
断言("识别出 kick", 各族.get("kick", 0) > 0, 各族)
断言("识别出 snare", 各族.get("snare", 0) > 0, 各族)
断言("识别出 hihat", 各族.get("hihat", 0) > 0, 各族)
# 「无名」不等于「识别失败」：
#   按音高/按节奏分行的行本来就没有族别名（用户要求不显示行名），
#   它们用 m72 / a:FD_kick 这类 key 归并，family 为 None 是**设计如此**。
# 真正该断言的是：不同行被正确分开（不是一个 blob），
# 且至少识别出 2 种以上族别。
不同key = set()
for g in 组:
    for r in g.get("rows", []):
        不同key.add(r.get("key"))
断言("行按 key 正确分开（不是一团）",
     len(不同key) >= 3, "只分出 %d 个 key" % len(不同key))
有名族 = [k for k in 各族 if k != "(无名)"]
断言("识别出 2 种以上族别", len(有名族) >= 2, 有名族)
print()

# ---- 3) 与预览缓存一致 ----
print("【3】与预览路径（.cache/analysis.json）一致")
缓存 = 根 / "preview" / ".cache" / "analysis.json"
if 缓存.is_file():
    d = json.loads(缓存.read_text(encoding="utf-8"))["data"]
    预览各族 = 统计各族(d.get("drumGroups") or [])
    print("   预览: " + str(预览各族))
    print("   导出: " + str(各族))
    for k in ("kick", "snare", "hihat"):
        断言("%s 数量一致" % k, 预览各族.get(k, 0) == 各族.get(k, 0),
             "预览 %d vs 导出 %d" % (预览各族.get(k, 0), 各族.get(k, 0)))
else:
    print("   （无预览缓存，跳过对比）")
print()

print("=" * 74)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 74)
sys.exit(1 if 失败 else 0)
