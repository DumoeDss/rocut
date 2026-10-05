# Rocut 原生文字动效

> 状态日期：2026-09-28。本文描述源码基线已经验证的能力；尚未把它声明为最终安装插件能力。

Rocut 已把 JIZURA 的文字动效、预设和工程导入能力吸收到同一个视频编辑器中。JIZURA 是受控上游与兼容输入，不是第二个编辑器、第二套时间线或 Creator Studio 的新工具 ID。工程、sequence、cue、cut、preset、revision 和 timing 的真值由 Rust 与 Rocut 事务层持有；React 只负责交互、预览与绘制。

## 用户入口

1. 在素材面板打开 `Motion text`，输入逐行文本或带时间戳歌词，选择 starter preset，并在当前播放头插入片段。
2. 选中片段后，在专用 `Motion text` 属性页编辑 sequence 默认值、cue 文本与时间、cut 边界、字体、配色、预设、锁定和规划控制。
3. 可绑定场景中的音频片段，执行节拍分析、手工 BPM／首拍覆盖、打点或歌词时间重同步。分析结果和手工覆盖是不同字段；原音频片段仍是唯一播放与导出音源。
4. 在预设库中搜索或按 11 个组筛选 889 个 drawable preset。目录只挂载可见项，预览资源随滚动、切项目和卸载释放。
5. 通过现有 Rocut 时间线移动、裁剪、拆分、复制、撤销与重做。动效源时间随片段几何映射，不由 React 自行重算。
6. 使用现有导出入口导出完整时间线或 cue 选区。最终成品仍经过 `CanvasRenderer`、`WasmCompositor` 和 `SceneExporter`。

详细 UI 行为见 [S05 原生 UI 进展](./s05-native-ui-progress.md)、[S06 音频与歌词时间](./s06-audio-analysis-progress.md) 和 [S07 预设覆盖](./s07-preset-coverage-progress.md)。

## JIZURA 工程导入

`.jizura.json` 通过 Rust importer 转换为原生 `MotionTextSequence`，再走与普通创建相同的 Rocut 事务。导入结果会返回逐字段兼容性、缺失资源和诊断；带 warning 的导入不会标为完全兼容。音频、字体重关联、未锁定随机规划、title card 和原 JIZURA 画布／导出设置存在语义差异，调用方必须展示诊断。

## CLI 与 Agent 用法

公开的高层接口为：

```text
rocut motion-text catalog
rocut motion-text list
rocut motion-text create <spec.json>
rocut motion-text mutate <sequence-id> <mutation.json> [--preview]
rocut motion-text vary <sequence-id> <variation.json> [--apply]
```

所有命令复用 `--target <id|auto>`、`--project <dir>` 和现有认证 Host。创建示例：

```json
{
	"source": "LIGHTS RISE\nWE MOVE",
	"sourceFormat": "plain",
	"language": "en",
	"duration": 360000,
	"startTime": 0,
	"starterPreset": "impact-title",
	"seed": 7,
	"expectedRevision": 0,
	"idempotencyKey": "creator:motion-text:lights-rise:v1"
}
```

`expectedRevision` 和 `idempotencyKey` 必填。若没有 `trackId`，Host 会在同一事务中创建 graphic track。返回值包含稳定的 sequence／clip／track／cue／cut ID、project revision、sequence revision、受影响 ID 和 Rust 诊断。

修改前必须先 `motion-text list` 或 `rocut read`，使用刚读到的两级 revision。sequence 冲突返回 HTTP 409 和 `motion-text-sequence-conflict`；project 冲突沿用事务层 `conflict`。相同 key 与相同请求是幂等重放，相同 key 与不同请求返回 `motion-text-idempotency-conflict`。Agent 不能直接写 `project.json`、构造 resolved plan 或用通用事务模拟缺失的高层能力。

JIZURA 导入使用 `sourceFormat: "jizura"`，并把原始 JSON 文本作为 inert `source` 传入；duration、language、seed、字体和 resolved plan 由 Rust 决定。完整协议见 [S08 Agent 接口](./s08-agent-interface-progress.md)。

### 只读候选与人工审批草稿

`motion-text mutate ... --preview` 接受 `mutation` 与 `expectedSequenceRevision`，调用同一 Rust planner，返回 `applied: false`、当前 `projectRevision`、`baseSequenceRevision`、`candidateSequenceRevision` 和完整 `candidate`。不修改工程、不增加 revision、不写幂等日志；写入用的 `expectedRevision`／`idempotencyKey` 在预览模式不必提供。默认不带 `--preview` 的行为仍为直接提交，仍要求完整写入保护字段。

