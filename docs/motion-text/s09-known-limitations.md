# S09 已知限制与可复现问题

> 状态日期：2026-10-01。0.5.0 为功能升级，不代表 G8/G9 最终验收关闭。此清单保留未完成工作和已知失败。

## 交付阻断

### L01：F01 zh-Hans 字形闭包已闭合（源码与 installed runtime）

- **状态（源码）：** 已关闭。Noto Sans SC 变量字体已落库为 `gothic_bold` 的 zh-Hans 资产变体。
- **状态（installed runtime）：** 已关闭。installed WASM 经正常依赖路径同步到 canonical 后，`MOTION_TEXT_UI_INSTALLED=1` 的完整 UI 探针在无 alias 的依赖入口下跑通全部 33 项检查，导出抽帧比较 MAE 5.9230／255。
- **仍未关闭：** 该字体是否随 plugin `dist` 真正分发，要等 L03 打包后在无 sibling checkout 的安装环境验收（L04）。
- **证据：** `motion-text/fonts/noto-sans-sc-variable.ttf`（17,772,300 bytes，SHA-256 `a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da`，31,036 glyph）在 F01 上 0 缺字；`motion-text/fonts/licenses/notosanssc-OFL.txt` 为同 revision 的 OFL 1.1 正文。catalog 以 `roleId: gothic_bold` 与 `defaultForLanguages: [zh-Hans]` 登记，`check:motion-text:fonts` 现为 19 assets、default missing 0、full coverage 1。
- **复现：** `bun run check:motion-text:fonts`；canonical 入口 `node script/probe-motion-text-ui.mjs`，installed 入口 `MOTION_TEXT_UI_INSTALLED=1 node script/probe-motion-text-ui.mjs`。
- **关闭条件：** 在无 sibling checkout 的安装环境重跑 F01，确认 1080p 证据包含中文字形。

### L02：installed WASM 已同步到 canonical（已关闭）

- **状态：** 已关闭。经正常依赖路径 `npx --yes bun@1.2.18 install`（仓库 pin 的 `packageManager` 版本）同步；未手工覆盖任何 installed 文件。
- **canonical：** 5,511,220 bytes；SHA-256 `14de620a1bfa38228a43e4103cc557ae7a27bbb30185bfffae91b17d685e75a8`（zh-Hans 字体条目编入 catalog 后重建）。
- **root 与 `apps/web` installed copy：** 同为 5,511,220 bytes，与 canonical 逐字节一致。
- **复现：** `bun run check:wasm` 全绿（source currency、path、API surface、Bun／Node init 与无 mock 的 32 步 migration chain）。
- **注意：** 使用 bun 1.4.2 执行 `bun install` 会修剪 workspace junction 并使 migration-chain 探针无法解析 `@opencut/editor-classic`；必须使用仓库 pin 的 bun 1.2.18。

### L03：plugin 打包与实际宿主验收需区分

- **状态：** 阻断 G8/G9。
- **现象：** 已有包含 motion-text 的 vendor/dist 和 0.4.4 隔离副本 smoke。0.5.0 将固定本轮已提交源码重新构建；共享安装仍需经插件管理器更新，Creator Studio 实际入口尚未验收。
- **复现：** 对比 [上游来源清单](./upstream-sources.md) 中的 pin；不要把 sibling checkout 的成功当作 dist 证据。
- **关闭条件：** 从验证 commit 更新 pin，执行正常 vendor/build/verify，并在无 sibling checkout 的安装环境运行 Creator Studio E2E。

### L04：已有 1080p smoke，最终验收仍未完成

- **状态：** 阻断 G9/M3。
- **已有证据：** canonical 320×180 F05 完整 14,400 帧导出、720p seek/draw、代表预设矩阵、889 项两帧 smoke、普通视频／文字／图形／音频双轨导出。
- **补充证据：** 2026-09-28 的 0.4.4 隔离 smoke 已产出完整／选区 1080p MP4 和抽帧。
- **缺口：** Creator Studio 实际入口、installed 预览／修改／取消／内存／GPU 实测，以及至少 30 次目标帧可见 seek。历史报告中的预算常量与硬编码 true 不能作为实测；294 ms 的 8 次时间码操作不能关闭原 250 ms 门禁，门槛已恢复。历史 PASS 不认证 0.5.0。
- **关闭条件：** 完成字体、WASM 和 plugin 打包后，在没有 Rocut/JIZURA sibling checkout 的环境执行 [S09 验证矩阵](./s09-verification-matrix.md)，并用[安装产物验收证据契约](./s09-installed-acceptance-contract.md)校验完整证据闭包。验证器已实现不等于验收已经执行。

