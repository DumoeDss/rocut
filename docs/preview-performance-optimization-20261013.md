# 实时预览性能优化（2026-10-13）

## 结果与边界

《群青》安装态工程（revision 125，1920×1080 / 30fps）同一 30–45 秒区间的预览提交吞吐，从约 3.37 fps 提升到 15.07–17.01 fps（约 4.5–5 倍）。没有降低画面尺寸、删减效果或改写剪辑工程。

| 15 秒采样              | 完成帧数 |  提交吞吐 | 平均提交耗时 |      P95 |
| ---------------------- | -------: | --------: | -----------: | -------: |
| 优化前                 |       51 |  3.37 fps |     263.65ms | 381.10ms |
| 仅提前过滤、裁剪脚本   |       51 |  3.39 fps |     254.73ms | 364.70ms |
| 隔离容器复用           |      258 | 17.01 fps |      53.81ms |  89.50ms |
| 隔离容器复用，重复采样 |      228 | 15.07 fps |      61.10ms | 101.60ms |

这些是预览请求完成指标，不是 GPU 完成时间、屏幕显示帧率或全片的最低帧率。采样开启 CDP CPU profiler 与少量 Canvas 方法计时，播放区间不截图；后续单独用截图验证画面确实连续变化。硬件为 RTX 3060 Laptop GPU / ANGLE D3D11，CSS 预览约 570×320，实际画布始终 1920×1080。

目前未达到稳定 30fps。本轮是已经落地并真机验证的预览优化，不代表完整 MV 导出验收或 Creator Studio agent 自主创作链验收完成。

## 根因与改动

1. `ProgrammaticNode` 原先对所有片段先整份 JSON 编码、进入 WASM，再判断是否需要画面。现在先使用现有视觉可见性求值，跳过不在当前范围内的片段；活动片段的来源验证、帧索引和时间映射仍由 Rust 完成。
2. 普通 authored Canvas 的沙箱原先嵌入完整 MV recipe 解释器。现在使用较小的固定 Worker 文档；原生 recipe 保留完整解释器，公开资源/后期 helper 保留，CSP 不变。
3. 主瓶颈是每帧三个 opaque-origin iframe 的重复加载：第一轮分解显示单次沙箱就绪约 120–150ms，而 Worker 实际执行约 5ms。`ProgrammaticSandboxRealm` 只缓存节点自己的固定 broker 容器，不缓存 Worker、素材或帧状态。
4. 每帧仍创建全新 Worker、全新私有 MessagePort。broker 在转交结果前终止 Worker、撤销 Blob URL，附带自己的 retirement 确认；未确认、异常、取消、超时的容器都不复用。节点失活、树退休和 session 生命周期取消会关闭容器。没有共享全局池。
5. 补齐直接 `CanvasRenderer.render()` 的性能 flush，并提供有界、显式启用的阶段报告。每个 span 最多 512 样本、报告最多 32 个；禁用时不采样。阶段表是滚动统计，跨采样窗口可能包含不足一批的尾部；整体吞吐/耗时以该次独立 `__rocutPreviewPerf` 时间窗为准。

第二轮阶段分解中，沙箱就绪降到约 8–11ms，最终 WASM 合成约 1–2ms。剩余成本主要在 Worker 启动、跨 realm 消息/Bitmap 传递和分配/GC。不能通过保留不可信 Worker 的全局状态或禁用效果来换取吞吐。

## 验证

- 79 项相关 Bun 测试通过（9 个测试文件，另含隔离进程内的生产边界回归）。覆盖 Worker 退休顺序、不同帧独立 Worker、私有端口、旧消息、broker 同时租用、生命周期关闭、取消、超时、发布保护与此前的播放饥饿修复。
- Vite-example 类型检查、12 个变更 TypeScript 文件的针对性 ESLint / Prettier、严格 UTF-8 和 `git diff --check` 通过。
- 生产前端构建通过；沿用相同 core WASM：`f9c69798a7642ee9bb8cbf9b1e416406b8ed55312f9de8dca2281761fc91fb7d`。没有重建或替换 Rust 运行时、CLI、主进程、skills、toolchain。
- 候选约 267.6 MB，通过插件布局、provenance、branding、toolchain 和用户要求的 1 GiB expanded 上限门禁，走正常 Elftia 安装器安装并重新打开工程。
- 两次低干扰采样均无渲染错误，工程 revision 仍为 125；暂停精确显示 tick `5324000`（00:00:44:11）。活动程序化 broker 数为 3。
- 独立播放验证跨越约 44–54 秒，153 个请求在播放期间完成，4 张播放画布截图全部不同；暂停后最后完成帧 tick `6464000` 与 00:00:53:26 一致。
- 没有在本轮重新导出全长 MV；不把类型检查/构建成功等同于导出质量验收。

## 复现与证据

工程及本地证据根：`E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/.projects/yoasobi-gunjou-mv-20261013`。

```powershell
node --import 'file:///E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia/node_modules/tsx/dist/loader.mjs' '<工程根>/profile-live-preview.mjs' repeat
node --import 'file:///E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia/node_modules/tsx/dist/loader.mjs' '<工程根>/diagnose-live-preview.mjs' --reproduce --fixed --performance
```

脚本通过 `elftia-cli` 连接本任务 CDP，实时查询 daemon 端口，临时切换《群青》标签后恢复原标签；不发送 LLM 消息、不编辑时间线。性能脚本会 seek 到 30 秒、暂时播放/暂停。仅在本任务 dev 实例上使用；端口/标签身份不匹配应先核对，不能盲目重启其他实例。

证据位于 `mv/qa/preview-performance-*.json`、对应脱敏 `.cpuprofile`、`live-preview-performance.json`。安装态 Surface inventory：`8b7fc9d22830e89a4c41f51f052cb48cc14e22e5ee56242340383e44aac02521`（安装树全部文件摘要，不是源码 commit）。这是保留当前安装 Runtime 的本地 Surface 补丁，不是 pin-only 发行包。

## 后续优先级

先评估 Bitmap/OffscreenCanvas 分配和纹理上传的安全复用，再评估 Worker 启动的静态脚本成本；每一步都必须保持来源隔离、帧确定性、取消后退休以及导出原生分辨率。之后按不同场景、转场和长时间播放复测。不要将本工程某一 15 秒区间的改善外推为全项目稳定 30fps。
