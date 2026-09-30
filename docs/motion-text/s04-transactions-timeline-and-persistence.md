# S04 事务、时间线行为与耐久保存进展

> 日期：2026-09-27
> 阶段状态：核心行为与 canonical WASM 证据完成；G4 尚未关闭
> 权威计划：`docs/design/rocut-jizura-integration-development-plan.md` 的 S04

## 已落地的数据流

motion-text 没有新增第二个工程写入口。UI 与 Agent 都继续进入同一事务引擎：

```text
Classic command
  → detached project draft
  → OpenCut projection diff
  → one transaction batch
  → ProjectStore durable save
  → committed project publication

CLI HTTP apply
  → AutomationApi
  → the same transaction engine
  → the same editor-plane record
```

sequence create/update/delete 和 motion clip create/update/delete 都属于原有 operation union。projection 保持关系安全顺序：删除时先 clip 后 sequence，创建时先 sequence 后 clip。sequence 与引用 clip 因而能在一个 revision 内一起成功或一起失败。

本批修复了一个会阻断所有既有 motion-text 工程后续 UI 编辑的问题：`SessionOpenCutTransactions.readDocument()` 之前没有读取引擎中的 `motionTextSequences`。引擎实际已有 sequence，但 UI diff 把它误判为新实体，再提交重复 `create-motion-text-sequence`。现在事务基线、detached draft 和持久记录三者都读取同一 sequence 集合；移动、裁剪、拆分、复制和删除不会再制造重复创建。

## 时间线语义

motion-text 继续复用 graphic track 和通用时间线命令：

- 移动只改变 clip timeline start；
- 裁剪更新 duration／trim，sequence 内容不被复制；
- 拆分的左右片段共享同一个 `sequenceId`；
- source split point 只舍入一次，满足 `left.trimStart + left.duration === right.trimStart`；
- 默认复制保持共享 sequence，与现有“复制所选片段”快捷键语义兼容；
- 删除、批量选择、撤销和重做继续使用原事务历史。

新增的 `motionTextCopyMode: "independent"` 提供“复制为独立动效”能力。该模式仍由同一个 `DuplicateElementsCommand` 和事务路由提交，不建立旁路。

## Rust 独立复制核心

平台无关的身份重建位于 `rust/crates/motion-text/src/identity.rs`，WASM API 为 `duplicateMotionTextSequence`。TypeScript 只负责 JSON 边界解码和事务编排，不生成 cue/cut 身份。

Rust 核心执行以下规则：

1. 调用方提供新的 sequence ID；旧 ID 与新 ID 必须不同且格式有效。
2. cue 和 resolved cut 使用带域分隔的 SHA-256 派生稳定新 ID。
3. cut 的 `cueId` 按 cue 映射重写；缺失引用或重复旧 ID fail closed。
4. 新 sequence revision 和 resolved-plan `sequenceRevision` 重置为 `0`。
5. source、时间、seed、preset、parameters、locks、内部转场和字体引用保持不变。
6. 使用 JSON value 原位重写已知身份字段，因此未知 additive 字段不会被 Rust struct 解码丢弃。
7. 同一输入与目标 sequence ID 重复调用得到完全相同的映射和 JSON。

一次命令中若多个被复制 clip 原本共享一个 sequence，它们的独立副本仍共同引用同一个新 sequence，保留组内共享关系；新 sequence 与所有新 clip 在同一事务中创建。撤销删除二者，重做恢复二者，只占一个 UI 历史动作。

## CLI、耐久保存与双向读回

Automation API 现在公开 `motionTextSequences()`，本地 Host 增加只读端点：

```text
GET /<token>/api/motion-text-sequences
```

CLI 证据覆盖：

- graphic track、sequence、引用 clip 在一个 HTTP batch 创建；
- 相同 idempotency key 重放保持 revision `1`，不重复创建；
- 使用过期 expected revision 的后续批次返回 conflict，且目标 track 不存在；
- 无面板端点立即读回相同 sequence；
- Host 关闭后从 `project.json` 重开，sequence 和 clip 引用仍一致；
- Classic 事务提交后的 sequence 可由同一公共读取面读回。

CLI editor plane 对高于 `CURRENT_PROJECT_VERSION` 的记录新增降级写保护：启动 Host 或显式 migration walk 都会拒绝该记录，不会用旧 runtime 覆盖未来 schema，原始文件保持不变。

