# 文档索引

> 第一次接触项目？先读根目录的 [`README.md`](../README.md)（用户视角）
> 或 [`AGENTS.md`](../AGENTS.md)（开发者视角）。

---

## 按需求查

| 我想…… | 读这个 |
|---|---|
| 了解项目是什么、怎么用 | [`../README.md`](../README.md) |
| 参与开发 / 改代码 | [`../AGENTS.md`](../AGENTS.md) |
| 知道目录里每个文件干什么 | [`STRUCTURE.md`](STRUCTURE.md) |
| 理解设计决策（为什么这么做） | [`ROADMAP.md`](ROADMAP.md) |
| **加一个新组件** | [`ADD_COMPONENT.md`](ADD_COMPONENT.md) |
| **加一套新主题** | [`ADD_THEME.md`](ADD_THEME.md) |
| 自己打包成 exe | [`PACKAGING.md`](PACKAGING.md) |
| 知道第三方依赖的版本与许可证 | [`VENDOR_VERSIONS.md`](VENDOR_VERSIONS.md) |

---

## 全部文档

| 文件 | 内容 | 读者 |
|---|---|---|
| [`../README.md`](../README.md) | 项目介绍、安装、使用 | 用户 |
| [`../AGENTS.md`](../AGENTS.md) | 开发入口、关键约束、踩过的坑 | 开发者 / AI agent |
| [`STRUCTURE.md`](STRUCTURE.md) | 目录结构与分层原则 | 开发者 |
| [`ROADMAP.md`](ROADMAP.md) | 设计决策记录 | 想理解「为什么」的人 |
| [`ADD_COMPONENT.md`](ADD_COMPONENT.md) | 加组件：3 步 | 扩展者 |
| [`ADD_THEME.md`](ADD_THEME.md) | 加主题：4 步 | 扩展者 |
| [`PACKAGING.md`](PACKAGING.md) | PyInstaller 配置与体积构成 | 要自己打包的人 |
| [`VENDOR_VERSIONS.md`](VENDOR_VERSIONS.md) | 第三方依赖版本与许可证 | 合规 / 溯源 |
| [`promo.md`](promo.md) | 宣传片：成片、结构、重建方法 | 要改宣传片的人 |

---

## 许可证合规

本项目使用 **GPL-3.0-or-later**，因为依赖链里有 GPL 代码：

| 依赖 | 许可证 | 影响 |
|---|---|---|
| PyFLP | GPL-3.0-or-later | **决定了本项目的许可证** |
| construct | MIT | 兼容 |
| construct-typing | MIT | 兼容 |
| fastenum | 未声明 | 需注意 |

详见 [`VENDOR_VERSIONS.md`](VENDOR_VERSIONS.md) 与根目录 [`LICENSE`](../LICENSE)。

---

## 文档维护

改文档后请核对内容与实际代码一致。检查清单：

- 文件路径是否存在
- 命令是否真的能用
- 数量（组件数、主题数）是否对得上
- 是否引用了已删除的文件

**不要写死会变化的数字**（如测试数量）—— 给出查询命令即可。
