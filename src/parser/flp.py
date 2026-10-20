"""FLP 解析器：FL Studio 工程 → 规范化 Snapshot。

这是**产品级**解析入口，取代 research/probe 下的一次性探针。
与探针的区别：
  · 输入输出为参数，不硬编码路径
  · 失败时抛出明确异常，不静默返回 None
  · 保留 provenance（每个字段标注来源）
  · 不依赖工作目录

只读保证：本模块只调用 pyflp.parse()，从不调用 save/write。

许可证说明：依赖 PyFLP（GPL-3.0）。本项目以 GPL-3.0 发布，兼容。
"""
import hashlib
import pathlib
import sys

# vendored 依赖路径（相对仓库根）
_仓库根 = pathlib.Path(__file__).resolve().parents[2]
_供应商 = _仓库根 / "research" / "vendor"
for _名称 in ("PyFLP", "construct", "construct-typing", "fastenum"):
    _p = str(_供应商 / _名称)
    if _p not in sys.path:
        sys.path.insert(0, _p)


class 解析错误(Exception):
    """FLP 解析失败。携带原始异常信息，便于排查版本兼容性。"""


def _安全(取值函数, 默认=None):
    """读取属性，失败返回默认值。

    注意：仅用于**可选字段**。对必需字段不要用此函数——
    静默失败会让统计悄悄出错（阶段 A 曾因此误报音频源数为 0）。
    """
    try:
        return 取值函数()
    except Exception:
        return 默认


def _枚举值(值):
    """枚举 → 可读字符串。"""
    if 值 is None:
        return None
    if hasattr(值, "name") and hasattr(值, "value"):
        return "%s(%s)" % (值.name, 值.value)
    return str(值)


def _颜色(对象):
    """颜色对象 → [r,g,b,a] 浮点数组。"""
    值 = _安全(lambda: 对象.color)
    if 值 is None:
        return None
    try:
        return [round(值.r, 6), round(值.g, 6), round(值.b, 6), round(值.a, 6)]
    except Exception:
        return None


