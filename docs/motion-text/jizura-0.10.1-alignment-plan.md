# JIZURA 0.9.0 → 0.10.1 对齐方案

> 决策日期：2026-10-20。上游 pin：`bae339e450512435b829a717248ea92ae5b44899`（0.9.0）
> → 目标 pin：`fc16bfe`（0.10.1）。本文只记录已核实的事实与实施顺序；
> 未执行项一律标注「未执行」，不以计划代替证据。

## 1. 已核实的上游差异

用本仓 `script/audit-jizura-registry.mjs` 对 0.10.1 checkout 重新生成目录，与入库的
0.9.0 目录逐项比对（生成物在 `elftia/.artifacts/jizura-align-20261020/`）：

| 项 | 0.9.0 | 0.10.1 | 结论 |
| --- | --- | --- | --- |
| catalog 条目 | 912 | 912 | 相同 |
| planner 投影 | 887 | 887 | 相同 |
| 12 组计数 | 27/23/186/125/52/109/130/62/66/36/69/27 | 同左 | 相同 |
| 去掉 `source.version` 后逐字节对比 | — | — | **完全一致** |
| `LICENSE` / `THIRD_PARTY_NOTICES.md` blob | `560026b6` / `a78cd43d` | 同左 | 未变 |

即：0.10.0 与 0.10.1 对 registry 加载文件（`01–08`、`11p_*`、`11q_sets`）的改动
**没有增删或重排任何预设**，全部是行为变化。预设 ID 集合变化为零。

## 2. Rocut 不是移植，是原生重写

这是决定漂移范围的架构事实，必须在动工前明确：

- `MotionTextResolvedCut`（`rust/crates/motion-text/src/planner.rs:360`）字段为
  `id / cue_id / text / start_time / duration / seed / preset / font_id / parameters`，
  **没有 `chunks`**。JIZURA 在 plan 时就把分行算好存进 plan；Rocut 在渲染时才分行
  （`packages/editor-classic/src/services/renderer/motion-text/typography-layouts.ts:268`）。
- `panels` 在 Rocut 是 `layouts-a-scene.ts:287` 的独立实现（固定 3 色板、自带配色、无阅读轴），
  与 JIZURA `11p_layoutsA.js:1403` 的「2–3 chunk + 逐面板随机字体/倾斜/宽度 + 按阅读方向擦除」
  不是同一设计。

因此「吸收 0.10」= 把这 6 项改进吸收进我们自己的实现，不是搬运上游代码。

## 3. 漂移面

| JIZURA 0.10 项 | Rocut 对应层 | 改变老工程渲染？ |
| --- | --- | --- |
| 拉丁整词不切 + 按字符数均衡分行 | render 时 | **会**（多词拉丁文本换行位置变化；日文 `words.length===1` 走字符切分，不变） |
| `panels` 拉丁 LTR | render 时 | **会**（本次决定一并重做 panels） |
| 隐藏装饰数字/时刻 | render 时 | 不会（新增参数默认关） |
| LRC 行序保持书写位置 + 固定时刻挤压 | Rust plan 时 | 不会（`start_time` 已持久化） |
| おまかせ主题（`J.THEMES` 六种） | Rust plan 时 | 不会（选中项已持久化） |
| 每 cut 开始时刻 | Rust plan/时序 | 不会（新增字段） |

上游自身把这次定为**次版本**（其 CHANGELOG 规定 major 才代表工程文件格式兼容性变更），
与本表判断一致：破坏面只在渲染观感，不在数据。

## 4. 版本与哈希：改为容错读取，而不是继续冻结

`JIZURA_CATALOG_HASH` 是内容派生的。本次内容未变，仅 `source.version` 六字节变化，
文档 hash 由 `9ec6f3be…`（606,262 B）变为 `4608ad7a…`（606,268 B）。

现状问题（`rust/crates/motion-text/src/attachment.rs:40-42`）：

- `engine.version` 与 `catalogHash` 做**精确相等**校验，且无迁移路径，
  升级后老工程渲染/导出会硬失败；
- `engine.version` 在运行时**不驱动任何行为**（唯一用途是这条校验），
  属于被当锁用的记账字段；
- 被校验的 catalog 文档并不是运行时加载的那份；真正加载的
  `jizura-planner-catalog.json` 只校验 `schema_version` 与条目数，不与任何 hash 比对。

改为：**读时接受「当前或已知历史身份」，写时只写当前身份。**
保留全部结构校验（id 唯一、区间不重叠、cut 在 cue 内、文本上限、
`plan.version`、`tokenizerVersion`）——它们是真实契约。

## 5. 实施清单（验收完成后执行）

1. 重新生成 catalog 与 planner 投影，`--revision fc16bfe`，版本记 0.10.1。
2. 更新 `factory.rs:28` `JIZURA_ENGINE_VERSION` 与 `factory.rs:29` `JIZURA_CATALOG_HASH`。
3. 按第 4 节改造 `attachment.rs` 身份校验。
4. 行为吸收：
   - 分行：整词边界 + 按字符长度均衡（替代 `distributeWords` 的等词数分配）；
   - `panels` 重做：2–3 chunk、逐面板随机化、按阅读方向擦除、拉丁 LTR；
   - 装饰数字/时刻隐藏：新增参数，默认关；
   - LRC 行序与固定时刻挤压（Rust planner）；
   - おまかせ主题（Rust planner）；
   - 每 cut 开始时刻。
