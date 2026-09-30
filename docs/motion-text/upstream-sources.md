# Motion Text 上游来源与许可清单

> 状态日期：2026-09-28。本文记录源码输入；最终 plugin NOTICE 与打包闭包必须在更新 vendor/dist 时再次从实际交付字节生成和核对。

## JIZURA

| 字段                     | 固定值                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------- |
| Repository               | https://github.com/852wa/JIZURA.git                                                     |
| Version                  | `0.9.0`                                                                                 |
| Commit                   | `bae339e450512435b829a717248ea92ae5b44899`                                              |
| License                  | MIT，Copyright (c) 2026 hakoniwa                                                        |
| `LICENSE`                | 1,086 bytes；SHA-256 `e06f8ce76d69c5a8f3e438a3ca8cc81c6621c93bac22aaaeec1f4c36330cbe99` |
| `THIRD_PARTY_NOTICES.md` | 1,766 bytes；SHA-256 `2b31e9c75ec9c243167aa41b7daad265cde6207ed2e6927adf2b219a76473c3d` |

JIZURA 的 registry 源文件在固定 commit 上按真实加载顺序执行，由 [audit-jizura-registry.mjs](../../script/audit-jizura-registry.mjs) 生成机器可审计目录。Rocut 不在运行时读取 sibling checkout；JIZURA 是行为、预设、名称、来源位置和导入格式的固定参考，生产工程使用 Rocut 原生 Rust planner、持久化契约和 renderer。

## 生成目录与摘要

| 产物                                                                                               | 用途                          | 摘要                                                                              |
| -------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------- |
| [jizura-preset-catalog.json](./jizura-preset-catalog.json)                                         | 912 项完整来源目录与审计身份  | 606,262 bytes；`9ec6f3be1a297152ccd377456348900fe0f4cc3b7629d21ec319976740f33d12` |
| [jizura-planner-catalog.json](../../rust/crates/motion-text/resources/jizura-planner-catalog.json) | Rust 可规划选择投影，887 项   | 81,062 bytes；`7fd1b885e17538b70b55feffed918f4af5b6c220d4023a76a472f8aa7936323b`  |
| [jizura-font-catalog.json](../../rust/crates/motion-text/resources/jizura-font-catalog.json)       | 23 个字体角色 + 1 个 zh-Hans 资产变体到离线资源的映射 | 13,017 bytes；`ff46303135e2b4983369e95e14798cb9f110c49fab23a9ac0284bc7854592854`  |

完整目录 hash 是 engine 的 `catalogHash`。planner 投影 hash 只标识可规划选择集，二者语义不同，不能互相替换。drawable 支持状态和逐项证据位于 [jizura-preset-compatibility.json](./jizura-preset-compatibility.json)。

## 离线字体

| 来源                                 | 固定 revision                              | 用途／许可                                                  |
| ------------------------------------ | ------------------------------------------ | ----------------------------------------------------------- |
| https://github.com/google/fonts      | `23e54b51ddffbc7713c583748e3bd86f62b1fa4a` | 19 份共享 TTF 的主要来源；每个 family 随附 SIL OFL 1.1 文本 |
| https://github.com/coz-m/MPLUS_FONTS | `eb604901d6f04b6f7f2a84b0378c58df84a9dba6` | M PLUS Rounded 1c 许可来源固定点                            |

原版 JIZURA `src/02b_lang.js` 是语言替换的权威设计来源。对 `zh-Hans`，它把
`gothic_black/bold/med/light` 分别映射到 Noto Sans SC 900/700/500/300，
`mincho_*` 映射到 Noto Serif SC，并为 display／round／brush 角色使用 ZCOOL 与
Ma Shan Zheng 等专用 family。因此 F01 默认 `gothic_bold` 的首选兼容候选 family 是
Noto Sans SC 700，而不是任意“看起来支持中文”的字体。该名称映射不等于资源选择：
当前工作区没有相应离线字节，且在 repository、revision、source path、SHA-256、许可和
真实字形检查全部固定前，不得写入 catalog 或声明支持。

2026-09-28 已对 Noto Sans SC 完成只读审计，并据此落库为 `gothic_bold` 的 zh-Hans 变体：

| 字段            | 审计值                                                             |
| --------------- | ------------------------------------------------------------------ |
| repository      | `https://github.com/google/fonts`                                  |
| revision        | `23e54b51ddffbc7713c583748e3bd86f62b1fa4a`                         |
| source path     | `ofl/notosanssc/NotoSansSC[wght].ttf`                              |
| bytes           | 17,772,300                                                         |
| SHA-256         | `a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da` |
| glyph count     | 31,036                                                             |
| F01 缺字        | 0                                                                  |
| license path    | `ofl/notosanssc/OFL.txt`                                           |
| license SHA-256 | `1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9` |

审计通过 pinned GitHub source、canonical Rust/WASM `ttf-parser` 和共享 F01 文本完成，随后写入
`apps/web/public/motion-text/fonts/noto-sans-sc-variable.ttf` 与
`apps/web/public/motion-text/fonts/licenses/notosanssc-OFL.txt`，并在 catalog 中登记为
`id: gothic_bold_zh_hans`、`roleId: gothic_bold`、`defaultForLanguages: ["zh-Hans"]`、
`supportedLanguages: ["zh-Hans", "en"]`。SBOM、asset closure、readiness 报告与 canonical WASM
已随之重建。

