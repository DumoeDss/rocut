/** Fixed compiler adapter: parse, never execute, author classic scripts. Only
 * ImportExpression specifiers change; no module conversion or added statements.
 * The graph supplies a trusted expression for its closed browser runtime.
 */
export const HYPERFRAMES_CLASSIC_IMPORTS_SOURCE = String.raw`
function hfClassicRewrite(code, base, acorn, resolve, runtimeExpression) {
  const tree = acorn.parse(code,{ecmaVersion:'latest',sourceType:'script',allowHashBang:true});
  const changes = [], names = new Set();
  function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) walk(item,visit); return; }
    if (typeof node.type === 'string') visit(node);
    for (const [key,value] of Object.entries(node))
      if (!['start','end','loc','range'].includes(key) && value && typeof value === 'object') walk(value,visit);
  }
  walk(tree,node => { if (node.type === 'Identifier') names.add(node.name); });
  let dynamic = false, valueName = '__rocutClassicSpecifier';
  // The generated parameter must not capture authored identifiers or identifiers
  // used in the trusted runtime expression. Parsing that expression executes none.
  const runtimeTree = acorn.parse('('+runtimeExpression+')',{ecmaVersion:'latest',sourceType:'script'});
  walk(runtimeTree,node => { if (node.type === 'Identifier') names.add(node.name); });
  while (names.has(valueName)) valueName += '_';
  walk(tree,node => {
    if (node.type !== 'ImportExpression') return;
    if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
      changes.push({start:node.source.start,end:node.source.end,text:JSON.stringify(resolve(node.source.value,base))});
    } else {
      dynamic = true;
      // Native import converts its specifier after evaluating import options and
      // turns conversion failures into Promise rejections. A null-prototype
      // coercion carrier defers the closed resolver to that exact native phase.
      // The authored expression is evaluated outside the arrow, once, retaining
      // direct eval/this/arguments/yield/await behavior in its original scope.
      changes.push({start:node.source.start,end:node.source.start,text:'(('+valueName+')=>({__proto__:null,toString(){return ('+runtimeExpression+').loadUrl('+valueName+','+JSON.stringify(base)+');}}))(('});
      changes.push({start:node.source.end,end:node.source.end,text:'))'});
    }
  });
  changes.sort((a,b) => b.start-a.start || b.end-a.end);
  let output = code;
  for (const change of changes) output = output.slice(0,change.start)+change.text+output.slice(change.end);
  return {code:output,dynamic};
}
`;
