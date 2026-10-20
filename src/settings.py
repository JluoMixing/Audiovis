"""G0-4：设置持久化（settings.json）。

## 为什么需要

现在唯一的"状态"是内存里的 会话，重启即失。
没有配置文件 → 语言、路径、导出默认值都无法记住。

## 设计

位置：`%APPDATA%/FLVisualizer/settings.json`（Windows）
      `~/.config/FLVisualizer/settings.json`（其它）

为什么不放在项目目录：
  · 用户可能把程序装在只读位置
  · 多用户共用一台机器时设置会串
  · 升级/重装不应丢设置

## 健壮性要求（都踩过或可预见）

  · 文件不存在 → 用默认值并写一份
  · 文件损坏 → 用默认值，**备份损坏文件**而不是直接覆盖
  · 缺字段   → 用默认值补全（向后兼容：新版加了设置项，旧文件仍能读）
  · 未知字段 → 保留（向前兼容：旧版读到新版写的文件，不丢数据）
"""
import json
import os
import pathlib
import shutil
import sys

# ---------------------------------------------------------------- 默认值

默认设置 = {
    "版本": 1,

    "常规": {
        # 语言：auto = 跟随系统
        "语言": "auto",
        # 界面主题
        "界面主题": "dark",
    },

    "路径": {
        # 空字符串 = 用系统默认位置
        "工程目录": "",
        "导出目录": "",
        "缓存目录": "",
    },

    "导出": {
        "帧率": 30,
        "宽": 1920,
        "高": 1080,
        "编码预设": "medium",
        "码率": "",          # 空 = CRF 质量优先
        "并行度": 0,          # 0 = 自动
        "混入音频": True,
        "完成后打开目录": False,
    },

    "预览": {
        # 0 = 自动（按 DPR 与缩放动态决定）
        "超采样倍率": 0,
    },

    "高级": {
        # 空 = 自动检测
        "浏览器路径": "",
        "日志级别": "info",
    },

    "最近工程": [],
}


# ---------------------------------------------------------------- 位置

def 配置目录():
    """用户级配置目录（跨平台）。"""
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
        return pathlib.Path(base) / "FLVisualizer"
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    return pathlib.Path(base) / "FLVisualizer"


def 配置文件():
    return 配置目录() / "settings.json"


# ---------------------------------------------------------------- 读写

def _深合并(默认, 已有):
    """用已有值覆盖默认值，缺失的补默认，未知的保留。

    这是向后兼容的关键：新版加了设置项时，旧 settings.json
    仍能读（新项用默认值）；旧版读新版文件时，未知项不丢。
    """
    if not isinstance(默认, dict) or not isinstance(已有, dict):
        return 已有 if 已有 is not None else 默认
    out = dict(默认)
    for k, v in 已有.items():
        if k in 默认:
            out[k] = _深合并(默认[k], v)
        else:
            out[k] = v      # 未知字段原样保留
    return out


def 读设置():
    """读取设置。任何异常都回退默认值，不让程序因配置问题起不来。"""
    f = 配置文件()
    if not f.is_file():
        s = json.loads(json.dumps(默认设置))     # 深拷贝
        写设置(s)
        return s
    try:
        已有 = json.loads(f.read_text(encoding="utf-8"))
    except Exception as e:
        # 损坏：备份后用默认值。不直接覆盖 —— 用户的设置可能只是
        # 少了一个括号，手工修一下还能救回来。
        备份 = f.with_suffix(".json.broken")
        try:
            shutil.copy2(f, 备份)
            sys.stderr.write(
                "[settings] 配置损坏（%s），已备份到 %s，使用默认值\n"
                % (e, 备份.name))
        except Exception:
            pass
        s = json.loads(json.dumps(默认设置))
        写设置(s)
        return s
    return _深合并(默认设置, 已有)


def 写设置(s):
    """原子写入：先写临时文件再替换，避免写一半断电导致文件损坏。"""
    f = 配置文件()
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(s, ensure_ascii=False, indent=1),
                   encoding="utf-8")
    tmp.replace(f)


def 改设置(补丁):
    """浅合并一个补丁（按分组）。返回合并后的完整设置。

    用法：改设置({"导出": {"帧率": 60}})
    只更新导出.帧率，其它不动。
    """
    s = 读设置()
    for 组, 值 in (补丁 or {}).items():
        if isinstance(值, dict) and isinstance(s.get(组), dict):
            s[组].update(值)
        else:
            s[组] = 值
    写设置(s)
    return s


def 恢复默认(组=None):
    s = json.loads(json.dumps(默认设置))
    if 组 is None:
        写设置(s)
        return s
    cur = 读设置()
    if 组 in 默认设置:
        cur[组] = s[组]
        写设置(cur)
    return cur


# ---------------------------------------------------------------- 语言推断

def 系统语言():
    """返回 'zh' 或 'en'。用于「语言=auto」时决定界面语言。"""
    try:
        import locale
        for 候选 in (locale.getlocale()[0], locale.getdefaultlocale()[0]):
            if 候选 and str(候选).lower().startswith("zh"):
                return "zh"
    except Exception:
        pass
    # 环境变量兜底
    for k in ("LANG", "LC_ALL", "LANGUAGE"):
        v = os.environ.get(k, "")
        if v.lower().startswith("zh"):
            return "zh"
    return "en"


def 生效语言(设置=None):
    s = 设置 or 读设置()
    语言 = (s.get("常规") or {}).get("语言") or "auto"
    if 语言 == "auto":
        return 系统语言()
    return 语言 if 语言 in ("zh", "en") else "zh"


# ---------------------------------------------------------------- 路径解析

def 工程目录(设置=None):
    s = 设置 or 读设置()
    p = (s.get("路径") or {}).get("工程目录") or ""
    if p:
        return pathlib.Path(p)
    return pathlib.Path.home() / "Documents" / "FLVisualizer" / "Projects"


def 导出目录(设置=None):
    s = 设置 or 读设置()
    p = (s.get("路径") or {}).get("导出目录") or ""
    if p:
        return pathlib.Path(p)
    return pathlib.Path.home() / "Documents" / "FLVisualizer" / "Exports"


def 缓存目录(设置=None):
    s = 设置 or 读设置()
    p = (s.get("路径") or {}).get("缓存目录") or ""
    if p:
        return pathlib.Path(p)
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return pathlib.Path(base) / "FLVisualizer" / "cache"
    return pathlib.Path.home() / ".cache" / "flvisualizer"


if __name__ == "__main__":
    print(json.dumps({
        "配置目录": str(配置目录()),
        "配置文件": str(配置文件()),
        "存在": 配置文件().is_file(),
        "系统语言": 系统语言(),
        "生效语言": 生效语言(),
        "工程目录": str(工程目录()),
        "导出目录": str(导出目录()),
        "缓存目录": str(缓存目录()),
    }, ensure_ascii=False, indent=1))
