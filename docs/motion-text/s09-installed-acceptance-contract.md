# S09 安装产物验收证据契约

2026-10-01 更正：`run-motion-text-installed-acceptance.mjs` 当前仅为隔离 smoke 收集器，
绕过 Creator Studio 入口，也未实测全部 installed 性能。缺失指标输出 null，S14-01／09
保持 not-run，因此其输出应被本验证器拒绝。历史 0.4.4 的 PASS 不代表最终验收，
也不适用于 0.5.0。seek 预算保持 250 ms，不能以时间码 DOM 更新替代目标帧可见。

`script/validate-motion-text-installed-acceptance.mjs` 用于第 14 节真实验收完成后验证证据闭包；它不会启动插件、生成素材或替代人工执行 12 个步骤。

运行方式：

```text
bun run check:motion-text:installed-acceptance -- --manifest <evidence-root>/acceptance.json
```

manifest 使用 schema version 1，并以其所在目录作为证据根。所有文件引用必须是无 `.`／`..`／反斜杠的相对路径；每项记录精确字节数和小写 SHA-256。证据根除 manifest 自身外必须与登记文件形成精确闭包，符号链接、特殊文件和未登记文件均拒绝。验证器要求：

- Rocut、plugin 与 plugin upstream commit 固定，plugin upstream 必须等于被验收 Rocut commit；
- canonical 与 installed WASM 字节数、SHA-256 完全一致，字体 catalog 身份固定；
- 明确记录隔离安装、Rocut/JIZURA sibling checkout 均不存在、没有系统字体 fallback，以及 1920×1080 浏览器环境；
- `S14-01` 至 `S14-12` 全部为 `passed` 且引用已登记证据；冲突重试、无面板导出诊断和三类资源／版本诊断还需结构化 facts；
- 证据至少包含工程、命令日志、三张 UI 截图、完整／选区 MP4、两份元数据、两组首中尾 PNG 和性能报告；
- 两个 MP4 均为 1080p、各一条视频／音频流，实际帧数与期望值误差不超过一帧，音画偏移不超过一帧；选区必须证明非零起点；验证器会把每个 export sidecar 的尺寸、帧率、帧数、流数量、offset 和 tick 范围与 manifest 逐字段比较；
- installed preview／seek／局部修改／取消满足第 13.3 节预算，并记录内存平台与 GPU 释放结果；performance sidecar 必须与 manifest 逐字段一致；
- 文本证据必须是无 BOM 的严格 UTF-8，不能包含用户私有绝对路径、Bearer token、认证 URL token 或未脱敏 secret/API key。

验证器通过只证明“证据集合自洽且达到结构门禁”，不证明截图观感正确，也不自动关闭 G8/G9。验收人员仍需从实际安装的 Creator Studio／Rocut plugin 执行第 14 节、检查画面，并保留生成该 manifest 的原始命令与媒体分析结果。
