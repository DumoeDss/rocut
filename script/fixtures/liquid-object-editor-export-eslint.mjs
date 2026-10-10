import base from '../../eslint.config.mjs';
const files=['script/fixtures/liquid-object-editor-export-*.ts','script/fixtures/liquid-object-editor-export-build.mjs','script/probe-liquid-object-editor-export.mjs'];
export default [...base.map(config=>config.files?{...config,files,...(config.languageOptions?{languageOptions:{...config.languageOptions,
 parserOptions:{...config.languageOptions.parserOptions,projectService:false,project:'./script/fixtures/liquid-object-editor-export.tsconfig.json'}}}:{})}:config),
 {files:files.filter(file=>file.endsWith('.mjs')),languageOptions:{parserOptions:{project:'./script/fixtures/liquid-object-editor-export-js.tsconfig.json'}}}];
