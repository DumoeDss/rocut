# 2026-10-11 集成审查

本记录审查 Rocut `d21c45bb`、Creator Studio `c5a2804` 之后的 MV、程序化画面、动画和导出链路，以及当时尚未提交的 Three revise、模型导入、Electron Liquid/native video、资源释放、WASM 包闭包和 Creator 模板入口。生产源码、共享依赖、安装目录和其他 session 的改动未被修改。本轮只新增本记录；没有提交或推送。

审查读取的四个仓库 HEAD：Rocut `d21c45bb06ae93a96490464abf421f646d77a4af`；Creator `c5a28047761de885d760deb05ab286aeb37caeb6`；Host `df1a26f8161ed83bd6c89e78ae9a164c187d6902`；producer `17025a02576d5d62d344965f6e9c283274978fe7`。HEAD 只标识已提交边界，不能标识正在变化的 dirty 源码；下一次隔离复跑必须另存移植后的文件 manifest。

## 结论与证据边界

本轮未发现可独立复现的新增源码 P0。已确认的风险主要是验收范围和包身份混用；下面的 P0 是整体验收阻断项，不表示已定位根因。定向测试通过不能替代新基线的真实 Host/编辑器/导出，也不能替代安装态 Electron 验收。

| 身份 | SHA-256 | 本轮用途 |
| --- | --- | --- |
| 当前 canonical `rust/wasm/pkg/opencut_wasm_bg.wasm` | `5dbd6c3cd9920fd19486ff5172d24af2d302e9d5bc5973864a8b108b7570faf5` | 只读包闭包/ABI 解析；历史 Glass/Ink/Liquid 全时长导出也使用此包 |
| 当前 shared `node_modules/opencut-wasm` | `ddade5ea1caedb1d5b721b58171ee4360d5ec3d2e9ca21cfb39d16e2939b8657` | 本轮未显式 alias 的真实 Rust 边界 Bun 测试；root、CLI、editor-classic 三处解析结果一致 |
| 新权威包 | 尚未在本审查中构建或使用 | 统一复跑必须显式绑定；禁止将上述两个身份的通过记录改写为新包通过 |

`script/runtime-wasm-package-closure.mjs:14` 的只读调用通过：canonical sync JS、glue 和 binary 能相互满足 ABI。sync JS SHA 为 `3ea9403a7e21fb5c1228062c356fad1843cc461822c57342b942aa3e96b84c17`，glue SHA 为 `a5317704b269497f6208b7f946c4f6e393e9e5be8a9fdc972e40ae19a0d156cc`。这只是已生成包的内部一致性，不证明它由当前 Rust 源码生成。

## 修复和验收清单

### P0-A：Tunnel 完整矩阵存在独立的非确定性阻断

- 证据：`docs/evidence/mv-tunnel-intermittent-nondeterminism-20261011.json:3`、`:58`、`:73` 记录相同代码的完整矩阵在不同 visit/case 上出现大幅发散，而孤立、preroll 或紧接重复可准确重现。原记录对 timing/resource pressure 的归因仍是调查解释，不能据此认定具体 native 层根因。
- 触发：完整矩阵非单帧、非截断运行；单帧通过不能关闭此项。
- 与 glyph-edge 残差分开：`mv-tunnel-992-663-attribution-20261011.json` 的 frame-4 光栅归因不解释完整矩阵的间歇性发散；不能调整阈值或用 `MATRIX_CAP` 关闭问题。
- 最小可信回归：在新包和同一冻结浏览器/字体/参考源码下执行 `node script/probe-mv-tunnel-native.mjs --browser-only`。保持现有 `max<=6, mae<0.025` 门限，移除诊断 cap、skip、preroll 配置；有限重复完整矩阵用于验证非确定性是否消失，保留每次的所有 frame/hash/失败证据。
- 阻断：阻断 Tunnel 完整验收和整体全通过声明；不自动阻断不宣称此能力已验收的技术构建。

### P1-A：Three revise 当前测试没有覆盖实际编译事务

