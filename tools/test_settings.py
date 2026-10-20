"""G0-4 验证：设置持久化的健壮性。

重点不是「能读写」，而是**异常情况下不出事**：
  · 文件不存在 → 自动创建
  · 文件损坏   → 备份 + 回退默认（不丢用户数据）
  · 缺字段     → 补默认（新版加设置项后，旧文件仍能读）
  · 未知字段   → 保留（旧版读新版文件，不丢数据）
  · 并发写     → 原子替换（不产生半截文件）
"""
import json
import pathlib
import shutil
import sys
import tempfile

根 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(根))

from src import settings as S  # noqa: E402

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


# 用临时目录，不污染真实配置
临时 = pathlib.Path(tempfile.mkdtemp(prefix="flv_settings_"))
原配置目录 = S.配置目录
S.配置目录 = lambda: 临时
S.配置文件 = lambda: 临时 / "settings.json"

try:
    print("=" * 70)
    print("G0-4 验证：设置持久化")
    print("=" * 70)
    print()

    # ---- 1) 首次运行 ----
    print("【1】首次运行（文件不存在）")
    f = S.配置文件()
    断言("初始不存在", not f.is_file())
    s = S.读设置()
    断言("自动创建了文件", f.is_file(), str(f))
    断言("返回默认值", s["常规"]["语言"] == "auto", s["常规"])
    断言("文件内容可解析", isinstance(
        json.loads(f.read_text(encoding="utf-8")), dict))
    print()

    # ---- 2) 读写往返 ----
    print("【2】读写往返")
    S.改设置({"导出": {"帧率": 60, "编码预设": "slow"}})
    s = S.读设置()
    断言("帧率已保存", s["导出"]["帧率"] == 60, s["导出"]["帧率"])
    断言("预设已保存", s["导出"]["编码预设"] == "slow", s["导出"]["编码预设"])
    断言("同组其它项未被覆盖", s["导出"]["宽"] == 1920, s["导出"]["宽"])
    print()

    # ---- 3) 缺字段（向后兼容）----
    print("【3】缺字段：旧文件缺新设置项")
    f.write_text(json.dumps({
        "版本": 1,
        "常规": {"语言": "en"},        # 只有语言，其它分组全缺
    }, ensure_ascii=False), encoding="utf-8")
    s = S.读设置()
    断言("已有的值保留", s["常规"]["语言"] == "en", s["常规"]["语言"])
    断言("缺失的分组补上默认", "导出" in s and s["导出"]["帧率"] == 30,
         s.get("导出"))
    断言("缺失的子项补上默认", s["常规"]["界面主题"] == "dark",
         s["常规"])
    print()

    # ---- 4) 未知字段（向前兼容）----
    print("【4】未知字段：新版写的文件给旧版读")
    f.write_text(json.dumps({
        "版本": 1,
        "常规": {"语言": "zh"},
        "未来功能": {"某个新设置": [1, 2, 3]},     # 本版不认识
    }, ensure_ascii=False), encoding="utf-8")
    s = S.读设置()
    断言("未知分组被保留", "未来功能" in s, list(s.keys()))
    断言("未知分组的值完整", s.get("未来功能", {}).get("某个新设置") == [1, 2, 3],
         s.get("未来功能"))
    print()

    # ---- 5) 损坏文件 ----
    print("【5】文件损坏")
    f.write_text('{"常规": {"语言": "zh"', encoding="utf-8")   # 少括号
    s = S.读设置()
    断言("回退到默认值", s["常规"]["语言"] == "auto", s["常规"]["语言"])
    备份 = f.with_suffix(".json.broken")
    断言("损坏文件已备份", 备份.is_file(), str(备份))
    if 备份.is_file():
        断言("备份内容是原始损坏内容",
             "zh" in 备份.read_text(encoding="utf-8"),
             备份.read_text(encoding="utf-8")[:40])
    print()

    # ---- 6) 原子写 ----
    print("【6】原子写入（不留半截文件）")
    S.写设置(json.loads(json.dumps(S.默认设置)))
    tmp = f.with_suffix(".json.tmp")
    断言("写完后无临时文件残留", not tmp.is_file(), str(tmp))
    断言("文件可正常解析", isinstance(
        json.loads(f.read_text(encoding="utf-8")), dict))
    print()

    # ---- 7) 恢复默认 ----
    print("【7】恢复默认")
    S.改设置({"导出": {"帧率": 24}})
    s = S.恢复默认("导出")
    断言("指定分组已恢复", s["导出"]["帧率"] == 30, s["导出"]["帧率"])
    print()

    # ---- 8) 语言推断 ----
    print("【8】语言推断")
    S.写设置(json.loads(json.dumps(S.默认设置)))
    s = S.读设置()
    语言 = S.生效语言(s)
    断言("auto 时返回有效语言", 语言 in ("zh", "en"), 语言)
    S.改设置({"常规": {"语言": "en"}})
    断言("显式 en 生效", S.生效语言() == "en", S.生效语言())
    S.改设置({"常规": {"语言": "zh"}})
    断言("显式 zh 生效", S.生效语言() == "zh", S.生效语言())
    S.改设置({"常规": {"语言": "非法值"}})
    断言("非法值回退到 zh", S.生效语言() == "zh", S.生效语言())
    print()

    # ---- 9) 路径默认值 ----
    print("【9】路径解析")
    S.写设置(json.loads(json.dumps(S.默认设置)))
    断言("工程目录有默认值", "Projects" in str(S.工程目录()), S.工程目录())
    断言("导出目录有默认值", "Exports" in str(S.导出目录()), S.导出目录())
    断言("缓存目录有默认值", "cache" in str(S.缓存目录()), S.缓存目录())
    S.改设置({"路径": {"导出目录": str(临时 / "myexp")}})
    断言("自定义路径生效", str(S.导出目录()) == str(临时 / "myexp"),
         S.导出目录())
    print()

finally:
    S.配置目录 = 原配置目录
    shutil.rmtree(临时, ignore_errors=True)

print("=" * 70)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 70)
sys.exit(1 if 失败 else 0)
