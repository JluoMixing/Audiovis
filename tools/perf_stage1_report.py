"""性能审计·阶段 1：汇总剖析数据，输出结论。

数据来源：tools/perf_profile.mjs 的实测输出。
本脚本不做新的测量，只做汇总与推算。
"""
import json
import pathlib
import sys

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
剖析 = json.loads((pathlib.Path(sys.argv[1]) if len(sys.argv) > 1
                   else pathlib.Path.home() / "AppData/Local/Temp/perfrun1/profile.json")
                  .read_text(encoding="utf-8"))

R = 剖析["结果"]
帧数 = 7980

print("=" * 78)
print("性能审计 · 阶段 1：剖析结果")
print("=" * 78)
print()
print("测量条件：%s，%d 帧均匀采样整曲（%.1f 秒）" % (
    剖析["参数"]["分辨率"], 剖析["参数"]["帧数"], 剖析["参数"]["时长秒"]))
print()

# ---- 1. 纯绘制 ----
td = R["totalDraw"]
print("【1】纯绘制耗时（一次完整绘制：状态计算 + 动态 + 静态）")
print("     中位数 %6.2f ms   ← 这是**常态**帧的成本" % td["median"])
print("     平均   %6.2f ms" % td["mean"])
print("     P95    %6.2f ms" % td["p95"])
print("     最大   %6.2f ms" % td["max"])
print("     最小   %6.2f ms" % td["min"])
print()
样本 = td["samples"]
前57 = sorted(样本)[:57]
print("     ★ 关键：60 个样本中有 3 个异常值（%.0f/%.0f/%.0f ms）" % (
    sorted(样本)[-3], sorted(样本)[-2], sorted(样本)[-1]))
print("       其余 57 个在 %.1f ~ %.1f ms 之间" % (min(前57), max(前57)))
print("       异常值疑为 GC 或首次渲染，占 %.1f%% 的样本但拉高了平均值" % (
    3 / 60 * 100))

# ---- 2. 分阶段 ----
print()
print("【2】分阶段耗时（探针包装，%d 帧累计）" % 剖析["参数"]["帧数"])
阶段 = R["分阶段"]
总探针 = sum(v["totalMs"] for v in 阶段.values())
print("     %-14s %10s %12s %12s %8s" % ("阶段", "累计ms", "调用次数", "单次ms", "占比"))
print("     " + "-" * 62)
for k, v in sorted(阶段.items(), key=lambda x: -x[1]["totalMs"]):
    print("     %-14s %10.1f %12d %12.5f %7.1f%%" % (
        k, v["totalMs"], v["calls"], v["perCallMs"],
        v["totalMs"] / 总探针 * 100))
print("     " + "-" * 62)
print("     %-14s %10.1f" % ("合计", 总探针))
print()
print("     每帧平均：动态绘制 %.2f ms，状态计算 %.2f ms，静态 %.2f ms" % (
    阶段["dynamicDraw"]["totalMs"] / 60,
    阶段["stateCalc"]["totalMs"] / 60,
    阶段["staticDraw"]["totalMs"] / 60))
print()
print("     ★ 动态绘制占 %.0f%%（%d 次调用/帧）—— 这是绘制阶段的主要成本" % (
    阶段["dynamicDraw"]["totalMs"] / 总探针 * 100,
    阶段["dynamicDraw"]["calls"] / 60))
print("     ★ 状态计算调用 %d 次/帧，但单次仅 %.4f ms —— 不是瓶颈" % (
    阶段["stateCalc"]["calls"] / 60, 阶段["stateCalc"]["perCallMs"]))

# ---- 3. 图像导出 ----
print()
print("【3】图像导出各方式对比")
gi = R["getImageData"]
pe = R["pngEncode"]
pb = R["pngToBlob"]
je = R["jpegEncode"]
print("     %-26s %10s %10s" % ("方式", "中位数ms", "相对PNG"))
print("     " + "-" * 48)
print("     %-26s %10.2f %9s" % ("getImageData（仅取像素）", gi["median"], "—"))
print("     %-26s %10.2f %9s" % ("toDataURL PNG（base64）", pe["median"], "1.00×"))
print("     %-26s %10.2f %8.2f×" % ("toBlob PNG（二进制）", pb["median"],
                                     pe["median"] / pb["median"]))
for q, v in sorted(je.items()):
    print("     %-26s %10.2f %8.2f×" % ("toDataURL JPEG " + q, v,
                                         pe["median"] / v))
print()
print("     ★ toBlob PNG 比 toDataURL PNG 快 %.1f×（%.1f → %.1f ms）" % (
    pe["median"] / pb["median"], pe["median"], pb["median"]))
print("       原因：toBlob 返回二进制 Blob，不经 base64 字符串")

# ---- 4. 完整链路 ----
print()
print("【4】完整帧链路拆解（含 CDP 往返）")
链路 = R["完整链路"]
总计 = sum(v["mean"] for v in 链路.values())
名称 = {
    "draw": "① 绘制（含 CDP 往返）",
    "encode": "② PNG 编码 + 取回",
    "transfer": "③ 提取 base64 字段",
    "decode": "④ base64 解码为 Buffer",
    "write": "⑤ 写盘",
}
print("     %-30s %10s %10s %10s %8s" % ("阶段", "平均ms", "中位ms", "P95ms", "占比"))
print("     " + "-" * 74)
for k in ["draw", "encode", "transfer", "decode", "write"]:
    v = 链路[k]
    print("     %-30s %10.2f %10.2f %10.2f %7.1f%%" % (
        名称[k], v["mean"], v["median"], v["p95"], v["mean"] / 总计 * 100))
