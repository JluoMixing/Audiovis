"""模板设计：**基础排版**。

## 为什么回退

前几版尝试「印刷品」概念（测试片标签 / 日本 obi / 出血大字 / 大字主导），
概念上有想法，但实际效果不好：构图依赖文字撑场面，
而文字一大就把组件挤成配角，组件本身的信息反而看不清。
用户判断「这些组件似乎无法设计出多么有设计感的模板」——
这是诚实的结论：**11 个数据组件的信息形态决定了它们适合规整排版，
不适合当海报元素。**

## 这一版的原则（用户定的）

  1. 基础排版，但位置大小关系要讲究，视觉上整齐、规矩
  2. 保留文字组件，但**只作点缀**，不占画面主导
  3. **所有模板都含主时间轴（playlist），且它占画面大多数**
  4. 其余组件大小地位一致（同一行内等高）
  5. 竖屏不要把上下占满，留呼吸感
  6. 允许「同几何、仅换组件」的变体，不为设计感牺牲整齐度

## 结构

横屏三种基本结构：

  上主下从   playlist 在上（主导），一行等高的次要组件在下
  左主右从   playlist 在左（主导），一列等宽的次要组件在右
  居中      playlist 水平居中，一行在下，文字居中点缀

竖屏（参照用户给的参考图）：

  上方留白 → playlist 通栏 → 一行等高三件 → 下方大幅留白

等高是「地位一致」的实现方式：同一行内高度相同，
宽度随各自比例变化 —— 这是行业惯例，也是视觉上最整齐的做法。

## 尺寸推导

所有尺寸由比例与可用空间推导，不写死坐标。
改一个边距或行高，整块布局自动重算，不会出现越界。
"""

import json
import pathlib

# ============================================================
# 组件比例（宽/高）
# ============================================================
规格 = {
    "playlist":   1180 / 600,
    "stepper":    960 / 360,
    "pianoroll":  900 / 300,
    "pitchwheel": 360 / 360,
    "spectrum":   640 / 200,
    "waveform":   640 / 160,
    "vectorscope": 300 / 300,
    "loudness":   420 / 300,
    "brightness": 360 / 220,
    "transient":  360 / 220,
    "transport":  520 / 120,
}


def 宽高(cid, w):
    return round(w), round(w / 规格[cid])


def 高宽(cid, h):
    return round(h * 规格[cid]), round(h)


def 组件(cid, x, y, w=None, h=None):
    if w is not None:
        w, h = 宽高(cid, w)
    else:
        w, h = 高宽(cid, h)
    return {"id": cid, "x": round(x), "y": round(y), "w": w, "h": h}


# ============================================================
# 空间分配器
# ============================================================

def 横排(件, y, x左, x右, 可用高, 最小间距=36):
    """横向等高排布。等高 = 地位一致。

    先按「等高时各自的最大宽度」试算总宽：
      装得下 → 剩余宽度均分为间距（整行铺满，左右边缘对齐）
      装不下 → 整体等比缩小，使总宽恰好等于可用宽度
    """
    件 = list(件)
    if not 件:
        return []
    总宽 = x右 - x左
    可w = 总宽 - 最小间距 * (len(件) - 1)
    上限 = [可用高 * 规格[c] for c in 件]
    总上限 = sum(上限)

    if 总上限 <= 可w:
        宽 = 上限
        间 = (最小间距 + (可w - 总上限) / (len(件) - 1)
              if len(件) > 1 else 0)
    else:
        缩 = 可w / 总上限
        宽 = [w * 缩 for w in 上限]
        间 = 最小间距

    行 = []
    x = float(x左)
    for i, c in enumerate(件):
        w, h = 宽高(c, 宽[i])
        行.append(组件(c, x, y, w=w))
        x += w + (间 if i < len(件) - 1 else 0)
    return 行