- 文件：`apps/cli/src/__tests__/programmatic-build-revision.test.ts:64`、`:91`、`:99`。
- 触发：Three 真实归档资源经 revise 替换/新增/重命名/删除，然后 recompile、保存、重开、取帧/导出。
- 证据：Three 当前单测只证明越过引擎门后因 `Missing programmatic resource: main.ts` 拒绝；真实 archive revision 循环只含 HF/Remotion，且本轮两项因缺少 `ROCUT_TEST_BUILD_REVISION_TOOLCHAIN` 跳过。`programmatic-build-files.test.ts` 的三引擎测试证明归档变化和 binary 保留，不证明 Three 编译器工作。
- 历史有效边界：已有 `probe-glass-editor.mjs` / `probe-ink-editor.mjs` 真实 Host revise/UI 证据，不能说 Three revise 从未运行；但其旧包/旧源码不能证明本轮新增 add/rename/delete/model-feature 组合。
- 最小修复：复用既有 Glass/Ink Host 与 pinned Three toolchain 做一例短 Three revise：原归档 compile，删除 author 目录可用性，新增 helper、重命名 entry、修改 import 和 inputProps，recompile，旧 source 仍可 frame、修订 source 输出改变，项目 reopen 后描述/hash 不变。失败操作须不发布新 document/不改变旧项目。随后跑现有 edited Glass 全时长 export，而非扩展所有模型。
- 命令入口：`node script/probe-glass-editor.mjs <artifact-parent> <chromium.exe> <bun.exe> <creator-assets> <new-pkg> <three-toolchain>`；导出 `ROCUT_GLASS_EXPORT_FULL=1` 配合 `node script/probe-glass-object-editor-export.mjs <saved-editor-run> <new-pkg> <three-toolchain> <chromium.exe> <ffmpeg.exe> <ffprobe.exe>`。新增文件操作仍需一个对应的真实 compile 定向例，现有入口不自动覆盖全部新增操作。
- 阻断：阻断本轮 Three 多文件 revise/model authoring 的完整放行；不是现有静态普通 Three 的已证明回归。

### P1-B：Electron native-video 扩展没有关闭 source soundtrack 路由

- 文件：`apps/cli/src/programmatic/html-rasterizer.ts:116`、`:137`。
- 触发：选择 Electron connection 且 compiled source 带 `source.audio`，即使配置了 FFmpeg/FFprobe 和新增 native-video callback。
- 结果：在进入新 callback 前明确抛出 `Native source audio requires the configured soundtrack adapter on this backend`。Particle Electron 也保留 source-audio/offthread-video 限制。
- 定性：这是可见的刻意支持范围限制，没有静默 fallback；`docs/hyperframes-native-audio-graph.md` 保持 standalone 验收边界，因此不将其误报成新增正常支持场景回归。若本轮目标宣称完整 MV Electron 闭环，此路径仍缺接线；新增视频回调不能被写成音视频闭环已完成。
- 最小下一步：由该链路 owner 决定接入已受控的 soundtrack/graph adapter，或继续明确 capability 不支持；保留有音轨 source 的 Electron refusal 测试和无音轨 native-video 成功/取消/恢复测试。完整支持需短音视频项目在同一 Electron backend export 后独立检查 PCM/帧数/时间戳。
- 阻断：不阻断当前明确无源音轨的 HTML/Three 画面技术打包；阻断 Electron native-source-audio/full-MV 支持声明。

### P1-C：历史全时长导出和当前新链路验收未绑定

- 文件：`docs/evidence/glass-object-editor-export-full.json:20`、`:79`；`ink-object-editor-export-full.json:70`、`:94`；`liquid-object-editor-export-full.json:74`、`:97`。
- 证据：历史 Glass/Ink 是 49 帧，Liquid 是 61 帧；真实 `decodeProject/buildScene/CanvasRenderer/WasmCompositor/SceneExporter` 和独立 FFmpeg decode 有效，明确排除 Electron/installed。其 WASM 是 canonical `5dbd6c3c…`，本轮 Bun 则是 shared `ddade5ea…`。
- 最小修复：统一复跑记录每项实际 served/loaded binary hash、sync/glue、源码 manifest、Creator helper、toolchain lock、浏览器/FFmpeg 身份；新包 stdout 或路径名字不能替代实际响应 bytes hash。更新证据须新增本轮 receipt，保留历史 scope。
- 涉及包装：`script/pack-runtime.mjs:156` 预检、`:193` 复制 binary、`:382` 打包；当前 canonical 闭包解决 stale installed JS 选择问题，但不能代替当前源码 rebuild。共享 canonical 仍可被其他 session 改写，因此打包以冻结源码/包为输入并 recheck source/package pins，不能仅相信预检时读取的路径。
- 阻断：ABI/glue/binary 不一致、打包中身份变化、loaded 包与报告不一致都阻断产物验收；旧 scope 的真实通过仍保留。

