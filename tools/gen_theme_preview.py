"""改进预览页：图片放大、网格列数减少、关键组件单独强调。

## 问题

预览页用 `repeat(auto-fill, minmax(400px, 1fr))` ——
在 1500px 宽下是 3 列，每张图只有约 450px 宽。
而组件原图是 640-1180px 宽，缩到 450px 后：
  · 细线（1px 描边）糊掉
  · 淡色（data 色 0.3 alpha）看不清
  · 步进器的音符变成小点

## 改法

1. 网格改为 **2 列**（每张约 700px）
2. 图片用 `image-rendering: pixelated` 对细线更友好？—— 不，那是给像素画的
3. 关键组件（步进器、频谱、波形）**单独一行全宽展示**
4. 加「点击看原图」的提示（原图在 out/components/ 里）
"""
import base64
import json
import pathlib

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
图目录 = 根 / "out" / "components"

# 关键组件（单独全宽展示）
重点 = ["stepper", "spectrum", "waveform"]

组件 = [
    ("playlist", "主时间轴", 1180, 600, "结构",
     "整首曲子的编排：轨道 × 时间。clip 质感由 SURFACE.fill 决定。"),
    ("stepper", "步进器", 960, 360, "结构",
     "**零指针**——「现在」完全由绽放余晖指示。音符画法来自各主题的 BLOOM。"),
    ("spectrum", "频谱", 640, 200, "音频",
     "滚动窗口的频段能量。色图从 bg 混到 DCOL.data（主题色）。"),
    ("waveform", "波形", 640, 160, "音频",
     "包络条走 sFill。峰值用 DCOL.data3，RMS 主体用 DCOL.data。"),
    ("pianoroll", "钢琴卷帘", 900, 300, "内容",
     "音符按音高与时间排布，边缘渐变用 DCOL.data。"),
    ("pitchwheel", "音级轮", 360, 360, "内容",
     "音高弯曲的极坐标视图。"),
    ("vectorscope", "声场", 300, 300, "音频",
     "左右声道的相位关系，点云用 DCOL.data。"),
    ("loudness", "响度", 420, 300, "音频",
     "响度曲线。主体走 sFill，峰值线用 DCOL.data2。"),
    ("brightness", "明亮度", 420, 300, "音频",
     "频谱重心随时间的移动，轨迹用 DCOL.data2。"),
    ("transient", "瞬态", 420, 300, "音频",
     "起音密度。同心圈用 DCOL.data / data2。"),
    ("transport", "走带读数", 320, 170, "信息",
     "大时钟 + 小节/拍 + 进度条。"),
    ("text", "文字", 620, 200, "内容",
     "自由文字块，框自适应文本。支持 {title} {tempo} 等变量。"),
]

主题 = [
    {
        "id": "wh_soft", "name": "白塑料", "sub": "SOFT HARDWARE",
        "claim": "一台 2003 年的白色设备。哑光白面板，唯一的颜色是一颗淡紫指示灯。",
        "key": "色块用**描边**而不是填充 —— 填充在浅底上会显得笨重廉价，"
               "1px 描边才精确、有设备感。",
        "data": "淡紫 `#9B85D8` 主体 / 粉 `#E07BB0` 峰值 / 冷灰蓝 `#B8C4D4` 弱信号",
        "bloom": "LED 点阵：方形亮格 + 左邻拖尾 + 扩散框。方格子才是「设备」，圆环是「魔法」。",
        "surface": "fill 只画 1px 描边 + 极淡内阴影，**不填色**。"
                   "唯一一个 fill 不填色的主题 —— 画的是「分区边界」。",
    },
    {
        "id": "chrome_freak", "name": "异形铬", "sub": "CHROME FREAK",
        "claim": "地下时装 lookbook 的排版。超粗窄体出血切边，荧光朱红只出现一次。",
        "key": "色块是**斜切厚板** —— 唯一非正交的几何。",
        "data": "荧光朱红 `#E03A1E` 主体 / 近黑 `#2A2C30` 次要 / 冷银 `#9A9DA2` 弱信号",
        "bloom": "切角碎片：带斜切角的实心四边形 + 沿 45° 飞散的副碎片。",
        "surface": "fill 画斜切厚板（右上与左下各切一角）。stroke 用荧光朱红。",
    },
    {
        "id": "nuclear", "name": "核警示", "sub": "NUCLEAR",
        "claim": "警示黄的几何逻辑：中心 + 三等分。不画辐射标志本身，只借构图。",
        "key": "色块是**模板喷涂**的断续边 —— 漆从镂空处漏过去，边缘不连续。",
        "data": "警示黄 `#C8B616` 主体 / 锈红 `#A8341C` 次要 / 军绿 `#5A6A48` 弱信号",
        "bloom": "仪表脉冲：一道弧 + 三条径向刻度。像工业设备的读数。",
        "surface": "fill 画半透明底 + 断续短划边框（划 10px / 隙 8px）。",
    },
]


def 图(键, cid):
    p = 图目录 / ("%s_%s.png" % (键, cid))
    if not p.is_file():
        return None
    return "data:image/png;base64," + base64.b64encode(
        p.read_bytes()).decode("ascii")