Browser session gate 与 BrowserProjectStore migration discovery 也会在持久版本高于当前版本时 fail closed，且在任何 migration 写入前停止；混合旧版／未来版记录同样不会绕过 store 级检查。

Project storage schema 已从 v31 提升到 v32，并新增 additive-only v31→v32 migration。迁移只在字段缺失时增加 `motionTextSequences: []`，已有集合、同名 opaque 值及其他未知字段均原样保留。新工程因此明确要求 v32 writer；从 v32 开始，CLI、通用 session gate 和浏览器迁移都拒绝更高版本的降级写入。

已经构建或发布的 v31 runtime 无法被 v32 代码追溯修补，且它的元素白名单可能在保存 v32 工程时丢失 clip 的 `sequenceId`。因此 v31 不是 motion-text 工程的安全 writer：不得用 v31 打开后保存 v32 工程，最低安全读写版本明确为 v32。当前阶段不宣称历史二进制具备不存在的强制保护。

Classic codec 同时保留 decode normalization：旧工程或 malformed payload 缺少可用集合时在内存中归一为 `[]`；已存在 sequence 的未知字段经 known-field rewrite 后保留。motion-text schema／plan 的未知版本在事务校验边界 fail closed。

## 当前验证

```text
cargo test -p motion-text
20 pass, 0 fail

bun test packages/editor-classic/src/core/managers/__tests__/transaction-command-routing.test.ts
23 pass, 0 fail

bun test apps/cli/src/__tests__/host.test.ts
8 pass, 0 fail

bun test apps/cli/src/__tests__/editor-plane.test.ts
14 pass, 0 fail

bun test packages/editor-classic/src/services/storage
140 pass, 0 fail

bun test packages/editor-classic/src/editor/session/__tests__/session-lifecycle.test.ts \
  packages/editor-classic/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts
2 isolated harnesses pass, 0 fail

bun test packages/editor-contracts/src packages/editor-automation/src \
  packages/editor-classic/src/editor/transactions/opencut \
  packages/editor-classic/src/editor/persistence/__tests__/project-codec-motion-text.test.ts \
  packages/editor-classic/src/services/storage \
  packages/editor-classic/src/core/managers/__tests__/transaction-command-routing.test.ts \
  apps/cli/src/__tests__/editor-plane.test.ts apps/cli/src/__tests__/host.test.ts
358 pass, 0 fail

node apps/electron-host/scripts/generate-clip-project.mjs \
  --root <临时目录> --clips 2 --name "S04 v32 verification"
PASS（record envelope、payload 及重开数据均为 schema v32）

node script/probe-motion-text-node.mjs
PASS（含 independentIdentity）

node script/check-wasm-api-surface.mjs
PASS：46 JS exports，63 stable WASM exports + 3 trampolines，612 imports

node script/check-wasm-paths.mjs
PASS

node script/check-wasm-init.mjs
PASS（32 个 transformer，CURRENT_PROJECT_VERSION=32）

bun run typecheck  # apps/cli
PASS

bunx eslint <本批受影响的已配置 TypeScript 文件>
PASS
```

`apps/web` 的全工程 `tsc` 仍有工作树既有 diagnostics（Bun test types、双 Next 类型、既有测试 fixture 类型等）；过滤本批生产文件后没有新增 diagnostic。`check-package-boundary` 仍只报告既有的 `apps/cli/src/__tests__/frame-proof.test.ts` 未声明 Classic 子路径导入，与本批无关。

## G4 尚未关闭的原因

canonical `rust/wasm/pkg` 已包含身份重建 API，但 root 和 `apps/web` 的已安装 `opencut-wasm` 二进制仍旧。按当前约束没有执行 `bun install`，也没有手工修改 `node_modules`。因此：

- canonical Node probe 和 WASM surface gate 已通过；
- 当前安装副本尚不能在正式 Classic runtime 调用新的独立复制核心；
- `node script/check-wasm-source.mjs` 仍只报告 root 与 `apps/web` 两个二进制不同。

S04 的 schema migration 任务已经完成；仅靠 additive decode normalization 不足以隔离旧 v31 writer，因此已新增 v31→v32 migration，没有修改任何历史 migration。

关闭 G4 前还需：

1. 获得依赖同步授权后执行 `bun install`；
2. 重跑完整 `bun run check:wasm`；
3. 通过后关闭 G3/G4，再进入 S05。

用户可见的“复制为独立动效”菜单／快捷入口属于 S05 原生 UI；S04 已提供事务能力和 manager API，不将 UI 入口冒充为本阶段完成项。
