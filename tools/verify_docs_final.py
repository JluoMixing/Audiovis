"""校验两份文档里的事实描述。"""
import json
import pathlib
import re

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
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


print("=" * 70)
print("文档事实校验")
print("=" * 70)
print()

# ---- 1) 组件数 ----
print("【1】组件（文档说 12 个）")
组件 = sorted(f.stem for f in (根 / "src" / "components").glob("*.js"))
断言("组件数 = 12", len(组件) == 12, len(组件))
文档组件 = ["text", "playlist", "stepper", "pianoroll", "pitchwheel",
            "spectrum", "waveform", "vectorscope", "loudness",
            "brightness", "transient", "transport"]
断言("文档列出的组件都存在",
     all(c in 组件 for c in 文档组件),
     [c for c in 文档组件 if c not in 组件])
print()

# ---- 2) 主题数 ----
print("【2】主题（文档说 12 套）")
ad = json.loads((根 / "preview" / "themes" / "artdirections.json")
                .read_text(encoding="utf-8"))
方向 = ad.get("directions") or {}
断言("directions 数 = 12", len(方向) == 12, len(方向))
文档主题 = ["default", "sumi", "blueprint", "longexposure", "construct",
            "tape", "staratlas", "weave", "risograph",
            "wh_soft", "chrome_freak", "nuclear"]
断言("文档列出的主题都存在",
     all(k in 方向 for k in 文档主题),
     [k for k in 文档主题 if k not in 方向])
断言("order 包含全部主题",
     set(文档主题) <= set(ad.get("order") or []),
     set(文档主题) - set(ad.get("order") or []))
print()

# ---- 3) bloom 主题文件 ----
print("【3】bloom 主题文件（11 个；default 无 bloom，回退 sumi）")
bloom = sorted(f.stem for f in (根 / "src" / "bloom" / "themes").glob("*.js"))
断言("bloom 主题文件 = 11", len(bloom) == 11, len(bloom))
断言("bloom 覆盖 11 套有独立绽放的主题",
     all(k in bloom for k in 文档主题 if k != "default"),
     [k for k in 文档主题 if k != "default" and k not in bloom])
print()

# ---- 4) src 结构 ----
print("【4】src 结构")
for 子 in ("core", "components", "bloom", "app", "build",
           "parser", "audio", "render"):
    断言("src/%s 存在" % 子, (根 / "src" / 子).is_dir())
for f in ("cli.py", "project.py", "settings.py",
          "runtime.py", "webview_host.py", "ARCHITECTURE.md"):
    断言("src/%s 存在" % f, (根 / "src" / f).is_file())
print()

# ---- 5) core 里的文件 ----
print("【5】core 文件（文档列了 9 个）")
core = sorted(f.name for f in (根 / "src" / "core").glob("*.js"))
文档core = ["canvas-kit.js", "registry.js", "theme.js", "surfaces.js",
            "paint.js", "data.js", "time.js", "notes.js", "fonts.js"]
断言("文档列的 core 文件都存在",
     all(c in core for c in 文档core),
     [c for c in 文档core if c not in core])
print()

# ---- 6) preview 结构 ----
print("【6】preview 结构")
for f in ("build_gui.py", "design_templates.py",
          "templates.json", "gui_prototype.html"):
    断言("preview/%s 存在" % f, (根 / "preview" / f).is_file())
断言("preview/gui/ 存在", (根 / "preview" / "gui").is_dir())
断言("preview/themes/artdirections.json 存在",
     (根 / "preview" / "themes" / "artdirections.json").is_file())
print()

# ---- 7) packaging ----
print("【7】packaging")
for f in ("Audiovis.spec", "make_zip.py"):
    断言("packaging/%s 存在" % f, (根 / "packaging" / f).is_file())
print()

# ---- 8) docs 清单 ----
print("【8】docs 清单")
# 开源版只保留「成品需要」的文档。
# 阶段报告（GUI_DONE / PERF_AUDIT / GPU_AND_HARDWARE）与
# _history/（GUI_PLAN / PHASE_A_REPORT / DESIGN_DIRECTIONS）
# 属于开发过程记录，已从仓库移除 —— 它们仍在本机 git 历史里。
文档docs = ["INDEX.md", "ROADMAP.md", "STRUCTURE.md", "ADD_COMPONENT.md",
            "ADD_THEME.md", "PACKAGING.md", "VENDOR_VERSIONS.md",
            "promo.md"]
实际docs = [f.name for f in (根 / "docs").glob("*.md")]
断言("成品文档都存在",
     all(d in 实际docs for d in 文档docs),
     [d for d in 文档docs if d not in 实际docs])

已移除 = ["GUI_DONE.md", "PERF_AUDIT.md", "GPU_AND_HARDWARE.md"]
断言("开发过程文档不在仓库里",
     not any(d in 实际docs for d in 已移除),
     [d for d in 已移除 if d in 实际docs])
断言("docs/_history/ 不在仓库里",
     not (根 / "docs" / "_history").exists())
print()

# ---- 9) 文档里不应再提过时内容 ----
print("【9】过时内容已清除")
r = (根 / "docs" / "ROADMAP.md").read_text(encoding="utf-8")
s = (根 / "docs" / "STRUCTURE.md").read_text(encoding="utf-8")
断言("ROADMAP 不再说「待开始」", "待开始" not in r)
断言("ROADMAP 不再提 preview.html", "preview/preview.html" not in r)
断言("ROADMAP 不再说阶段 B 规划中", "| **B** | MVP：能生成一条完整视频 | CLI + mp4 | 待开始 |" not in r)
断言("STRUCTURE 不再提 preview.html", "preview.html" not in s or
     "gui_prototype.html" in s)
断言("两份文档都标了已完成", "已完成" in r)
print()

# ---- 10) 打包产物 ----
print("【10】打包产物")
断言("dist/Audiovis/Audiovis.exe 存在",
     (根 / "dist" / "Audiovis" / "Audiovis.exe").is_file())
断言("dist/Audiovis-v1.0.0-win64.zip 存在",
     (根 / "dist" / "Audiovis-v1.0.0-win64.zip").is_file())
print()

print("=" * 70)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 70)
