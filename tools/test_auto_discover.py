"""验证扫目录真的有效：加一个临时组件，不登记，看它是否自动出现。

这是这次改动的核心价值 —— 证明「漏登记」不可能发生。
"""
import pathlib
import shutil
import subprocess
import sys

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


临时组件 = 根 / "src" / "components" / "_testauto.js"
临时主题 = 根 / "src" / "bloom" / "themes" / "_testauto.js"

print("=" * 70)
print("验证：新增文件自动被发现（不需要登记）")
print("=" * 70)
print()

try:
    # ---- 1) 加临时组件 ----
    print("【1】加一个组件文件，不做任何登记")
    临时组件.write_text('''register({
  id: '_testauto', name: '自动发现测试', w: 111, h: 222, group: '内容',
  desc: '临时测试组件',
  绘制: function (g, w, h) { g.fillStyle = '#f00'; g.fillRect(0, 0, w, h); },
});
''', encoding="utf-8")
    print("    已写 src/components/_testauto.js")

    r = subprocess.run([sys.executable, str(根 / "preview" / "build_gui.py")],
                       capture_output=True, text=True, encoding="utf-8",
                       cwd=str(根))
    断言("重建成功", '"状态": "完成"' in (r.stdout or ""),
         (r.stdout or "")[-200:])

    html = (根 / "preview" / "gui_prototype.html").read_text(encoding="utf-8")
    断言("新组件自动出现在产物里", "_testauto" in html)
    print()

    # ---- 2) 加临时主题 ----
    print("【2】加一个主题文件，不做任何登记")
    临时主题.write_text('''(function () {
  BLOOM._testauto = {
    绘制: function (g, t, w, h, P) {},
  };
})();
''', encoding="utf-8")
    print("    已写 src/bloom/themes/_testauto.js")

    r = subprocess.run([sys.executable, str(根 / "preview" / "build_gui.py")],
                       capture_output=True, text=True, encoding="utf-8",
                       cwd=str(根))
    断言("重建成功", '"状态": "完成"' in (r.stdout or ""))

    html = (根 / "preview" / "gui_prototype.html").read_text(encoding="utf-8")
    断言("新主题自动出现在产物里", "BLOOM._testauto" in html)
    print()

    # ---- 3) 数量正确 ----
    print("【3】数量")
    import re
    注册 = re.findall(r"register\(\{\s*id:\s*'(\w+)'", html)
    断言("组件 13 个（12 + 临时）", len(注册) == 13, len(注册))
    主题 = re.findall(r"BLOOM\.(\w+)", html)
    主题 = set(主题)
    断言("主题 9 个（8 + 临时）", len(主题) == 9, len(主题))
    print()

finally:
    # 清理
    print("【4】清理临时文件")
    for f in (临时组件, 临时主题):
        if f.is_file():
            f.unlink()
            print("    已删 %s" % f.name)
    r = subprocess.run([sys.executable, str(根 / "preview" / "build_gui.py")],
                       capture_output=True, text=True, encoding="utf-8",
                       cwd=str(根))
    html = (根 / "preview" / "gui_prototype.html").read_text(encoding="utf-8")
    断言("临时组件已从产物移除", "_testauto" not in html)
    import re
    注册 = re.findall(r"register\(\{\s*id:\s*'(\w+)'", html)
    断言("恢复 12 个组件", len(注册) == 12, len(注册))
    print()

print("=" * 70)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 70)
sys.exit(1 if 失败 else 0)
