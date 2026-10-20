"""Snapshot 规范化：原始解析结果 → 稳定 Schema。

Schema 定义见 data/schema/project_snapshot.schema.json。

设计原则（来自项目早期决策）：
  · Visualizer 依赖本 Schema，不依赖 PyFLP 内部对象
  · 时间保留原始 PPQ tick，不做未经验证的秒换算
  · 每个值带 provenance（value / unit / source）
  · 明确标注未纳入的能力（scope）
"""
import json
import pathlib

SCHEMA_VERSION = "1.1.0"

# 当前版本明确不支持的范畴（如实声明，不假装完整）
SCOPE = {
    "automation": "排除在核心快照外；原始证据保留在解析结果中",
    "channel_to_mixer": "排除在核心快照外（PyFLP 未暴露此映射）",
    "markers": "支持读取；若工程无 marker 则为空数组",
}


def _纯值(值):
    """把值转为 JSON 可序列化的形式。

    PyFLP 的 sample_path 是 pathlib.Path，不能直接序列化；
    枚举等对象也需转字符串。此函数统一处理，避免下游踩坑。
    """
    if 值 is None or isinstance(值, (str, int, float, bool)):
        return 值
    if isinstance(值, pathlib.PurePath):
        return str(值)
    if isinstance(值, (list, tuple)):
        return [_纯值(x) for x in 值]
    if isinstance(值, dict):
        return {str(k): _纯值(v) for k, v in 值.items()}
    if hasattr(值, "name") and hasattr(值, "value"):
        return "%s(%s)" % (值.name, 值.value)
    if hasattr(值, "value"):
        return _纯值(值.value)
    return str(值)


def _时间(值, 来源="pyflp"):
    """PPQ tick 时间字段：显式带 unit，避免下游猜测单位。"""
    if 值 is None:
        return None
    return {"value": _纯值(值), "unit": "ppq_tick", "source": 来源}


def _值(值, 来源="pyflp"):
    """非时间字段。"""
    if 值 is None:
        return None
    return {"value": _纯值(值), "source": 来源}


