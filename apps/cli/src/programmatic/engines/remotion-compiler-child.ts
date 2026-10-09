/** Static, browser-only bundling entry; all source reads stay in the declared
 * snapshot or the host-configured dependency tree. No author module execution. */
export const REMOTION_COMPILER_CHILD = String.raw`
(async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 1000000) throw Error('Compiler config too large'); }
  const config = JSON.parse(input);
  const isThree = config.engine === 'three';
  const {build} = await import(config.compilerEntry);
  const dependencies = await fs.realpath(path.join(config.toolchainRoot, 'node_modules'));
  const allowed = new Set(config.files.map(file => path.resolve(config.project,file)));
  const within = (root,file) => { const rel=path.relative(root,file); return rel === '' || (!rel.startsWith('..'+path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
  const mime = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml',
    '.ttf':'font/ttf','.otf':'font/otf','.woff':'font/woff','.woff2':'font/woff2'};
  if (!isThree) Object.assign(mime, {'.webm':'video/webm','.mp4':'video/mp4',
    '.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg','.flac':'audio/flac'});
  const staticFiles = [], urls = {};
  for (const file of config.files.filter(file => !isThree && file.startsWith('public/'))) {
    const body = await fs.readFile(path.join(config.project,file));
    const kind = mime[path.extname(file).toLowerCase()];
    if (!kind) throw Error('Unsupported Remotion static asset: ' + file);
    const name = file.slice(7), src = 'data:'+kind+';base64,'+body.toString('base64');
    urls['/'+name.split('/').map(encodeURIComponent).join('/')] = src;
    staticFiles.push({name,src,sizeInBytes:body.byteLength,lastModified:0});
  }
  const upstream = path.join(dependencies,'remotion/dist/esm/index.mjs');
  const wrapper = 'export * from '+JSON.stringify(upstream)+';\nimport {staticFile as nativeStaticFile, Html5Audio as NativeHtml5Audio, Html5Video as NativeHtml5Video, OffthreadVideo as NativeOffthreadVideo, __rocutDurationsContext as NativeDurationsContext, delayRender as nativeDelayRender, continueRender as nativeContinueRender, cancelRender as nativeCancelRender} from '+JSON.stringify(upstream)+';\n'
    + 'export function staticFile(name) { const key=nativeStaticFile(name); const url=window.__rocutRemotionAssets[key]; if (!url) throw Error("Undeclared Remotion static file: "+name); return url; }\n'
    + (config.mediaWrapper ?? '');
  let reads = 0;
  const result = await build({
    stdin:{contents:config.driver,resolveDir:config.project,loader:'tsx',sourcefile:'rocut-remotion-driver.tsx'},
    bundle:true,write:false,metafile:true,outfile:'bundle.js',platform:'browser',format:'iife',target:'chrome120',jsx:'automatic',
    tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},nodePaths:[dependencies],logLevel:'silent',
    define:{'process.env.NODE_ENV':'"production"'},legalComments:'inline',minify:true,
    plugins:[{name:'rocut-declared-inputs',setup(api) {
      api.onResolve({filter:/^rocut:entry$/}, () => ({path:path.resolve(config.project,config.entryFile)}));
      if (!isThree) api.onResolve({filter:/^remotion$/}, () => ({path:'remotion',namespace:'rocut-native'}));
      api.onLoad({filter:/.*/,namespace:'rocut-native'}, () => ({contents:wrapper,loader:'js',resolveDir:dependencies}));
      api.onResolve({filter:/.*/}, async args => {
        if(isThree && args.path.startsWith('three/') && !args.path.startsWith('three/addons/'))
          throw Error('Use the single canonical Three runtime or its addons');
        if (args.path.startsWith('.') || path.isAbsolute(args.path)) {
          const target=path.resolve(args.resolveDir,args.path);
          if (!within(config.project,target) && !within(dependencies,target)) throw Error('Import escapes declared project/toolchain');
        } else {
          if (/^[a-z]+:|^\/\//i.test(args.path)) throw Error('Remote and Node imports are unavailable');
          // nodePaths is only a fallback in esbuild. Bare imports from authored
          // files must not discover a host/project ancestor's node_modules.
          if (!args.pluginData?.rocutToolchainResolution) return api.resolve(args.path, {
            kind:args.kind,
            resolveDir:within(dependencies,args.resolveDir) ? args.resolveDir : dependencies,
            pluginData:{rocutToolchainResolution:true},
          });
        }
      });
      api.onLoad({filter:/.*/,namespace:'file'}, async args => {
        if (++reads > 4096) throw Error('Compiler dependency expansion exceeded its limit');
        const real=await fs.realpath(args.path);
        if (!allowed.has(real) && !within(dependencies,real)) throw Error('Compiler read an undeclared source file');
        const ext=path.extname(real).toLowerCase();
        const body=await fs.readFile(real);
        // Expose the pinned ESM runtime's own context in-memory. Importing its
        // CJS internal would create a second, disconnected Remotion context.
        if (!isThree && real === upstream) {
          let native = new TextDecoder('utf-8',{fatal:true}).decode(body);
          const start = native.indexOf('var OffthreadVideoForRendering = ');
          const end = native.indexOf('\n// ', start + 1);
          if (start < 0 || end < 0) throw Error('Pinned Remotion Offthread component seam changed');
          const component = native.slice(start, end), fetchSeam = 'const res = await fetch(actualSrc, {';
          if (component.split(fetchSeam).length !== 2) throw Error('Pinned Remotion Offthread fetch seam changed');
          native = native.slice(0,start) + component.replace(fetchSeam, 'const res = await window.rocutOffthread.fetch(actualSrc, {') + native.slice(end);
          return {contents:native+'\nexport {DurationsContext as __rocutDurationsContext};',loader:'js',resolveDir:path.dirname(real)};
        }
        if (/^(video|audio)\//.test(mime[ext] ?? '')) return {contents:'export default '+JSON.stringify('data:'+mime[ext]+';base64,'+body.toString('base64')),loader:'js'};
        if (mime[ext]) return {contents:body,loader:'dataurl'};
        const loader=({'.ts':'ts','.tsx':'tsx','.js':'js','.mjs':'js','.cjs':'js','.jsx':'jsx','.json':'json','.css':'css'})[ext];
        if (!loader) throw Error('Unsupported Remotion source extension: '+ext);
        return {contents:new TextDecoder('utf-8',{fatal:true}).decode(body),loader,resolveDir:path.dirname(real)};
      });
    }}]
  });
  const js = result.outputFiles.find(file => file.path.endsWith('.js'))?.text;
  if(isThree) {
    const threeInputs=Object.keys(result.metafile.inputs).filter(file=>file.replaceAll('\\','/').includes('/three/build/'));
    if(threeInputs.length!==2 || !threeInputs.some(file=>file.endsWith('three.module.js')) || !threeInputs.some(file=>file.endsWith('three.core.js')))
      throw Error('Expected one canonical Three module/core bundle');
  }
  const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  if (!js) throw Error('Remotion compiler emitted no browser entry');
  const safe = value => JSON.stringify(value).replace(/</g,'\\u003c');
  const globals = config.environment + '\nwindow.__rocutRemotionSpec='+safe(config.spec)+';window.remotion_inputProps='+safe(JSON.stringify(config.spec.inputProps ?? {}))
    + ';window.__rocutRemotionAssets='+safe(urls)+';window.remotion_staticFiles='+safe(staticFiles)+';';
  const script = isThree ? 'window.__rocutThreeSpec='+safe(config.spec)+';\n'+js : globals + '\nwindow.rocut={ready:null, async renderFrame(frame){await this.ready; return window.__rocutRenderRemotionFrame(frame)}};'
    + 'window.rocut.ready=(async()=>{await new Promise(resolve=>document.addEventListener("DOMContentLoaded",resolve,{once:true}));'
    + 'void document.body.offsetHeight; await Promise.all([...document.fonts].map(face=>face.load()));\n'+js+'\n})();window.rocut.ready.catch(()=>{});';
  const html='<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;background:transparent}'+css.replace(/<\/style/gi,'<\\/style')
    + '</style></head><body>'+(isThree ? '<script type="application/json" id="rocut-runtime-notices">'+safe(config.runtimeNotices)+'</script>' : '')
    + '<script>'+script.replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
  if (Buffer.byteLength(html) > 20000000) throw Error('Compiler output transport limit exceeded');
  await fs.writeFile(config.outputFile,html,{encoding:'utf8',flag:'wx'});
})().then(()=>process.exit(0),error=>{console.error(String(error).slice(0,2000));process.exit(1)});
`;
