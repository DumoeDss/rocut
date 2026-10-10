import base from '../../eslint.config.mjs';
const files=['script/fixtures/liquid-object-capture-probe.ts','script/fixtures/liquid-object-capture-probe-types.ts','script/fixtures/liquid-object-capture-probe-pixels.d.mts'];
export default base.map(config=>config.files ? {...config,files,...(config.languageOptions ? {languageOptions:{...config.languageOptions,
 parserOptions:{...config.languageOptions.parserOptions,projectService:false,project:'./script/fixtures/liquid-object-capture-probe.tsconfig.json'}}}:{})}:config);