需要人工审批时，先 `draft begin`，再生成候选。用一个 `update-motion-text-sequence` 操作提交到 `draft stage`：`sequenceId` 为返回 ID，`expectedSequenceRevision` 为返回 `baseSequenceRevision`，`sequence` 必须原样使用 Rust 返回的 `candidate`，不能手工编造或修改 resolved plan。审批前工程保持不变；取得用户对具体变更的批准后才 `draft approve`。用户保存导致草稿失效或 revision 冲突时，重读并重新生成候选／草稿，不复用陈旧候选。预览采用独立的 `mutation-previews` 接口，旧宿主拒绝时应更新插件，不能自动回退成直接写入。

### 在编辑器中审阅 Agent 草稿

Elftia 内打开编辑器左下角的 Editor menu → Review agent changes，可刷新待审草稿、查看修改前后对照，再点击 Approve changes 或 Reject proposal。长内容在面板内滚动，大型渲染计划可展开查看完整值。关闭弹窗不会批准或拒绝草稿。

审批绑定服务端返回的精确审阅版本；如果 Agent 在审阅期间追加修改，旧审批会被拒绝，必须刷新并重新查看。用户编辑、项目保存或宿主重启也可能让草稿失效，此时要求 Agent 重新读取工程并生成提案。审批结果不确定时，不自动重试。仅支持声明草稿审阅能力的宿主。

### 修改歌词与手工切分

修改 cue 歌词后，Rust 会更新实际渲染分段，而不只更新属性面板中的文字。普通分段重新按语言生成；已有手工 cut 时长且 cue 总时长不变时，若新文字仍能填满相同数量的非空分段，则保留时长并重新分配文字。文字太短、分段只含空白或总时长改变时，清除过时的分段时长并重新规划。仅修改其他属性、不改变歌词时，不重分段；cut 锁仍会阻止歌词修改。

## 当前交付边界

- canonical 源码运行时已验证 912 项权威目录，其中 889 项是可绘制 preset，23 项是字体角色。
- 889 项全部完成 Chromium 可见性验证和正式 compositor／export 两帧 smoke；五组代表 preset 另有独立 MP4 矩阵。
- F06 已覆盖 24、25、30、60、30000/1001 fps 与 16:9、9:16、1:1 的 15 个 canonical export 组合。
- F05 的 8 分钟、600 cue、1,200 cut 已完成 14,400 帧低分辨率编码，并验证完整范围取消。
- 普通视频、普通文字、原生图形与 48 kHz 音频已在同一 canonical scene 中导出双轨 MP4。
- F01 UI 探针与独立 readiness 审计共享同一提交后文本；19 份离线字体中 `gothic_bold` 的 zh-Hans 变体（Noto Sans SC）0 缺字，是唯一全覆盖资产。`ko`／`zh-Hant` 仍按缺字门禁拒绝，不得使用环境字体或放宽门禁。
- Rust 已支持稳定字体角色到语言资产变体的一次性解析；工程持久化具体资产 ID，所以重开、锁定、变体和显式选择不会随目录升级漂移。`gothic_bold_zh_hans` 已经正常依赖路径随 installed WASM 同步；plugin dist 待 L03 打包后随安装产物验收。
- root 与 `apps/web` 的 installed WASM 已与 canonical 逐字节一致（`bun run check:wasm` 全绿，installed 入口 F01 探针 33/33）。插件 `upstream.json`、`vendor/`、`dist/` 仍待更新，因此源码通过不等于已安装插件通过。

具体状态见 [能力支持矩阵](./capability-support.md)、[S09 验证矩阵](./s09-verification-matrix.md)、[安装产物验收证据契约](./s09-installed-acceptance-contract.md)、[字体 readiness 报告](./s09-font-readiness.json)、[已知限制](./s09-known-limitations.md) 和 [上游来源清单](./upstream-sources.md)。

## 维护规则

- 新的业务规则、preset 选择、cut/timing、工程迁移和冲突语义进入 Rust／事务层。
- Canvas2D 字体测量、纹理与像素绘制可留在 renderer，但只能消费 Rust 产生的计划和稳定 seed。
- 新能力必须同时更新 catalog／support manifest、对应测试、本文支持矩阵和交付闭包。
- 只有从验证 commit 走正常依赖同步、plugin vendor/build，并在无 sibling checkout 环境完成最终脚本后，才能把“源码支持”提升为“安装产物支持”。
