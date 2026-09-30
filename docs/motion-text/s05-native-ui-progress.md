# S05 原生 UI 与 M1 编辑闭环进展

> 日期：2026-09-27
> 阶段状态：canonical WASM 路径下的正式 F01 原生编辑与 MP4 导出闭环已验证；G5/M1 尚未关闭
> 权威计划：`docs/design/rocut-jizura-integration-development-plan.md` 的 S05

## 当前原生入口

素材面板新增 `Motion text` 入口。用户可输入逐行中文或其他文本，选择 4 个 starter preset，并在当前播放头插入固定 15 秒片段。sequence factory 位于 Rust，负责 cue 身份、时间分配、seed、planner、engine/catalog 元数据和 resolved plan；React 只收集输入、显示诊断并发起事务。

sequence 与引用 clip 通过同一个 `InsertElementCommand` 提交，因此只有一次耐久保存和一条历史记录。撤销同时移除二者，重做同时恢复二者；非法 sequence、ID 不一致和重复 sequence 均 fail closed。

输入入口已覆盖：

- 空输入禁用；
- Ctrl/Cmd+Enter 快捷插入；
- 中文 IME composition 期间不误提交；
- preset 卡片有 `aria-pressed` 和可见键盘焦点；
- Rust warning/error 在面板内显示，不生成部分 sequence。

## 专用属性页

motion-text 片段的默认属性 tab 已从通用 Transform 改为专用 `Motion text`。页面按编辑器现有语义色、UI 字体和窄侧栏密度设计，没有引入新的视觉系统或非用户触发动画。

当前页面提供：

- sequence revision、默认 style/layout/enter/hold、默认字体和配色摘要；
- 按时间排列的歌词 cue 列表；
- 当前播放头对应 cue 高亮，并显示当前 resolved cut 的 style/enter；
- 每个 cue 的“继承 sequence”或“局部 style/font/color/parameters”状态；
- 点击 cue 定位播放头；被裁剪在可见区间外的 cue 给出明确提示；
- sequence defaults 可编辑默认字体、preset 配色或自定义 foreground/accent；
- cue 可编辑中文文本、start/duration、局部 starter 风格、局部字体和局部配色，并可逐项恢复继承；
- 4 个 starter 风格卡片会生成 Rust restyle candidate，并在真实预览 canvas 中显示结果；
- 变体面板可选择全序列／当前 cue 和 style、layout、enter、hold、exit、treat、cam 分组，生成或 reroll 确定性候选；
- Cancel 只丢弃本地候选，不写工程；
- starter／variation Apply 复用候选 sequence，经 `UpdateMotionTextSequenceCommand` 以一个 project transaction 提交；一次 undo/redo 恢复整个 sequence；
- defaults／cue Apply 调用 Rust `mutateMotionTextSequence` 校验并重建 resolved plan，再走同一事务入口；
- cue 局部配色已接入真实渲染，override 只影响所属 cue，不污染其他 cue。

属性页没有建立第二个 Zustand store，也没有直接修改 project JSON 或绕过保存。候选描述只属于组件本地，renderer manager 只保存一个不耐久的 preview override；已提交状态始终来自 active project。编辑器支持 Ctrl/Cmd+Enter，并在中文 IME composition 期间阻止误提交；sequence/cue lock、非法字体、非法颜色、空文本、越界时间和 cue 重叠均由 Rust fail closed。

`mutateMotionTextSequence` 每次成功 mutation 只增加一次 revision，保留未知 sequence/cue 扩展字段，并重新生成 resolved plan。已应用的 variation 在之后修改其他 cue 的文字或时间时保留；只有显式把所属 cue 的局部 preset 恢复继承才清除该 cue 的既有 resolved 选择。工程 codec 将 motion-text sequence 视为完整实体替换，避免 undo 时从新版持久化记录复活已删除的 plan 或局部 override，同时继续保留已经随 sequence 解码进入内存的扩展字段。

## 真实候选与预览隔离

Rust 新增 `createMotionTextVariationCandidate`。输入为完整 sequence、uint32 salt、稳定 cue ID 集合、preset group 集合和 renderer support manifest；Rust 校验目标、分组、revision 上溢和 renderer 能力，调用既有 planner 执行确定性选择、cue／cut／preset-group／parameter lock 保留，并返回 `baseRevision`、`candidateRevision`、实际 salt、诊断和完整候选 sequence。不存在的 cue、重复目标、空分组、无 renderer 候选及全锁定无变化均不返回部分 sequence。

候选只替换 preview render tree 中同 ID 的 sequence。保存、缩略图和导出仍直接读取 active project，因此未 Apply 的候选不会泄漏到任何耐久或成片路径。Cancel 清除临时覆盖并恢复 committed frame；project revision 变化或切换／关闭属性页会自动丢弃 stale preview。Apply 不重新生成结果，直接提交已预览的 `revision = base + 1` sequence；若 base 已过期，既有 command revision 门禁拒绝提交。

## Rust 时间规则

正式时间换算均在 `motion-text` Rust crate：

- `mapMotionTextClipTime`：timeline → sequence；
- `mapMotionTextSequenceTimeToTimeline`：sequence → timeline。

双向规则共同处理 clip start、clip duration、trim start 和 sequence duration，区间统一为半开 `[start, end)`。React 不复制裁剪换算，只消费 WASM 结果并把合法时间交给 playback manager。

## 当前验证