这证明 F01 的 zh-Hans 字形缺口在源码交付闭包中已闭合，也证明该资产会被 `zh-Hans` 的新建／导入
解析选中；它不等于完整 zh-Hans 字库覆盖声明。installed WASM 已经正常依赖路径同步并包含该资产
（L02 已关闭）；plugin dist 是否分发它仍由 L03/L04 跟踪。

Rust 字体目录已为后续落库准备了不改变现有工程语义的变体模型：现有 `id` 继续作为 23
个稳定 JIZURA 角色的 base asset ID；新增语言资产使用自己的唯一 `id`，并以 `roleId` 和
`defaultForLanguages` 声明由哪个角色在何种语言下选中。Rust 只在创建／JIZURA 导入时解析
角色并把具体资产 ID 写入 defaults／resolved cuts；重开、锁定、变体和显式用户选择均不
重新解析。当前 catalog 已用这两个字段登记唯一的 zh-Hans 资产
`gothic_bold_zh_hans`（Noto Sans SC），其余 23 个角色的 base asset 不变。

当前 19 份 TTF 共 117,455,080 bytes；连同 19 份 OFL 文本共 38 文件、117,539,061 bytes。每个角色记录 family、weight、kind、`supportedLanguages`、`builtinPath`、内容 SHA-256、源目录、源文件和 license path。实际文件清单以字体目录和 [SBOM](../../SBOM.md) 为准。

SBOM 中的角色数、资产数、语言标签和字节总量现由
`script/motion-text-font-inventory.mjs` 从 catalog 与实际 public tree 生成，不再维护硬编码副本。
生成时会逐项验证摘要、OFL 文本、stable base role、语言默认映射以及 TTF／许可目录闭包；
额外或遗漏文件都会使生成失败。语言变体因此只增加 catalog asset entry 和实际资产数，不会
被误计为新的 JIZURA 逻辑角色。`bun run check:sbom` 以无写入模式重算完整文档并拒绝陈旧
的 checked-in SBOM；三平台 CI 在依赖安装后、installed-WASM 校验前运行同一门禁。确需
更新时运行 `node script/generate-sbom.mjs`。

当前已交付资源声明 `gothic_bold` 角色的 zh-Hans 变体，但**没有**声明完整 zh-Hans／ko 覆盖；`zh-Hant`、`ko` 与其余角色的中文保真仍按缺字门禁拒绝。新增或替换字体时必须：

1. 固定 repository、revision、源路径、内容 SHA-256 和许可文件；
2. 用真实字形检查更新 `supportedLanguages`，并为语言变体登记唯一资产 `id`、稳定 `roleId` 与 `defaultForLanguages`；不根据字体名称推断；
3. 更新 runtime asset manifest、SBOM、plugin NOTICE 和 packed closure；
4. 重跑 F01、语言矩阵、WASM／asset／export 门禁。

候选落库前必须先运行同一 F01 fixture 的独立预检：

```text
node script/probe-motion-text-font-readiness.mjs --candidate <font.ttf> --expected-sha256 <font-sha256> --license <license-file> --expected-license-sha256 <license-sha256>
```

命令会分别验证预先固定的字体／许可 SHA-256、严格 UTF-8 OFL 1.1 文本，并通过 canonical Rust/WASM 字体检查器输出精确缺字；任一条件失败都会返回非零。当前基线由 `bun run check:motion-text:fonts` 固定在 [s09-font-readiness.json](./s09-font-readiness.json)。F01 全覆盖只能证明该 fixture 可导出，不能据此单独声明一般性的完整 zh-Hans 字库覆盖。

## Rocut 与插件交付基线

当前 Rocut 工作树以 commit `8246f0b9c463d32e1d807cfed18b62c7baed04a4` 为已提交基线，但 motion-text 改动尚在未提交工作树中，因此它不是可供插件 pin 的最终验证 commit。

当前 `elftia-plugin-rocut/upstream.json` 仍固定：

- repository：`https://github.com/DumoeDss/rocut`
- commit：`fea667d6ea57412eeae2fa07d70a594c844bed38`

该 pin 早于本轮 motion-text 源码，不得把现有 plugin dist 宣称为已包含本功能。后续必须先形成验证 commit，再按 producer 的正常 `vendor -> build -> verify:dist` 链更新 pin、provenance、NOTICE 和实际交付字节；不能手工复制 sibling 源码、WASM 或字体到 vendor/dist。

## 打包前核对

- JIZURA commit、MIT 文本和 third-party notice 与本文摘要一致；
- catalog、planner projection、font catalog 的 hash 与 canonical runtime 报告一致；
- 19 份 TTF 与 19 份 OFL（含 zh-Hans 变体与 `notosanssc-OFL.txt`）全部进入 allowlist、manifest、SBOM 和 plugin provenance；
- canonical WASM、root installed copy、`apps/web` installed copy、plugin vendored copy来自同一验证基线；
- 打包树不依赖 `_others/JIZURA` 或 `_others/rocut`；
- 最终安装环境重复 [S09 验证矩阵](./s09-verification-matrix.md) 中标为安装产物必测的场景。