def 解析(flp路径, 通道表=None):
    """解析 FLP，返回原始结构字典（未规范化）。

    参数：
        flp路径   pathlib.Path 或 str
        通道表    可选，用于附加通道名称等外部信息

    返回：字典，含 项目 / channels / patterns / playlist / markers
    异常：解析错误
    """
    import pyflp

    flp路径 = pathlib.Path(flp路径)
    if not flp路径.is_file():
        raise 解析错误("FLP 文件不存在：%s" % flp路径)

    原始字节 = flp路径.read_bytes()
    摘要 = hashlib.sha256(原始字节).hexdigest()

    try:
        工程 = pyflp.parse(flp路径)
    except Exception as e:
        raise 解析错误(
            "PyFLP 解析失败（%s）：%s\n"
            "可能原因：FL 版本不受支持、文件损坏、或为压缩格式。"
            % (type(e).__name__, e)) from e

    # ---- 项目元数据 ----
    项目 = {
        "输入路径": str(flp路径),
        "字节数": len(原始字节),
        "sha256": 摘要,
        "fl_version": _枚举值(_安全(lambda: 工程.version)),
        "ppq": _安全(lambda: 工程.ppq),
        "tempo": _安全(lambda: 工程.tempo),
        "标题": _安全(lambda: 工程.title),
        "作者": _安全(lambda: 工程.artists),
        "流派": _安全(lambda: 工程.genre),
    }
    if 项目["ppq"] is None:
        raise 解析错误("无法读取 PPQ —— 时间换算无法进行，拒绝继续")
    if 项目["tempo"] is None:
        raise 解析错误("无法读取 Tempo —— 秒换算无法进行，拒绝继续")

    # ---- 通道 ----
    通道列表 = []
    for 通道 in 工程.channels:
        类型名 = type(通道).__name__
        项 = {
            "iid": _安全(lambda c=通道: c.iid),
            "类型": 类型名,
            "名称": _安全(lambda c=通道: c.display_name),
            "内部名称": _安全(lambda c=通道: c.internal_name),
            "颜色": _颜色(通道),
        }
        if 类型名 == "Sampler":
            项["sample_path"] = _安全(lambda c=通道: c.sample_path)
        通道列表.append(项)

    # ---- Pattern 与音符 ----
    Pattern列表 = []
    for pattern in 工程.patterns:
        音符列表 = []
        for note in _安全(lambda p=pattern: list(p.notes), []) or []:
            音符列表.append({
                "key": _安全(lambda n=note: n.key),
                "position": _安全(lambda n=note: n.position),
                "length": _安全(lambda n=note: n.length),
                "velocity": _安全(lambda n=note: n.velocity),
                "pan": _安全(lambda n=note: n.pan),
                "release": _安全(lambda n=note: n.release),
                "midi_channel_or_color": _安全(lambda n=note: n.midi_channel),
                "rack_channel": _安全(lambda n=note: n.rack_channel),
            })
        Pattern列表.append({
            "iid": _安全(lambda p=pattern: p.iid),
            "名称": _安全(lambda p=pattern: p.name),
            "颜色": _颜色(pattern),
            "length_raw_ppq": _安全(lambda p=pattern: p.length),
            "notes": 音符列表,
        })

    # ---- Playlist ----
    arrangements = []
    markers = []
    for arr in _安全(lambda: list(工程.arrangements), []) or []:
        arr项 = {
            "iid": _安全(lambda a=arr: a.iid),
            "名称": _安全(lambda a=arr: a.name),
            "tracks": [],
        }
        for mk in _安全(lambda a=arr: list(a.timemarkers), []) or []:
            markers.append({
                "arrangement_iid": arr项["iid"],
                "名称": _安全(lambda m=mk: m.name),
                "position_raw_ppq": _安全(lambda m=mk: m.position),
            })

        for track in _安全(lambda a=arr: list(a.tracks), []) or []:
            track项 = {
                "iid": _安全(lambda t=track: t.iid),
                "名称": _安全(lambda t=track: t.name),
                "颜色": _颜色(track),
                "clips": [],
            }
            for item in _安全(lambda t=track: list(t), []) or []:
                起点 = _安全(lambda i=item: i.position)
                长度 = _安全(lambda i=item: i.length)
                项 = {
                    "position_raw_ppq": 起点,
                    "length_raw_ppq": 长度,
                    "end_raw_ppq_derived": (起点 + 长度
                                            if isinstance(起点, int)
                                            and isinstance(长度, int) else None),
                    "muted": _安全(lambda i=item: i.muted),
                    "group": _安全(lambda i=item: i.group),
                    "offsets": _安全(lambda i=item: i.offsets),
                }
                if hasattr(item, "pattern"):
                    项["类型"] = "pattern"
                    项["pattern_iid"] = _安全(lambda i=item: i.pattern.iid)
                    项["source_name"] = _安全(lambda i=item: i.pattern.name)
                elif hasattr(item, "channel"):
                    项["channel_iid"] = _安全(lambda i=item: i.channel.iid)
                    项["source_name"] = _安全(lambda i=item: i.channel.display_name)
                    类名 = type(_安全(lambda i=item: i.channel)).__name__
                    项["channel_class"] = 类名
                    if 类名 == "Sampler":
                        项["sample_path"] = _安全(lambda i=item: i.channel.sample_path)
                    项["类型"] = "automation" if 类名 == "Automation" else "channel_clip"
                else:
                    项["类型"] = "unknown"
                track项["clips"].append(项)
            arr项["tracks"].append(track项)
        arrangements.append(arr项)

    return {
        "项目": 项目,
        "channels": 通道列表,
        "patterns": Pattern列表,
        "playlist": {"arrangements": arrangements},
        "markers": markers,
        "provenance": {
            "来源": "pyflp",
            "解析时间": None,   # 由调用方填充
            "只读保证": "仅调用 pyflp.parse()，未调用任何写入方法",
        },
    }
