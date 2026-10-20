# 第三方依赖版本与许可证

本文件记录依赖的精确版本与**许可证**，确保环境可复现、合规可溯。

---

## 许可证概览

**本项目使用 GPL-3.0-or-later。**

原因：依赖链里有 GPL 代码，且被链接进本程序。

| 依赖 | 许可证 | 是否影响本项目许可证 |
|---|---|---|
| **PyFLP** | **GPL-3.0-or-later** | **是 —— 决定了本项目必须是 GPL** |
| construct | MIT | 否（兼容） |
| construct-typing | MIT | 否（兼容） |
| fastenum | 未声明 | 需向上游确认 |
| numpy | BSD-3-Clause | 否 |
| soundfile | BSD-3-Clause | 否 |
| imageio-ffmpeg | BSD-2-Clause | 否 |
| FFmpeg（二进制） | LGPL / GPL（取决于编译选项） | 分发时需注意 |
| pywebview | BSD-3-Clause | 否 |

PyFLP 的头部声明原文：

```
This program is free software: you can redistribute it and/or modify it
under the terms of the GNU General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option)
any later version.
```

---

## 源码依赖（vendored）

这 4 个包**不在本仓库内**（体积大、上游 checkout）。
本文件记录精确 commit，确保可复现。

| 依赖 | Commit | 分支 | describe | 用途 |
|---|---|---|---|---|
| **PyFLP** | `f937126b888ce94271bfea631b89166c74056530` | master | `f937126` | FLP 主解析器 |
| construct | `28c6e5779f2b76d55474914607291a3821502000` | master | `28c6e57` | PyFLP 的二进制解析依赖 |
| construct-typing | `3b51654b1e2a61a57b8e0639f89dc2908bad0509` | HEAD | `v0.5.6` | construct 类型标注 |
| fastenum | `a8c559fa6627fb6dced51c0a85d7372c657f85d9` | master | `a8c559f` | 枚举加速 |

### 获取方式

```powershell
mkdir research\vendor -Force
cd research\vendor

git clone https://github.com/demberto/PyFLP.git
git -C PyFLP checkout f937126b888ce94271bfea631b89166c74056530

git clone https://github.com/construct/construct.git
git -C construct checkout 28c6e5779f2b76d55474914607291a3821502000

git clone https://github.com/ilanschnell/fastenum.git
git -C fastenum checkout a8c559fa6627fb6dced51c0a85d7372c657f85d9
```

`construct-typing` 需从上游 release 获取 `v0.5.6`。

### 运行时路径

`src/parser/flp.py` 会在运行时把 `research/vendor/` 下的 4 个包
加到 `sys.path`。打包时 spec 会把它们作为数据打进去。

---

## Python 包依赖

实测可用版本（Python 3.9.5）：

| 包 | 版本 | 用途 |
|---|---|---|
| numpy | 1.26.4 | 数值计算（必需） |
| soundfile | 0.12.1 | 音频读取（必需） |
| imageio-ffmpeg | — | 视频编码（必需，内置 ffmpeg 7.1） |
| pywebview | — | 无边框窗口（必需） |
| jsonschema | 4.17.3 | Schema 校验（开发用） |
| Pillow | 10.4.0 | 图像处理（开发用） |

**项目目前没有 `requirements.txt`。** 若要从源码安装，按上表手动装。

---

## 外部可执行文件

| 文件 | 来源 | 用途 |
|---|---|---|
| `node.exe` | Node.js v22.11.0 | 渲染页驱动（CDP） |
| `ffmpeg.exe` | 由 `imageio-ffmpeg` 内置 | 视频编码 |
| `msedge.exe` | Windows 系统自带 | 无头渲染 |

打包时 `node.exe` 会随包分发；`ffmpeg` 由 PyInstaller 的
`imageio_ffmpeg` hook 自动收集。

---

## 渲染途径说明

使用 **CDP（Chrome DevTools Protocol）** 驱动无头 Edge，
通过 WebSocket 控制、HTTP 回传帧数据。

早期曾用 `--screenshot` 参数（单次截图），已改为 CDP
（支持逐帧控制、并行、超时管理）。

---

## 更新记录

| 日期 | 变更 |
|---|---|
| 2026-10 | 重写：补许可证信息、去掉过时的「ffmpeg 未安装」 |