### P1-D：新增模板/模型/释放合同通过，实际安装态仍未证明

- 新 Creator gallery fallback、36 个 helper/reference 路由、`rocut-canvas` / `rocut-three` / HF / Remotion selection 和 prompt 传递的定向合同测试均通过。新入口是 authoring choices，不是安装成功/能力健康证据。
- 模型 glTF closure 包装、作者字节归档/恢复、完整性/链接拒绝和 incomplete restore 保留的定向测试通过；不升级为任意模型/SVG/skinning/codec 已安装 render 接受。
- Compositor 异步 request 开始前注册 ownership、阻止 GPU 同时使用、close 后 drain 的测试用隔离 WASM doubles；不能据此声明真实 GPU callback/race 已验收。
- 最小验收：一例真实 glTF 导入→普通 Three compile→非顺序 frame→保存/reopen→source restore；一例 feature SVG 和 animation clip；Particle/Glass/Ink/Liquid fixtures 继续各自既有约束。安装态用实际打包内容进入 gallery、选择模板、probe capability 和创建一个项目；记录 capability unavailable 的用户行为。Electron native-video 和 Liquid 分别成功→取消→同 grant 恢复，最后 native window/worker/broker 退出。
- 阻断：声明本轮新增模型、模板和 Electron 支持前必须补相应验收；纯作者 helper 可继续作为需 probe 的 authoring entry。

## 本轮最小检查

| 检查 | 结果 | WASM 与实际范围 |
| --- | --- | --- |
| Rocut 9 个 build/model/asset/Electron/compositor 定向 Bun 文件 | 30 pass / 2 skip / 0 fail，225 assertions | Rust resource/build validation 使用 shared `ddade5ea…`；Electron orchestration 与 codec/feature IO 用合同 fixtures，ownership 由独立子进程 mock `opencut-wasm`；无真实 GPU/export |
| Rocut scalar batch/admission/project admission 3 文件 | 13 pass / 0 fail，26 assertions | 真实 scalar/admission 项使用 shared `ddade5ea…`；部分项目/批次诊断使用 core doubles；没有新包/GPU验收 |
| Creator template renderer/catalog/IPC 3 Vitest 文件 | 32 pass | 纯合同，无 WASM |
| Creator `node --test scripts/tests/rocut-template-entry.test.mjs` | 2 pass | 统一 helper identity、36 helper/reference 存在性，无 WASM/render |
| Host native video/Liquid session/particle/descriptor 4 Vitest 文件 | 46 pass | mock Electron/CDP/HTTP 协议合同，无真实 Electron 窗口、WASM或GPU |
| canonical `resolveRuntimeWasmPackage({repoRoot:process.cwd()})` | pass | 只读 `5dbd6c3c…` 包闭包，不是源码重建/行为测试 |
| `git diff --check` | pass | 执行时全工作树仅做只读检查；没有清理其他 session 变化 |

Rocut 第一个 Bun 命令的文件：`programmatic-build-revision`、`programmatic-build-files`、`programmatic-model-import`、`programmatic-model-restore`、`three-asset-features`、`three-codec-closure`、`liquid-object-electron`、`electron-native-video-server`（均在 `apps/cli/src/__tests__`），以及 `packages/editor-classic/src/services/renderer/compositor/wasm-compositor-ownership.test.ts`。两项 skip 明确是 HF/Remotion 实际编译环境未配置，不写成 pass。

## 统一复跑有限矩阵

所有行从同一冻结源码执行，绑定同一 `new-pkg`。仅接受实际 loaded bytes identity；日志保留失败和 skip。浏览器侧与 Host Node/Bun 必须各自记录选包。脚本直接 alias canonical 的行只能在私有 snapshot 中以新包替换其私有 canonical 路径，不能改写共享依赖。`fixture-source.json` 需在该冻结 snapshot 生成并验证。

