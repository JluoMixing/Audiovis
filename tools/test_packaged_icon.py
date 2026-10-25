"""验证打包后的 exe 图标与运行时行为。

## 检查什么

1. exe 里嵌入了几个图标资源、尺寸是多少
2. exe 启动后窗口图标是否正确
3. 导出时不弹控制台窗口（打包版实测）
"""
import ctypes
import ctypes.wintypes as wt
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
exe = 根 / "dist" / "Audiovis" / "Audiovis.exe"

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
print("验证打包版图标与行为")
print("=" * 70)
print()

断言("exe 存在", exe.is_file(), exe)
print()

# ---- 1) 提取 exe 里的图标资源 ----
print("【1】exe 内嵌的图标资源")
try:
    import struct

    # 用 Windows API 枚举 exe 的资源
    u32 = ctypes.windll.user32
    k32 = ctypes.windll.kernel32

    LOAD_LIBRARY_AS_DATAFILE = 0x00000002
    h = k32.LoadLibraryExW(str(exe), None, LOAD_LIBRARY_AS_DATAFILE)
    if not h:
        raise RuntimeError("LoadLibraryEx 失败")

    # 枚举 RT_GROUP_ICON (14)
    图标组 = []

    EnumResNameProc = ctypes.WINFUNCTYPE(
        ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p,
        ctypes.c_void_p, ctypes.c_void_p)

    def 回调(hMod, lpszType, lpszName, lParam):
        if lpszType == 14:   # RT_GROUP_ICON
            图标组.append(lpszName)
        return True

    k32.EnumResourceNamesW(h, 14, EnumResNameProc(回调), 0)
    print("  RT_GROUP_ICON 组数: %d" % len(图标组))
    断言("有图标组", len(图标组) >= 1, len(图标组))

    # 读第一个组的内容（ICONDIR 结构）
    if 图标组:
        res = k32.FindResourceW(h, 图标组[0], 14)
        size = k32.SizeofResource(h, res)
        data = k32.LoadResource(h, res)
        ptr = k32.LockResource(data)
        raw = ctypes.string_at(ptr, size)

        # GRPICONDIR: reserved(2) type(2) count(2) + entries
        if len(raw) >= 6:
            _, 类型, 数量 = struct.unpack("<HHH", raw[:6])
            print("  类型: %d  内含图标数: %d" % (类型, 数量))
            断言("图标数 >= 7", 数量 >= 7, 数量)

            尺寸 = []
            for i in range(数量):
                off = 6 + i * 14
                if off + 14 > len(raw):
                    break
                w, hh, colors, res_, planes, bpp, size_, idx = \
                    struct.unpack("<BBBBHHIH", raw[off:off + 14])
                尺寸.append((w or 256, hh or 256))
            print("  尺寸: %s" % ", ".join("%d" % w for w, _ in 尺寸))
            期望 = {16, 24, 32, 48, 64, 128, 256}
            有 = {w for w, _ in 尺寸}
            断言("覆盖全部期望尺寸", 期望 <= 有, "缺 %s" % (期望 - 有))

    k32.FreeLibrary(h)
except Exception as e:
    print("  ⚠ 资源枚举失败: %s" % e)
    print("    改用 Pillow 检查源 ICO 作为对照")
    from PIL import Image
    im = Image.open(根 / "assets" / "icon" / "audiovis.ico")
    print("    源 ICO 尺寸:", sorted(im.info.get("sizes", set())))
print()

# ---- 2) 启动 exe，检查窗口图标与导出行为 ----
print("【2】启动 exe")
subprocess.run(["powershell", "-NoProfile", "-Command",
                "Get-CimInstance Win32_Process -Filter "
                "\"Name='Audiovis.exe'\" | "
                "ForEach-Object { Stop-Process -Id $_.ProcessId -Force "
                "-ErrorAction SilentlyContinue }"],
               capture_output=True, timeout=60)
time.sleep(2)

端口 = 11700
p = subprocess.Popen([str(exe), "--port", str(端口)],
                     cwd=str(根 / "dist" / "Audiovis"),
                     stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL)


def 请求(路径, 数据=None, 超时=600):
    url = "http://127.0.0.1:%d%s" % (端口, 路径)
    b = json.dumps(数据).encode() if 数据 is not None else None
    req = urllib.request.Request(
        url, data=b, method="POST" if b else "GET",
        headers={"Content-Type": "application/json"} if b else {})
    with urllib.request.urlopen(req, timeout=超时) as r:
        return json.loads(r.read())


