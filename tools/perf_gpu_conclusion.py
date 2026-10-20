"""GPU 与渲染速度的关系：完整结论。

数据来源：
  · tools/perf_gpu_raster.mjs（GPU 光栅化对比，实测）
  · tools/perf_nvenc_check.py / perf_nvenc_diag.py（NVENC 诊断，实测）
  · tools/perf_encoder_compare.json（编码器对比，实测）
  · docs/PERF_AUDIT.md（完整视频实测）
"""
import json
import pathlib

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")

print("=" * 80)
print("GPU 与渲染速度：实测结论")
print("=" * 80)
print()

# ---- 1. GPU 光栅化 ----
print("【1】GPU 光栅化对**绘制**的影响（实测）")
print()
数据 = {
    "nogpu（当前）": {"draw": 10.3, "p95": 163.4, "png": 17.7,
                     "renderer": "Microsoft Basic Render Driver（软件光栅化）"},
    "gpu（启用独显/核显）": {"draw": 9.8, "p95": 23.2, "png": 21.7,
                          "renderer": "AMD Radeon Graphics（硬件）"},
    "swiftshader（软件 Vulkan）": {"draw": 8.5, "p95": 154.7, "png": 17.3,
                                  "renderer": "SwiftShader（CPU 模拟）"},
}
print("%-26s %10s %10s %10s" % ("模式", "绘制中位", "绘制P95", "PNG中位"))
print("-" * 62)
for k, v in 数据.items():
    print("%-26s %10.2f %10.1f %10.2f" % (k, v["draw"], v["p95"], v["png"]))
print()
print("  绘制中位数几乎相同（8.5~10.3 ms）—— GPU 对**中位绘制**帮助很小")
print("  但 P95 差异巨大：")
print("    nogpu       P95 = 163.4 ms  ← 有严重卡顿尖峰")
print("    gpu         P95 =  23.2 ms  ← 尖峰消失")
print("    swiftshader P95 = 154.7 ms  ← 同样有尖峰")
print()
print("  ★ 重要发现：启用 GPU 后 **P95 从 163 ms 降到 23 ms**（7 倍改善）")
print("     中位数没变，但**卡顿消失**。这对整体吞吐可能有影响，")
print("     因为尖峰帧会拖慢流水线。")
print()
print("  ★ 但 PNG 编码反而变慢（17.7 → 21.7 ms）：")
print("     硬件光栅化的画布需要回读到 CPU 才能编码 PNG，")
print("     这个回读有成本。")
print()
print("  → 净效果需实测端到端，不能只看单项。")

# ---- 2. NVENC ----
print()
print("=" * 80)
print("【2】GTX 1650 的 NVENC 状态（实测诊断）")
print("=" * 80)
print()
print("  硬件存在：NVIDIA GeForce GTX 1650，4 GB，驱动 471.96，CUDA 11.4")
print("  ffmpeg 编译了 h264_nvenc / hevc_nvenc / av1_nvenc")
print()
print("  但调用失败，ffmpeg 报错原文：")
print("    Driver does not support the required nvenc API version.")
print("    Required: 12.2  Found: (空)")
print("    The minimum required Nvidia driver for nvenc is 551.76 or newer")
print()
print("  ★ 原因明确：**驱动版本过低**")
print("     当前 471.96 → 需要 551.76+（NVENC API 12.2）")
print()
print("  说明：ffmpeg 7.1（imageio-ffmpeg 自带）编译时链接了较新的")
print("        NVENC SDK，要求较新的驱动。这是 ffmpeg 与驱动的版本匹配问题，")
print("        不是显卡不支持。GTX 1650（TU117）本身支持 NVENC H.264/HEVC。")

# ---- 3. 收益推算 ----
print()
print("=" * 80)
print("【3】升级驱动后的收益推算")
print("=" * 80)
print()
总耗时 = 230.98
总帧数 = 7984
渲染每帧 = 12.78
编码每帧 = 15.13
渲染秒 = 渲染每帧 * 总帧数 / 1000
编码秒 = 编码每帧 * 总帧数 / 1000

print("  当前完整视频 %.2f 分钟 = 渲染 %.1f 秒 + 编码 %.1f 秒" % (
    总耗时 / 60, 渲染秒, 编码秒))
print("  （渲染与编码**串行**执行）")
print()
print("  若 NVENC 达到以下速度：")
print()
print("  %-24s %10s %12s %12s" % ("场景", "编码ms/帧", "总耗时分", "提升"))
print("  " + "-" * 62)
for 名, 每帧 in [("乐观", 3.0), ("中性", 5.0), ("保守", 8.0)]:
    总 = 渲染秒 + 每帧 * 总帧数 / 1000
    print("  %-24s %10.1f %12.2f %11.2f×" % (名, 每帧, 总 / 60, 总耗时 / 总))
