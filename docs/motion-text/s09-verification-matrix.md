# S09 最终验证矩阵

> 更正日期：2026-10-01。G8/G9/M3 仍开放。历史 0.4.4 隔离 smoke 导出已完成，但未经过 Creator Studio 入口，性能字段含非实测常量；历史 validator PASS 不能作为最终验收。seek 门槛恢复为 250 ms。下表未特别标注的安装操作仅表示 smoke 覆盖。

## 状态定义

| 状态     | 含义                                                 |
| -------- | ---------------------------------------------------- |
| 通过     | 当前列明范围已有可重复证据                           |
| 部分通过 | 子场景通过，但规格中的其他表面、分辨率或组合仍未验证 |
| 阻断     | 门禁按预期失败，必须解决前置资源或产物问题           |
| 未执行   | 尚无本轮运行证据                                     |
| 不适用   | 设计上不属于该表面，并已说明替代 owner               |

## 第 13.1 节错误发现矩阵

| 层级                                                   | 当前状态     | 已有证据                                                                                                      | 剩余缺口                                                     |
| ------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 核心：多语言、LRC、多时间戳、手工 cut、间奏、非法边界  | 通过（源码） | Rust `motion-text` 75/75；contract、factory、time/audio 测试；语言变体矩阵                                    | 安装产物重跑随最终门禁执行                                   |
| 稳定性：插入前置行、局部 reroll、锁定、重开、随机 seek | 通过（源码） | stable ID、locks、variation、三生命周期 restart；F04/F05 420 次乱序 seek 与顺序 fingerprint 一致              | 无新的源码缺口                                               |
| 时间线：移动、裁剪、非 cut 边界拆分、复制              | 通过（源码） | S04/S05 UI probe、retime/split/duplicate 定向回归、重载与 undo/redo                                           | 最终安装工程重复可视抽帧                                     |
| 契约：UI/CLI 同写、冲突、幂等重试、草稿撤回            | 通过（源码） | mixed user/Agent test、project/sequence 双 revision、request journal、结构化 409、draft/transaction tests     | 安装插件 E2E                                                 |
| 存储：老工程、新工程重开、未来字段、降级读写           | 通过（源码） | v31→v32 additive migration、opaque field 保留、future-version fail closed；联合升级／双项目／多语言／重开测试 | 最终 plugin runtime 重跑                                     |
| 渲染：连续帧、乱序 seek、循环、不同语言同时播放        | 通过（源码） | renderer tests、F04/F05 stress、双语言/seed scene、cue loop、三语言项目隔离                                   | installed surface 可视复验                                   |
| 合成：视频下层、透明背景、模糊残影、scene 模式         | 部分通过     | 889 item Chromium probe、11 组×8 场景矩阵、代表 export；普通视频／文字／图形 scene                            | 最终安装工程的 1080p 视频下层抽帧                            |
| 预览／导出：同时间取样、音画同步、末尾帧               | 部分通过     | 选区 export（60 帧／884.6 ms）、F05 末尾 60 帧、完整 14,400 帧、双轨 MP4、同时间 frame proof                  | installed 1080p 完整／选区导出与首中尾人工验收               |
| 资源：字体缺失、音频更换、资源迁移、离线               | 部分通过     | 共享 F01 fixture 的 19-asset readiness 审计（默认资产 0 缺字、1 份全覆盖）、unknown preset、asset MIME/hash、音频重绑和离线字体门禁 | installed WASM/plugin closure 未更新 |
| 性能：长歌、多片段、动态缩略图、关闭项目               | 部分通过     | F04/F05 heap/seek、F04 局部修改 p95、889 虚拟化目录、RAF/session disposal、完整编码与取消                     | installed 1080p GPU/内存                                     |
| 交付：插件独立运行、旧插件、卸载重装                   | 阻断         | source producer tests 与 old-plugin fail-closed 规则                                                          | pin/vendor/dist、无 sibling checkout、卸载重装均未执行       |

## 第 13.2 节固定 fixture