def 竖排(件, x, y顶, y底, 可用宽, 最小间距=36, 权重=None, 对齐="left"):
    """纵向排布。同宽（可用宽），高度按权重分配并受宽度上限约束。

    剩余竖向空间均分为间距 —— 整列铺满，上下边缘对齐。
    """
    件 = list(件)
    if not 件:
        return []
    权重 = list(权重) if 权重 else [1.0] * len(件)
    总高 = y底 - y顶
    可h = max(10.0, 总高 - 最小间距 * (len(件) - 1))
    上限 = [可用宽 / 规格[c] for c in 件]

    高 = [0.0] * len(件)
    活 = list(range(len(件)))
    余 = 可h
    守卫 = 0
    while 活 and 余 > 0.5 and 守卫 < 20:
        守卫 += 1
        总权 = sum(权重[i] for i in 活) or 1
        触顶 = False
        for i in list(活):
            份额 = 余 * 权重[i] / 总权
            if 高[i] + 份额 > 上限[i]:
                高[i] = 上限[i]
                活.remove(i)
                触顶 = True
        if not 触顶:
            for i in 活:
                高[i] += 余 * 权重[i] / 总权
            余 = 0
            break
        余 = 可h - sum(高)
    for i in 活:
        if 高[i] <= 0:
            高[i] = min(上限[i], 可h / max(1, len(件)))

    实际总 = sum(高)
    间 = (max(最小间距, (总高 - 实际总) / max(1, len(件) - 1))
          if len(件) > 1 else 0)

    行 = []
    y = float(y顶)
    for i, c in enumerate(件):
        w, h = 宽高(c, 可用宽 * min(1.0, 高[i] / 上限[i]))
        if 对齐 == "right":
            行.append(组件(c, x + 可用宽 - w, y, w=w))
        elif 对齐 == "center":
            行.append(组件(c, x + (可用宽 - w) / 2, y, w=w))
        else:
            行.append(组件(c, x, y, w=w))
        y += h + (间 if i < len(件) - 1 else 0)
    return 行


# ============================================================
# 文字：**点缀**，不是主角
# ------------------------------------------------------------
# 倍率压在 0.20~0.40 之间（前几版是 2.75）。
# 任何主题下都不会喧宾夺主。
# ============================================================
点缀 = dict(角色="display", 倍率=0.40, 最小字号=26, 最大字号=62,
            大写=True, 颜色="ink", 行距=1.10, 字距=1.2, 对齐="left")
小注 = dict(角色="mono", 倍率=0.20, 最小字号=15, 最大字号=26,
            大写=True, 颜色="inkFaint", 行距=1.45, 字距=1.0, 对齐="left")


def 文字(x, y, 内容, 预设, 锚="tl", **覆盖):
    样式 = dict(预设)
    样式.update(覆盖)
    样式["内容"] = 内容
    if "倍率" in 样式:
        样式["字号倍率"] = 样式.pop("倍率")
    样式 = {k: v for k, v in 样式.items() if v is not None}
    return {"id": "text", "x": round(x), "y": round(y), "锚": 锚, "样式": 样式}


# ============================================================
# 横屏：1920 × 1080
# ============================================================
M = 96          # 页边距
G = 44          # 组件间距


def 横_上主下从(主件, 行件, 行高=182, 主宽=1292):
    W, H = 1920, 1080
    行 = []
    底行顶 = H - M - 行高
    行.extend(竖排([主件], M, M, 底行顶 - G, 主宽, 权重=[1.0]))
    行.extend(横排(行件, 底行顶, M, W - M, 行高, 最小间距=G))
    # 文字放在主件**右侧的空白区**，避免压在主件上。
    # 主件占 x=M..M+主宽，右侧到 W-M 还有空白。
    文字x = M + 主宽 + G
    行.append(文字(文字x, M + 16, "{title}", 点缀, 锚="tl", 对齐="left"))
    行.append(文字(文字x, M + 96, "{tempo} BPM", 小注, 锚="tl", 对齐="left"))
    return 行


