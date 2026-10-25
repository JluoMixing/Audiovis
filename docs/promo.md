# 宣传片

Audiovis 的产品宣传片，两支成片、一份可重建的工程。

## 成片

| 版本 | 文件 | 规格 | 用途 |
|---|---|---|---|
| 横屏 | [`audiovis_promo_16x9.mp4`](video/audiovis_promo_16x9.mp4) | 1920×1080 / 60fps / 78.7s | GitHub、B站、YouTube |
| 竖屏 | [`audiovis_promo_9x16.mp4`](video/audiovis_promo_9x16.mp4) | 1080×1920 / 60fps / 78.7s | 抖音、小红书、Reels |

两支片子时间轴完全一致，只是排版不同：

- **横屏**：16:9 全程，第三幕的竖屏成品缩成中间一张卡片，右侧排品牌与规格面板
- **竖屏**：前两幕把 16:9 画面放在 1080×607 的前景框里，背景用同一素材放大模糊铺满；
  第三幕的成品是原生 9:16，**满屏播放** —— 这是竖屏版最大的优势

## 片子结构

| 段 | 时间 | 内容 |
|---|---|---|
| 01 现状 | 0:00–0:11 | FL 工程录屏 → 冻结 → 关掉 → 桌面 → 双击图标 → 软件启动 |
| 02 软件 | 0:11–0:43 | 真实操作录屏（导入 → 分辨率 → 模板 → 组件 → 主题 → ENJOY IT） |
| 过场 | 0:43–0:48 | 收窄成 9:16 + 虚拟「导出视频」控制条 + 分段进度 → 白闪 |
| 03 成片 | 0:48–1:14 | 软件导出的成品，从 drop 那一拍开始 |
| 片尾 | 1:14–1:19 | 黑场 → logo 光扫 → 链接 → 渐隐 |

全片只有一条音轨（BGM）。所有素材静音，声音统一来自 `original/*.wav`。

## 重建

工程在 `promo/remotion/`（不在仓库里，见下方「为什么不入库」）。

```powershell
cd promo\remotion
npm install

# 关键：TEMP 必须指向工作区，否则 Remotion 自带的 ffmpeg 会写系统临时目录失败
$tmp = (Resolve-Path .tmp).Path
cmd /c "set TEMP=$tmp&& set TMP=$tmp&& npx remotion render src/index.ts Audiovis out\h.mp4 --concurrency=4"
cmd /c "set TEMP=$tmp&& set TMP=$tmp&& npx remotion render src/index.ts AudiovisVertical out\v.mp4 --concurrency=4"
```

输出是 full-range（yuvj420p），交付前必须转一次：

```powershell
ffmpeg -i out\h.mp4 -vf "scale=in_range=full:out_range=tv:flags=lanczos,format=yuv420p" `
  -af "volume=-8.5dB" -c:v libx264 -preset medium -crf 16 -pix_fmt yuv420p `
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv `
  -c:a aac -b:a 320k -movflags +faststart out\final.mp4
```

竖屏版的 `volume` 是 `-7.1dB`（两条链路的增益不同，别抄错）。

## 音画同步的锚点

这几个数是从素材里量出来的，**不要凭感觉改**：

| 项 | 值 | 怎么来的 |
|---|---|---|
| BGM | 155 BPM | 自动估计会得出 103（2/3 错拍），用工程 BPM 校正 |
| 片子起点 | BGM 88.47s（第 57 小节） | 让 drop 落在第 27 小节 |
| drop | 片子 47.63s | BGM 136.467s |
| `drop_new` 的 0 秒 | BGM 136.100s | 互相关 + 画面走带读数（2:16.1）双重确认 |
| `recordly_manual_v2` | 21.0s 处剪掉 1.6s | 逐帧画面匹配量出来的 |

`drop_new` 的首帧**不是** drop 本身，差 0.37 秒。直接"开头对齐 drop"会让那一击晚半拍。

## 为什么不入库

`promo/` 整个目录被 `.gitignore` 忽略，原因：

- `node_modules/` 728 MB、`public/media/` 180 MB、渲染中间帧数百 MB
- 素材（BGM、录屏）是本地文件，体积大且不适合分发

只有 `docs/video/*.mp4` 是例外（`.gitignore` 里显式白名单）。

## 改片子看哪里

| 想改 | 改这个文件 |
|---|---|
| 文案 | `promo/remotion/src/v2/Act2.tsx` 顶部的 `CAPS` |
| 段落时长、drop 锚点 | `promo/remotion/src/v2/design.ts` 的 `T` |
| 第一幕动作节拍 | `promo/remotion/src/v2/Act1.tsx` 顶部常量 |
| 过场控制条 | `promo/remotion/src/v2/Act2.tsx` 的 `Trans` |
| 第三幕缩卡时机 | `promo/remotion/src/v2/Act3.tsx` 的 `SHRINK_AT` |

## 两个踩过的坑

1. **两幕交界要提前挂载覆盖层**。第一幕末尾必须挂 `<FileTray force />`，
   否则切到第二幕会露出 Windows 资源管理器。横屏、竖屏各踩过一次。
2. **竖屏的托盘盖不住背景**。托盘在 `overflow: hidden` 的前景框里，
   只盖得住 607px；下方文案区显示的是模糊背景，而那个背景里也有真实文件夹。
   解法是托盘在场期间把背景压成近黑（见 `Vertical2.tsx` 的 `0.82` 那层）。