| Fixture                                         | 状态         | 证据与结论                                                                                                                                                       |
| ----------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 中文 12 cue、视频叠加、强调／手工 cut／间奏 | 通过（源码） | UI probe 与 readiness 审计共享提交后文本；zh-Hans 默认资产 `gothic_bold_zh_hans` 0 缺字，19 份资产中 1 份完整覆盖；MP4 导出＋抽帧 MAE 4.8332／255（阈值 20） |
| F02 日／韩／英／混合文字与缺字诊断              | 部分通过     | 11 组×8 场景覆盖 zh/ja/ko/en，缺字诊断通过；中文／韩文字体保真未形成完整离线闭包                                                                                 |
| F03 三段不同 seed／字体／语言，重复挂载与切项目 | 通过（源码） | [motion-text-node.test.ts](../../packages/editor-classic/src/services/renderer/__tests__/motion-text-node.test.ts)、session lifecycle 与双项目多语言联合回归     |
| F04 3 分钟、120 cue                             | 通过（源码） | 240 cuts、180 次 720p seek p95 0.8 ms；40 次 stable-cue 修改的 plan/可见 draw-readback/总 p95 为 11.4/7.9/18.9 ms；持久化重开通过                                |
| F05 8 分钟、600 cue                             | 通过（源码） | 1,200 cuts、240 次 seek、p95 0.3 ms、14,400 帧完整编码、5 帧取消、durable replay                                                                                 |
| F06 多帧率与 16:9／9:16／1:1                    | 通过（源码） | canonical `layout:perspective` 以 24/25/30/60/30000÷1001 × 三画幅完成 15 个正式 compositor/export 组合；结合既有 11 组×8 场景矩阵覆盖横竖画幅下全部 preset group |
| F07 老工程、JIZURA、损坏 JSON、未知版本、缺资源 | 通过（源码） | v31→v32、JIZURA fixture、malformed JSON、future/unknown version、unknown preset 与 missing-resource diagnostics 均 fail closed；最终安装产物仍须重跑             |

## 第 13.3 节性能预算

| 指标      | 目标                                   | 本轮结果                                                                                   | 状态                            |
| --------- | -------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------- |
| 常规预览  | 720p p95 ≤ 33.3 ms                     | F04/F05 seek+draw p95 0.8/0.3 ms；这是固定 renderer slice，不是完整 installed 多媒体帧     | 通过（源码切片）                |
| seek 响应 | F04 p95 ≤ 250 ms                       | 180 次乱序 seek+draw p95 0.8 ms，fingerprint parity 通过                                   | 通过（源码切片）                |
| 局部修改  | F04 p95 ≤ 300 ms                       | 40 次 stable-cue 更新：Rust plan p95 11.4 ms、可见 720p draw/readback 7.9 ms、总计 18.9 ms | 通过（源码切片）                |
| 重效果    | 可降预览分辨率，导出保留质量           | 889 项有逐项 720p 成本与 320×180 export smoke；重效果成本有报告                            | 部分通过                        |
| 内存      | 有界，F05 不随访问帧数线性增长         | precise heap 已记录；release 后 retained 约 1.35 MiB，资源 dispose tests 通过              | 部分通过；缺 installed GPU 基线 |
| 取消      | 可协作阶段 ≤ 1 秒                      | 14,400 帧 export 在第 5 帧取消，25.9 ms、1 cancelled、返回 null                            | 通过（源码）                    |
| 导出      | 1080p、帧数正确、唯一音轨、误差 ≤ 1 帧 | 320×180 F05 14,400 帧完成；选区音频唯一；非 motion scene 同含 `vide`/`soun`                | 阻断最终 1080p installed 验收   |

固定报告：

- [s09-stress-probe.json](./s09-stress-probe.json)：F04/F05 factory、720p seek/draw、heap、选区 export 与取消；
- [s09-font-readiness.json](./s09-font-readiness.json)：共享 F01 文本、19 份离线字体逐资产检查和默认字体精确缺字；
- [s09-export-matrix.json](./s09-export-matrix.json)：layout／enter／fx／bg／trans 五组代表 MP4；
- [s09-export-catalog.json](./s09-export-catalog.json)：889 项 compositor/export smoke；
- [s09-format-matrix.json](./s09-format-matrix.json)：F06 五帧率 × 三画幅的 15 项正式 export；
- [s09-full-export.json](./s09-full-export.json)：F05 14,400 帧完整编码；
- [s09-non-motion-export.json](./s09-non-motion-export.json)：普通视频／文字／图形／48 kHz 音频双轨兼容。

## 工程升级、跨项目与多语言联合回归

[motion-text-routing.test.ts](../../apps/cli/src/__tests__/motion-text-routing.test.ts) 现在包含一条联合场景：

1. 从两个完整的 schema v31 工程开始，并各自携带不同 opaque provider 字段；
2. 两个 Host 同时存活，通过 `--project` 分别创建 zh-Hans 与 ja sequence，复用相同幂等 key；
3. Host 启动走已发布 v31→v32 迁移，创建后仍保留 provider 字段；
4. 同时关闭并分别重开两个工程；
5. 读回语言、文本、稳定 ID、project/sequence revision，确认没有串项目；
6. 重放中文 create，确认 durable journal 返回原结果且两项目 revision 均不前进。

