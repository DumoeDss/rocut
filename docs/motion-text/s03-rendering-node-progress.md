# S03 动效渲染节点进展

> 日期：2026-09-27
> 阶段状态：功能实现与 canonical 验证完成；G3 等待已安装 WASM 副本同步后关闭
> rocut 输入基线：`8246f0b9c463d32e1d807cfed18b62c7baed04a4`
> JIZURA 对照基线：v0.9.0 / `bae339e450512435b829a717248ea92ae5b44899`

## 本批已落地

新增原生 `MotionTextNode`，并接入 rocut 的统一渲染树：

```text
scene-builder
  → MotionTextNode
  → resolve（Rust/WASM clip-time 映射）
  → JIZURA renderer adapter
      ├─ support-manifest
      ├─ runtime
      ├─ draw
      └─ font-runtime
  → frame-descriptor（rendered texture）
  → WasmCompositor
```

工程级 `motionTextSequences` 现在由以下路径传入同一个 `buildScene`：

- 实时预览；
- 项目缩略图；
- Classic renderer manager 导出；
- Electron 独立 export renderer；
- session／Vite 集成 harness。

没有为预览或导出建立第二个动效绘制入口。隐藏 track／clip 仍由 scene-builder 的既有可见性过滤处理，片段和 sequence 均使用半开区间。

## 时间、视觉节点和合成

- 片段到 sequence source tick 的映射继续调用 Rust/WASM `mapMotionTextClipTime`；React/Canvas 层没有复制生产时间规则。
- 动效纹理使用当前 renderer 的实际宽高，不继承 `GraphicNode` 的固定 512×512 设计面。
- 节点复用视觉元素的 transform、animation、opacity、blend mode 和 clip effects。
- `overlay` 不填充背景；`scene` 才拥有完整背景。两者都作为当前轨道 z-order 中的一层进入 WasmCompositor。
- 无 active cut 的 overlay 不产生纹理；超出 clip 或 sequence 区间时节点解析为 `null`。

动态纹理使用 `rendered` descriptor，而不是按 canvas 对象身份缓存的 `external` descriptor。content hash 包含：

- sequence ID／revision；
- plan version／sequence revision；
- engine version／catalog hash；
- source tick；
- cut ID、seed、preset、parameters；
- font fingerprint 与颜色；
- renderer 尺寸。

同一节点跨帧保持一个 texture ID，source tick 或影响像素的状态变化会改变 content hash。compositor 现在按 `texture ID + content hash` 决定是否重画和调用 `uploadTextureForHandle`：相同 hash 不上传，新 hash 必须上传；texture 离场和 compositor dispose 都会释放 GPU owner。连续 1002 个不同帧只复用一个 backing `OffscreenCanvas`，不会为每帧积累纹理或临时画布。

## 首批 JIZURA renderer pack

adapter 已拆成兼容 re-export、类型、runtime、draw 与 support manifest。它没有 DOM 模块加载副作用、播放器／存储／UI 状态或 `Math.random()`；随机微动只使用 `cut.seed + 24 Hz step` 派生值，因此随机 seek 与顺序采样一致。

已实现的首批预设：

| 分组   | 当前实现                                                                   |
| ------ | -------------------------------------------------------------------------- |
| style  | `base`、`noir`、`crimson`、`caution`、`mono`、`paper`                      |
| layout | `center`、`huge`、`marquee`、`mixed`、`stack`、`type`、`vcols`             |
| enter  | `blur`、`cut`、`fade`、`pop`、`slideL`、`slideR`、`wipe`                   |
| hold   | `breathe`、`drift`、`float`、`jitter`、`pulse`、`still`、`sway`            |
| exit   | `blur`、`cut`、`drift`、`fade`、`shrink`、`slideOutL`、`slideOutR`、`wipe` |
| treat  | `glow`、`none`、`outline`、`outlineFill`、`underline`                      |
| cam    | `push`、`static`                                                           |

尚未实现的 preset 不会被标成 supported。唯一 support manifest 同时供渲染诊断和 planner 输入使用：Rust planner 的自动选择池会与显式 renderer support 集合求交；默认值、cue override、导入计划或锁定恢复出的不支持 preset 返回 `unsupported-renderer-preset`，不产生部分计划。省略 support 集合时保留旧调用方兼容行为。节点仍会对旧工程中的未知项生成 `unsupported-preset` warning，并用基础布局提供可观察的降级像素；后续 UI 必须诚实呈现该诊断。

字体选择按 sequence/cut 独立解析。会话级 `MotionTextFontRuntime` 从项目 attachment 或离线 builtin 路径加载字体；首期可验证格式为 TTF／OTF，builtin 逻辑路径为 `motion-text/fonts/<font.id>.ttf`。Rust `ttf-parser` 负责结构和逐 code point 缺字检查，Rust `sha2` 负责内容摘要；摘要不一致和无效字体 fail closed。FontFace family 加入字体 ID 与摘要隔离，只有 FontFace 注册完成后才发布给布局和绘制。

