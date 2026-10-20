"""工程文件 `.flvproj` 的读写。

## 格式

`.flvproj` 是一个 zip，内含：

    project.json     工程元数据（名称、FLP/音频路径、布局、主题、导出设置）
    analysis.json    音频分析缓存（打开时免于重新分析，几秒 → 毫秒）
    thumbnail.png    首帧缩略图（最近工程列表里显示）

## 为什么存分析缓存

分析一段 4 分钟音频要 2~3 秒，工程越多越慢。
缓存进工程文件后，打开旧工程几乎瞬时。
代价是文件变大（nujabes 约 4 MB），但换来的是可迁移 + 打开快。

用户确认的方案是 C（引用 + 缓存 + 缩略图），不是只存引用 ——
只存引用时换机器/移动文件就打不开。

## 引用 vs 内嵌

FLP 与音频**只存路径引用**，不内嵌（否则工程文件几十上百 MB）。
故移动原始文件后需要重新指定路径 —— 打开时做存在性检查并提示。

## 版本

project.json 里带 `schema_version`。加载时做迁移，
避免以后改格式后旧工程打不开。
"""
import io
import json
import pathlib
import zipfile

SCHEMA_VERSION = 1

# zip 内的文件名
文件_工程 = "project.json"
文件_分析 = "analysis.json"
文件_缩略图 = "thumbnail.png"


class 工程错误(Exception):
    pass


def 打包(目标路径, 元数据, 分析数据=None, 缩略图PNG=None):
    """写出 .flvproj。

    参数：
        目标路径    .flvproj 路径（自动补扩展名）
        元数据      dict，见 新建元数据()
        分析数据    可选，analyze.构建() 的返回值
        缩略图PNG   可选，bytes（PNG）

    返回实际写入的路径。
    """
    目标路径 = pathlib.Path(目标路径)
    if 目标路径.suffix.lower() != ".flvproj":
        目标路径 = 目标路径.with_suffix(".flvproj")
    目标路径.parent.mkdir(parents=True, exist_ok=True)

    元数据 = dict(元数据)
    元数据["schema_version"] = SCHEMA_VERSION

    # 原子写：先写临时文件再替换，避免写一半断电留下损坏的工程
    临时 = 目标路径.with_suffix(".flvproj.tmp")
    try:
        with zipfile.ZipFile(临时, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr(文件_工程, json.dumps(元数据, ensure_ascii=False,
                                            indent=1))
            if 分析数据 is not None:
                z.writestr(文件_分析, json.dumps(分析数据, ensure_ascii=False))
            if 缩略图PNG:
                z.writestr(文件_缩略图, 缩略图PNG)
        临时.replace(目标路径)
    except Exception:
        try:
            临时.unlink(missing_ok=True)
        except Exception:
            pass
        raise
    return 目标路径


def 读取(路径):
    """读取 .flvproj。

    返回 {"元数据": dict, "分析": dict|None, "缩略图": bytes|None}

    异常情况都抛 工程错误 并给出可读原因 ——
    工程文件损坏时用户需要知道是文件问题还是程序问题。
    """
    路径 = pathlib.Path(路径)
    if not 路径.is_file():
        raise 工程错误("工程文件不存在：%s" % 路径)
    if not zipfile.is_zipfile(路径):
        raise 工程错误("不是有效的工程文件（应为 zip 格式）：%s" % 路径.name)

    try:
        with zipfile.ZipFile(路径, "r") as z:
            名单 = set(z.namelist())
            if 文件_工程 not in 名单:
                raise 工程错误("工程文件缺少 %s" % 文件_工程)

            元数据 = json.loads(z.read(文件_工程).decode("utf-8"))

            分析 = None
            if 文件_分析 in 名单:
                try:
                    分析 = json.loads(z.read(文件_分析).decode("utf-8"))
                except Exception:
                    分析 = None      # 缓存坏了不影响打开，重算即可

            缩略图 = None
            if 文件_缩略图 in 名单:
                缩略图 = z.read(文件_缩略图)
    except zipfile.BadZipFile as e:
        raise 工程错误("工程文件损坏：%s" % e)
    except 工程错误:
        raise
    except Exception as e:
        raise 工程错误("读取失败：%s" % e)

    # 版本迁移
    版本 = 元数据.get("schema_version", 0)
    if 版本 > SCHEMA_VERSION:
        raise 工程错误(
            "工程由更新版本创建（schema %d，本程序支持 %d），请升级后再打开"
            % (版本, SCHEMA_VERSION))
    元数据 = _迁移(元数据, 版本)

    return {"元数据": 元数据, "分析": 分析, "缩略图": 缩略图}


def _迁移(元数据, 版本):
    """把旧版本工程升到当前版本。

    目前只有 v1，无需迁移。保留这个函数是为了格式演进时
    有一个明确的落点 —— 而不是在读取逻辑里堆 if。
    """
    if 版本 < 1:
        # v0（无版本号）：补默认值
        元数据.setdefault("布局", {"组件": []})
        元数据.setdefault("主题", "sumi")
        元数据.setdefault("导出设置", {})
    元数据["schema_version"] = SCHEMA_VERSION
    return 元数据


def 新建元数据(名称, flp, audio, 布局, 主题="sumi",
              导出设置=None, 静帧秒=48.0):
    """构造工程元数据。"""
    import time
    return {
        "schema_version": SCHEMA_VERSION,
        "name": 名称,
        "flp": str(flp),
        "audio": str(audio),
        "布局": 布局,
        "主题": 主题,
        "静帧秒": 静帧秒,
        "导出设置": 导出设置 or {},
        "创建时间": time.time(),
        "修改时间": time.time(),
    }


def 检查引用(元数据):
    """检查 FLP / 音频是否还在原处。

    返回 {"flp": {...}, "audio": {...}}，每项含 存在/路径。
    不存在的引用要提示用户重新指定 —— 否则打开后什么都渲染不出来。
    """
    out = {}
    for 键 in ("flp", "audio"):
        p = 元数据.get(键) or ""
        out[键] = {
            "路径": p,
            "存在": bool(p) and pathlib.Path(p).is_file(),
        }
    return out


def 摘要(路径):
    """工程摘要（供最近列表显示）。

    只读项目元数据，不解压分析缓存 —— 列表里有几十个工程时
    逐个解压 4 MB 会很慢。
    """
    路径 = pathlib.Path(路径)
    try:
        with zipfile.ZipFile(路径, "r") as z:
            元数据 = json.loads(z.read(文件_工程).decode("utf-8"))
            有缩略图 = 文件_缩略图 in z.namelist()
        引用 = 检查引用(元数据)
        return {
            "路径": str(路径),
            "名称": 元数据.get("name") or 路径.stem,
            "flp": 元数据.get("flp"),
            "audio": 元数据.get("audio"),
            "主题": 元数据.get("主题"),
            "修改时间": 元数据.get("修改时间"),
            "组件数": len((元数据.get("布局") or {}).get("组件") or []),
            "有缩略图": 有缩略图,
            "引用有效": (引用["flp"]["存在"] and 引用["audio"]["存在"]),
            "大小字节": 路径.stat().st_size,
        }
    except Exception as e:
        return {"路径": str(路径), "名称": 路径.stem, "错误": str(e)[:120]}


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        print(json.dumps(摘要(sys.argv[1]), ensure_ascii=False, indent=1))
    else:
        print("用法：python src/project.py <工程.flvproj>")
