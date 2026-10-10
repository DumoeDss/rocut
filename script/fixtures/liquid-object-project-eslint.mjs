import base from '../../eslint.config.mjs';
const files=['script/fixtures/liquid-object-project-*.ts','script/fixtures/liquid-object-capture-probe*.ts','script/fixtures/liquid-object-capture-probe*.mts','script/fixtures/liquid-object-capture-probe-pixels.mjs','script/probe-liquid-object-project.mjs','script/probe-liquid-object-capture.mjs'];
export default [...base.map(config=>config.files ? {...config,files,...(config.languageOptions ? {languageOptions:{...config.languageOptions,
 parserOptions:{...config.languageOptions.parserOptions,projectService:false,project:'./script/fixtures/liquid-object-project.tsconfig.json'}}}:{})}:config),
 {files:files.filter(file=>file.endsWith('.mjs')),languageOptions:{parserOptions:{project:'./script/fixtures/liquid-object-capture-probe-js.tsconfig.json'}}}];