def 横_上主下从_通栏(主件, 行件, 行高=152, 主宽=1470):
    W, H = 1920, 1080
    行 = []
    底行顶 = H - M - 行高
    行.extend(竖排([主件], M, M, 底行顶 - G, 主宽, 权重=[1.0]))
    行.extend(横排(行件, 底行顶, M, W - M, 行高, 最小间距=G))
    # 同 横_上主下从：文字放主件右侧空白区
    文字x = M + 主宽 + G
    行.append(文字(文字x, M + 16, "{title}", 小注, 锚="tl", 对齐="left"))
    return 行


def 横_左主右从(主件, 列件, 主宽=1176, 列宽=468):
    W, H = 1920, 1080
    行 = []
    列x = M + 主宽 + G
    行.extend(竖排([主件], M, M, H - M, 主宽, 权重=[1.0]))
    行.extend(竖排(列件, 列x, M, H - M, 列宽, 最小间距=G))
    行.append(文字(M, H - M, "{title}   {tempo} BPM   {bars} BARS",
                  小注, 锚="bl"))
    return 行


def 横_居中(主件, 行件, 行高=142, 主宽=1330):
    W, H = 1920, 1080
    行 = []
    底行顶 = H - M - 行高
    主x = (W - 主宽) / 2
    行.extend(竖排([主件], 主x, M, 底行顶 - G - 60, 主宽, 权重=[1.0]))
    行.append(文字(W / 2, 底行顶 - 46, "{title}   {tempo} BPM", 小注,
                  锚="tc", 对齐="center"))
    行.extend(横排(行件, 底行顶, M, W - M, 行高, 最小间距=G))
    return 行


# ============================================================
# 竖屏：1080 × 1920
# ------------------------------------------------------------
# 参照用户给的参考图：
#   上方留白 → playlist 通栏 → 一行等高三件 → 下方大幅留白
# 上下各留 20%+，不要把空间占满。
# ============================================================
PM = 64
PG = 34


def 竖_基础(主件, 行件, 顶留=0.215, 上隙=64, 行高=150, 文上=True):
    W, H = 1080, 1920
    行 = []
    主宽 = W - PM * 2
    主h = 主宽 / 规格[主件]
    顶 = round(H * 顶留)
    if 文上:
        行.append(文字(PM, 顶 - 62, "{title}", 点缀, 倍率=0.34))
    行.extend(竖排([主件], PM, 顶, 顶 + 主h, 主宽, 权重=[1.0]))
    行.extend(横排(行件, 顶 + 主h + 上隙, PM, W - PM, 行高, 最小间距=PG))
    if not 文上:
        行.append(文字(PM, 顶 + 主h + 上隙 + 行高 + 46,
                      "{title}   {tempo} BPM", 小注))
    return 行


def 竖_两行(主件, 行一, 行二, 顶留=0.185, 上隙=56, 行高=150, 行隙=46):
    W, H = 1080, 1920
    行 = []
    主宽 = W - PM * 2
    主h = 主宽 / 规格[主件]
    顶 = round(H * 顶留)
    行.append(文字(PM, 顶 - 58, "{title}", 点缀, 倍率=0.34))
    行.extend(竖排([主件], PM, 顶, 顶 + 主h, 主宽, 权重=[1.0]))
    y1 = 顶 + 主h + 上隙
    行.extend(横排(行一, y1, PM, W - PM, 行高, 最小间距=PG))
    y2 = y1 + 行高 + 行隙
    行.extend(横排(行二, y2, PM, W - PM, 行高, 最小间距=PG))
    return 行