preview 对字体加载失败或缺字返回 warning 并允许可见 fallback；正式 export 返回 error，不渲染不确定结果。system font 因没有可重现摘要而禁止正式 export。runtime 使用 AbortController、generation token 和迟到结果丢弃；project drain、suspend、invalidate 和 dispose 会删除已注册 FontFace 并清除字节／promise 缓存。`MotionTextNode` 记录准备时的 generation，resume 后会重新加载，已 rejected 的旧 promise 也不会阻止重试。

## 当前证据

TypeScript 行为测试覆盖：

- scene-builder 建立 `MotionTextNode`；缺失 sequence fail closed；
- 随机 seek 和顺序采样得到相同 content hash；
- 同 texture ID 在不同 source tick 产生不同 content hash；
- 视觉 opacity／blend／transform 路径进入 frame descriptor；
- overlay 透明，scene 拥有背景；
- clip／sequence 半开区间；
- 两个不同语言／seed 的节点在同一 scene 中保持隔离；
- 未支持 preset 产生结构化诊断；
- 字体 ready barrier、摘要不匹配、精确缺字 code point、preview warning 和 export fail closed；
- invalidate 后迟到字体结果被丢弃，FontFace 被删除并可重新加载；
- 1000 次长歌字体准备只保留一个字体缓存和一个 FontFace；
- suspend/invalidate 后节点按新 generation 重新准备，stale rejection 后可重试；
- rendered texture 的同 hash 去重、新 hash 上传、离场释放和 dispose 释放。

Chromium 像素探针覆盖：

- 同一 source tick 重复绘制像素哈希一致；
- 不同 source tick 不复用陈旧帧；
- 不同 seed 与不同语言输出不同像素；
- overlay 保留透明像素；
- scene 全画布不透明；
- preview 与 export 经过真实 compositor readback 后同时间点像素一致；
- 同 texture ID 的后续 source tick 会实际改变 GPU readback，回到原 tick 可复现；
- 真实 Geist TTF 经 FontFace 加载，Rust 摘要匹配；`Hello 世界` 精确报告 `U+4E16`、`U+754C`，invalidate／reload／dispose 的 FontFace 数量为 `1 → 0 → 1 → 0`。fixture 直接读取已锁定 Next 依赖内的 `Geist-Regular.ttf`，没有复制一份二进制进仓；[Geist 上游许可证](https://github.com/vercel/geist-font/blob/main/OFL.txt)声明 copyright 2024 The Geist Project Authors，并采用 SIL Open Font License 1.1。

当前验证命令：

```text
bun test packages/editor-classic/src/services/renderer
20 pass, 0 fail

cargo test -p motion-text
17 pass, 0 fail

node script/probe-motion-text-node.mjs
PASS（含 planner renderer support 与 font inspection）

node script/probe-motion-text-renderer-browser.mjs
PASS（含 compositor readback 与真实 FontFace 生命周期）

node script/check-wasm-paths.mjs
PASS

node script/check-wasm-api-surface.mjs
PASS：45 JS exports，62 stable WASM exports + 3 trampolines，612 imports

node script/check-wasm-init.mjs
PASS

bun run typecheck  # apps/vite-example
PASS

bun run typecheck  # apps/electron-host
PASS

bunx eslint <本批 S03 TypeScript files>
PASS
```

## 环境约束

canonical `rust/wasm/pkg` 已按固定工具链重建，声明与二进制门禁已记录新 planner support 类型。工作区 root 和 `apps/web` 当前解析到的 `node_modules/opencut-wasm` 二进制仍是旧副本，缺少最新字体检查实现；因此正式应用立刻使用显式字体时会收到明确加载诊断，而不会静默使用未验证字体。

同步需要执行 `bun install`。本阶段明确禁止共享依赖重装，因此未执行，也没有手工改写 `node_modules`。`bun run check:wasm` 当前只在 `check-wasm-source` 报告这两个已安装副本与 canonical binary 不同；其后的 paths、API surface 和 init 已逐项独立运行并通过。

## G3 关闭条件

功能实现与 canonical 证据已覆盖 G3 行为门禁。剩余关闭动作只有：

1. 在获得共享依赖重装授权后执行 `bun install`，把 canonical `rust/wasm/pkg` 同步到 root 与 `apps/web` 的已安装副本；
2. 重跑完整 `bun run check:wasm`，确认 source parity 与后三项门禁在同一次聚合命令中全绿；
3. 再把权威计划的 G3 状态从“进行中”改为“完成”。

继续扩充 renderer pack、在 UI 展示兼容性诊断以及完整字体许可证／离线资源清单属于后续 S05／S07，不阻塞本批已完成的基础 G3 实现。
