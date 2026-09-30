# Motion Text / JIZURA S00 基线与技术决定

> 状态：2026-09-26 完成 S00；后续实现直接按
> `rocut-jizura-integration-development-plan.md` 推进，不使用 Rasen 流程。

## 1. 开发基线

| 项目 | 固定值 | 决定 |
| --- | --- | --- |
| rocut | `8246f0b9c463d32e1d807cfed18b62c7baed04a4` | 本轮开发基线 |
| rocut 插件 pin | `fea667d6ea57412eeae2fa07d70a594c844bed38` | 暂不移动；S08 从通过验收的最终 rocut 提交更新 |
| JIZURA | `0.9.0` / `bae339e450512435b829a717248ea92ae5b44899` | 行为、预设和来源基线 |

插件 pin 到 rocut HEAD 之间正好有两个提交：`f318e274` 只修复 published-example
临时目录清理，`8246f0b9` 是对应 PR 的合并提交；运行时、编辑器契约和渲染代码没有差异。
因此使用当前 rocut HEAD 开发不会引入未审计的产品行为，同时也不应提前改插件 pin。

本工作不建立第二套私有契约。公共类型、事务、projection、codec、WASM ABI 和 CLI
能力都先在 rocut 上游修改；插件与 Creator Studio 只消费最终能力。用户已明确要求不走
Rasen，因此进度与证据记录在普通开发计划和本目录中。

## 2. 测试环境

| 项目 | 实测值 |
| --- | --- |
| OS | Windows 11 Pro 64-bit，10.0.26200 |
| Node | v24.14.0（满足 Node 20+ 运行条件） |
| Bun | 1.4.2 |
| Rust / Cargo | 1.88.0 / 1.88.0 |
| wasm-pack | 0.13.1（仓库固定版本） |
| Electron | 43.4.0（`apps/electron-host`） |
| 浏览器探针 | Headless Chrome 151.0.7922.34 |
| 浏览器 GPU | ANGLE + Vulkan + SwiftShader Device (Subzero) |
| 物理 GPU | NVIDIA RTX 3060 Laptop GPU；AMD Radeon Graphics |
| FFmpeg / ffprobe | 6.0 full build |
| 探针字体 | 所有 JIZURA 字体键固定映射到本机 Arial；不访问网络字体 |

当前 CLI 导出仍采用“借用已连接编辑器 pane 的 renderer”路径；没有 pane 时明确返回
`NoSurfaceAttachedError`。Electron reference host 通过隐藏渲染窗口和 FFmpeg provider
导出。motion-text 必须进入现有 pane 的同一 scene/compositor/export 路径，不另建导出器。

## 3. Registry 审计

[`audit-jizura-registry.mjs`](../../script/audit-jizura-registry.mjs) 在隔离的 Node VM 中按
JIZURA 的真实源文件顺序执行 `J.register`，并输出
[`jizura-preset-catalog.json`](./jizura-preset-catalog.json)。它不是正则计数；函数本体仍
作为函数注册，只在目录 JSON 中转换为函数字段名和元数据。

| group | 数量 | group | 数量 |
| --- | ---: | --- | ---: |
| style | 27 | font | 23 |
| layout | 186 | enter | 125 |
| hold | 52 | exit | 109 |
| decor | 130 | treat | 62 |
| bg | 66 | cam | 36 |
| fx | 69 | trans | 27 |
| **合计** | **912** | | |

目录还记录 source file、pack、set、顺序、实现类型、函数钩子、显式字体引用及可序列化
元数据。S07 的“全目录完成”以这 912 个稳定 ID 为母集，新增或缺失项必须由重新运行审计
器显式体现。

## 4. Rust / Node 桥接决定

新增的 `rust/crates/motion-text` 是平台无关领域层；第一批生产代码已实现 JIZURA 兼容的
歌词源解析，包括：