5. 同步 11 处硬编码 `"0.9.0"` fixture：
   `surface-transaction-binding.test.ts:42`、`opencut/__tests__/fixture.ts:34`、
   `mv-jz-renderer.test.ts:10`、`motion-text-font-runtime.test.ts:51`、
   `motion-text-node.test.ts:65`、`draft/conformance/index.ts:162`、
   `motion-text-engine.test.ts:38`、`motion-text.test.ts:35`、
   `apps/cli/src/__tests__/host.test.ts:71`、`structured-cues-fixture.ts:38`；
   `rust/crates/editor-api/src/mv_jz_owner_tests.rs:24` 复用常量，随常量变化。
6. 同步 `upstream-sources.md`（pin、版本、摘要）与本文。
7. 回归：Rust `motion-text` 全套、`check:motion-text:presets`、`check:motion-text:costs`、
   `check:sbom`、渲染器 Chromium probe。
8. 插件链：vendor → build → verify:dist → pack，新 epkg 重新安装并复验。

## 6. 关于「889 条 Chromium 证据」

该批证据是 S07 覆盖战役的一次性产物，门禁**不重放浏览器**：
`check:motion-text:costs` 在 `benchmark-motion-text-renderer.mjs:91` 直接
`process.exit(0)`，`chromium.launch` 位于其后。审计脚本仅在
`cost.source.rendererSupportVersion !== MOTION_TEXT_RENDERER_SUPPORT_VERSION` 时
认为成本报告过期；过期时 `costTier` 回落到 `unmeasured`，而
`allCostsMeasured` 只是报告中记录的布尔值，不是致命门禁。

因此：不涨 `MOTION_TEXT_RENDERER_SUPPORT_VERSION` 就不需要重跑基准；
若因新增参数涨版本，应重跑一次基准以保持证据陈述真实，不可只重生成报告让字段变成
`unmeasured` 而仍宣称已测。

## 7. 顺序约束

本轮改动完成后，Rocut 需要重新 `vendor -> build -> pack -> 安装`。这属于**机械重装**，
不使既有安装验收失效：那 11 项测的是原生 tab / 资产详情 / 替换流 / 定位链 / 回退，
与本轮 motion-text 改动不相交。重装后只需补测 motion-text 自己的证据。

## 8. 执行状态（2026-10-20）

已完成：

1. 目录按 0.10.1 / `fc16bfe` 重新生成，差异仅 `source.version` 与 `source.revision`；
   兼容报告重新生成，1827 行替换全部是这两处戳。
2. `JIZURA_ENGINE_VERSION = "0.10.1"`、`JIZURA_CATALOG_HASH = sha256:4608ad7a…`。
3. `attachment.rs` 改为**身份校验**：接受当前或历史 engine 版本 / 目录 hash
   （`JIZURA_LEGACY_ENGINE_VERSIONS` / `JIZURA_LEGACY_CATALOG_HASHES`），
   写入仍只写当前。结构校验（schemaVersion、id、tokenizer、时长、cue 上限）不变。
4. 渲染器吸收：
   - `balancedWordLines`：只按词边界分行，按字符数均衡，行数不超过词数；
   - 单个拉丁词不再被字符切分（CJK 仍按字切分）；
   - `panels` 重做：2–3 块、按字符量分配宽度、斜切分隔、逐块擦除、强调块反白，
     拉丁左→右 / CJK 右→左 / 竖屏上→下；
   - 装饰数字与时刻可隐藏（`jizura.hideNo` / `jizura.hideTime`，默认关闭），
     歌词里出现的同样文本不受影响。
5. **混合 LRC 时间**：`assign_mixed_timing` 取代原来的 fail-closed 拒绝。
   有时间戳的行是锚点，锚点之间的无时间行按书写顺序填满空隙；
   时间戳不前进时顺推 50 ms 而不是整体拒绝；解析器保留 `mixed-lrc-timing` warning
   由调用方展示。`source.rs` 的行序也从「无时间行排到最后」改为「紧跟其书写前一行」。
6. **おまかせ主题**：目录里的 `metadata.tags` / `wa` 已投影进 planner 目录
   （856 条带标签、34 条 wa），`MotionTextTheme` 六向（lyricPv / kinetic / wa /
   horror / pop / ballad）按 mood 标签收窄随机池；某组无匹配时回退整池。
   `theme` 是可省略字段，未选择时不写盘。

无需实施（原先误判为缺口）：

- **每 cut 开始时刻**已经完整存在：`planner.rs` 的 `deterministic_segments` 自动切分，
  `cutDurations` 在契约里（`motion-text.ts:202`）并持久化，
  编辑入口 `packages/editor-classic/src/motion-text/components/cut-timing-editor.tsx`
  已挂载在 `properties-tab.tsx`。JIZURA 0.10 的「第二段起的开始时刻」与 Rocut 的
  「边界结束时刻」是同一件事的两种呈现。

未执行：

- packaged surface / canonical WASM 需在出包轮次重新构建并重跑导出证据。
