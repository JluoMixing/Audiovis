"""用可靠方法验证 exe 内嵌图标。

## 上次为什么失败

我用 `EnumResourceNamesW` + 回调里比较 `lpszType == 14`，
但 `lpszType` 是资源类型指针（MAKEINTRESOURCE 的整数），
ctypes 回调签名写成 `c_void_p` 后比较不可靠 —— 这是我脚本的问题，
不一定是 exe 没图标。

## 改用 ExtractIconExW

Windows 官方 API，直接返回 exe 里的图标数量与句柄。
可靠、简单。
"""
import ctypes
import pathlib
import struct

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
exe = 根 / "dist" / "Audiovis" / "Audiovis.exe"
ico = 根 / "assets" / "icon" / "audiovis.ico"

print("=" * 70)
print("验证 exe 内嵌图标")
print("=" * 70)
print()

u32 = ctypes.windll.user32
shell32 = ctypes.windll.shell32

# ---- 1) ExtractIconEx：数 exe 里有多少个图标 ----
print("【1】ExtractIconExW 枚举图标")
n = shell32.ExtractIconExW(str(exe), -1, None, None, 0)
print("  exe 内图标数量: %d" % n)

大 = (ctypes.c_void_p * max(1, n))()
小 = (ctypes.c_void_p * max(1, n))()
if n > 0:
    取 = shell32.ExtractIconExW(str(exe), 0, 大, 小, n)
    print("  取到: %d 个大图标 / %d 个小图标" % (取, 取))
    for i in range(min(n, 8)):
        print("    #%d 大=%s 小=%s" % (i, bool(大[i]), bool(小[i])))
    # 释放
    for h in list(大) + list(小):
        if h:
            u32.DestroyIcon(h)

print()

# ---- 2) 直接解析 PE 资源表（更底层，看真实尺寸）----
print("【2】解析 exe 的 RT_GROUP_ICON 资源")


def 读pe资源(路径):
    """极简 PE 资源解析：找 RT_GROUP_ICON 的条目。"""
    data = pathlib.Path(路径).read_bytes()

    # DOS header → PE offset
    if data[:2] != b"MZ":
        raise ValueError("不是 PE 文件")
    pe_off = struct.unpack("<I", data[0x3C:0x40])[0]
    if data[pe_off:pe_off + 4] != b"PE\0\0":
        raise ValueError("PE 签名错误")

    coff = pe_off + 4
    num_sections = struct.unpack("<H", data[coff + 2:coff + 4])[0]
    opt_size = struct.unpack("<H", data[coff + 16:coff + 18])[0]
    opt_off = coff + 20
    magic = struct.unpack("<H", data[opt_off:opt_off + 2])[0]

    if magic == 0x20B:      # PE32+
        res_rva_off = opt_off + 108
    else:                    # PE32
        res_rva_off = opt_off + 96
    res_rva = struct.unpack("<I", data[res_rva_off:res_rva_off + 4])[0]
    if res_rva == 0:
        return []

    # section table
    sec_off = opt_off + opt_size
    节 = []
    for i in range(num_sections):
        o = sec_off + i * 40
        name = data[o:o + 8].rstrip(b"\0").decode("latin1")
        vsize, vaddr, rawsize, rawptr = struct.unpack(
            "<IIII", data[o + 8:o + 24])
        节.append((name, vaddr, vsize, rawptr, rawsize))

    def rva2off(rva):
        for name, va, vs, rp, rs in 节:
            if va <= rva < va + max(vs, rs):
                return rp + (rva - va)
        return None

    def 读资源目录(rva, 层=0, 结果=None):
        if 结果 is None:
            结果 = []
        off = rva2off(rva)
        if off is None:
            return 结果
        # IMAGE_RESOURCE_DIRECTORY: 16 bytes
        n_named, n_id = struct.unpack("<HH", data[off + 12:off + 16])
        total = n_named + n_id
        for i in range(total):
            e = off + 16 + i * 8
            name_id, off_field = struct.unpack("<II", data[e:e + 8])
            if name_id == 14 and 层 == 0:      # RT_GROUP_ICON
                if off_field & 0x80000000:      # 子目录
                    读资源目录(rva + (off_field & 0x7FFFFFFF), 层 + 1, 结果)
            elif 层 == 1 and (off_field & 0x80000000):
                读资源目录(rva + (off_field & 0x7FFFFFFF), 层 + 1, 结果)
            elif 层 == 2 and not (off_field & 0x80000000):
                # IMAGE_RESOURCE_DATA_ENTRY
                de = rva2off(rva + off_field)
                if de is not None:
                    data_rva, data_size = struct.unpack(
                        "<II", data[de:de + 8])
                    结果.append((data_rva, data_size))
        return 结果

    条目 = 读资源目录(res_rva)
    return [(rva2off(r), s) for r, s in 条目 if rva2off(r)]


try:
    组 = 读pe资源(exe)
    print("  RT_GROUP_ICON 数据条目: %d" % len(组))
    for off, size in 组:
        原始 = exe.read_bytes()[off:off + size]
        if len(原始) >= 6:
            _, 类型, 数量 = struct.unpack("<HHH", 原始[:6])
            尺寸 = []
            for i in range(数量):
                o = 6 + i * 14
                if o + 14 > len(原始):
                    break
                w, hh = struct.unpack("<BB", 原始[o:o + 2])
                尺寸.append(w or 256)
            print("    类型=%d 数量=%d 尺寸=%s"
                  % (类型, 数量, sorted(set(尺寸))))
except Exception as e:
    print("  ⚠ 解析失败: %s" % e)
print()

# ---- 3) 对照源 ICO ----
print("【3】源 ICO 对照")
from PIL import Image
im = Image.open(ico)
print("  %s: %s" % (ico.name, sorted(im.info.get("sizes", set()))))
print()

# ---- 4) 结论 ----
print("=" * 70)
if n > 0:
    print("结论：exe 内嵌了 %d 个图标 —— 图标已正确打包。" % n)
    print()
    print("上次脚本报「图标组数 0」是我的 ctypes 回调写法有问题，")
    print("不是打包失败。")
else:
    print("结论：exe 里没有图标 —— 需要检查 spec。")
print("=" * 70)
