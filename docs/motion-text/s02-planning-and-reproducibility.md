# S02 序列规划与可复现性

> 日期：2026-09-26
> 阶段结论：通过 G2
> rocut 输入基线：`8246f0b9c463d32e1d807cfed18b62c7baed04a4`
> JIZURA 对照基线：v0.9.0 / `bae339e450512435b829a717248ea92ae5b44899`

## 实现范围

平台无关的解析、分段、规划、随机选择、锁定、时间映射和校验均位于
`rust/crates/motion-text`。React 和 Classic editor 没有复制这些规则；Node/Bun 和浏览器
调用同一份 WASM 导出：

- `parseMotionTextSource`
- `tokenizeMotionText`
- `planMotionTextSequence`
- `mapMotionTextClipTime`

`MotionTextSequence.resolvedPlan` 仍是 S01 冻结的工程级持久数据。S02 只生成和替换 plan，
不建立第二种工程格式，也不把 JIZURA 的工具 ID 或行号索引写进 rocut 工程。

## 解析与稳定身份

歌词解析兼容首批 JIZURA 文本语义：

| 输入语义   | 当前行为                                                     |
| ---------- | ------------------------------------------------------------ |
| plain text | 每个非空、非注释行生成 cue                                   |
| LRC        | 支持一行多时间标签、`.`/`:` 小数、乱序后按时间排序           |
| 元数据     | 支持 `ti`、`ar`、`al`、`by`、`offset`                        |
| 间奏       | 支持日／中／英／韩关键词和显式秒数                           |
| 注释与段落 | `#` 行忽略；空行记录 `gapBefore`                             |
| 行内语义   | `\|` 注解、`_..._` 强调、尾部 ASCII `!` impact、`/` 手工分段 |
| 异常时间   | 产生结构化 diagnostic；混合有时间／无时间 cue 产生 warning   |

cue ID 由 `sequenceId + cue text + 同文本 occurrence` 稳定派生，不再包含 source line。
因此在前方插入不同文本的 cue，不会让后续 cue 的覆盖、锁和已解析 cut 错绑。完全相同文本
的多次出现仍以 occurrence 区分；若在同文本序列前插入同文本，身份歧义必须由上层编辑器
以显式 ID 操作解决，不能伪装成可自动推断。

cut ID 由 `sequenceId + cueId + segment text + 同文本 occurrence` 派生。重新规划时先以 cut
ID 对齐旧 plan，只有旧数据没有相同 ID 时才回退到同 cue 内的 index，以便兼容早期草稿。

## 确定性 tokenizer

tokenizer 版本固定为 `unicode-v1`，不调用 `Intl.Segmenter`：

- 显式 `segments` 永远优先，并随 sequence 持久化；
- 英文按最多三个词／约九个字母的短语聚合，并避免留下过短尾段；
- 中文、日文按四个 Unicode scalar 或标点分段；
- 韩文按三个 Unicode scalar、空格或标点分段；
- 空白和空 segment 被规范化移除。

这不是语言学分词器，而是跨 Rust、Node、Chromium 可复现的业务切分器。需要精确歌词节奏
或语言边界时，调用方应保存显式 segments；未来改变默认算法必须新增 tokenizer version，
不能在 `unicode-v1` 下静默改变结果。

固定 fixture 覆盖中文、日文、韩文、英文与显式日文分段，期望摘要保存在
[`motion-text-semantic-expected.json`](../../script/fixtures/motion-text-semantic-expected.json)。

## 规划算法

规划输入先完整校验；任意 error 都返回 `plan: null`，绝不返回部分 plan。合法输入按如下顺序
处理：

1. cue 按 `startTime + id` 排序，输入数组顺序不参与结果；
2. tokenizer 产生 segment，间奏产生单个空文本 cut；
3. cue duration 按 segment 字符权重做整数边界分配，每个 cut 至少一个 tick，且总和严格等于 cue duration；
4. 由 sequence seed、cue ID、cut ID 和 variation salt 派生 32-bit cut seed；
5. catalog 先按稳定 preset ID 排序，再做权重选择，catalog 输入顺序不影响结果；
6. cue override 覆盖默认值，随后应用 preset-group、parameter、cut 和整 cue 锁；
7. cut 按 `startTime + id` 输出，并写入 plan version 与 sequence revision。

