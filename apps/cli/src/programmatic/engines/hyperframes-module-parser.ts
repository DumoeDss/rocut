import { HYPERFRAMES_MODULE_SCOPES_SOURCE } from "./hyperframes-module-scopes";

/** Acorn AST positions preserve source syntax, comments, live bindings, cyclic
 * graphs and top-level await. No regex attempts to recognize JavaScript imports.
 * The only executable text here is this fixed compiler adapter itself.
 */
export const HYPERFRAMES_MODULE_PARSER_SOURCE =
	HYPERFRAMES_MODULE_SCOPES_SOURCE +
	String.raw`
function hfModuleRewrite(code, base, acorn, resolve, runtimeId, inline = false, resource) {
  const tokens = [];
  const tree = acorn.parse(code,{ecmaVersion:'latest',sourceType:'module',allowHashBang:true,onToken:tokens});
  const isBound = hfModuleScopes(tree);
  const names = new Set(), changes = [];
  function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) walk(item,visit); return; }
    if (typeof node.type === 'string') visit(node);
    for (const [key,value] of Object.entries(node)) if (!['start','end','loc','range'].includes(key) && value && typeof value === 'object') walk(value,visit);
  }
  walk(tree,node => { if (node.type === 'Identifier') names.add(node.name); });
  let name = '__rocutModule'; while (names.has(name) || names.has(name+'Meta')) name += '_';
  let usesRuntime = false, usesMeta = false, dynamic = false, resources = false;
  const origin = inline ? JSON.stringify(base) : name + '.metaUrl(import.meta.url)';
  const metaProperty = node => node?.type === 'MetaProperty' && node.meta.name === 'import' && node.property.name === 'meta';
  const metaUrl = node => node?.type === 'MemberExpression' && !node.computed && node.property.name === 'url' && metaProperty(node.object);
  function tokenAfter(offset) {
    let low = 0, high = tokens.length;
    while (low < high) { const middle = (low+high) >>> 1; if (tokens[middle].start < offset) low = middle+1; else high = middle; }
    return low;
  }
  walk(tree,node => {
    if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) {
      if (typeof node.source.value !== 'string') throw Error('Invalid native module specifier');
      changes.push({start:node.source.start,end:node.source.end,text:JSON.stringify(resolve(node.source.value,base))});
    } else if (node.type === 'ImportExpression') {
      if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
        changes.push({start:node.source.start,end:node.source.end,text:JSON.stringify(resolve(node.source.value,base))});
      } else {
        dynamic = true; usesRuntime = true;
        changes.push({start:node.source.start,end:node.source.start,text:name+'.loadUrl('});
        changes.push({start:node.source.end,end:node.source.end,text:','+origin+')'});
      }
    } else if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'URL'
      && !isBound(node,'URL') && node.arguments.length === 2 && node.arguments.every(arg => arg.type !== 'SpreadElement') && metaUrl(node.arguments[1])) {
      usesRuntime = true; resources = true;
      if (node.arguments[0].type === 'Literal' && typeof node.arguments[0].value === 'string') resource?.(node.arguments[0].value,base);
      // Insert outside the complete argument text, including grouping/comments.
      // Both original expressions evaluate once and in their original order.
      // The original native URL constructor still constructs the actual object.
      let at = tokenAfter(node.callee.end);
      while (tokens[at]?.type.label === ')') at++;
      const open = tokens[at], close = tokens[tokenAfter(node.end)-1];
      if (open?.type.label !== '(' || close?.type.label !== ')') throw Error('Unrecognized native URL argument range');
      changes.push({start:open.end,end:open.end,text:'...'+name+'.resourceArguments('});
      changes.push({start:close.start,end:close.start,text:')'});
    } else if (metaProperty(node)) {
      usesRuntime = true; usesMeta = true;
      changes.push({start:node.start,end:node.end,text:name+'Meta'});
    }
  });
  changes.sort((a,b) => b.start-a.start || b.end-a.end);
  let output = code;
  for (const change of changes) output = output.slice(0,change.start)+change.text+output.slice(change.end);
  if (usesRuntime) {
    const prelude = 'import * as '+name+' from '+JSON.stringify(runtimeId)+';\n'
      +(usesMeta ? 'const '+name+'Meta={...import.meta,url:'+origin+',resolve:(value)=>'+name+'.resolveUrl(value,'+origin+')};\n' : '');
    // Acorn accepts hashbangs. A generated import must not move one into the
    // middle of the module where the browser would parse it as invalid syntax.
    const newline = output.startsWith('#!') ? output.indexOf('\n') : -1;
    output = output.startsWith('#!') ? (newline < 0 ? output+'\n'+prelude : output.slice(0,newline+1)+prelude+output.slice(newline+1)) : prelude+output;
  }
  // Metadata can resolve a declared module not otherwise statically imported.
  // Keep that resolution closed but do not omit its lazy archived body.
  return {code:output,dynamic:dynamic || usesMeta,resources:resources || usesMeta};
}
`;
