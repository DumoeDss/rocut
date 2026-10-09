import { HYPERFRAMES_AUDIO_GRAPH_PATCH } from "./hyperframes-audio-graph-patch";
import { HYPERFRAMES_MODULE_GRAPH_SOURCE } from "./hyperframes-module-graph";

/** Static child entry, embedded by the CLI bundler. Authored JS is compiled as
 * browser code, never imported/executed in this Node/Bun process. */
export const HYPERFRAMES_COMPILER_CHILD = String.raw`
(async () => {
  const fs = await import('node:fs/promises');
  const sync = await import('node:fs');
  const path = await import('node:path');
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 1000000) throw Error('Compiler config too large'); }
  const config = JSON.parse(input);
  delete process.env.HYPERFRAME_RUNTIME_URL;
  const {bundleToSingleHtml} = await import(config.compilerEntry);
  const {parseHTMLContent} = await import(config.parserEntry);
  const acorn = await import(new URL('../../../../acorn/dist/acorn.mjs',config.compilerEntry).href);
  const allowed = new Set(config.files.map(file => path.resolve(config.project, file)));
  let reads = 0;
  const noteRead = file => {
    if (++reads > 4096) throw Error('Compiler dependency expansion exceeded its limit');
    const actual = sync.realpathSync(file);
    if (!allowed.has(actual)) throw Error('Compiler read an undeclared source file');
  };
  ${HYPERFRAMES_MODULE_GRAPH_SOURCE}
  const modules = await prepareHyperframesModules(config,fs,sync,path,parseHTMLContent,noteRead,acorn);
  const html = await bundleToSingleHtml(config.project, {
    entryFile: config.entryFile, runtime: 'inline', inlineAssets: true,
    onRead: noteRead
  });
  const doc = parseHTMLContent(html);
  modules.finalize(doc);
  if (config.nativeAudio) {
    // bundleToSingleHtml alone does not run the engine's render-identity pass.
    // Use the upstream pass after inlining so repeated clips/buses keep author
    // IDs but gain distinct, correctly scoped compiled-instance stamps.
    const {assignMediaRenderIds} = await import(new URL('./mediaRenderIds.js', config.compilerEntry).href);
    assignMediaRenderIds(doc);
  }
  if (doc.querySelector('iframe,object,embed,[data-composition-src]'))
    throw Error('Engine media or unresolved nested content is not supported yet');
  if (doc.querySelector('audio') && !config.nativeAudio)
    throw Error('HyperFrames audio requires an explicit native soundtrack declaration');
  const videos = [...doc.querySelectorAll('video')];
  for (const video of videos) {
    if ((!video.hasAttribute('muted') && !config.nativeAudio) || video.hasAttribute('autoplay'))
      throw Error('HyperFrames video must be explicitly muted or declare a native soundtrack, without autoplay');
  }
  if (doc.querySelector('audio[autoplay]')) throw Error('HyperFrames audio must not autoplay');
  if (videos.length || doc.querySelector('audio')) {
    const runtimes = [...doc.querySelectorAll('script[data-hyperframes-preview-runtime]')];
    if (runtimes.length !== 1) throw Error('Expected one pinned HyperFrames runtime for exact media seek');
    const runtime = runtimes[0], code = runtime.textContent;
    // Pinned 0.8.139's force-sync branch still tolerates 20 ms for preview.
    // Change only that gate in the captured copy; keep native clip/rate/loop
    // arithmetic and the installed package untouched. Version/shape changes fail.
    const previewTolerance = /\b([\w$]+)\.forceSync&&([\w$]+)>\.02\b/g;
    if ([...code.matchAll(previewTolerance)].length !== 1)
      throw Error('Pinned HyperFrames exact-media patch no longer matches; review the adapter');
    // Decimal nested starts can produce 0.079999999999... instead of 0.08.
    // Chromium truncates media time to microseconds, selecting the prior frame.
    // Normalize only native decoder assignments, not the upstream time mapping.
    const decoderTime = /(\b[\w$]+\.currentTime=)([\w$]+)(}catch\([\w$]+\){[\w$]+\("runtime\.media\.site[23]",)/g;
    if ([...code.matchAll(decoderTime)].length !== 2)
      throw Error('Pinned HyperFrames decoder-time patch no longer matches; review the adapter');
    let patched = code.replace(previewTolerance, '$1.forceSync&&$2>0')
      .replace(decoderTime, '$1Math.round($2*1e6)/1e6$3');
    if (config.nativeAudio) {
      ${HYPERFRAMES_AUDIO_GRAPH_PATCH}
      // This exact pinned native sync point follows source-time loop mapping,
      // author volume/fades and root-global timing resolution. Fail closed when
      // upstream changes; never infer nested timing from authored attributes.
      const hook = 'let R=Cs(i,e.timeSeconds-n.start)*e.playbackRate,B=2,';
      if (patched.split(hook).length !== 2) throw Error('Pinned HyperFrames audio observation hook changed; review the adapter');
      const beforeFade = 'let I=n.fades??bm;';
      const hidden = 'r.closest("[data-hidden]")!==null||ko(r.ownerDocument,r)';
      if (patched.split(beforeFade).length !== 2 || patched.split(hidden).length !== 2 || !patched.includes('function _s(e,t=Dn)'))
        throw Error('Pinned HyperFrames native gain-envelope hook changed; review the adapter');
      patched = patched.replace(beforeFade, 'let rocutAudioBaseGain=H,I=n.fades??bm;');
      // Send the native-normalized lane/GSAP envelope, not a reinterpreted DOM
      // timeline. Rust evaluates its curve/fades on the absolute PCM sample grid.
      patched = patched.replace(hook, 'let R=Cs(i,e.timeSeconds-n.start)*e.playbackRate,rocutAudioHidden='+hidden+';window.rocutHyperframesAudio?.observe(r,{time:e.timeSeconds,start:n.start,end:n.end,sourceDuration:n.sourceDuration,sourceTime:f,playbackRate:R,volume:rocutAudioHidden?0:H,inWindow:a,gainEnvelope:!rocutAudioHidden&&(F!==null||n.volumeKeyframes?.length||I.fadeIn>0||I.fadeOut>0)?{version:1,start:n.start,duration:n.duration,baseGain:F!==null||n.volumeKeyframes?.length?E:rocutAudioBaseGain,fadeIn:I.fadeIn,fadeOut:I.fadeOut,points:F!==null?_s(r.getAttribute(kt)||"")?.points??[]:(n.volumeKeyframes??[]).map(p=>({t:p.time,v:p.volume}))}:undefined});let B=2,');
      // 0.8.139 otherwise bounds <audio loop> to one source traversal before
      // its own loop mapper can run. Give looping media the authored/host slot,
      // just as looping video already gets; leave source-time arithmetic native.
      const loopWindow = 'isVideo:p.tagName==="VIDEO",sourceDuration:_';
      if (patched.split(loopWindow).length !== 2) throw Error('Pinned HyperFrames audio loop-window hook changed; review the adapter');
      patched = patched.replace(loopWindow, 'isVideo:p.tagName==="VIDEO"||p.loop,sourceDuration:_');
    }
    runtime.textContent = patched;
  }
  for (const el of doc.querySelectorAll('[src],[href],[poster],[srcset]')) {
    for (const attr of ['src','href','poster']) {
      const value = el.getAttribute(attr);
      if (value && !value.startsWith('data:') && !value.startsWith('#')) {
        if (attr !== 'src' || !['VIDEO','AUDIO','SOURCE'].includes(el.tagName)) throw Error('Compiled document has an unresolved external asset');
        const file = path.resolve(config.project, value);
        const mime = {'.mp4':'video/mp4','.webm':'video/webm','.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg','.flac':'audio/flac'}[path.extname(file).toLowerCase()];
        if (!mime || !allowed.has(file) || sync.realpathSync(file) !== file) throw Error('Undeclared HyperFrames media asset');
        const bytes = await fs.readFile(file);
        el.setAttribute(attr, 'data:'+mime+';base64,'+bytes.toString('base64'));
      }
    }
    if (el.hasAttribute('srcset')) throw Error('Engine srcset needs an explicit asset adapter');
  }
  const root = doc.querySelector('[data-composition-id]');
  const duration = config.durationFrames * config.frameRate.denominator / config.frameRate.numerator;
  if (!root || Number(root.getAttribute('data-width')) !== config.width || Number(root.getAttribute('data-height')) !== config.height
      || Math.abs(Number(root.getAttribute('data-duration')) - duration) > 1e-8)
    throw Error('Root composition dimensions/duration differ from compile specification');
  const audioAdapter = config.nativeAudio
    ? '<script>Object.defineProperty(window,"__rocutHyperframesAudioAdapter",{value:1});</script>' : '';
  const output = config.driver + audioAdapter + doc.toString();
  if (Buffer.byteLength(output) > 20000000) throw Error('Compiler output transport limit exceeded');
  await fs.writeFile(config.outputFile, output, {encoding:'utf8',flag:'wx'});
})().then(() => process.exit(0), error => { console.error(String(error).slice(0,2000)); process.exit(1); });
`;