局部变体只重算目标 cue 和目标 preset group。非目标 cue 从已有 resolved plan 原样复用；
锁定 group、parameter、cut 或整 cue 的视觉快照保持不变。整 cue／cut 锁同时保留 seed、preset、
font 和 parameters，但时间与文本身份仍服从当前 sequence，避免锁把已删除内容复活。

## JIZURA 权重与约束元数据

[`audit-jizura-registry.mjs`](../../script/audit-jizura-registry.mjs) 现在除完整 912 项目录外，还
输出可直接传给 Rust 的 `plannerChoices`：

- 887 个可选择项；排除 23 个 font 和 2 个 special layout；
- 读取上游 `w` 作为基础 weight；
- 对 layout 的 `fits(n)` 在 0–256 字符范围执行并压缩为 `minChars`／`maxChars`；
- 读取 enter/exit 等定义的 `maxChars`；
- 把 `minDur` 秒数转换为 120,000 ticks/s 的 `minDuration`；
- 当前共有 252 项带至少一个字符或时长约束，审计无 warning。

Rust planner 对 weight、重复 `group:id`、字符范围和时长范围 fail closed。权重极高但不满足
约束的 preset 不进入候选集合；固定 fixture 含一个高权重、`minChars=100` 的不兼容 layout，
证明约束先于权重生效。

本阶段只移植首批选择所需的静态权重与范围约束。JIZURA 的 style bias、历史 novelty、
portrait bias、emphasis、busy/treat 组合规则等将在 S06/S07 随对应 renderer pack 分批进入
版本化 catalog；它们不会在 React 中临时实现。

## 时间和邻接语义

cue 校验要求：

- sequence duration 为正整数；
- cue start 非负、duration 为正，且结尾不超过 sequence；
- cue ID 非空且唯一；
- cue 半开区间 `[start, start + duration)` 不得重叠；
- cut 数不能大于 cue duration ticks，保证每个 cut 有正 duration。

transition 只有在存在恰好邻接的前一个 cut、且前后都不是间奏时才保留或参与随机选择；
首 cut、时间有 gap 的 cut 和间奏边界会把 `trans` 归一为 `null`。这显式表达了 JIZURA
`canTrans` 的邻接依赖，避免孤立 transition 在 seek 或 split 后引用不存在的前帧。

clip 使用半开区间映射：

```text
sequenceTime = trimStart + timelineTime - clipStart
active iff timelineTime ∈ [clipStart, clipStart + clipDuration)
       and sequenceTime ∈ [0, sequenceDuration)
```

因此 trim 不触发重新规划；同一 sequence 的 split 片段共享 plan，只改变采样窗口。

## WASM wire 与 editor contract

planner 返回值使用 JSON-compatible WASM serializer：

- Rust `BTreeMap` 在 JS 中是 plain object，不是 `Map`；
- JSON null 在 JS 中保持 `null`，不变成 `undefined`；
- `preset.trans` 与 `fontId` 的空值显式为 `null`；
- `MotionTextParameterValue` 声明为 JSON union，object 分支是 `Record`。

`MotionTextPresetOverride.trans` 是三态输入：字段缺失表示继承，`null` 表示明确禁用 transition，
字符串表示指定 preset。Rust 使用自定义 deserializer 保留这个区别。

WASM wire 的普通 string/number 经
`motionTextResolvedPlanFromPlanner()` 在 `@opencut/editor-contracts` 边界增加 nominal ID 和
`MediaTime` brand。编译 fixture 使用生成的 `opencut_wasm.d.ts` 作为输入类型，转换后的 plan
可直接赋给 `MotionTextResolvedPlan`，并通过完整 sequence validator。

本次公开 WASM surface 从 40 增至 44 个 JS exports；binary 为 61 个稳定 export 加 3 个
compiler trampoline，612 imports，66 行低层声明。API surface、负向 controls 和真实 Node/Bun
初始化门禁均已重新录制并通过。