print("  %-24s %10.2f %12.2f %11s" % ("当前（libx264 medium）", 编码每帧,
                                      总耗时 / 60, "1.00×"))
print()
print("  ★ 即便编码快到 0 秒（不可能），下限是渲染的 %.2f 分钟" % (渲染秒 / 60))

# ---- 4. 真正瓶颈 ----
print()
print("=" * 80)
print("【4】真正的主要瓶颈（按优化后实测）")
print("=" * 80)
print()
print("  单帧成本构成（渲染侧，单路）：")
print("    ① PNG 编码（浏览器内）    约 16.6 ms   49%   ← 渲染侧最大")
print("    ② 绘制（含 CDP 往返）     约 10.2 ms   30%")
print("    ③ 帧传输（HTTP 二进制）    约  5.5 ms   16%")
print("    ④ 写盘                   约  1.9 ms    6%")
print("    ────────────────────────────────────────────")
print("    渲染侧合计               约 34.2 ms（4 路并行后有效值 12.8 ms）")
print()
print("  整体：")
print("    渲染（已并行）  %.1f 秒   46%%" % 渲染秒)
print("    视频编码（串行）%.1f 秒   54%%   ← 整体最大单项" % 编码秒)
print()
print("  ★ 结论：")
print("     · **视频编码**是当前整体最大的单项（54%），GPU 能帮上忙")
print("     · **PNG 编码**是渲染侧最大瓶颈（49%），GPU **帮不上**")
print("       原因：toBlob 是浏览器内部实现，无法接入外部 GPU 编码器")
print("     · **绘制**只占 30%，且 GPU 对中位耗时帮助很小")

# ---- 5. 与硬件的关系 ----
print()
print("=" * 80)
print("【5】渲染速度与硬件的关系")
print("=" * 80)
print()
print("  %-28s %-14s %s" % ("环节", "受什么影响", "说明"))
print("  " + "-" * 76)
行 = [
    ("绘制", "CPU 单核 + 浏览器", "Canvas 2D 逐指令执行；GPU 只改善尖峰"),
    ("PNG 编码", "CPU 单核", "zlib 压缩在浏览器主线程；无法外接 GPU"),
    ("帧传输", "内存带宽 + 进程", "HTTP 本地回环，受 CPU 影响"),
    ("写盘", "磁盘", "SSD 上成本低；HDD 上会明显变慢"),
    ("视频编码", "CPU 多核 或 GPU", "libx264 吃多核；NVENC 吃 GPU"),
    ("并行渲染", "物理核数", "8 核后收益递减（实测 4 路最优）"),
]
for a, b, c in 行:
    print("  %-28s %-14s %s" % (a, b, c))
print()
print("  ★ 总体判断：")
print("     · 当前流程**主要吃 CPU**，GPU 只在视频编码环节有用")
print("     · 升级驱动启用 NVENC，预计可把 3.85 分钟降到 2.4~2.8 分钟")
print("     · 但要再往下压，瓶颈会回到 PNG 编码（纯 CPU）")
print()
print("  ★ 若换更强的 CPU（更多物理核）：")
print("     · 并行渲染可提高（当前 8 核 → 16 核理论可到 2×）")
print("     · PNG 编码与 x264 编码也会变快")
print("     · 这是比 GPU 更直接的提速手段")

# ---- 6. 建议 ----
print()
print("=" * 80)
print("【6】建议")
print("=" * 80)
print()
print("  值得做（低成本、明确收益）：")
print("    1. 升级 NVIDIA 驱动到 551.76+，启用 NVENC")
print("       预期：3.85 → 2.4~2.8 分钟（省 28~38%）")
print("       风险：低。ffmpeg 已编译 nvenc，驱动升级后即可用")
print("       注：GTX 1650 是单编码单元版本，速度不及桌面高端卡")
print()
print("    2. 测试启用 GPU 光栅化（去掉 --disable-gpu）")
print("       实测 P95 从 163 → 23 ms，尖峰消失")
print("       但 PNG 编码变慢 4 ms，**净效果需端到端实测**")
print()
print("  不值得做：")
print("    3. 试图用 GPU 加速 PNG 编码 —— 浏览器不开放此接口")
print("    4. 提高并行度超过 4 路 —— 实测 6 路反而下降")
print()
print("  若要进一步提速，方向是：")
print("    · 跳过 PNG（直接传原始像素或 BMP），但 I/O 会成新瓶颈")
print("    · 或改变架构（如用 WebGL 渲染 + 直接读回 GPU 缓冲）")
print("      但这会大幅增加复杂度，当前 3.85 分钟已可接受")
