# S01 公共契约、核心桥接与存储设计

> 日期：2026-09-26
> 阶段结论：通过 G1
> rocut 输入基线：`8246f0b9c463d32e1d807cfed18b62c7baed04a4`
> JIZURA 输入基线：v0.9.0 / `bae339e450512435b829a717248ea92ae5b44899`

## 实现范围

- 在 `@opencut/editor-contracts` 冻结 motion-text schema v1、resolved-plan v1、120,000 ticks/s 时间单位和 branded IDs。
- 增加工程级 `MotionTextSequence`，覆盖 source、engine/catalog 版本、audio binding、font assets、defaults、cue overrides/locks 和 resolved cuts。
- 公共 `Clip.content` 只保存 `{kind: "motion-text", sequenceId}`。sequence 是项目级实体，clip 不复制歌词、计划或资源列表。
- 在既有事务 union 中增加 sequence create、full-replacement update 和 delete；没有建立第二个工程写入口。
- 在 Classic donor 增加 `MotionTextElement`，复用 graphic track，保留 rocut 的时间、trim、params、动画、隐藏和效果行为。
- 同步扩展 draft inverse/review、幂等 fingerprint、in-memory engine、native adapter、能力发现、conformance 和向量语料。
- 同一 Rust/WASM 解析入口分别由 Node sync entry 与 Chromium bundler entry 调用并比较结构化结果。

## 冻结的数据与所有权

```text
TProject.motionTextSequences[]
  └─ MotionTextSequence (工程级、可修订、可由多个片段引用)

GraphicTrack.elements[]
  └─ MotionTextElement
       └─ sequenceId

public Clip
  └─ content: { kind: "motion-text", sequenceId }
```

`MotionTextElement` 不把 sequence JSON 塞进 `params`。普通 transform、opacity、blend mode 和 keyframe 仍走现有标量参数系统；结构化歌词、锁定与 resolved plan 由 sequence 所有。

工程存储使用 additive 字段 `motionTextSequences`。`project-codec.ts` 对旧工程缺失字段归一为 `[]`，并在 encode 时写回；timeline element 白名单增加 `sequenceId`。没有修改任何历史 migration。

## schema 和资源边界

版本常量：

- `MOTION_TEXT_SCHEMA_VERSION = 1`
- `MOTION_TEXT_PLAN_VERSION = 1`
- `MediaTime = integer ticks`，固定 `120_000 ticks/second`

运行时校验覆盖：

- schema/plan 版本与 engine/version/catalog/tokenizer 元数据；
- sequence/cue/cut/font ID 格式和重复 ID；
- 正 duration、非负时间、有限 parameter number 和 32-bit seed；
- cue/cut 范围、cut→cue、font 和 asset 引用；
- source 字符数、cue/cut/font 数量、parameter 深度／节点／字符串长度；
- 可选的已知预设目录校验，ID 使用 `group:id`，例如 `layout:center`。

## 事务与 revision 语义

最终操作 payload：

```ts
{ kind: "create-motion-text-sequence"; sequence }

{
  kind: "update-motion-text-sequence";
  sequenceId;
  expectedSequenceRevision;
  sequence; // 完整 replacement
}

{
  kind: "delete-motion-text-sequence";
  sequenceId;
  expectedSequenceRevision;
}
```

update 使用完整 replacement，避免嵌套 cue、lock 或 plan 被浅 patch 静默丢失。`sequenceId` 必须与 replacement 的 `sequence.id` 相同。实体冲突返回 `provider:motion-text-sequence-revision-conflict`；事务全局 revision 仍严格递增。

sequence replacement 不额外强制“新 sequence revision 必须大于旧值”。这是为了让 draft inverse 能精确恢复旧快照；常规领域编辑器在 S02 生成递增 revision。并发保护依靠 `expectedSequenceRevision`，不能依靠 replacement 自报的 revision。

关系和批次顺序：

1. 删除引用 clip；
2. 删除无引用 sequence；
3. 创建 sequence；
4. 创建引用 clip。