## 当前产品边界

### L05：CLI Host 不独立拥有像素 renderer

无面板 Host 可完成 catalog、创建、读取、修改、变体和导入。像素预览／导出必须借用 attached editor pane；没有 pane 时应返回明确能力状态，业务读取仍可用。这是当前架构边界，不应在 CLI 中复制浏览器 renderer。

### L06：字体语言覆盖按实测声明

当前离线字体中，`gothic_bold` 已具备实测覆盖 F01 的 zh-Hans 变体（Noto Sans SC），`mono` 仅声明英文，其余角色声明日文＋英文。`ko` 与 `zh-Hant` 仍无离线字形闭包，相关文本只能进入 Rust 规划与测试，导出会被缺字门禁阻断；语言标签本身不构成字体保真承诺。Rust catalog 在保留 23 个稳定角色 ID 的同时追加带 `roleId`／`defaultForLanguages` 的具体资产：只在新建或 JIZURA 导入时解析，工程保存的是具体资产 ID，后续 mutation、lock、variation 和重开不会随 catalog 升级自动换字。

### L07：JIZURA 导入不是原版运行时嵌入

导入保留可映射的 source、timing、seed、字体、锁定、规划控制和 resolved 选择，并返回兼容性报告。音频／字体重关联、未锁定自动规划、整 cut 锁粒度、inactive colors、title card、顶层随机器、画布和导出设置可能是近似或诊断项。Rocut 不加载原版全局 `J` 状态。

### L08：首版不支持任意单字独立图层选择

当前粒度是 sequence、cue、stable cut、preset group 和 parameter。若用户需要任意字形成为独立时间线图层，应作为后续数据模型与编辑器能力设计，不能仅在 React 内临时拆分。

### L09：性能证据仍分层

720p renderer seek/draw、F04 局部修改到稳定预览 p95、低分辨率完整编码和取消已有固定报告，但最终 installed 1080p 合成、真实多媒体项目的端到端内存／GPU 基线尚未完成。不得把 320×180 的 F05 吞吐换算成 1080p 承诺。

## 最近一次全仓回归中的非 motion-text 失败

2026-10-01 使用固定版本 `npx --yes bun@1.2.18 test` 重新执行：1,113 pass、4 skip、7 fail（168 文件、1,124 tests）。下列失败没有被本轮 motion-text 修改掩盖，也不计为通过：

1. C6 provenance 的独立 anchor 与新构建的 Vite/Next emitted-artifact hash 不一致；
2. 故意丢字段的 `third-party-adapter-variant-nonconforming` fixture 触发预期 conformance 失败；
3. 三个既有 mask 测试与当前 snapping／text-canvas／path 行为不一致；
4. 一个 project-persistence diagnostic 测试以未绑定方法调用私有 helper；
5. 一个 placement 测试传入严格整数时间边界拒绝的 fractional media ticks。

本轮定向验证另有 Rust motion-text/time 86 项、motion-text CLI/UI model/renderer/audio/export 106 项、安装验收验证器 13 项通过；Vite 类型检查、构建、WASM、SBOM 与 package boundary 检查通过。这些结果不替代全仓失败，也不代表 Creator Studio 实际入口或 installed 性能验收完成。

## 关闭顺序

1. 用 `probe-motion-text-font-readiness.mjs --candidate` 对分别固定 SHA-256 的字体与 OFL 1.1 许可文件做落库前审计，再选择 zh-Hans 字体资源；
2. 正常同步 installed WASM 并重跑门禁；
3. 形成验证 commit，更新 plugin pin/vendor/dist；
4. 在仅安装产物环境执行 Creator Studio 与第 14 节验收；
5. 更新本清单，把关闭项链接到最终证据，但不删除历史限制记录。