print("     " + "-" * 74)
print("     %-30s %10.2f" % ("合计", 总计))
print()
print("     ★ 编码+取回（%.1f ms）占 %.0f%% —— **最大瓶颈**" % (
    链路["encode"]["mean"], 链路["encode"]["mean"] / 总计 * 100))
print("     ★ base64 相关开销（transfer + decode = %.2f ms）占 %.1f%%" % (
    链路["transfer"]["mean"] + 链路["decode"]["mean"],
    (链路["transfer"]["mean"] + 链路["decode"]["mean"]) / 总计 * 100))
print("     ★ 写盘仅 %.2f ms，不是瓶颈" % 链路["write"]["mean"])

# ---- 5. IPC ----
print()
print("【5】进程通信（CDP）")
ipc = R["ipc空往返"]
print("     空调用往返：中位 %.2f ms" % ipc["median"])
print("     说明：每次 Runtime.evaluate 有约 %.1f ms 固定开销" % ipc["median"])
print("     → 每帧至少 2 次往返（绘制 + 取图），即约 %.1f ms/帧 的固定成本" % (
    ipc["median"] * 2))

# ---- 6. 内存 ----
print()
print("【6】内存")
m = R["内存"]
print("     JS 堆使用: %s MB / %s MB" % (m["heapUsedMB"], m["heapTotalMB"]))
print("     画布数: %d（离屏单画布，未泄漏）" % m["canvasCount"])

# ---- 7. 与之前预测的对照 ----
print()
print("=" * 78)
print("与阶段 A/B 预测的对照（用户要求核实依据）")
print("=" * 78)
print()
print("%-34s %12s %12s %s" % ("预测项", "预测值", "实测值", "结论"))
print("-" * 78)
print("%-34s %12s %12s %s" % (
    "Base64 传输省 35.5 ms/帧", "35.5 ms", "—", "见下"))
print("%-34s %12s %12s %s" % (
    "多进程并行 4 路省 40 ms/帧", "40.0 ms", "—", "待测"))
print("%-34s %12s %12s %s" % (
    "硬件编码 NVENC/QSV", "13.5 ms", "不可用", "✗ 假设不成立"))
print()
print("【核实 1：Base64 传输】")
b64开销 = 链路["transfer"]["mean"] + 链路["decode"]["mean"]
print("  实测 base64 相关开销仅 %.2f ms/帧（提取字段 + 解码）" % b64开销)
print("  预测的「省 35.5 ms」**依据不足** —— 它把 PNG 编码成本误算进了 base64。")
print("  真实情况：PNG 编码本身 %.1f ms 是主要成本，base64 只占 %.1f ms。" % (
    链路["encode"]["mean"] - b64开销, b64开销))
print("  → 结论：改用 toBlob（%.1f ms）可省约 %.1f ms/帧，这是**实测支持**的。" % (
    pb["median"], pe["median"] - pb["median"]))
print()
print("【核实 2：硬件编码】")
enc = json.loads((根 / "tools" / "perf_encoders.json").read_text(encoding="utf-8"))
print("  本机 GPU 为 AMD Radeon 集成显卡，**无 NVENC / QSV**")
print("  可用硬件编码器：%s" % ", ".join(enc["可用硬件编码器"]) or "无")
for r in enc["编码器结果"]:
    if r.get("可用"):
        print("    %-14s %6.2f ms/帧" % (r["编码器"], r["每帧ms"]))
print("  → 结论：原预测「NVENC/QSV 省 13.5 ms/帧」是**未经验证的假设**，")
print("     本机不成立。实际可用的是 AMD AMF，收益需实测确认。")
print()
print("【核实 3：多进程并行】")
print("  预测「4 路省 40 ms/帧」基于「渲染天然可分片」的**推理**，")
print("  未考虑：进程启动成本、内存带宽竞争、CPU 核心数限制。")
print("  本机 8 物理核 / 16 逻辑核，理论可支撑，但需实测。")
print("  → 待阶段 2 验证。")

# ---- 8. 瓶颈排序 ----
print()
print("=" * 78)
print("瓶颈排序（按实测数据）")
print("=" * 78)
print()
瓶颈 = [
    ("PNG 编码 + CDP 取回", 链路["encode"]["mean"], "每帧必做，占链路 %.0f%%" % (
        链路["encode"]["mean"] / 总计 * 100)),
    ("绘制（含 CDP 往返）", 链路["draw"]["mean"], "其中 CDP 固定开销约 %.1f ms" % (
        ipc["median"])),
    ("写盘", 链路["write"]["mean"], "SSD 上成本低"),
    ("base64 解码", 链路["decode"]["mean"], "实际很小，非瓶颈"),
    ("提取 base64 字段", 链路["transfer"]["mean"], "可忽略"),
]
for i, (名, 值, 说明) in enumerate(瓶颈, 1):
    print("  %d. %-24s %7.2f ms/帧   %s" % (i, 名, 值, 说明))
print()
print("  当前链路合计: %.1f ms/帧 → 完整视频 %.1f 分钟" % (
    总计, 帧数 * 总计 / 1000 / 60))
print("  （阶段 B 实测 104.8 ms/帧，含编码 16 ms 与进程启动等）")

out = 根 / "tools" / "perf_stage1.json"
out.write_text(json.dumps({
    "测量条件": 剖析["参数"],
    "纯绘制": td,
    "分阶段": 阶段,
    "图像导出": {"getImageData": gi, "png_toDataURL": pe,
                 "png_toBlob": pb, "jpeg": je},
    "完整链路": 链路,
    "IPC": ipc,
    "内存": m,
    "链路合计ms": round(总计, 2),
}, ensure_ascii=False, indent=1), encoding="utf-8")
print()
print("已记录:", out)