| 族 | 既有入口 / 有限范围 | 必须环境、依赖 | 失败是否阻断 |
| --- | --- | --- | --- |
| WASM/pack | `check-wasm-source` / `check-wasm-paths` / `check-wasm-api-surface` / `check-wasm-init`；runtime closure + Node/Bun 固定 worker smoke | pinned Rust/wasm-bindgen，源码 manifest，新包绝对路径；private snapshot | ABI、import、路径、worker、实际 bytes 错误阻断技术打包 |
| 动画 | `probe-scalar-animation-runtime-parity.mjs`；linear/step/bezier/extrapolation，legacy omission；一个 editor keyframe/reopen | 新包、Node/Bun；editor fixture | 当前支持语义或保存回读失败阻断相应能力 |
| Canvas 基础/空间/扭曲 | `probe-stylized-effects.mjs` 的默认、`--generators`、`--spatial`、`--magnify`、`--displacement`、`--wave`；每模式一次 | 私有 canonical 新包、fixture manifest、`ROCUT_PROBE_BROWSER_PATH`、Vite/mediabunny | 已登记 V 的当前行为失败阻断相应放行 |
| Reveal/Sweep/Mesh/Cloth | `probe-reveal-effects.mjs`、`probe-sweep-scroll.mjs`、`probe-mesh-scenes.mjs`（含既有 cloth/refraction 模式） | `<chromium.exe> <ffmpeg-directory>`；私有 snapshot alias 新包 | 同上，不以单shader通过代替editor/export |
| 2D Liquid | `probe-liquid-effects.mjs`、`probe-liquid-cancellation.mjs`，每受支持 backend 固定矩阵一次 | browser、FFmpeg、显式 `ROCUT_LIQUID_READBACK_PKG`、artifact root | 取帧取消/恢复失败阻断当前Liquid能力 |
| Droplets/Clouds/Blaze | `probe-droplets.mjs … pipeline`、`probe-clouds.mjs … pipeline`、`probe-blaze.mjs` 加各族一个现有 editor/export | snapshot/pkg/artifact parent/browser 均绝对路径；editor/export另需其现有config/FFmpeg | 当前V export失败阻断；只raster不计export |
| Bubble/Frost/Canvas/FlameWrap | `probe-bubble.mjs` + `probe-bubble-export.mjs`；`probe-frost-editor.mjs <config> --export`；`probe-canvas-capture.mjs <pkg> <artifacts> webgl canvas`；`probe-flame-wrap-editor.mjs`现有 full 模式 | Bubble default/diagnostic包分开；Frost/private build config；Canvas现有明确presentation-only；FlameWrap默认420与显式444分开 | 历史 N/partial 不自动阻断技术构建，不能升级V；current accepted范围退化阻断 |
| Three 基础/codec/feature | `probe-three-scene.mjs` 普通/`--ascii`/`--dither`；`probe-meshopt-three.mjs`；一个model/SVG/clip新例 | 固定three/toolchain lock、Creator assets、实际package closure、新pkg；静态模型/环境fixtures | 模型/feature本轮放行前必过；无网络隐式加载 |
| Particle/Glass/Ink/Liquid Object | `probe-particle-editor-export.mjs`；Glass edited49帧；`probe-ink-object-editor-export-full.mjs`49帧；`probe-liquid-object-editor-export-full.mjs`61帧 | Creator assets、新pkg、Three toolchain、browser、FFmpeg/FFprobe；真实persisted project与worker退出证据 | 当前已验收对应链路失败阻断 |
| HF/Remotion | `probe-hyperframes.mjs <toolchain>`、`probe-remotion.mjs <toolchain>`；native video与音频一个短例 | pinned toolchain、新pkg Host/browser分别绑定、native decoder；音频graph所需DSP/Chromium身份 | 当前引擎范围退化阻断；Electron soundtrack另列不支持 |
| MV 主家族 | Ember/Fall/Thread/Ink/Night/Heart/Flame/TitleRiff/KanjiSlam/TypeCard/Tunnel 各既有 `probe-mv-*` 固定矩阵，不扩展历史诊断脚本 | `ROCUT_TEST_WASM_DIRECTORY`、`ROCUT_TEST_MV_REFERENCE`、`ROCUT_TEST_BROWSER_EXECUTABLE`、`ROCUT_TEST_RUST_SOURCE`、FFmpeg/FFprobe；对应真实字体、analysis/landmark/参考资源 | 完整目标失败阻断整体MV验收；诊断skip/cap不得通行 |
| Creator/Electron 安装态 | 本记录合同测试；实际gallery选择一次；Liquid与native-video各成功/取消/同grant恢复一次 | 新Host/producer能力descriptor、真实安装payload/连接文件、actual loaded新pkg；必要用户会话 | descriptor/runtime错配阻断安装产物；mock成功不能替代 |

矩阵不承诺整个生态、所有 codec、硬件GPU或全曲制作通过。各族原门限和原参考保留；默认编码失败与显式替代编码通过分别记录。正常构建成功、历史V、source-only合同成功和实际本轮安装验收是不同证据。