# ============================================================
# 模板表
# ============================================================
def 生成():
    输出 = [{
        "id": "blank", "name": "空白", "note": "从零开始",
        "land": [], "port": [],
    }]

    def 加(键, 名, 注, 横布局, 竖布局):
        输出.append({"id": 键, "name": 名, "note": 注,
                     "land": 横布局, "port": 竖布局})

    加("base", "基础", "主时间轴在上 · 一行三件",
      横_上主下从("playlist", ["stepper", "spectrum", "waveform"]),
      竖_基础("playlist", ["transient", "spectrum", "brightness"],
              顶留=0.235, 行高=138))

    加("row4", "四栏", "主时间轴通栏 · 一行四件",
      横_上主下从_通栏("playlist",
                    ["stepper", "spectrum", "waveform", "transport"]),
      竖_两行("playlist", ["stepper", "spectrum"],
              ["waveform", "transport"], 顶留=0.200, 行高=148, 行隙=52))

    加("split", "分栏", "主时间轴在左 · 右侧一列",
      横_左主右从("playlist",
                ["stepper", "spectrum", "waveform", "transport"]),
      竖_基础("playlist", ["stepper", "loudness", "transient"],
              顶留=0.225, 行高=156))

    加("center", "居中", "主时间轴居中 · 一行在下",
      横_居中("playlist", ["stepper", "spectrum", "waveform", "transport"]),
      竖_基础("playlist", ["spectrum", "transient"],
              顶留=0.205, 行高=182, 文上=False))

    加("alt", "变体", "同「基础」排版 · 换一组组件",
      横_上主下从("playlist", ["pianoroll", "loudness", "transient"]),
      竖_基础("playlist", ["pitchwheel", "spectrum", "loudness"],
              顶留=0.235, 行高=160))

    return 输出


# ============================================================
# 自检
# ============================================================
def _分行(组件们):
    行集 = []
    for b in sorted(组件们, key=lambda z: z["y"]):
        for r in 行集:
            if abs(r[0]["y"] - b["y"]) < 8:
                r.append(b)
                break
        else:
            行集.append([b])
    return 行集


def 检查(模板):
    问题 = []
    for t in 模板:
        for 向, W, H in (("land", 1920, 1080), ("port", 1080, 1920)):
            布局 = t[向]
            if not 布局:
                continue
            组件们 = [b for b in 布局 if b["id"] != "text"]
            文字们 = [b for b in 布局 if b["id"] == "text"]

            if not any(b["id"] in ("playlist", "pianoroll") for b in 组件们):
                问题.append("%s/%s 缺主时间轴" % (t["name"], 向))
            if not 文字们:
                问题.append("%s/%s 无文字" % (t["name"], 向))

            for b in 组件们:
                if b["x"] < -2 or b["y"] < -2 or \
                   b["x"] + b["w"] > W + 2 or b["y"] + b["h"] > H + 2:
                    问题.append("%s/%s %s 越界 (%d,%d %dx%d)" %
                              (t["name"], 向, b["id"], b["x"], b["y"],
                               b["w"], b["h"]))
                比 = b["w"] / b["h"]
                if abs(比 - 规格[b["id"]]) / 规格[b["id"]] > 0.03:
                    问题.append("%s/%s %s 比例偏差 %.3f vs %.3f" %
                              (t["name"], 向, b["id"], 比, 规格[b["id"]]))

            for i in range(len(组件们)):
                for j in range(i + 1, len(组件们)):
                    a, b = 组件们[i], 组件们[j]
                    if not (a["x"] + a["w"] <= b["x"] or
                            b["x"] + b["w"] <= a["x"] or
                            a["y"] + a["h"] <= b["y"] or
                            b["y"] + b["h"] <= a["y"]):
                        问题.append("%s/%s %s 与 %s 重叠" %
                                  (t["name"], 向, a["id"], b["id"]))

            总 = sum(b["w"] * b["h"] for b in 组件们) or 1
            主 = sum(b["w"] * b["h"] for b in 组件们
                     if b["id"] in ("playlist", "pianoroll"))
            if 主 / 总 < 0.5:
                问题.append("%s/%s 主时间轴仅占组件面积 %.0f%%" %
                          (t["name"], 向, 主 / 总 * 100))

            if 向 == "port":
                顶 = min(b["y"] for b in 组件们)
                底 = max(b["y"] + b["h"] for b in 组件们)
                if 顶 / H < 0.10:
                    问题.append("%s/port 顶部留白仅 %.0f%%" %
                              (t["name"], 顶 / H * 100))
                if (H - 底) / H < 0.12:
                    问题.append("%s/port 底部留白仅 %.0f%%" %
                              (t["name"], (H - 底) / H * 100))

            # 同一行的**次要**组件应等高（地位一致）。
            # 主时间轴豁免 —— 它按设计就是大的那个。
            # 且只比较同一列带内的：分栏模板里 playlist 与右列首件同 y
            # 但不同列，高度本就不同（初版检查漏了这层，误报）。
            次要 = [b for b in 组件们
                    if b["id"] not in ("playlist", "pianoroll")]
            for 行集 in _分行(次要):
                if len(行集) < 2:
                    continue
                高集 = [b["h"] for b in 行集]
                if max(高集) - min(高集) > 4:
                    问题.append("%s/%s 同行不等高（差 %dpx）: %s" %
                              (t["name"], 向, max(高集) - min(高集),
                               ",".join(b["id"] for b in 行集)))
    return 问题


