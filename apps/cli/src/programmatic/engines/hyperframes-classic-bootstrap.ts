import { HYPERFRAMES_CLASSIC_IMPORTS_SOURCE } from "./hyperframes-classic-imports";

/** Compile-time provenance is embedded before upstream script coalescing and
 * comment stripping. External classics remain external script tags (data src),
 * with their authored execution attributes and upstream composition scoping.
 */
export const HYPERFRAMES_CLASSIC_BOOTSTRAP_SOURCE =
	HYPERFRAMES_CLASSIC_IMPORTS_SOURCE +
	String.raw`
async function prepareHyperframesClassicImports(config, fs, sync, path, parseHTMLContent, noteRead, acorn) {
  const files = new Set(config.files), documents = [], scripts = [], names = new Set();
  const types = new Set(['','application/ecmascript','application/javascript','application/x-ecmascript','application/x-javascript','text/ecmascript','text/javascript','text/javascript1.0','text/javascript1.1','text/javascript1.2','text/javascript1.3','text/javascript1.4','text/javascript1.5','text/jscript','text/livescript','text/x-ecmascript','text/x-javascript','text/hf-after-fonts']);
  const read = id => {
    if (!files.has(id)) throw Error('Compiler read an undeclared classic source file: '+id);
    const file = path.resolve(config.project,id); noteRead(file);
    return sync.readFileSync(file);
  };
  const text = bytes => new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  function identifiers(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) identifiers(item); return; }
    if (node.type === 'Identifier') names.add(node.name);
    for (const [key,value] of Object.entries(node)) if (!['start','end','loc','range'].includes(key)) identifiers(value);
  }
  for (const id of [...files].filter(id => ['.html','.htm'].includes(path.extname(id).toLowerCase())).sort()) {
    const doc = parseHTMLContent(text(read(id))), document = {id,doc,changed:false}; documents.push(document);
    const elements = [...new Set([...doc.querySelectorAll('script'),...[...doc.querySelectorAll('template')].flatMap(t => [...t.content.querySelectorAll('script')])])];
    for (const script of elements) {
      if (!types.has((script.getAttribute('type') || '').trim().toLowerCase())) continue;
      let base = hfModuleUrl(id), bytes, code;
      if (script.hasAttribute('src')) {
        base = hfModuleAddress(script.getAttribute('src'),base);
        bytes = read(hfModuleFile(base)); code = text(bytes);
      } else code = script.textContent || '';
      identifiers(acorn.parse(code,{ecmaVersion:'latest',sourceType:'script',allowHashBang:true}));
      scripts.push({document,script,base,bytes,code});
    }
  }
  let runtimeName = '__rocutHyperframesClassicGraph'; while (names.has(runtimeName)) runtimeName += '_';
  const literals = []; let dynamic = false;
  for (const item of scripts) {
    const result = hfClassicRewrite(item.code,item.base,acorn,(specifier,base) => {
      const alias = 'https://rocut.invalid/__rocut_classic_import_'+literals.length+'__';
      literals.push({alias,specifier,base}); return alias;
    },runtimeName);
    dynamic ||= result.dynamic;
    if (result.code === item.code) continue;
    if (item.bytes) {
      const integrity = item.script.getAttribute('integrity');
      if (integrity) {
        const crypto = await import('node:crypto');
        const tokens = integrity.trim().split(/\s+/).map(value => value.split('-'));
        const ranks = {sha256:1,sha384:2,sha512:3}, rank = Math.max(...tokens.map(([kind]) => ranks[kind] || 0));
        if (!rank || !tokens.some(([kind,digest]) => ranks[kind] === rank && crypto.createHash(kind).update(item.bytes).digest('base64') === digest)) throw Error('Declared classic script integrity mismatch');
        item.script.removeAttribute('integrity');
      }
      item.script.setAttribute('src','data:text/javascript;base64,'+Buffer.from(result.code,'utf8').toString('base64'));
    } else item.script.textContent = result.code;
    item.document.changed = true;
  }
  for (const document of documents.filter(document => document.changed)) {
    const file = path.resolve(config.project,document.id); noteRead(file);
    await fs.writeFile(file,document.doc.toString(),{encoding:'utf8'});
  }
  return {literals,dynamic,runtimeName,active:dynamic || literals.length > 0};
}
`;