定向命令结果：

```text
bun test src/__tests__/motion-text-routing.test.ts
2 pass, 27 assertions

bun test <8-file motion-text CLI/Host integration slice>
23 pass, 201 assertions
```

因此“工程升级、跨项目与多语言并发组合”的源码子项关闭；它不提升 plugin 安装状态。

## 第 14 节最终用户与 Agent 脚本

|                                            步骤 | 当前状态         | 证据或阻断                                                        |
| ----------------------------------------------: | ---------------- | ----------------------------------------------------------------- |
|        1. 从 Creator Studio 打开实际安装 plugin | 待验收 | 已有直接 host ensure smoke；实际 Creator Studio 入口未覆盖 |
|             2. 导入音频／视频并创建透明文字动效 | 通过（安装产物） | fixture 视频+生成 WAV+F01 中文 12 cue 序列在 installed surface 创建成功；S14-02 |
| 3. 选择 typographic preset 并预览首／切换／尾句 | 通过（安装产物） | Impact title 预设预览，首/尾 cue 切换；S14-03 |
|              4. 编辑、锁定并对其余 cue 生成变体 | 通过（安装产物） | cue 2 文本编辑+Layout 锁，变体应用后锁保持；S14-04 |
|                   5. 移动、头裁剪、动效中间拆分 | 通过（安装产物） | timeline 拖动+头裁剪+中间拆分；S14-05 |
|                                   6. 撤销／重做 | 通过（安装产物） | S14-06 |
|                             7. 保存、关闭、重开 | 通过（安装产物） | 重载重开+截图留存；S14-07 |
|              8. Agent 读 ID，制造冲突后重读重试 | 通过（安装产物） | CLI 读 ID、stale revision 409、重读重试成功；S14-08 |
|                      9. 叠加不同语言并乱序 seek | 待验收 | 已有第二 ja 序列和 8 次时间码操作（p95 294 ms）；未覆盖至少 30 次目标帧可见测量及 250 ms 预算 |
|                              10. 完整与局部导出 | 通过（安装产物） | 完整 900 帧+选区 61 帧（非零起点 240000–480000 ticks）1920×1080 MP4，A/V 偏移 0 帧，首中尾抽帧+元数据 sidecar；S14-10 |
|            11. 关闭面板后导出诊断、业务读取继续 | 通过（安装产物） | 关面板后 export 拒绝（409）、read 正常；S14-11 |
|         12. 缺字体、旧 plugin、未知 preset 诊断 | 通过（安装产物） | missing-font mutation 422、旧 CLI usage 无 motion-text 动词、unknown-preset JIZURA import 422，恢复 create 成功；S14-12 |

历史 `acceptance.json` 包含 12 步记录、16 产物、2 导出、plugin 0.4.4。
其 PASS 已撤回作为最终验收结论；补齐实测后须按
[安装产物验收证据契约](./s09-installed-acceptance-contract.md) 重新验证。

## 非 motion-text 兼容

固定 [s09-compatibility-tests.txt](./s09-compatibility-tests.txt) 覆盖 23 个测试文件，结果为 111/111 tests、366 assertions。另一个 canonical scene 通过正式 compositor／exporter 输出同时含 `vide` 和 `soun` 的 MP4。两者证明源码兼容切片，不替代最终安装产物的可视工程验收。

## 最终门禁结论

**G9/M3：未通过。待补 Creator Studio 入口、installed 性能／资源释放实测及最终版本验收。**

已完成的是矩阵分类、源码联合回归、目录／压力／兼容证据、限制归档，以及交付链前三项前置：

1. ~~正常同步 installed WASM~~ 已完成：installed 与 canonical 逐字节一致（5,511,220 bytes／`14de620a`），`bun run check:wasm` 全绿，无 alias 的 installed 入口 F01 探针 33/33；
2. ~~确认字体资产随 dependency／plugin 闭包进入安装产物~~ 已完成：dist 内含 19 份 TTF＋19 份 OFL（38 个 motion-text 文件），隔离安装经 HTTP 分发 Noto Sans SC（200、17,772,300 bytes、TTF magic）；
3. ~~从验证 commit 更新 plugin pin/vendor/dist~~ 已完成：pin `8246f0b9c463`、vendor 350 files、dist 354 files、tree hash `fd68541c4c72bffc`，隔离副本逐字节一致；
4. 隔离副本已有两段 1080p MP4、抽帧和截图。第 14 节最终验收仍开放；原 sidecar 的预览／修改／取消／内存／GPU 字段不构成 installed 实测。

开放项的复现与关闭条件见 [s09-known-limitations.md](./s09-known-limitations.md)。