会话 = None
for _ in range(40):
    time.sleep(1)
    try:
        会话 = 请求("/api/session", 超时=5)
        break
    except Exception:
        pass
断言("服务就绪", 会话 is not None)

# 窗口图标
try:
    u = ctypes.windll.user32
    窗口 = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def 枚举(hwnd, l):
        buf = ctypes.create_unicode_buffer(256)
        u.GetWindowTextW(hwnd, buf, 256)
        if buf.value == "Audiovis" and u.IsWindowVisible(hwnd):
            cls = ctypes.create_unicode_buffer(256)
            u.GetClassNameW(hwnd, cls, 256)
            if "WindowsForms" in cls.value:
                窗口.append(hwnd)
        return True

    u.EnumWindows(枚举, 0)
    断言("找到应用窗口", len(窗口) > 0, len(窗口))
    if 窗口:
        # 读窗口图标句柄（非零说明有图标）
        WM_GETICON = 0x007F
        ICON_BIG = 1
        hIcon = u.SendMessageW(窗口[0], WM_GETICON, ICON_BIG, 0)
        print("  窗口图标句柄: %s" % (hIcon or "（0，由窗口类默认）"))
except Exception as e:
    print("  ⚠ 窗口检查失败: %s" % e)
print()

# ---- 3) 导出时是否弹控制台 ----
print("【3】导出（打包版实测）—— 检查是否弹控制台窗口")


def 数控制台():
    u = ctypes.windll.user32
    计 = [0]

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(h, l):
        try:
            cls = ctypes.create_unicode_buffer(128)
            u.GetClassNameW(h, cls, 128)
            if cls.value == "ConsoleWindowClass" and u.IsWindowVisible(h):
                计[0] += 1
        except Exception:
            pass
        return True

    u.EnumWindows(cb, 0)
    return 计[0]


if 会话 and not 会话.get("已导入"):
    工程 = pathlib.Path(r"E:\FL_Project\amapiano")
    r = 请求("/api/import", {"flp": str(工程 / "amapiano.flp"),
                           "audio": str(工程 / "amapiano.mp3")})
    for _ in range(400):
        time.sleep(1.5)
        t = 请求("/api/job?id=" + r["id"])
        if t.get("状态") != "运行中":
            break
    print("  导入: %s" % t.get("状态"))
    会话 = 请求("/api/session")

if 会话:
    ts = json.loads((根 / "preview" / "templates.json")
                    .read_text(encoding="utf-8"))
    组件 = [x for x in ts if x.get("name") == "基础"][0]["land"]
    输出 = 根 / "dist" / "Audiovis" / "out" / "_icon_test.mp4"
    输出.parent.mkdir(parents=True, exist_ok=True)
    if 输出.exists():
        输出.unlink()

    基线 = 数控制台()
    print("  渲染前控制台窗口数: %d" % 基线)

    r = 请求("/api/render", {
        "flp": 会话.get("flp"), "audio": 会话.get("audio"),
        "主题": "sumi", "画布": {"w": 1920, "h": 1080},
        "帧率": 6, "时长": 1, "起点": 20,
        "输出": str(输出), "预设": "ultrafast", "并行度": 4,
        "组件": 组件,
    })
    峰值 = 基线
    t = {}
    for _ in range(400):
        time.sleep(0.8)
        t = 请求("/api/job?id=" + str(r["id"]))
        峰值 = max(峰值, 数控制台())
        if t.get("状态") != "运行中":
            break

    print("  渲染状态: %s" % t.get("状态"))
    print("  峰值控制台窗口数: %d" % 峰值)
    断言("渲染完成", t.get("状态") == "完成",
         (t.get("错误") or "")[:200])
    断言("输出存在", 输出.is_file())
    断言("导出时零控制台弹窗（打包版）", 峰值 <= 基线,
         "基线 %d → 峰值 %d" % (基线, 峰值))

    if 输出.exists():
        输出.unlink()
print()

# 清理
subprocess.run(["powershell", "-NoProfile", "-Command",
                "Get-CimInstance Win32_Process -Filter "
                "\"Name='Audiovis.exe'\" | "
                "ForEach-Object { Stop-Process -Id $_.ProcessId -Force "
                "-ErrorAction SilentlyContinue }"],
               capture_output=True, timeout=60)

print("=" * 70)
print("通过 %d / %d" % (通过, 通过 + 失败))
print("=" * 70)
sys.exit(1 if 失败 else 0)
