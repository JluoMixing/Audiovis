"""验证对话框改造：结构正确、可调用、不弹窗。

模态对话框不能真的弹（会阻塞），故只做结构验证：
  · OPENFILENAMEW 的大小符合 Win32 定义（x64 应为 152 字节）
  · comdlg32 的两个函数可解析
  · 选文件() 存在且能导入
"""
import ast
import ctypes
import pathlib
import sys

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
sys.path.insert(0, str(根))

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
print("文件对话框改造验证")
print("=" * 70)
print()

s = (根 / "app_server.py").read_text(encoding="utf-8")

print("【1】代码结构")
断言("不再用 sys.executable 跑对话框",
     "sys.executable, \"-c\", 对话框脚本" not in s)
断言("有 _原生对话框", "def _原生对话框(" in s)
断言("有 选文件", "def 选文件(" in s)
# tkinter 回退已主动移除：它依赖 sys.executable -c 跑脚本，
# 打包后 sys.executable 是 exe，会重启一个实例而不是弹对话框。
断言("不再依赖 tkinter 子进程", "对话框脚本" not in s)
print()

print("【2】Win32 结构体（x64 下 OPENFILENAMEW 应为 152 字节）")
from ctypes import wintypes

class OPENFILENAMEW(ctypes.Structure):
    _fields_ = [
        ("lStructSize", wintypes.DWORD),
        ("hwndOwner", wintypes.HWND),
        ("hInstance", wintypes.HINSTANCE),
        ("lpstrFilter", wintypes.LPCWSTR),
        ("lpstrCustomFilter", wintypes.LPWSTR),
        ("nMaxCustFilter", wintypes.DWORD),
        ("nFilterIndex", wintypes.DWORD),
        ("lpstrFile", wintypes.LPWSTR),
        ("nMaxFile", wintypes.DWORD),
        ("lpstrFileTitle", wintypes.LPWSTR),
        ("nMaxFileTitle", wintypes.DWORD),
        ("lpstrInitialDir", wintypes.LPCWSTR),
        ("lpstrTitle", wintypes.LPCWSTR),
        ("Flags", wintypes.DWORD),
        ("nFileOffset", wintypes.WORD),
        ("nFileExtension", wintypes.WORD),
        ("lpstrDefExt", wintypes.LPCWSTR),
        ("lCustData", wintypes.LPARAM),
        ("lpfnHook", wintypes.LPVOID),
        ("lpTemplateName", wintypes.LPCWSTR),
        ("pvReserved", wintypes.LPVOID),
        ("dwReserved", wintypes.DWORD),
        ("FlagsEx", wintypes.DWORD),
    ]

大小 = ctypes.sizeof(OPENFILENAMEW)
print("    实测 sizeof = %d 字节" % 大小)
断言("结构体大小符合 Win32 定义（152）", 大小 == 152, 大小)
print()

print("【3】comdlg32 函数可解析")
try:
    f1 = ctypes.windll.comdlg32.GetOpenFileNameW
    f2 = ctypes.windll.comdlg32.GetSaveFileNameW
    断言("GetOpenFileNameW 可用", f1 is not None)
    断言("GetSaveFileNameW 可用", f2 is not None)
except Exception as e:
    断言("comdlg32 可加载", False, e)
print()

print("【4】模块导入与函数存在")
try:
    import app_server
    断言("app_server 可导入", True)
    断言("选文件 是函数", callable(getattr(app_server, "选文件", None)))
    断言("_原生对话框 是函数",
         callable(getattr(app_server, "_原生对话框", None)))
except Exception as e:
    断言("app_server 可导入", False, e)
print()

print("=" * 70)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 70)
sys.exit(1 if 失败 else 0)