- LRC 单/多时间标签、`.` 与 `:` 小数格式；
- `ti/ar/al/by/offset` 元数据；
- 空行章节间隔、注释、间奏及显式间奏秒数；
- `|` 注释、`*...*` 强调、ASCII `!` impact、`/` 手工分段；
- 120,000 ticks/s 时间、稳定 cue ID、混合 LRC 时间诊断。

同一 crate 以原生 Rust 单元测试运行，也由 `rust/wasm` 通过 `tsify`/`wasm-bindgen` 导出。
浏览器继续使用 bundler entry；Node/Bun 使用仓库已有的显式同步实例化 entry
`opencut-wasm/sync`，不加载 DOM/GPU。运行
[`probe-motion-text-node.mjs`](../../script/probe-motion-text-node.mjs) 已在 Node v24.14.0
无 `window`/`document` 的进程中完成 schema、歌词、间奏和字段 round-trip。

这是后续核心桥接的固定方式：wire DTO 不引用 Canvas、DOM、GPU 或 UI 类型；Canvas
测量和逐帧绘制留在 editor renderer。

## 5. 帧与纹理探针

[`probe-jizura-render.mjs`](../../script/probe-jizura-render.mjs) 使用固定项目、seed、Arial
和透明模式生成 3 cue / 9.5 秒的原版 JIZURA plan。完整结果在
[`jizura-render-probe.json`](./jizura-render-probe.json)。

| 检查 | 结果 |
| --- | --- |
| 六个时间点顺序渲染后乱序 seek | 每帧 SHA-256 全部一致 |
| 透明像素 | 827,807 |
| 半透明像素 | 16,442 |
| 不透明像素 | 77,351 |
| JIZURA canvas → rocut backing OffscreenCanvas | 像素 hash 一致 |
| 1280×720，30 帧，热身后 | median 0.90 ms；p95 13.90 ms |
| 1920×1080，30 帧，热身后 | median 0.80 ms；p95 20.10 ms |

这些数字是 SwiftShader、单个代表性 `center + pop + breathe + shrink + rings` 组合的 S00
基线，不代表全目录最坏情况。720p 代表场景满足 33.3 ms 预览目标；S07/S09 仍需对重
效果、长歌、真实字体、缓存和完整目录重新测量。

rocut 纹理接入固定使用 `RenderedTextureDescriptor`，其 `contentHash` 至少包含 sequence
revision、resolved-plan revision、source tick、输出尺寸、字体摘要和引擎版本。不得把持续
变化的同一个 canvas 当作 `ExternalTextureDescriptor`：当前 compositor 按 source 对象
identity 缓存，复用 canvas 会把后续帧误判为命中缓存。

## 6. S00 决定记录

| ID | 决定 | 依据 / 影响 |
| --- | --- | --- |
| S00-D01 | 当前 rocut HEAD 是开发基线；插件 pin 留到 S08 | 两个提交只涉及 scratch 清理和合并 |
| S00-D02 | 纯业务逻辑进入 `motion-text` Rust crate | 满足 rocut 的 UI/业务边界；原生和 WASM 共用 |
| S00-D03 | Node 使用 `opencut-wasm/sync` | 已在无 DOM Node 24 实际调用；不假设 GPU WASM 可用于 host |
| S00-D04 | 动态帧走 `rendered` 纹理和逐帧 hash | 避免 external texture 的 identity 缓存产生陈旧帧 |
| S00-D05 | 目录母集是实际执行注册得到的 912 项 | 后续适配、能力矩阵和 smoke 都以稳定 ID 对账 |
| S00-D06 | S00 性能预算暂不调整 | 代表性 720p p95 13.9 ms，仍有足够余量；重效果后续单列 |
| S00-D07 | 不建立 Rasen change 或私有 Elftia 写入 | 用户明确要求；计划文档直接记账，rocut 公共契约仍是唯一入口 |

S00 未发现需要改变产品范围的证据。下一步进入公共数据模型、运行时校验、Clip 内容引用、
projection/codec、事务 inverse/idempotency 和能力发现；这些都必须保持 additive migration。
