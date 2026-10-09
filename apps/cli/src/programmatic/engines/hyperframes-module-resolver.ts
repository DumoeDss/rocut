/** Browser/compiler-shared URL and import-map mechanics, not JS source parsing.
 * The graph is closed over archived files; no Node package or network fallback.
 */
export const HYPERFRAMES_MODULE_RESOLVER_SOURCE = String.raw`
const HF_MODULE_ROOT = 'https://rocut.invalid/__rocut_modules__/';
function hfModuleUrl(file) {
  return HF_MODULE_ROOT + file.split('/').map(encodeURIComponent).join('/');
}
function hfModuleAddress(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('//')
      || /^[a-z][a-z\d+.-]*:/i.test(value)) throw Error('Network and scheme-based module dependencies are unavailable');
  const url = value.startsWith('/') ? new URL(value.slice(1),HF_MODULE_ROOT) : new URL(value,base);
  if (!url.href.startsWith(HF_MODULE_ROOT)) throw Error('Module import escapes the declared project');
  return url.href;
}
function hfModuleFile(url) {
  if (!url.startsWith(HF_MODULE_ROOT)) throw Error('Invalid archived module URL');
  const parsed = new URL(url), parts = parsed.pathname.slice(new URL(HF_MODULE_ROOT).pathname.length).split('/').map(decodeURIComponent);
  if (parts.some(p => !p || p === '.' || p === '..' || p.includes('/') || p.includes('\\')))
    throw Error('Invalid archived module path');
  return parts.join('/');
}
function hfModuleMapKey(value, base) {
  return value.startsWith('./') || value.startsWith('../') || value.startsWith('/')
    ? hfModuleAddress(value, base) : value;
}
function hfModuleImportMaps(documents, base) {
  const imports = Object.create(null), scopes = Object.create(null);
  function merge(target, entries) {
    if (entries === undefined) return;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw Error('Invalid native module import map');
    for (const [raw, address] of Object.entries(entries)) {
      const key = hfModuleMapKey(raw, base);
      if (!key || /^[a-z][a-z\d+.-]*:/i.test(raw)) throw Error('Network import-map keys are unavailable');
      if (Object.hasOwn(target,key)) continue;
      if (address === null) { target[key] = null; continue; }
      const resolved = hfModuleAddress(address, base);
      if (key.endsWith('/') && !resolved.endsWith('/')) throw Error('Import-map prefix must target a directory');
      target[key] = resolved;
    }
  }
  for (const map of documents) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) throw Error('Invalid native module import map');
    merge(imports,map.imports);
    if (map.scopes !== undefined) {
      if (!map.scopes || typeof map.scopes !== 'object' || Array.isArray(map.scopes)) throw Error('Invalid native module import-map scopes');
      for (const [prefix,entries] of Object.entries(map.scopes)) {
        const key = hfModuleAddress(prefix,base);
        merge(scopes[key] ??= Object.create(null),entries);
      }
    }
  }
  return {imports,scopes};
}
function hfModuleResolve(specifier, base, maps) {
  // Native import() performs string-hint coercion; it also turns failures while
  // evaluating its argument into a rejected promise.
  if (typeof specifier === 'symbol') throw TypeError('Cannot convert a Symbol to a module specifier');
  const value = typeof specifier === 'string' ? specifier : String(specifier);
  if (!value || value.includes('\\') || value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value))
    throw Error('Network and scheme-based module dependencies are unavailable');
  const relative = value.startsWith('./') || value.startsWith('../') || value.startsWith('/');
  const key = relative ? hfModuleAddress(value,base) : value;
  function match(entries) {
    if (Object.hasOwn(entries,key)) {
      if (entries[key] === null) throw Error('Module import is blocked by the import map');
      return entries[key];
    }
    for (const prefix of Object.keys(entries).filter(k => k.endsWith('/') && key.startsWith(k)).sort((a,b) => b.length-a.length)) {
      const address = entries[prefix];
      if (address === null) throw Error('Module import is blocked by the import map');
      const result = new URL(key.slice(prefix.length),address).href;
      if (!result.startsWith(address)) throw Error('Module import escapes its import-map prefix');
      return result;
    }
    return undefined;
  }
  for (const scope of Object.keys(maps.scopes).filter(k => base === k || (k.endsWith('/') && base.startsWith(k))).sort((a,b) => b.length-a.length)) {
    const found = match(maps.scopes[scope]); if (found !== undefined) return found;
  }
  const mapped = match(maps.imports);
  if (mapped !== undefined) return mapped;
  if (!relative) throw Error('Undeclared bare module dependency: ' + value);
  return key;
}
`;