if __name__ == "__main__":
    根 = pathlib.Path(__file__).resolve().parent
    模板 = 生成()
    (根 / "templates.json").write_text(
        json.dumps(模板, ensure_ascii=False, indent=1), encoding="utf-8")

    print("=" * 78)
    print("模板已生成：%d 个" % len(模板))
    print("=" * 78)
    for t in 模板:
        if not t["land"]:
            print("  %-7s %s" % (t["name"], t["note"]))
            continue
        横 = [b["id"] for b in t["land"] if b["id"] != "text"]
        竖 = [b["id"] for b in t["port"] if b["id"] != "text"]
        横文 = sum(1 for b in t["land"] if b["id"] == "text")
        print("  %-7s %-26s 横 %d 件(文%d) · 竖 %d 件" %
              (t["name"], t["note"], len(横), 横文, len(竖)))
    print()

    print("=" * 78)
    print("横屏布局实测")
    print("=" * 78)
    for t in 模板:
        if not t["land"]:
            continue
        组 = [b for b in t["land"] if b["id"] != "text"]
        总 = sum(b["w"] * b["h"] for b in 组)
        主 = sum(b["w"] * b["h"] for b in 组
                 if b["id"] in ("playlist", "pianoroll"))
        右 = max(b["x"] + b["w"] for b in 组)
        下 = max(b["y"] + b["h"] for b in 组)
        print("  %-7s 主时间轴占面积 %2.0f%%   右边缘 %d  下边缘 %d" %
              (t["name"], 主 / 总 * 100, 右, 下))
        for b in 组:
            print("      %-11s %4d,%4d  %4dx%-4d" %
                  (b["id"], b["x"], b["y"], b["w"], b["h"]))
    print()

    print("=" * 78)
    print("竖屏布局实测")
    print("=" * 78)
    for t in 模板:
        if not t["port"]:
            continue
        组 = [b for b in t["port"] if b["id"] != "text"]
        顶 = min(b["y"] for b in 组)
        底 = max(b["y"] + b["h"] for b in 组)
        print("  %-7s 顶留白 %.0f%%  底留白 %.0f%%  内容高 %.0f%%" %
              (t["name"], 顶 / 1920 * 100, (1920 - 底) / 1920 * 100,
               (底 - 顶) / 1920 * 100))
        for b in 组:
            print("      %-11s %4d,%4d  %4dx%-4d" %
                  (b["id"], b["x"], b["y"], b["w"], b["h"]))
    print()

    问题 = 检查(模板)
    if 问题:
        print("【自检问题】")
        for p in 问题:
            print("  ✗ " + p)
    else:
        print("【自检】✓ 无越界 / 无重叠 / 比例正确 / 含主时间轴 / "
              "同行等高 / 竖屏留白充足 / 主时间轴占面积过半")
