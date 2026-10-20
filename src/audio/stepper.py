"""新的鼓组步进器提取（替换 _鼓组步进器）。

## 与旧版的区别

旧版：
  · 按**通道**分组，用**通道名关键词**分类成 kick/snare/hihat
  · 判定「是不是鼓组」靠「音高种类 ≤ 2」或「所有通道都是打击乐」
  → 软音源（通道名是 EZdrummer）全部判 other；音频采样完全看不到

新版（按用户敲定的方案）：
  · 纳入：通道名关键词 / MIDI 音高在 GM 范围 / `#step` 后缀
  · 分行：每个**音高**（软音源）或每个**通道**（无名）是一行
  · 行序：按「频率 + 节奏位置」打分，分数小者在前（底鼓→军鼓→踩镲）
  · **行名一律不输出**（避免猜错误导）
  · 同一时刻 ±1/16 内的同组音符合并
  · 音频 clip 默认不纳入，名字带 `#step` 才纳入

输出去掉了 name / group 字段，改为 排序后的行数组 + 每行的分数与特征，
方便前端只按顺序画颜色条。
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from src.audio import drums as D  # noqa: E402


def _通道名(信息):
    if not 信息:
        return ""
    名 = 信息.get("名称") or 信息.get("内部名称") or ""
    if not 名 and 信息.get("sample_path"):
        名 = str(信息["sample_path"]).replace("/", "\\").split("\\")[-1]
    return 名 or ""


def 提取_鼓组(快照, 通道表, 每小节步数=16):
    """返回 {
         "rows": [ 行... ],        # 已按行序排好
         "usage": { patternId: [区间...] },
         "stats": {...}
       }

    每行：
       { key, midi, freq, 位置特征..., steps: {步: 力度}, 分数 }
       **不含 name / group** —— 用户要求不显示行名，避免猜错。
    """
    PPQ = 快照["metadata"]["ppq"]
    格长 = PPQ / 4

    结果 = []
    统计 = {"总pattern数": 0, "纳入": 0, "按关键词": 0, "按音高": 0,
            "按节奏": 0, "按后缀": 0, "跳过高音种类": 0}
    # 疑似鼓组但没纳入的 —— 供界面提示用户加 #step
    未纳入候选 = []

    for p in 快照["patterns"]:
        统计["总pattern数"] += 1
        pname = p.get("name")
        if isinstance(pname, dict):
            pname = pname.get("value")
        pname = D.去后缀(pname) if pname else ""

        音符 = []
        for n in p["notes"]:
            起 = (n.get("start") or {}).get("value")
            if 起 is None:
                continue
            cid = (n.get("channel_id") or {}).get("value")
            pv = n.get("pitch")
            midi = D.音名到midi(pv.get("value") if isinstance(pv, dict) else pv)
            vel = (n.get("velocity") or {}).get("value")
            音符.append({"t": 起, "ch": cid, "midi": midi, "vel": vel})
        if not 音符:
            continue

        # ---- 纳入判定 ----
        # #step 后缀强制纳入（优先于一切自动判定）
        强制 = D.有后缀(pname, "#step")
        按音高 = 0
        按关键词 = 0
        依据 = None

        for x in 音符:
            信息 = 通道表.get(x["ch"]) or {}
            名 = _通道名(信息)
            if D.有后缀(名, "#step"):
                强制 = True
        if 强制:
            依据 = "后缀"
        else:
            for x in 音符:
                信息 = 通道表.get(x["ch"]) or {}
                名 = _通道名(信息)
                类, _ = _鼓组分类_本地(名)
                if 类 != "other":
                    按关键词 += 1
                if D.是打击音高(x["midi"]):
                    按音高 += 1
            有音高 = [x for x in 音符 if x["midi"] is not None]
            音高种类 = len(set(x["midi"] for x in 有音高))

            # 第三层：重复度 + 16 分对齐率
            #
            # ## 为什么需要这一层
            # GM 音高范围只对「严格按 GM 映射的软音源」有效。
            # 实测 8 个工程里 92 个候选 pattern，只有 3 个能靠 GM 音高判定
            # —— 因为 FL 的鼓通道默认音高是 C5(72)，与 GM 鼓范围(35..59)
            # 完全不重叠。
            #
            # 鼓组 pattern 的真正共性是：
            #   · 同一音高重复很多次（hihat 能重复几十次）
            #   · 节奏落在 16 分格上
            # 而旋律 pattern 一个音高通常只出现 1~3 次。
            #
            # 实测（8 个工程、人工标注对比）：
            #   命中 39/48 鼓 pattern（81%），误判 4/31 旋律（13%）
            # 仍不完美（swing 重的鼓对齐率会降到 73%），
            # 故必须配合「未纳入提示」让用户用 #step 兜底。
            _种类 = len(set(x["midi"] for x in 有音高)) if 有音高 else 0
            _重复度 = (len(有音高) / _种类) if _种类 else 0
            _对齐 = _十六分对齐率(p, PPQ)
            _似鼓 = (_重复度 >= 4.0 and _对齐 >= 0.85)

            if 按关键词 > 0 and 按关键词 >= len(音符) * 0.5:
                依据 = "关键词"
            elif _似鼓:
                # 重复度高 + 对齐 → 鼓组（含自定义映射的软音源）
                依据 = "节奏"
                用音高分行_覆盖 = 有音高 and _种类 <= 12
            elif 有音高 and 音高种类 <= 8 and 按音高 >= len(有音高) * 0.85:
                # 绝大多数音高落在 GM 鼓范围、且音高种类不多 → 软音源鼓组。
                #
                # 阈值用 85% 而不是 100%：实测 island 的「amen break drums」
                # 有 112/114 音符在 GM 范围（98%），但有 2 个装饰音符
                # 落在范围外（C5=72、C#4=61 可能是特效采样）。
                # 要求 100% 会把整个鼓组 pattern 判掉 —— 一条无关紧要的
                # 边角音符不该否决整体判定。
                依据 = "音高"

        if not 依据:
            if len(set(x["midi"] for x in 音符 if x["midi"] is not None)) > 8:
                统计["跳过高音种类"] += 1
            # 记录「像鼓但没纳入」的：重复度或对齐率接近阈值
            _有 = [x["midi"] for x in 音符 if x["midi"] is not None]
            _种 = len(set(_有))
            _重 = (len(_有) / _种) if _种 else 0
            _对 = _十六分对齐率(p, PPQ)
            if (_重 >= 2.5 and _对 >= 0.7) or (_重 >= 4.0):
                未纳入候选.append({
                    "id": p.get("id"),
                    "name": pname or "",
                    "notes": len(音符),
                    "pitches": _种,
                    "repeat": round(_重, 2),
                    "align": round(_对, 3),
                })
            continue

        统计["纳入"] += 1
        统计["按" + 依据] += 1

        # ---- 分行：软音源按音高，其它按通道 ----
        # 节奏层：音高种类不多时也按音高分行（软音源的每个鼓件是不同音高）；
        # 种类太多则说明可能是旋律，按通道分行更安全。
        用音高分行 = (依据 == "音高") or (
            依据 == "节奏" and len(set(x["midi"] for x in 音符
                                      if x["midi"] is not None)) <= 12)
        分组 = {}
        for x in 音符:
            k = x["midi"] if 用音高分行 else x["ch"]
            分组.setdefault(k, []).append(x)

        行列表 = []
        for k, 列表 in 分组.items():
            midi = k if 用音高分行 else None
            if not 用音高分行:
                # 无名通道：用该通道音符音高的众数当作频率参考
                有音高 = [y["midi"] for y in 列表 if y["midi"] is not None]
                midi = max(set(有音高), key=有音高.count) if 有音高 else None
            起点 = min(y["t"] for y in 列表)
            # 步位置用**相对起点**的绝对步序；
            # 节奏特征由 D.节奏特征() 内部取模成 0..15。
            # （若在这里取模，后面算 steps 时会丢失跨小节信息）
            步位置 = [int(round((y["t"] - 起点) / 格长)) for y in 列表]
            特征 = D.节奏特征(步位置, 每小节步数)
            分数 = D.行序评分(midi, 特征, 每小节步数)

            步 = {}
            for y in 列表:
                s = int(round((y["t"] - 起点) / 格长))
                v = y["vel"] if y["vel"] is not None else 100
                if s not in 步 or v > 步[s]:
                    步[s] = v

            # 归并用的 key：
            #   · 关键词路径：用识别出的族别名（kick/snare/hihat…）
            #     —— 名字可靠时就不该再靠分数猜
            #   · 音高路径：用音高值
            #   · 其它：用通道 id
            族名 = None
            if 用音高分行:
                归并键 = "m" + str(k)
            else:
                信息 = 通道表.get(k) or {}
                类, _ = _鼓组分类_本地(_通道名(信息))
                if 类 and 类 != "other":
                    族名 = 类
                    归并键 = "g:" + 类
                else:
                    归并键 = "c" + str(k)

            行列表.append({
                "key": 归并键,
                "family": 族名,
                "_k": str(k),
                "midi": midi,
                "freq": round(D.midi到频率(midi), 1) if midi is not None else None,
                "score": round(分数, 4),
                "features": 特征,
                "steps": 步,
                # 供合并使用
                "_notes": 列表,
            })

        # 丢掉杂行：占比极小的音高不是「鼓件」，是装饰音/边角
        # ------------------------------------------------------------
        # 实测 island 的 amen break（EZdrummer）按音高拆出 8 个音高，
        # 其中 G#3/D3/A#2 分别占 52%/28%/16%（踩镲/军鼓/底鼓），
        # 其余 5 个音高合计不到 4%，各 1~3 个音符 —— 却各占一行，
        # 让步进器在 5~6 行之间，前 60 秒都是这个状态。
        #
        # 判据：行内音符数 >= max(3, 该 pattern 总音符数的 8%)。
        # 用占比而非绝对值，because 稀疏 pattern（只有 8 个音符）
        # 不能按同一门槛删，否则会被删空。
        if len(音符) >= 20:
            门槛 = max(3, int(len(音符) * 0.08))
            行列表 = [r for r in 行列表
                    if sum(1 for _ in r["steps"].values()) >= 门槛]
            if not 行列表:
                continue

        # 行序：分数升序（底鼓 → 军鼓 → 踩镲），同分按 midi 升序
        行列表.sort(key=lambda r: (r["score"],
                                   r["midi"] if r["midi"] is not None else 999))

        # ---- 合并重合：同一行内相邻 1 格内只留一个 ----
        合并后 = []
        for r in 行列表:
            # 相距 ≤1 格的同一行音符视为同一击（重音/连击），只留力度大的
            保留 = []
            上次 = None
            for s in sorted(r["steps"]):
                if 上次 is not None and s - 上次 <= 1:
                    # 与前一次太近 → 合并，取力度大的
                    if r["steps"][s] > r["steps"][上次]:
                        保留[-1] = s
                        上次 = s
                    continue
                保留.append(s)
                上次 = s
            新steps = {s: r["steps"][s] for s in 保留}
            r = {k: v for k, v in r.items() if k != "_notes"}
            r["steps"] = 新steps
            r["mergedCount"] = len(保留)
            合并后.append(r)

        origin = min(x["t"] for x in 音符)
        结果.append({
            "id": p.get("id"),
            "origin": origin,
            "basis": 依据,
            "rows": 合并后,
        })

    统计["未纳入候选数"] = len(未纳入候选)
    return {"groups": 结果, "stats": 统计, "missed": 未纳入候选}


def 提取_音频鼓(快照, 后缀="#step"):
    """从 Playlist 里找出名字带 #step 的**音频 clip**，整理成步进器行。

    ## 为什么需要

    用户的一些鼓是**音频采样**直接摆在 Playlist 上（不是 pattern），
    这类东西没有音符、没有音高，用 pattern 那套完全看不到。
    但它们的 start/end 是已知的 ——
    **不需要识别它是什么鼓，只需知道它什么时候响起。**

    只有名字带后缀的才纳入（默认不纳入，避免大量误识别）。

    返回（结构与 提取_鼓组 一致）：
      { groups: [{ id, origin, basis:'音频', rows:[...] }], stats, missed }
    """
    PPQ = 快照["metadata"]["ppq"]
    格长 = PPQ / 4

    命中 = []
    for 轨道 in 快照.get("arrangement", {}).get("tracks", []):
        for clip in 轨道.get("clips") or []:
            if clip.get("type") != "audio":
                continue
            名 = (clip.get("source") or {}).get("name") or ""
            if 后缀 not in str(名):
                continue
            起 = (clip.get("start") or {}).get("value")
            止 = (clip.get("end") or {}).get("value")
            if 起 is None or 止 is None:
                continue
            命中.append({
                "name": str(名).replace(后缀, "").strip(),
                "start": 起,
                "end": 止,
                "track": 轨道.get("index"),
            })

    if not 命中:
        return {"groups": [], "stats": {"音频命中": 0}, "missed": []}

    # 每个音频源（按名字去后缀）成为一行
    分行 = {}
    for c in 命中:
        分行.setdefault(c["name"], []).append(c)

    rows = []
    origin = min(c["start"] for c in 命中)
    for 名, 列表 in 分行.items():
        起点 = min(c["start"] for c in 列表)
        步 = {}
        for c in 列表:
            k = int(round((c["start"] - 起点) / 格长))
            步[k] = 100
        # 同时给出**绝对 tick**，供前端直接绘制。
        # 不能用「clip.start + origin + 步序×格长」那一套：
        # 同一音频行里有多个 clip 分布在全曲，共用一个 origin 会算错
        # （实测偏了整整一个 origin，所有音符被推到工程末尾之外）。
        绝对 = sorted(c["start"] for c in 列表)
        位置 = list(步.keys())
        特征 = D.节奏特征(位置, 每小节步数=16)
        # 音频没有音高，用名字关键词给一个「虚拟音高」参与排序；
        # 认不出则给 None，由分数兜到最后。
        类, _ = _鼓组分类_本地(名)
        虚拟 = {"kick": 36, "snare": 38, "hihat": 42, "openhat": 46,
                "crash": 49, "tom": 50}.get(类)
        分数 = D.行序评分(虚拟, 特征)
        # 归并键：认得出族别时**与 pattern 行共用同一个键**
        # ------------------------------------------------------------
        # 用户明确说过：「不用太局限于『这一行现在是 pattern 的底鼓，
        # 而接下来变成了 audio clip 的底鼓，所以要刷新一下』，没必要。」
        #
        # 所以音频里的 kick 和 pattern 里的 kick 应当合成**同一行**：
        # 都是底鼓，只是来源不同。这样行数更少、也更稳定。
        # 认不出族别时才用文件名单独成行。
        归并键 = ("g:" + 类) if 类 and 类 != "other" else ("a:" + 名)
        rows.append({
            "key": 归并键,
            "family": 类 if 类 != "other" else None,
            "midi": 虚拟,
            "score": round(分数, 4),
            "features": 特征,
            "steps": 步,
            "source": "audio",
            "absTicks": 绝对,      # 该行每次响起的绝对 tick
            "clipName": 名,
            "duration": [列表[0]["end"] - 列表[0]["start"]],
        })

    rows.sort(key=lambda r: (r["score"],
                            r["midi"] if r["midi"] is not None else 999))
    return {
        "groups": [{"id": "audio", "origin": origin, "basis": "音频",
                    "rows": rows}],
        "stats": {"音频命中": len(命中), "音频行数": len(rows)},
        "missed": [],
    }


def _十六分对齐率(pattern, PPQ):
    """音符落在 16 分格上的比例。

    鼓组 pattern 几乎都对齐到 16 分格（或 32 分）；
    旋律 pattern 常有自由时值，对齐率明显低。
    swing 较重的鼓会降到 0.73~0.85，故阈值不能定太高。
    """
    格长 = PPQ / 4.0
    音符 = pattern.get("notes") or []
    if not 音符:
        return 0.0
    对齐 = 0
    总 = 0
    for n in 音符:
        t = (n.get("start") or {}).get("value")
        if t is None:
            continue
        总 += 1
        r = t / 格长
        if abs(r - round(r)) < 0.02:
            对齐 += 1
    return (对齐 / 总) if 总 else 0.0


def _鼓组分类_本地(名称):
    """转发到 analyze 里的关键词分类（避免循环导入，延迟取）。"""
    from src.audio.analyze import _鼓组分类
    return _鼓组分类(名称)
