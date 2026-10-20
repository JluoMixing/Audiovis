"""性能审计·阶段 1b：CDP 传输瓶颈定位。

数据来源：tools/perf_cdp_probe.mjs 实测。
"""
import json
import pathlib

p = pathlib.Path.home() / "AppData/Local/Temp/cdp_probe.json"
d = json.loads(p.read_text(encoding="utf-8"))

print("=" * 78)
print("CDP 传输瓶颈定位")
print("=" * 78)
print()

绘制 = d["CDP_仅绘制"]["中位ms"]
取图 = d["CDP_绘制加PNG取回"]["中位ms"]
假串 = d["CDP_等长假串"]["中位ms"]
小负载 = d["CDP_小负载"]["中位ms"]
浏览器内PNG = d["浏览器内PNG"]["中位ms"]
toBlob = d["CDP_toBlob仅取大小"]["中位ms"]
http直传 = d["HTTP直传"]["中位ms"]
b64长度 = d["实测base64长度"]

print("【关键测量】")
print("  %-42s %8.2f ms" % ("① CDP 往返：仅绘制（无图像返回）", 绘制))
print("  %-42s %8.2f ms" % ("② CDP 往返：绘制 + 返回 PNG base64", 取图))
print("  %-42s %8.2f ms" % ("③ CDP 往返：返回等长假串（仅传输）", 假串))
print("  %-42s %8.2f ms" % ("④ CDP 往返：返回 1KB 小串（固定开销）", 小负载))
print("  %-42s %8.2f ms" % ("⑤ 浏览器内 PNG 编码（不含传输）", 浏览器内PNG))
print("  %-42s %8.2f ms" % ("⑥ CDP + toBlob（不传图像，仅取大小）", toBlob))
print("  %-42s %8.2f ms" % ("⑦ HTTP 直传二进制（优化架构）", http直传))
print()
print("  base64 长度: %d 字符（%.1f KB）" % (b64长度, b64长度 / 1024))
print()

# 拆解
print("=" * 78)
print("拆解：② 的 54.55 ms 由什么构成")
print("=" * 78)
print()
纯传输 = 假串 - 小负载
print("  固定开销（CDP 往返 + JSON 解析骨架）      %6.2f ms" % 小负载)
print("  传输 %d KB 的净成本                     %6.2f ms" % (
    b64长度 / 1024, 纯传输))
print("  PNG 编码本身（浏览器内实测）              %6.2f ms" % 浏览器内PNG)
print("  " + "-" * 56)
print("  合计推算                                  %6.2f ms" % (
    小负载 + 纯传输 + 浏览器内PNG))
print("  实测 ②                                    %6.2f ms" % 取图)
print("  差额（绘制 + CDP 序列化开销）              %6.2f ms" % (
    取图 - 小负载 - 纯传输 - 浏览器内PNG))
print()
print("  ★ 结论：54.55 ms 中，")
print("     PNG 编码占 %.1f ms（%.0f%%）" % (
    浏览器内PNG, 浏览器内PNG / 取图 * 100))
print("     传输占 %.1f ms（%.0f%%）" % (纯传输, 纯传输 / 取图 * 100))
print("     固定开销占 %.1f ms（%.0f%%）" % (小负载, 小负载 / 取图 * 100))
print("     其余 %.1f ms（绘制 + 序列化）" % (
    取图 - 小负载 - 纯传输 - 浏览器内PNG))

print()
print("=" * 78)
print("三条可行路径对比")
print("=" * 78)
print()
print("  %-38s %10s %12s" % ("路径", "ms/帧", "相对当前"))
print("  " + "-" * 62)
基准 = 取图
路径 = [
    ("当前：CDP + base64 PNG", 取图, "基准"),
    ("CDP + toBlob（仍走 CDP）", toBlob, "省 %.1f ms" % (取图 - toBlob)),
    ("HTTP 直传二进制", http直传, "省 %.1f ms" % (取图 - http直传)),
]
for 名, 值, 说明 in 路径:
    print("  %-38s %8.2f   %s" % (名, 值, 说明))

print()
print("  ★ HTTP 直传（%.1f ms）比 CDP 取回（%.1f ms）快 %.1f×" % (
    http直传, 取图, 取图 / http直传))
print("    原因：")
print("      · 不经 base64（省去 33% 体积膨胀）")
print("      · 不经 CDP 的 JSON 序列化")
print("      · 二进制流直接传输")
print()
print("  ★ 但 HTTP 直传仍有 %.1f ms，其中绘制+编码约占 %.1f ms，" % (
    http直传, 浏览器内PNG + (绘制 - 小负载)))
print("    说明**编码本身**已成为下一道瓶颈。")

print()
print("=" * 78)
print("下一步优化的优先级（基于实测）")
print("=" * 78)
print()
可省 = [
    ("改用 HTTP 直传二进制", 取图 - http直传,
     "实测 %.1f ms，收益最大" % (取图 - http直传)),
    ("改用 toBlob 替代 toDataURL", 取图 - toBlob,
     "实测 %.1f ms；若同时改 HTTP 则收益重叠" % (取图 - toBlob)),
    ("PNG 编码降级为更快格式", 浏览器内PNG - 5,
     "PNG 编码 %.1f ms；BMP/PPM 几乎无编码但体积大 3-5 倍" % 浏览器内PNG),
]
for 名, 值, 说明 in sorted(可省, key=lambda x: -x[1]):
    print("  · %-30s 约省 %5.1f ms   %s" % (名, 值, 说明))
print()
print("  注意：上述收益**不可简单相加**（存在重叠）。")
print("  并行渲染的收益也需实测，不能按核数线性外推。")