def 规范化(原始, tempo交叉验证=None):
    """原始解析结果 → 规范化 Snapshot。

    参数：
        原始             flp.解析() 的返回值
        tempo交叉验证     可选，{"tempo": 95.246, "ppq": 96, "状态": "完全一致"}

    返回：符合 Schema 的字典
    """
    项目 = 原始["项目"]
    通道表 = {c["iid"]: c for c in 原始["channels"]}

    # ---- Pattern ----
    patterns = []
    for p in 原始["patterns"]:
        通道ids = sorted({
            n["rack_channel"] for n in p["notes"]
            if isinstance(n.get("rack_channel"), int)
        })
        notes = []
        for n in p["notes"]:
            notes.append({
                "start": _时间(n.get("position")),
                "duration": _时间(n.get("length")),
                "pitch": _值(n.get("key")),
                "velocity": _值(n.get("velocity")),
                "pan": _值(n.get("pan")),
                "color_or_midi_channel": _值(n.get("midi_channel_or_color")),
                "channel_id": _值(n.get("rack_channel")),
            })
        patterns.append({
            "id": p["iid"],
            "name": _值(p.get("名称")),
            "length": _值(p.get("length_raw_ppq")),
            "color": _值(p.get("颜色")),
            "channel_ids": 通道ids,
            "notes": notes,
        })

    # ---- Arrangement / Track / Clip ----
    audio_sources = {}
    tracks = []
    arrangements = 原始["playlist"]["arrangements"]
    for arr in arrangements:
        for track in arr["tracks"]:
            clips = []
            for clip in track["clips"]:
                if clip.get("类型") == "automation":
                    continue          # 按既定范围排除
                if clip.get("类型") == "pattern":
                    clip_type = "pattern"
                    source_id = clip.get("pattern_iid")
                    source_name = clip.get("source_name")
                    source_path = None
                else:
                    通道 = 通道表.get(clip.get("channel_iid"), {})
                    source_path = 通道.get("sample_path")
                    clip_type = "audio" if source_path else "channel_clip_unknown"
                    source_id = clip.get("channel_iid")
                    source_name = clip.get("source_name")
                    if source_path:
                        键 = str(source_path)
                        if 键 not in audio_sources:
                            audio_sources[键] = {
                                "id": len(audio_sources) + 1,
                                "name": source_name,
                                "source_path": 键,
                                "channel_ids": [],
                            }
                        if source_id not in audio_sources[键]["channel_ids"]:
                            audio_sources[键]["channel_ids"].append(source_id)

                起点 = clip.get("position_raw_ppq")
                长度 = clip.get("length_raw_ppq")
                clips.append({
                    "id": "a%d-t%d-c%d" % (arr["iid"], track["iid"], len(clips) + 1),
                    "type": clip_type,
                    "start": _时间(起点),
                    "length": _时间(长度),
                    "end": _时间(clip.get("end_raw_ppq_derived"),
                                "derived: start + length"),
                    "source": {
                        "kind": clip_type,
                        "id": source_id,
                        "name": source_name,
                        "sample_path": _纯值(source_path),
                        "source": "pyflp",
                    },
                    "muted": _值(clip.get("muted")),
                    "group": _值(clip.get("group")),
                    "offsets": _值(clip.get("offsets")),
                })
            tracks.append({
                "index": track["iid"],
                "name": _值(track.get("名称")),
                "color": _值(track.get("颜色")),
                "clips": clips,
            })

    # ---- metadata ----
    节奏 = None
    if tempo交叉验证 and tempo交叉验证.get("状态") == "完全一致":
        节奏 = {
            "value": tempo交叉验证["tempo"],
            "unit": "bpm",
            "source": "flpdiff+pyflp 交叉验证",
            "cross_validated": True,
        }
    elif 项目.get("tempo") is not None:
        # 未做交叉验证时仍写入，但标注为单一来源
        节奏 = {
            "value": 项目["tempo"],
            "unit": "bpm",
            "source": "pyflp（单一来源，未交叉验证）",
            "cross_validated": False,
        }

    metadata = {
        "fl_version": 项目.get("fl_version"),
        "ppq": 项目["ppq"],
        "tempo": 节奏,
        "source_file_sha256": 项目["sha256"],
        "source_file_path": 项目["输入路径"],
        "title": 项目.get("标题"),
        "primary_source": "pyflp",
    }

    # ---- 通道表 ----
    # 鼓组识别靠通道名做关键词匹配（kick / snare / hat …）。
    # 原先把通道表读自仓库里一个**写死的旧文件**，那是某个特定工程的
    # 通道编号 —— 换工程就对不上，于是所有鼓件都被判成 other，
    # 步进器只剩「其它」一行（用户实测报的就是这个）。
    # 通道表属于工程本身，必须随快照一起走。
    channels = []
    for c in 原始.get("channels") or []:
        # sample_path 可能是 pathlib.Path，必须先转成字符串，
        # 否则 json.dumps 会抛 TypeError（WindowsPath is not JSON serializable）
        样本 = c.get("sample_path")
        if 样本 is not None and not isinstance(样本, str):
            样本 = str(样本)
        channels.append({
            "iid": c.get("iid"),
            "type": c.get("类型"),
            "name": c.get("名称") or "",
            "internal_name": c.get("内部名称") or "",
            "sample_path": 样本,
        })

    return {
        "schema_version": SCHEMA_VERSION,
        "metadata": metadata,
        "channels": channels,
        "arrangement": {
            "id": arrangements[0]["iid"] if arrangements else None,
            "name": arrangements[0]["名称"] if arrangements else None,
            "tracks": tracks,
            "markers": 原始.get("markers", []),
        },
        "patterns": patterns,
        "audio_sources": list(audio_sources.values()),
        "scope": SCOPE,
    }


def 保存(snapshot, 输出路径):
    """写入 Snapshot 文件。"""
    输出路径 = pathlib.Path(输出路径)
    输出路径.parent.mkdir(parents=True, exist_ok=True)
    输出路径.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=1), encoding="utf-8")
    return 输出路径


def 统计(snapshot):
    """Snapshot 摘要，用于日志与验证。"""
    a = snapshot["arrangement"]
    有内容 = [t for t in a["tracks"] if t["clips"]]
    return {
        "schema_version": snapshot["schema_version"],
        "ppq": snapshot["metadata"]["ppq"],
        "tempo": (snapshot["metadata"]["tempo"] or {}).get("value"),
        "轨道总数": len(a["tracks"]),
        "有内容轨道": len(有内容),
        "clip总数": sum(len(t["clips"]) for t in a["tracks"]),
        "pattern数": len(snapshot["patterns"]),
        "音符总数": sum(len(p["notes"]) for p in snapshot["patterns"]),
        "音频源数": len(snapshot["audio_sources"]),
        "marker数": len(a["markers"]),
    }
