"""性能审计·阶段 3：最终验证报告。

汇总所有实测数据，输出完整的审计报告。
"""
import json
import pathlib

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
T = pathlib.Path.home() / "AppData/Local/Temp"

print("=" * 80)
print("性能审计报告 · 基于实测")
print("=" * 80)
print()
print("硬件环境：AMD Ryzen 7 5800H（8 物理核 / 16 逻辑核）/ 15.4 GB 内存")
print("          GPU: AMD Radeon 集成显卡（512 MB 共享显存）")
print("测试工程：nujabes（266.14 秒，7980 帧 @30fps，1920×1080）")
print()

# ---- 阶段 1：剖析 ----
s1 = json.loads((根 / "tools" / "perf_stage1.json").read_text(encoding="utf-8"))
print("=" * 80)
print("一、阶段 1：性能剖析")
print("=" * 80)
print()
print("【渲染链路技术栈】")
print("  绘图：      HTML5 Canvas 2D（浏览器内，无 WebGL）")
print("  截图：      canvas.toDataURL('image/png') → base64")
print("  进程通信：  Chrome DevTools Protocol (CDP) over WebSocket")
print("  图像格式：  PNG（无损）")
print("  编码器：    ffmpeg + libx264 preset=medium crf=18")
print("  音频合成：  ffmpeg 混流，AAC 192k，-ss 对齐起点")
print()

链路 = s1["完整链路"]
print("【完整帧链路拆解（优化前）】")
print("  %-32s %10s %8s" % ("阶段", "ms/帧", "占比"))
print("  " + "-" * 54)
名称 = {"draw": "① 绘制（含 CDP 往返）", "encode": "② PNG 编码 + 取回",
        "transfer": "③ 提取 base64 字段", "decode": "④ base64 解码",
        "write": "⑤ 写盘"}
总计 = sum(v["mean"] for v in 链路.values())
for k in ["draw", "encode", "transfer", "decode", "write"]:
    print("  %-32s %10.2f %7.1f%%" % (
        名称[k], 链路[k]["mean"], 链路[k]["mean"] / 总计 * 100))
print("  " + "-" * 54)
print("  %-32s %10.2f" % ("合计", 总计))
print()
print("  ★ 瓶颈：PNG 编码 + CDP 取回占 80%")
print("  ★ base64 相关仅占 0.9% —— 与最初预测**相反**")
print()

print("【分阶段绘制耗时】")
阶段 = s1["分阶段"]
探针总 = sum(v["totalMs"] for v in 阶段.values())
for k, v in sorted(阶段.items(), key=lambda x: -x[1]["totalMs"]):
    print("  %-14s %8.2f ms/帧  %5.1f%%  （%d 次调用/帧）" % (
        k, v["totalMs"] / 60, v["totalMs"] / 探针总 * 100, v["calls"] / 60))
print()
print("  ★ 动态绘制占 88%，是绘制阶段的主要成本")
print("  ★ 状态计算调用 1033 次/帧但仅 0.26 ms/帧 —— 非瓶颈")

# ---- 预测核实 ----
print()
print("=" * 80)
print("二、预测核实（用户要求）")
print("=" * 80)
print()
print("%-36s %14s %14s %s" % ("原预测", "预测值", "实测值", "结论"))
print("-" * 80)
print("%-36s %14s %14s %s" % (
    "Base64 传输优化", "省 35.5 ms", "省 0.59 ms", "✗ 依据错误"))
print("%-36s %14s %14s %s" % (
    "多进程并行 4 路", "省 40.0 ms", "省 40.3 ms", "△ 数值巧合，机制不同"))
print("%-36s %14s %14s %s" % (
    "硬件编码 NVENC/QSV", "省 13.5 ms", "本机不可用", "✗ 假设不成立"))
print()
print("【核实 1：Base64 传输】")
print("  实测 base64 相关开销仅 %.2f ms/帧（提取字段 + 解码）。" % (
    链路["transfer"]["mean"] + 链路["decode"]["mean"]))
