"""G0-1 验证：合并后两条路径产出必须逐字段一致。

这是合并的核心风险：合并时若丢了一侧的修复，
数值会静默变化（不报错），只有逐字段比对才能发现。
"""
import json
import pathlib
import sys

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))
sys.path.insert(0, str(根 / "preview"))

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


print("=" * 74)
print("G0-1 验证：分析实现已合并")
print("=" * 74)
print()

# ---- 1) 只有一份实现 ----
print("【1】函数定义只存在于 analyze.py")
import ast  # noqa: E402

def 取函数名(路径):
    tree = ast.parse(pathlib.Path(路径).read_text(encoding="utf-8"))
    return {n.name for n in tree.body
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}

A = 取函数名(根 / "src" / "audio" / "analyze.py")
B = 取函数名(根 / "preview" / "audio_analysis.py")

算法函数 = {n for n in A if n.startswith("_") or n in
            ("构建", "读取快照", "工程范围")}
# 构建() 允许存在 —— 它是薄封装（只转发参数），不实现算法。
# 真正的判据是：内部算法函数（_ 开头）与核心工具不得重复定义。
重复 = (算法函数 - {"构建"}) & B
断言("audio_analysis.py 不再重复实现算法", not 重复,
     "仍重复: " + ", ".join(sorted(重复)))
# 允许「不实现算法的辅助函数」（如 _找默认音频 只决定路径）。
# 真正要守的是：不得重复实现分析算法（上一条断言已覆盖），
# 且核心入口 构建() 仍在。
允许辅助 = {"构建", "_找默认音频"}
断言("audio_analysis.py 只剩薄封装（含路径辅助）",
     B <= 允许辅助,
     "实际: " + ", ".join(sorted(B)) + " 超出预期: " +
     ", ".join(sorted(B - 允许辅助)))
断言("保留 构建 入口", "构建" in B, sorted(B))
print()

# ---- 2) 两条路径产出逐字段一致 ----
print("【2】缓存路径 vs 现场分析：逐字段一致")
import preview.audio_analysis as 缓存侧  # noqa: E402
from src.audio.analyze import 构建 as 现场构建  # noqa: E402

快照 = 根 / "data" / "projects" / "nujabes" / "project_snapshot.json"
音频 = pathlib.Path(r"E:\FL_Project\nujabes\nujabes.mp3")

if not 音频.is_file():
    断言("测试音频存在", False, str(音频))
    sys.exit(1)

数据缓存 = 缓存侧.构建(str(音频), str(快照), 用缓存=True)
数据现场 = 现场构建(音频, 快照, 用缓存=False)

键A = set(数据缓存)
键B = set(数据现场)
断言("键集合一致", 键A == 键B,
     "缓存独有 %s / 现场独有 %s" % (键A - 键B, 键B - 键A))

# 逐键比对（浮点用容差）
def 深比(a, b, 路径="", 容差=1e-6):
    if type(a) != type(b):
        # int/float 视为同类
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            pass
        else:
            return "%s 类型不同 %s vs %s" % (路径, type(a), type(b))
    if isinstance(a, dict):
        # 允许「整数键 vs 字符串键」的差异：
        # 缓存走 JSON 往返，dict 的 int 键会变成 str 键；
        # 前端 JS 里 Object.keys 一律是字符串，两者等价。
        # 若不放开这条，缓存路径与现场分析永远"不一致"。
        ka = {str(k) for k in a}
        kb = {str(k) for k in b}
        if ka != kb:
            return "%s 键不同（%s vs %s）" % (
                路径, sorted(ka - kb)[:3], sorted(kb - ka)[:3])
        映射B = {str(k): v for k, v in b.items()}
        for k in a:
            r = 深比(a[k], 映射B[str(k)], 路径 + "." + str(k), 容差)
            if r:
                return r
        return None
    if isinstance(a, list):
        if len(a) != len(b):
            return "%s 长度 %d vs %d" % (路径, len(a), len(b))
        for i, (x, y) in enumerate(zip(a, b)):
            r = 深比(x, y, "%s[%d]" % (路径, i), 容差)
            if r:
                return r
        return None
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if abs(a - b) > 容差:
            return "%s 数值 %r vs %r" % (路径, a, b)
        return None
    if a != b:
        return "%s 值不同 %r vs %r" % (路径, str(a)[:40], str(b)[:40])
    return None

不一致 = []
for k in sorted(键A & 键B):
    r = 深比(数据缓存[k], 数据现场[k], k)
    if r:
        不一致.append(r)

断言("全部字段一致", not 不一致,
     不一致[:3] if 不一致 else "")
if 不一致:
    for x in 不一致[:6]:
        print("      " + x)
print()

# ---- 3) 关键指标抽查 ----
print("【3】关键指标抽查")
断言("时长一致", abs(数据缓存["audio"]["duration"]
                   - 数据现场["audio"]["duration"]) < 1e-6)
断言("频谱帧数一致",
     数据缓存["spectrogram"]["frames"] == 数据现场["spectrogram"]["frames"])
断言("鼓组 pattern 数一致",
     len(数据缓存["drumGroups"]) == len(数据现场["drumGroups"]))
断言("含 #step 音频统计",
     (数据缓存.get("drumAudio") or {}).get("音频命中", 0)
     == (数据现场.get("drumAudio") or {}).get("音频命中", 0))
print()

# ---- 4) 缓存真的生效 ----
print("【4】缓存机制")
import time  # noqa: E402
t0 = time.time()
_ = 缓存侧.构建(str(音频), str(快照), 用缓存=True)
耗时1 = time.time() - t0
t0 = time.time()
_ = 现场构建(音频, 快照, 用缓存=False)
耗时2 = time.time() - t0
print("    缓存命中: %.2fs    现场分析: %.2fs" % (耗时1, 耗时2))
断言("缓存命中明显更快", 耗时1 < 耗时2 * 0.5,
     "%.2fs vs %.2fs" % (耗时1, 耗时2))
print()

print("=" * 74)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 74)
sys.exit(1 if 失败 else 0)
