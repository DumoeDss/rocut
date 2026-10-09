/** Identify immutable lexical candidates without executing authored code.
 * Runtime identity, not const syntax, decides whether a constructor is native.
 * Unknown/mutable values stay untouched.
 */
export const HYPERFRAMES_MODULE_REFERENCES_SOURCE = String.raw`
function hfModuleResourceReferences(isBound) {
  const property = node => !node.computed && node.property.type === 'Identifier' ? node.property.name
    : node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string' ? node.property.value : null;
  const member = (kind,key) => kind === 'global' && key === 'URL' ? 'constructor'
    : kind === 'meta' && key === 'url' ? 'base' : null;
  function classify(node, seen = new Set()) {
    if (!node) return null;
    if (node.type === 'MetaProperty' && node.meta.name === 'import' && node.property.name === 'meta') return 'meta';
    if (node.type === 'MemberExpression') return member(classify(node.object,seen),property(node));
    if (node.type !== 'Identifier') return null;
    const binding = isBound.binding(node,node.name);
    if (!binding) return node.name === 'URL' ? 'constructor' : node.name === 'globalThis' ? 'global' : null;
    if (!binding.reference || seen.has(binding)) return null;
    const chain = new Set(seen); chain.add(binding);
    let kind = classify(binding.reference.value,chain);
    for (const key of binding.reference.path) kind = member(kind,key);
    return kind;
  }
  return {constructor:node => classify(node) === 'constructor',base:node => classify(node) === 'base'};
}
`;