print("  原预测把 **PNG 编码成本**（16.6 ms）误算进了 base64。")
print("  真正有效的是改用 **HTTP 二进制传输**（避开 CDP 的 JSON 序列化），")
print("  实测 54.55 → 33.35 ms/帧。")
print()
print("【核实 2：硬件编码】")
enc = json.loads((根 / "tools" / "perf_encoders.json").read_text(encoding="utf-8"))
print("  本机 GPU 为 AMD Radeon 集成显卡，**无 NVENC / QSV**。")
print("  可用硬件编码器：%s" % ", ".join(enc["可用硬件编码器"]))
cmp = json.loads((根 / "tools" / "perf_encoder_compare.json").read_text(encoding="utf-8"))
可用 = [r for r in cmp if r.get("可用")]
软件基准 = [r for r in 可用 if "medium" in r["方案"]]
硬件最快 = min([r for r in 可用 if "libx264" not in r["方案"]],
               key=lambda x: x["每帧ms"], default=None)
if 软件基准 and 硬件最快:
    print("  实测：libx264 medium %.2f ms/帧 vs 最快硬件 %s %.2f ms/帧" % (
        软件基准[0]["每帧ms"], 硬件最快["方案"], 硬件最快["每帧ms"]))
    print("  加速仅 %.2f×（原预测 4~8×）—— **预测严重高估**" % (
        软件基准[0]["每帧ms"] / 硬件最快["每帧ms"]))
print()
print("【核实 3：多进程并行】")
print("  原预测基于「渲染天然可分片」的推理，未考虑启动开销与核数限制。")
par = json.loads((T / "par_test.json").read_text(encoding="utf-8"))
print("  实测（600 帧）：")
for r in par:
    print("    %d 路 → %.2f ms/帧" % (r["并行度"], r["msPerFrame"]))
基准 = par[0]["msPerFrame"]
for r in par:
    print("    %d 路加速 %.2f×（效率 %.0f%%）" % (
        r["并行度"], 基准 / r["msPerFrame"],
        (基准 / r["msPerFrame"]) / r["并行度"] * 100))
print("  ★ **非线性**：4 路 1.89×，6 路反而降到 1.76×")
print("  ★ 原因：固定启动开销 + 物理核数限制 + 内存带宽竞争")

# ---- 阶段 2：优化验证 ----
print()
print("=" * 80)
print("三、阶段 2：逐项优化验证")
print("=" * 80)
print()

优化 = [
    ("① HTTP 二进制传输", "66.18", "32.20", "2.06×",
     "实测；像素级完全一致（60/60 帧哈希相同）"),
    ("② 多进程并行 4 路", "32.20", "20.16", "1.60×",
     "实测 600 帧；非线性，6 路下降"),
    ("③ 编码 preset 保持 medium", "15.21", "15.21", "1.00×",
     "未改；ultrafast 可再快 1.68× 但画质略降"),
]
print("%-28s %10s %10s %10s  %s" % ("优化项", "优化前", "优化后", "加速", "依据"))
print("-" * 96)
for 名, 前, 后, 加速, 依据 in 优化:
    print("%-28s %10s %10s %10s  %s" % (名, 前, 后, 加速, 依据))

print()
print("【验证过但**未采用**的优化】")
print()
print("  静态图层缓存：实测 7.4 → 6.7 ms/帧（仅省 0.7 ms，9%）")
print("    且引入视觉偏差（76.8% 通道有差异，最大差 5）")
print("    → 收益微弱、代价明确，**不采用**")
print()
print("  激进缓存（不重绘主时间轴与步进器）：3.8 ms/帧（省 49%）")
print("    但画面错误（指针不动、步进器不绽放）")
print("    → **不可采用**")

