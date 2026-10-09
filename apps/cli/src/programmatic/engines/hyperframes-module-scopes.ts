/** Lexical binding analysis over Acorn nodes. No author code is evaluated. */
export const HYPERFRAMES_MODULE_SCOPES_SOURCE = String.raw`
function hfModuleScopes(tree) {
  const scopes = new WeakMap();
  function scope(parent, ownsVar = false) {
    const result = {parent,bindings:new Map(),varScope:null};
    result.varScope = ownsVar ? result : parent.varScope;
    return result;
  }
  function bind(pattern, target, reference = null) {
    if (!pattern) return;
    if (pattern.type === 'Identifier') target.bindings.set(pattern.name,{reference});
    else if (pattern.type === 'RestElement') bind(pattern.argument,target);
    else if (pattern.type === 'AssignmentPattern') bind(pattern.left,target);
    else if (pattern.type === 'ArrayPattern') for (const item of pattern.elements) bind(item,target);
    else if (pattern.type === 'ObjectPattern') for (const item of pattern.properties) {
      const key = item.type === 'Property' ? (!item.computed && item.key.type === 'Identifier'
        ? item.key.name : item.key.type === 'Literal' && typeof item.key.value === 'string' ? item.key.value : null) : null;
      const child = reference && key !== null ? {...reference,path:[...reference.path,key]} : null;
      bind(item.type === 'RestElement' ? item.argument : item.value,target,child);
    }
  }
  function children(node, current) {
    for (const [key,value] of Object.entries(node)) {
      if (['start','end','loc','range'].includes(key) || !value || typeof value !== 'object') continue;
      if (Array.isArray(value)) for (const child of value) visit(child,current);
      else visit(value,current);
    }
  }
  function visit(node, current) {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
    scopes.set(node,current);
    if (node.type === 'Program') { for (const item of node.body) visit(item,current); return; }
    if (['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)) {
      if (node.type === 'FunctionDeclaration' && node.id) bind(node.id,current);
      const parameters = scope(current);
      if (node.id) bind(node.id,parameters);
      for (const parameter of node.params) bind(parameter,parameters);
      for (const parameter of node.params) visit(parameter,parameters);
      // Function-body var declarations do not shadow parameter initializers.
      if (node.body.type === 'BlockStatement') {
        const body = scope(parameters,true); scopes.set(node.body,body);
        for (const item of node.body.body) visit(item,body);
      } else visit(node.body,parameters);
      return;
    }
    if (node.type === 'BlockStatement' || node.type === 'StaticBlock') {
      const block = scope(current,node.type === 'StaticBlock'); scopes.set(node,block);
      for (const item of node.body) visit(item,block);
      return;
    }
    if (node.type === 'CatchClause') {
      const caught = scope(current); bind(node.param,caught);
      visit(node.param,caught); visit(node.body,caught); return;
    }
    if (['ForStatement','ForInStatement','ForOfStatement'].includes(node.type)) {
      const loop = scope(current); scopes.set(node,loop); children(node,loop); return;
    }
    if (node.type === 'SwitchStatement') {
      visit(node.discriminant,current);
      const cases = scope(current); for (const item of node.cases) visit(item,cases);
      return;
    }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      if (node.type === 'ClassDeclaration' && node.id) bind(node.id,current);
      const klass = scope(current); if (node.id) bind(node.id,klass);
      visit(node.superClass,klass); visit(node.body,klass); return;
    }
    if (node.type === 'VariableDeclaration') {
      for (const declaration of node.declarations) bind(declaration.id,node.kind === 'var' ? current.varScope : current,
        node.kind === 'const' && declaration.init ? {value:declaration.init,path:[]} : null);
    } else if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers) bind(specifier.local,current);
    }
    children(node,current);
  }
  const root = scope(null,true); visit(tree,root);
  const binding = (node,name) => {
    for (let current = scopes.get(node); current; current = current.parent)
      if (current.bindings.has(name)) return current.bindings.get(name);
    return undefined;
  };
  const isBound = (node,name) => binding(node,name) !== undefined;
  isBound.binding = binding;
  return isBound;
}
`;
