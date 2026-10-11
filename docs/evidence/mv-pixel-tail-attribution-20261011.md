# MV 像素长尾：四族归因汇总与集中验收决策

日期：2026-10-11。范围：night（wet-floor fall/count、train moving/frozen/exit）与 tunnel 的 complete-frame 像素残差集中归因；不是安装态/Electron/全片导出的新验收声明。

## 结论总表

| case | complete frame | scene 级 | 分段隔离 | 归因 | 证据
|---|---|---|---|---|---
| wet-floor fall | max=2（gate 已按先例对齐 <=2 后通过位） | 通过（max 1） | 表面/反射 bit 级排除 | shimmer 亚像素重采样舍入族（99.5% delta1，alpha 逐位一致） | mv-night-wetfloor-parity-diagnosis-20261010.json
| wet-floor count | 21302px max186 | 通过 | surface bit-identical；glints 全洗清；相机 17 位一致；drawImage 元数排除；(1800,900) 同边界早 1px、(300,120) 同 surface 字节暗/亮翻转 | 相同数学输入的光栅化边缘采样翻侧族 | mv-night-count-raster-family-20261011.json
| train-moving | 32189px max25 | 通过 | GL 段同输入一致（15 passes 全执行） | scene <=1 LSB 经 bloom 阈值 0.72 翻转 + 三层 downsample 放大 | mv-night-train-segment-isolation-20261011.json
| train-frozen | 7445px max12 | 通过（error 为 complete-frame，非 scene） | 同 moving 机理；y540-810 同区；alpha 逐位一致 | 同上 | 本轮 jk1sNA evidence + mv-night-train-parity-finding-20261011.json
| train-exit | **0 差异** | **0** | 15 passes | 无残差——同引擎同链不同帧内容完全 bit-exact | 本轮 81bRVZ evidence
| tunnel | 22px（(992,663) 簇 delta4-6 + 19 个 delta1） | — | crossbuck strokeRect 候选已实验排除（改后逐字节不变）；字形边缘 delta1 已分类 | 另一 primitive 或字形子像素舍入，未归因部分仅剩 (992,663) 簇 | mv-tunnel-crossbuck-exclusion-20261011.json + mv-tunnel-grain-fillhistory-fix-20261010.json

## 统一机理

四族残差收敛到同一根因类：**两侧数学输入相同（surface 字节、glow 位置、相机 17 位、GL 参数、随机流全部逐位核对一致），Chromium canvas 光栅化在几何边界处把边缘样本翻到对侧**。scene 级表现为 <=1 LSB；经 bloom bright-pass 阈值（0.72）翻转与三层 downsample 后放大至 12-25 亮度级（train）；不经 GL 的直接表现为 2-6 级（wet-floor/tunnel）。alpha 通道在全部 case 中逐位一致，排除合成顺序/覆盖结构分歧。train-exit 全零证明这不是系统性管线缺陷，而是内容依赖的边界采样翻转。

## 决策选项（待用户拍板）

1. **阈值对齐（推荐）**：按 wet-floor complete-frame gate <=2 的既有先例，将 train complete-frame gate 从 <=1 对齐到与其 scene 级/放大机理相称的值（建议 max<=25 连带 mae<=0.01 或按 hist 形状门控），tunnel 维持现状等待 (992,663) 簇单独归因。理由：每段单独 bit 级核对全过、机理已证、alpha 一致、exit 帧全零；参考实现自身的 GL 阈值附近本就存在内容敏感性。
2. **逐位复刻**：在 native 侧复刻 bloom 阈值+重采样的精确舍入序。理由：可完全消除残差；代价：需在 GL port 中对齐 Chromium 内部重采样内核实现，属于下游实现细节耦合，维护成本高。
3. **混合**：train 走选项 1；wet-floor count 的 21302px 若观感验收（放大静帧对比）无可见差异也可走 1，否则针对性查 (300,120)/(1800,900) 的边缘翻侧条件。

## 不变项

- 全部 gate 阈值修改需落 evidence 引用本表；
- scene 级 gate 不放宽（保持 max<=1/<=2 现状）；
- 探针 identity 链（wasm/manifest/frozen sources）在每次复验中保持完整；
- 不以本表替代安装态/Electron/全片导出验收。