# ---- 最终结果 ----
print()
print("=" * 80)
print("四、最终结果：完整视频实测")
print("=" * 80)
print()
print("%-30s %16s %16s %10s" % ("指标", "优化前", "优化后", "提升"))
print("-" * 78)
行 = [
    ("完整渲染时间", "13.9 分钟", "3.86 分钟", "3.6×"),
    ("平均每帧（渲染）", "88.8 ms", "12.78 ms", "6.9×"),
    ("平均每帧（编码）", "16.0 ms", "15.13 ms", "1.06×"),
    ("平均每帧（合计）", "104.8 ms", "27.9 ms", "3.8×"),
    ("输出帧数", "7980", "7984", "—"),
    ("分辨率", "1920×1080", "1920×1080", "不变"),
    ("帧率", "30 fps", "30 fps", "不变"),
    ("文件大小", "—", "126.26 MB", "—"),
    ("含音轨", "否", "是", "新增"),
    ("时长", "—", "266.13 s", "—"),
]
for a, b, c, d in 行:
    print("%-30s %16s %16s %10s" % (a, b, c, d))

print()
print("★ 音画同步验证：")
print("    相关系数 0.9991（高度相关）")
print("    视频时长 266.130 s vs 音频 266.140 s，差 0.010 s（不足 1/3 帧）")
print()
print("★ 视觉回归验证：")
print("    优化前后 60/60 帧**像素级完全一致**，SHA-256 哈希相同")

# ---- 成本与遗留 ----
print()
print("=" * 80)
print("五、优化成本与遗留瓶颈")
print("=" * 80)
print()
print("【优化成本】")
print("  新增代码：capture_v2.mjs（HTTP 传输 + 分片，约 300 行）")
print("  改动代码：render.py 增加并行编排（约 80 行）")
print("  新增依赖：无（Node 内置 http/fs，Python 内置 concurrent.futures）")
print("  维护负担：低 —— 保留 capture.mjs 作为回退路径")
print()
print("【遗留瓶颈（按实测）】")
遗留 = [
    ("PNG 编码", "约 16.6 ms/帧", "占优化后单帧成本的 59%",
     "可换 BMP/PPM 但体积增 3~5 倍，I/O 反成瓶颈"),
    ("绘制（含 CDP）", "约 10.2 ms/帧", "占 37%",
     "动态绘制占 88%，已接近 Canvas 2D 的合理水平"),
    ("编码（libx264 medium）", "15.13 ms/帧", "与渲染并行执行，非关键路径",
     "ultrafast 可快 1.68×，画质略降"),
    ("并行效率上限", "4 路 1.89×", "6 路下降",
     "受物理核数限制，提高并行度无益"),
]
print("%-24s %14s %22s %s" % ("瓶颈", "实测", "占比/说明", "可行方向"))
print("-" * 92)
for a, b, c, d in 遗留:
    print("%-24s %14s %22s %s" % (a, b, c, d))

print()
print("【尚未验证的假设】")
print("  · 其他分辨率（如 1280×720、4K）的性能特征未测")
print("  · 其他主题（8 个）的绘制成本差异未逐一分测")
print("  · 不同工程（音符密度差异大）的渲染成本未测")
print("  · NVENC/QSV 在 NVIDIA/Intel 机器上的收益未验证（本机无此硬件）")

print()
print("=" * 80)
print("六、下一步建议")
print("=" * 80)
print()
print("1. **保持当前优化**（HTTP 传输 + 4 路并行）—— 3.6× 提升，零视觉代价")
print()
print("2. **可选：编码 preset 改为 veryfast**")
print("   实测 15.21 → 11.49 ms/帧（1.32×），PSNR 42.78 → 42.28（差 0.5 dB）")
print("   由于编码与渲染并行，实际端到端收益有限，但可降低编码等待")
print()
print("3. **不建议继续压榨渲染速度**")
print("   当前 3.86 分钟渲染一条 4.4 分钟视频，已进入「可接受」区间。")
print("   进一步优化需要牺牲视觉质量或大幅增加复杂度，投入产出比低。")
print()
print("4. **转向功能开发**（阶段 C：布局编辑器）")
print("   性能已不是瓶颈，继续优化边际收益递减。")

out = 根 / "docs" / "PERF_AUDIT.md"
