import { HYPERFRAMES_MODULE_RESOLVER_SOURCE } from "./hyperframes-module-resolver";
import { HYPERFRAMES_MODULE_PARSER_SOURCE } from "./hyperframes-module-parser";
import {
	HYPERFRAMES_MODULE_RUNTIME_SOURCE,
	HYPERFRAMES_RESOURCE_MIMES,
} from "./hyperframes-module-runtime";

/** Embedded in the fixed child and therefore covered by the archived adapter
 * hash. Preparation touches only the compiler's private staged HTML snapshots.
 * Upstream still owns composition mounting/scoping/font-gated script ordering.
 */
export const HYPERFRAMES_MODULE_GRAPH_SOURCE =
	HYPERFRAMES_MODULE_RESOLVER_SOURCE +
	HYPERFRAMES_MODULE_PARSER_SOURCE +
	String.raw`
async function prepareHyperframesModules(config, fs, sync, path, parseHTMLContent, noteRead, acorn) {
  const files = new Set(config.files), originals = new Map(), origins = new Map(), external = new Map();
  const markerPrefix = '__rocut_hf_module_origin_';
  const runtimeId = 'https://rocut.invalid/__rocut_module_runtime__';
  let serial = 0, hasModules = false;
  const moduleMime = id => ({'.js':'text/javascript','.mjs':'text/javascript','.cjs':'text/javascript','.json':'application/json'})[path.extname(id).toLowerCase()];
  function read(id) {
    if (!files.has(id)) throw Error('Compiler read an undeclared module source file: ' + id);
    if (!originals.has(id)) {
      const file = path.resolve(config.project,id); noteRead(file);
      originals.set(id,sync.readFileSync(file));
    }
    return originals.get(id);
  }
  const strictText = bytes => new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const moduleScripts = doc => [...new Set([
    ...doc.querySelectorAll('script'),
    ...[...doc.querySelectorAll('template')].flatMap(t => [...t.content.querySelectorAll('script')])
  ])].filter(el => ['module','text/hf-after-fonts+module'].includes((el.getAttribute('type') || '').trim().toLowerCase()));
  // Preserve the authored HTML's base before the upstream inliner moves its
  // module body or external tag. Comments are read back through Acorn, not regex.
  for (const id of [...files].filter(id => ['.html','.htm'].includes(path.extname(id).toLowerCase())).sort()) {
    const doc = parseHTMLContent(strictText(read(id))), scripts = moduleScripts(doc);
    if (!scripts.length) continue;
    hasModules = true;
    for (const script of scripts) {
      const token = markerPrefix + serial++;
      const base = hfModuleUrl(id);
      if (script.hasAttribute('src')) {
        const url = hfModuleAddress(script.getAttribute('src'),base), target = hfModuleFile(url);
        if (!moduleMime(target)) throw Error('Unsupported declared module MIME: ' + target);
        read(target);
        const integrity = script.getAttribute('integrity');
        if (integrity) {
          const crypto = await import('node:crypto');
          const tokens = integrity.trim().split(/\s+/).map(value => value.split('-'));
          const ranks = {sha256:1,sha384:2,sha512:3}, rank = Math.max(...tokens.map(([kind]) => ranks[kind] || 0));
          if (!rank || !tokens.some(([kind,digest]) => ranks[kind] === rank && crypto.createHash(kind).update(read(target)).digest('base64') === digest))
            throw Error('Declared module integrity mismatch');
          // The compiled artifact is content-addressed separately. Its rewritten
          // module no longer has the original bytes, whose SRI was checked above.
          script.removeAttribute('integrity');
        }
        const reference = 'rocut-module-source:' + token;
        external.set(reference,url); script.setAttribute('src',reference);
      } else {
        origins.set(token,base);
        script.textContent = '/*'+token+'*/\n'+(script.textContent || '');
      }
    }
    const file = path.resolve(config.project,id); noteRead(file);
    await fs.writeFile(file,doc.toString(),{encoding:'utf8'});
  }
  return { finalize(doc,classics = {literals:[],dynamic:false,runtimeName:'__rocutHyperframesClassicGraph',active:false}) {
    const scripts = moduleScripts(doc);
    if (!hasModules && !scripts.length && !classics.active) return;
    const maps = hfModuleImportMaps([...doc.querySelectorAll('script[type="importmap"]')].map(el => JSON.parse(el.textContent || '{}')),hfModuleUrl(config.entryFile));
    const records = new Map(), pending = [], inline = [], moduleVariants = Object.create(null);
    const identityLimit = 1024;
    let identityBytes = 0;
    let expandDynamic = classics.dynamic, expandResources = false;
    function admit(url) {
      const id = hfModuleFile(url);
      if (!files.has(id)) throw Error('Compiler read an undeclared module source file: ' + id);
      if (!moduleMime(id)) throw Error('Unsupported declared module MIME: ' + id);
      const canonical = new URL(url).href;
      if (!records.has(canonical)) {
        if (records.size >= identityLimit) throw Error('Compiler module URL identity expansion exceeded its limit');
        records.set(canonical,null); pending.push(canonical);
      }
      return canonical;
    }
    const resolve = (specifier,base) => admit(hfModuleResolve(specifier,base,maps));
    const classicAliases = classics.literals.map(({alias,specifier,base}) => [alias,resolve(specifier,base)]);
    const resource = (specifier,base) => {
      const id = hfModuleFile(hfModuleAddress(specifier,base));
      if (!files.has(id)) throw Error('Compiler read an undeclared resource source file: ' + id);
      read(id);
    };
    for (const script of scripts) {
      if (script.hasAttribute('src')) {
        const url = external.get(script.getAttribute('src'));
        if (!url) throw Error('Untracked external native module script');
        admit(url);
      } else {
        const comments = [];
        acorn.parse(script.textContent || '',{ecmaVersion:'latest',sourceType:'module',onComment:comments,allowHashBang:true});
        const markers = comments.filter(comment => origins.has(comment.value));
        if (markers.length !== 1) throw Error('Missing or ambiguous native module source origin');
        const result = hfModuleRewrite(script.textContent || '',origins.get(markers[0].value),acorn,resolve,runtimeId,true,resource);
        expandDynamic ||= result.dynamic; expandResources ||= result.resources; inline.push([script,result.code]);
      }
    }
    let expandedMaps = false;
    while (pending.length || (expandDynamic && !expandedMaps)) {
      if (expandDynamic && !expandedMaps) {
        expandedMaps = true;
        // Metadata/computed alias resolution can choose an import-map target
        // without a literal import. Include every declared module target.
        for (const entries of [maps.imports,...Object.values(maps.scopes)])
          for (const address of Object.values(entries)) if (typeof address === 'string' && !new URL(address).pathname.endsWith('/')) {
            const id = hfModuleFile(address);
            if (files.has(id) && moduleMime(id)) admit(address);
          }
        // Query/hash identity is unbounded, but static dependency resolution
        // has only finitely many scope classes for each declared physical file.
        // Compile representative referrers; runtime selects the matching class
        // while retaining the caller's exact URL in import.meta and module key.
        for (const id of [...files].filter(id => moduleMime(id)).sort()) {
          const base = hfModuleUrl(id);
          admit(base);
          let other = base+'?__rocut_scope_other__';
          while (Object.hasOwn(maps.scopes,other)) other += '_';
          admit(other);
          for (const scope of Object.keys(maps.scopes))
            if (!new URL(scope).pathname.endsWith('/') && hfModuleFile(scope) === id) admit(scope);
        }
      }
      const url = pending.shift(); if (url === undefined) continue;
      const id = hfModuleFile(url);
      const mime = moduleMime(id), original = strictText(read(id));
      let code = original;
      if (mime === 'application/json') JSON.parse(original);
      else {
        const result = hfModuleRewrite(original,url,acorn,resolve,runtimeId,false,resource);
        code = result.code; expandDynamic ||= result.dynamic; expandResources ||= result.resources;
      }
      const uri = 'data:'+mime+';base64,'+Buffer.from(code,'utf8').toString('base64');
      identityBytes += Buffer.byteLength(uri);
      if (identityBytes > 20000000) throw Error('Compiler module URL identity byte expansion exceeded its limit');
      records.set(url,{physicalId:id,code,mime,uri});
      const choices = moduleVariants[id] ??= Object.create(null);
      choices[JSON.stringify(hfModuleScopeKeys(url,maps))] = uri;
    }
    const dataUrl = url => records.get(url).uri + '#rocut=' + encodeURIComponent(url);
    const imports = Object.create(null);
    for (const url of [...records.keys()].sort()) imports[url] = dataUrl(url);
    for (const [alias,url] of classicAliases) imports[alias] = dataUrl(url);
    const bodies = Object.fromEntries([...records].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([id,record]) => [id,record.uri]));
    const assets = Object.create(null), resourceMimes = ${JSON.stringify(HYPERFRAMES_RESOURCE_MIMES)};
    if (expandResources) for (const id of [...files].filter(id => !moduleMime(id)).sort()) {
      const mime = resourceMimes[path.extname(id).toLowerCase()] || 'application/octet-stream';
      assets[id] = 'data:'+mime+';base64,'+read(id).toString('base64');
    }
    // One fixed resolver supplies both deferred computed imports and metadata.
    // It returns only embedded data URLs or throws before a network request.
    const json = value => JSON.stringify(value).replace(/</g,'\\u003c');
    const runtime = 'return hfCreateModuleRuntime('+json(maps)+','+json(bodies)+','+json(assets)+','+json(moduleVariants)+');';
    const bootstrap = doc.createElement('script');
    bootstrap.setAttribute('data-rocut-hyperframes-module-graph','1');
    // The bootstrap is a separate classic script: top-level this cannot be
    // shadowed by authored globalThis/window/URL bindings. Capture intrinsics
    // now so subsequent legal global lexical bindings cannot alter resolution.
    bootstrap.textContent = 'const '+classics.runtimeName+'=(()=>{const {URL,Object,Array,Reflect,String,Error,TypeError,Proxy,JSON,Set,encodeURIComponent,decodeURIComponent}=this;const undefined=void 0;'+${JSON.stringify(HYPERFRAMES_MODULE_RESOLVER_SOURCE + HYPERFRAMES_MODULE_RUNTIME_SOURCE)}+'\n'+runtime+'})();this.Object.defineProperty(this,"__rocutHyperframesModuleGraph",{value:'+classics.runtimeName+'});';
    const facade = 'const graph='+classics.runtimeName+'; export const metaUrl=graph.metaUrl,resolveUrl=graph.resolveUrl,loadUrl=graph.loadUrl,resourceArguments=graph.resourceArguments,resourceConstructor=graph.resourceConstructor;';
    imports[runtimeId] = 'data:text/javascript;base64,'+Buffer.from(facade,'utf8').toString('base64');
    for (const el of doc.querySelectorAll('script[type="importmap"]')) el.remove();
    const importMap = doc.createElement('script'); importMap.setAttribute('type','importmap');
    importMap.textContent = json({imports});
    doc.head.prepend(importMap); doc.head.prepend(bootstrap);
    for (const [script,code] of inline) script.textContent = code;
    for (const script of scripts.filter(el => el.hasAttribute('src')))
      script.setAttribute('src',dataUrl(external.get(script.getAttribute('src'))));
  }};
}
`;