html = """<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>Audiovis · 三套新主题全组件预览</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{
  background:#141416;color:#E8E6E2;
  font-family:"Segoe UI","Microsoft YaHei",sans-serif;
  font-size:14px;line-height:1.55;
  padding:52px 40px 100px;
}
.wrap{max-width:1560px;margin:0 auto}
h1{font-size:26px;font-weight:600;margin-bottom:10px}
.lead{color:#9A9790;max-width:80ch;margin-bottom:40px;font-size:13px}
.lead b{color:#E8E6E2;font-weight:600}

.themehead{margin:70px 0 24px;padding-bottom:16px;
  border-bottom:1px solid #2A2A2C}
.themehead .nm{font-size:23px;font-weight:600}
.themehead .sb{font-size:10px;letter-spacing:3px;color:#6E6B66;margin-top:3px}
.themehead .claim{margin-top:12px;font-size:13.5px;color:#C8C4BC;max-width:76ch}
.specs{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));
  gap:22px;margin-top:18px}
.spec{font-size:12px;line-height:1.62;color:#8E8B86}
.spec b{display:block;color:#B8B4AC;font-size:9.5px;letter-spacing:2px;
  text-transform:uppercase;margin-bottom:5px;font-weight:400}
.spec code{font-family:"Consolas",monospace;color:#A8A5A0;
  background:#1E1E20;padding:1px 4px}

/* 重点组件：全宽 */
.feature{margin-top:26px;border:1px solid #2A2A2C;overflow:hidden}
.feature .shot{background:#000;line-height:0}
.feature .shot img{display:block;width:100%;height:auto}
.feature .meta{padding:14px 18px 16px}
.feature .cn{font-size:15px;font-weight:600}
.feature .cs{font-size:9px;letter-spacing:2px;color:#6E6B66;margin-top:2px}
.feature .cd{margin-top:9px;font-size:12.5px;line-height:1.6;color:#8A8782}

/* 其余组件：两列 */
.grid{display:grid;grid-template-columns:repeat(2,1fr);
  gap:24px;margin-top:26px}
@media(max-width:1100px){.grid{grid-template-columns:1fr}}
.comp{border:1px solid #2A2A2C;overflow:hidden;
  display:flex;flex-direction:column}
.comp .shot{background:#000;line-height:0;display:flex;
  align-items:center;justify-content:center}
.comp .shot img{display:block;width:100%;height:auto}
.comp .meta{padding:13px 15px 15px;flex:1}
.comp .cn{font-size:14px;font-weight:600}
.comp .cs{font-size:9px;letter-spacing:2px;color:#6E6B66;margin-top:2px}
.comp .cd{margin-top:8px;font-size:12px;line-height:1.6;color:#8A8782}
.comp .cg{display:inline-block;margin-top:10px;font-size:9px;
  letter-spacing:1.6px;padding:2px 6px;border:1px solid #3A3A3C;
  color:#7A7772}

.secttl{margin:34px 0 14px;font-size:10px;letter-spacing:3px;
  text-transform:uppercase;color:#6E6B66}
</style>
</head>
<body>
<div class="wrap">
  <h1>三套新主题 · 全组件预览</h1>
  <p class="lead">
    全部为<b>真实渲染</b>（走完整管线：数据 → 组件 → SURFACE / BLOOM → 编码）。
    每个组件单独渲染在该组件的注册尺寸上。
    步进器、频谱、波形因细节多，<b>单独全宽展示</b>。
  </p>
"""

for t in 主题:
    html += """
  <div class="themehead">
    <div class="nm">%s</div>
    <div class="sb">%s</div>
    <div class="claim">%s</div>
    <div class="specs">
      <div class="spec"><b>核心</b>%s</div>
      <div class="spec"><b>数据色</b>%s</div>
      <div class="spec"><b>SURFACE</b>%s</div>
      <div class="spec"><b>BLOOM</b>%s</div>
    </div>
  </div>""" % (t["name"], t["sub"], t["claim"],
              t["key"], t["data"], t["surface"], t["bloom"])

    # 重点组件
    html += '\n  <div class="secttl">重点组件</div>'
    for cid, 名, w, h, 组, 说明 in 组件:
        if cid not in 重点:
            continue
        data = 图(t["id"], cid)
        if not data:
            continue
        html += """
  <div class="feature">
    <div class="shot"><img src="%s" alt="%s"></div>
    <div class="meta">
      <div class="cn">%s</div>
      <div class="cs">%s · %d × %d · %s</div>
      <div class="cd">%s</div>
    </div>
  </div>""" % (data, 名, 名, cid, w, h, 组, 说明)

    # 其余组件
    html += '\n  <div class="secttl">其余组件</div>\n  <div class="grid">'
    for cid, 名, w, h, 组, 说明 in 组件:
        if cid in 重点:
            continue
        data = 图(t["id"], cid)
        img = ('<img src="%s" alt="%s">' % (data, 名)) if data else \
              '<div style="padding:30px;color:#5E5B56">（缺图）</div>'
        html += """
    <div class="comp">
      <div class="shot">%s</div>
      <div class="meta">
        <div class="cn">%s</div>
        <div class="cs">%s · %d × %d</div>
        <div class="cd">%s</div>
        <span class="cg">%s</span>
      </div>
    </div>""" % (img, 名, cid, w, h, 说明, 组)
    html += "\n  </div>"

html += """
</div>
</body>
</html>
"""

输出 = 根 / "out" / "three_themes_components.html"
输出.write_text(html, encoding="utf-8")
print("已生成:", 输出)
print("大小: %.2f MB" % (len(html) / 1024 / 1024))
