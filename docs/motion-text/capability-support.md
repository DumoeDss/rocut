# Motion Text 能力支持矩阵

> 状态日期：2026-09-28。`源码通过` 仅表示 canonical Rust/WASM 与 Rocut 源码表面有证据；`安装产物通过` 需要独立的 plugin vendor/dist 与无 sibling checkout 验收。

## 预设目录

权威目录共 912 项：889 个 drawable preset 和 23 个字体角色。Rocut 另有 5 个 native alias，不计入 JIZURA 889 项覆盖率。

| 目录组        | ID       |    数量 | 原生 renderer | 逐项 Chromium 预览 | 正式 export smoke |
| ------------- | -------- | ------: | ------------- | ------------------ | ----------------- |
| Style         | `style`  |      27 | 通过          | 通过               | 通过              |
| Layout        | `layout` |     186 | 通过          | 通过               | 通过              |
| Entrance      | `enter`  |     125 | 通过          | 通过               | 通过              |
| Hold          | `hold`   |      52 | 通过          | 通过               | 通过              |
| Exit          | `exit`   |     109 | 通过          | 通过               | 通过              |
| Decoration    | `decor`  |     130 | 通过          | 通过               | 通过              |
| Treatment     | `treat`  |      62 | 通过          | 通过               | 通过              |
| Background    | `bg`     |      66 | 通过          | 通过               | 通过              |
| Camera        | `cam`    |      36 | 通过          | 通过               | 通过              |
| Screen effect | `fx`     |      69 | 通过          | 通过               | 通过              |
| Transition    | `trans`  |      27 | 通过          | 通过               | 通过              |
| 合计          |          | **889** | **889/889**   | **889/889**        | **889/889**       |

逐项 export 报告记录 1,751/1,751 个 eligible cut 绑定、889/889 个可见样本、1,778 帧、889 个有效 `ftyp` MP4 和 0 error。证据见 [s09-export-catalog.json](./s09-export-catalog.json)。

## 编辑与自动化能力

| 能力                            | 原生 UI              | CLI／Host                         | Creator Studio 源规则 | 当前结论                               |
| ------------------------------- | -------------------- | --------------------------------- | --------------------- | -------------------------------------- |
| plain／LRC 创建                 | 支持                 | `create`                          | 支持                  | 源码通过                               |
| `.jizura.json` 导入             | 支持，展示兼容性诊断 | `create` + `sourceFormat: jizura` | 支持，必须读回        | 源码通过；不是 bit-exact 原版重放      |
| cue 文本／时间编辑              | 支持                 | `mutate`                          | 支持                  | Rust 校验，一次 mutation 一次 revision |
| cut 边界编辑                    | 支持                 | `mutate`                          | 支持                  | 稳定 cut ID，Rust 校验                 |
| 字体／配色／默认 preset         | 支持                 | `mutate`                          | 支持                  | 字体受离线字形门禁约束                 |
| cue／cut／group／parameter 锁定 | 支持                 | `mutate`                          | 支持                  | 变体和 restyle 保留锁定 snapshot       |
| 变体预览／应用                  | 支持                 | `vary`／`vary --apply`            | 支持                  | preview 不落盘，apply 需双 revision    |
| 音频绑定／分析／手工节拍        | 支持                 | `mutate` mutation kinds           | 可调用                | PCM 不持久化，Rocut 音轨仍是唯一音源   |
| 歌词时间预览与显式同步          | 支持                 | `mutate`                          | 可调用                | 不自动覆盖 locked/manual/tap cue       |
| 移动／裁剪／拆分／撤销重做      | 支持                 | 现有事务接口                      | 通过 Rocut 事务       | 源码通过                               |
| 完整／选区导出                  | 支持                 | 需 attached pane                  | 可请求                | canonical 源码通过；最终安装产物未验收 |
| 任意单字独立图层编辑            | 不支持               | 不支持                            | 不支持                | 后续能力，不伪装为当前支持             |

## 宿主与交付表面

| 表面                                           | 业务读写                       | 像素预览／导出                             | 状态与边界                                              |
| ---------------------------------------------- | ------------------------------ | ------------------------------------------ | ------------------------------------------------------- |
| Rust `motion-text` crate + canonical WASM      | 支持                           | 为 renderer 提供确定性计划                 | 源码通过；业务真值 owner                                |
| `apps/vite-example`／editor-classic 浏览器表面 | 支持                           | 支持                                       | canonical 与 installed 两个入口的 F01 探针均通过        |
| `apps/cli` authenticated Host                  | 支持，无需打开面板             | Host 自身无 Canvas；导出借用 attached pane | 23/23 定向集成测试通过                                  |
| `apps/web` installed runtime                   | 契约代码存在                   | 尚未验收                                   | installed WASM 已与 canonical 一致；1080p 安装验收待 L04 |
| `elftia-plugin-rocut` producer source          | skill 已描述高层命令           | 取决于 vendored pane                       | source tests 通过；pin/vendor/dist 未更新               |
| Creator Studio producer source                 | 会选择 Rocut 并读回双 revision | 通过 Rocut 请求                            | source typecheck/tests 通过；仅安装产物 E2E 未执行      |
| 当前已安装 rocut plugin                        | 旧能力可用                     | 旧 surface                                 | **不声明 motion-text 支持**；缺少能力时必须 fail closed |
| Rocut GPUI desktop                             | 未接入本功能                   | 未接入                                     | 本轮未实现、未验收                                      |

## 字体支持

23 个 JIZURA 字体角色映射到 20 份 digest-pinned 离线 TTF，其中 `gothic_bold` 另有 Noto Sans SC（zh-Hans）和 Noto Sans KR（ko）变体。新建表单可显式选择语言，Rust 负责解析默认资产。`mono` 仍为 Latin-only；`zh-Hant` 及未覆盖角色的中韩文保真不作保证。UI 对当前语言显示 `supported`、`unsupported` 或 `unknown`，导出遇到必需字形缺失时 fail closed。

最新 F01 中，默认解析到 `gothic_bold_zh_hans`（Noto Sans SC 变量字体），缺字为 0，是 20 份资产中唯一完整覆盖该 fixture 的资产。Noto Sans KR 对本次韩文及混排样本覆盖完整，不代表完整覆盖 F01 的全部中文字符。精确码点和逐资产结果见 [字体 readiness 报告](./s09-font-readiness.json)。不得使用操作系统 fallback 冒充确定的字体覆盖。来源与许可见 [上游来源清单](./upstream-sources.md)。

语言字体选择由 Rust catalog 决定，而不是 React fallback。目录可为稳定角色追加语言资产变体；新建／导入会保存解析后的具体资产 ID，后续 mutation、锁定、variation 与保存重开保持该 ID。当前 catalog 已登记 zh-Hans 和 ko 变体，已同步到本地 WASM 消费副本并实际安装插件。最新安装证据见 [修复验收记录](../elftia-integration-repair.md)；本页较早的宿主快照不替代该记录。

## 兼容性分级

- **源码通过：** canonical factory、事务、renderer 或 exporter 的固定测试通过。
- **条件支持：** 能力存在，但依赖 attached pane、已准备字体或特定 surface。
- **阻断：** 代码会明确报错，不继续写入或导出。
- **未验收：** 没有对应宿主／安装产物证据；不能根据相邻表面推断支持。

最终交付状态以 [S09 验证矩阵](./s09-verification-matrix.md) 为准。