## 与 JIZURA 原版的有意差异

| JIZURA 0.9 行为                                   | rocut S02 行为                                      | 原因                                 |
| ------------------------------------------------- | --------------------------------------------------- | ------------------------------------ |
| seed 混入 line/cut index                          | seed 混入稳定 cue/cut ID                            | 前插无关 cue 不应重滚后续内容        |
| 依赖 `Intl.Segmenter`，无则走 fallback            | 固定 `unicode-v1` 或显式 segments                   | 浏览器／Node／Rust 必须一致          |
| plan 含 renderer 函数生成的大量参数和 events      | S02 先冻结选择、时间、seed、preset、font、parameter | 绘制参数随 S03/S06 pack 分批进入     |
| history novelty、统一感和 style bias 参与全局选择 | 当前只有 catalog weight/range 和局部 variation      | 先得到可测试、可持久化的最小确定核心 |
| line lock 保存 `lockedCuts` JSON 快照             | resolved plan + 稳定 ID + typed locks               | 避免第二套私有工程结构               |
| 无效或部分时间可在 UI 流程中继续推导              | error 原子失败，无 partial plan                     | 防止持久化不可重放的半计划           |

因此 S02 不声称与原版 plan bit-exact。原版是行为和目录来源；rocut 的稳定身份、跨 runtime
一致性、事务持久化和半开时间语义是有意修正。

## G2 验证

通过：

```text
cargo test -p motion-text
13 pass, 0 fail

cargo check -p motion-text --features wasm
PASS

node script/probe-motion-text-node.mjs
PASS：固定语义摘要、JSON wire、非法时间原子失败

node script/probe-motion-text-browser.mjs
PASS：parse / plan / tokenize / clip-time / 语义摘要在 Node 与 Chromium 完整一致

node script/check-wasm-api-surface.mjs
PASS：44 JS exports；61 stable + 3 trampoline；612 imports；66 declarations

node script/check-wasm-api-surface.mjs --negative-control
PASS：27 negative/positive controls

node script/check-wasm-init.mjs
PASS：Bun bare entry、Node sync entry、真实 migration chain

bun x tsc --noEmit --ignoreConfig --strict --target ES2022 --module ESNext --moduleResolution Bundler --skipLibCheck --lib ES2022,DOM script/fixtures/motion-text-planner-typecheck.ts
PASS：生成的 WASM 声明、planner adapter 和 MotionTextResolvedPlan 完整类型链

bun test packages/editor-contracts/src
150 pass, 0 fail

bun test packages/editor-contracts/src/__tests__/motion-text.test.ts
10 pass, 0 fail
```

G2 判定：

- 同数据重复规划一致：通过 Rust equality test 与固定摘要；
- 前插 cue 不错绑后续覆盖：通过 parser test 与 Node/Chromium fixture；
- 锁定内容在局部变体后不变：通过 group、parameter、cut/cue snapshot tests；
- 非法时间原子失败：`plan: null` + `overlapping-cues`；
- 跨 Node／浏览器结构一致：完整对象深比较通过。

### 尚未闭合的环境同步项

聚合命令 `bun run check:wasm` 当前只在 `check-wasm-source` 失败：

```text
root node_modules/opencut-wasm/opencut_wasm_bg.wasm differs
apps/web/node_modules/opencut-wasm/opencut_wasm_bg.wasm differs
```

`rust/wasm/pkg` 已由当前 Rust 源码生成，且上述 API surface、初始化、Node 和 Chromium
直接门禁均已通过；差异只存在于工作区已安装的两个 WASM 包副本。同步它们需要执行
`bun install`，但共享依赖重装不在本阶段的既有授权内，因此没有执行，也没有绕过包管理器
手工改写 `node_modules`。获得明确授权并同步后，应重新运行 `bun run check:wasm` 关闭此项。

## 下一阶段

S03 将实现单一 `MotionTextNode`，让 preview、随机 seek、thumbnail 和 export 共享同一个按
source tick 求值的渲染入口。动态纹理必须按 sequence revision、plan revision、source tick、
尺寸、字体摘要和 engine version 更新 content hash，不能复用静态 canvas identity 缓存。