因此 sequence 与 clip 可以在同一 batch 原子创建；删除仍被 clip 引用的 sequence 会失败；motion-text clip 只能位于 graphic track。重复 idempotency key 返回原结果，不重复创建实体。

## 能力与旧客户端行为

- `supportedOperations()` 返回三种新 operation kind。
- capability `motion-text-sequences: true` 表示 host 能读写该实体。
- `TransactionRead.motionTextSequences()` 保持为可选方法，使旧 host 源码仍能满足接口；新 host 返回数组。
- 旧持久文档缺少 `motionTextSequences` 时，native adapter 与 Classic codec 都补 `[]`。
- 不认识新 operation 的旧 host 必须返回 unsupported-operation；调用方不得降级为直接改工程 JSON。
- motion-text schema v1 的最低安全读写能力不是某个尚未发布的 semver，而是上述 capability 加三种 operation。插件发版后再把该能力映射到具体 rocut 版本。
- 未知 schema/plan 版本在契约边界明确报错。未来字段可由 Classic 的 opaque overlay 保留；“保留”不等于旧 runtime 可以编辑或渲染。

## Node／浏览器桥证据

`script/probe-motion-text-browser.mjs` 对同一有效 fixture 和无效 fixture 分别调用：

- Node sync WASM entry；
- Chromium bundler WASM entry。

两端比较完整结构化返回；无效 fixture 固定得到 `invalid-lrc-time` error diagnostic。当前结果：

```text
probe-motion-text-browser: 2 Node/browser fixtures match (valid + invalid)
```

Node 单独探针在 Node v24.14.0 下运行，无 DOM/global document 依赖。

## 验证

通过：

```text
bun test packages/editor-contracts/src
148 pass, 0 fail

bun test packages/editor-classic/src/editor/transactions/opencut/__tests__/adapter-router.test.ts packages/editor-classic/src/editor/persistence/__tests__/project-codec-motion-text.test.ts
14 pass, 0 fail

bun test packages/editor-classic/src/editor/surface/embedding/__tests__/surface-transaction-binding.test.ts
5 pass, 0 fail

node script/generate-vector-manifest.mjs --check
node script/check-sdk-surface-labels.mjs
npm run probe:motion-text:node
npm run probe:motion-text:browser
```

额外覆盖：

- sequence 与引用 clip 同批创建并 durable reopen；
- sequence revision 冲突、keyed replay、被引用 sequence 删除失败；
- 旧文档缺字段、Classic 保存重开、timeline `sequenceId` 白名单；
- sequence 内未知 additive 字段经 known-field rewrite 后仍保留；
- projection create/delete 的关系安全排序；
- Surface 对三种新操作和 `Clip.content` 做实际运行时校验。

全 `bun test packages/editor-classic/src` 当前为 423 pass / 6 fail（补齐本阶段新增 operation fixture 后）。剩余失败属于工作树既有问题：mask snapping 三项、isolated persistence 的 `describeFailure` 绑定、singleton command-count 快照和 placement 测试中的非整数 MediaTime fixture。它们未被当作 G1 通过证据。

`node script/check-package-boundary.mjs` 的 motion-text 新增边界已通过；仍有一个既有 CLI 测试导入未声明 `@opencut/editor-classic/timeline/types` 子路径的失败。

## 已知限制与下一阶段

- S01 只冻结 schema、桥接和耐久存储；resolved plan 的确定性生成、局部锁定／变体算法属于 S02。
- `MotionTextElement` 已可被事务、codec、选择、移动、trim 和通用 split 基础设施承载；独立复制时的 sequence/cue/cut 身份重建在 S02 核心 API 完成后接入 S04。
- 未知未来 schema 目前可保留但不可编辑；最低版本 UI 与降级写保护在 S04/S08 绑定到实际发布版本。
- 尚未渲染 motion-text；预览、seek、thumbnail 和 export 的单一 `MotionTextNode` 属于 S03。

门禁结论：G1 通过。S02 可以依赖 schema v1、sequence revision CAS、稳定 ID 和 Node/browser 一致的 Rust/WASM 入口。