```text
cargo test -p motion-text
33 pass, 0 fail

bun test packages/editor-classic/src/wasm/__tests__/motion-text-factory.test.ts \
  packages/editor-classic/src/wasm/__tests__/motion-text-time.test.ts \
  packages/editor-classic/src/services/renderer/__tests__/motion-text-node.test.ts \
  packages/editor-classic/src/core/managers/__tests__/transaction-command-routing.test.ts \
  packages/editor-classic/src/editor/persistence/__tests__/project-codec-motion-text.test.ts
52 pass, 0 fail

npx --no-install eslint <本批 motion-text factory/time/UI/renderer/transaction/codec 文件>
pass

apps/vite-example: bun run typecheck
pass

node script/check-wasm-api-surface.mjs
51 JS exports; 68 stable WASM exports + 3 compiler trampolines; pass

node script/check-wasm-paths.mjs
pass

node script/check-wasm-init.mjs
Bun/Node real initialization pass

node script/probe-motion-text-node.mjs
all reported checks true，含 variation candidate revision／WASM 边界

node script/probe-motion-text-ui.mjs
12-cue F01 fixture（强调、impact、手动分段、1.5 秒间奏、三段连续下层视频）通过
starter 与 variation 的真实 canvas preview、Cancel 逐像素恢复、stale candidate 丢弃、variation 单次 undo/redo、Apply 后保存重开全部通过
IME、Ctrl+Enter、fractional cue time 保真、overlap fail-closed、lock/custom preset、defaults dirty state、焦点／滚动、1024px 视口约束、真实时间线移动／左裁剪／拆分／撤销／重做及拆分后重载全部通过
640×360 MP4 导出通过；video/mp4、ftyp 文件头、下载落盘与源 Blob 均为 412726 bytes
7.000 秒预览 canvas／导出 MP4 抽帧比较通过；RGB mean absolute error = 3.5829 / 255
```

UI 探针在真实 Chromium 中启动完整 Vite editor，运行时显式 alias 到 canonical `rust/wasm/pkg`，因此不会把 installed WASM 未同步的问题伪装成已解决。它通过真实文件选择器导入 5 秒 H.264 fixture 三次，并由时间码 UI 定位到 0／5／10 秒形成 15 秒连续下层视频；随后创建 12-cue 中文 sequence，确认强调、impact、手动分段和间奏进入工程。探针先后对 starter 和 variation 截取 committed／candidate／Cancel 后 canvas，确认候选真实改变画面且 Cancel 恢复原始像素；variation Apply 后只需一次 Ctrl+Z 撤销、一次 Ctrl+Shift+Z 重做，保存重开仍保持 candidate revision。此外，探针修改 cue，移动、裁剪、拆分时间线片段，保存重开后确认三段视频和两个拆分片段仍存在，并从同一工程导出非空 MP4；同时校验应用实际创建的 Blob、`<a download>`、MIME、`ftyp` 文件头、文件名和浏览器落盘字节一致。它还将播放头固定到 7 秒，截取真实预览 canvas，再以 ffmpeg 从 MP4 同一时间抽帧并在内存中比较；统一尺寸后的 RGB mean absolute error 为 3.5829／255。1024×768 截图检查未发现页面级横向溢出；窄属性栏中的 cue 文本正常换行，编辑器可滚动并获得焦点。正常 Vite 依赖入口仍会在 React 挂载前因 installed 二进制不匹配报 `function signature mismatch`，与下述依赖同步阻塞一致。

正式 F01 还暴露并修复了一个真实 UI 缺陷：Rust 对 12 个 cue 分配的时间不一定落在 0.01 秒网格上，属性面板原先用 `toFixed(2)` 展示后无条件把舍入值回传，导致“只改文字”也可能产生 cue overlap。现在仅当用户实际编辑时间输入时才换算新 tick；未编辑的 start/duration 保留 Rust 原始值。探针同时断言初始 Apply 禁用、文字修改后启用，并确认提交成功。

`apps/vite-example` TypeScript 全量检查通过。本批相关 ESLint、Prettier、Rust fmt、52 项 motion-text Bun 测试、6 项 frame-proof Bun 测试及 33 项 Rust 测试均通过。CLI frame-proof 测试已改用声明过的 `@opencut/editor-classic/timeline` 入口，`check:packages`、`check:surface-labels` 和 `check:packed-closure` 均通过。

canonical WASM 经后续 S07/S09 增量与 zh-Hans 字体资产落库后当前为 5,511,220 bytes，SHA-256 `14de620a1bfa38228a43e4103cc557ae7a27bbb30185bfffae91b17d685e75a8`。root 与 `apps/web` installed copy 已经正常依赖路径（`npx --yes bun@1.2.18 install`）同步到同一二进制；聚合 `bun run check:wasm` 现为全绿，含 source currency、paths、API surface 与 Bun／Node init。无 alias 的 installed 入口 `MOTION_TEXT_UI_INSTALLED=1 node script/probe-motion-text-ui.mjs` 也跑通 33 项检查。

## 未关闭项

本文件不是 G5/M1 完成声明。至少还需：

1. 正式 F01 的 12-cue 数据、下层视频、强调、间奏、修改、移动、左裁剪、拆分、撤销／重做、保存重开、MP4 导出及同时间抽帧比较均已有 canonical Chromium 证据；
2. 获得依赖同步授权后更新已安装 WASM 二进制，并从正常依赖入口重跑同一 UI 闭环。目前两个 installed copy 的二进制仍与 canonical build 不同；在此之前不得关闭 S05/G5/M1，也不得手改副本掩盖该阻塞。
