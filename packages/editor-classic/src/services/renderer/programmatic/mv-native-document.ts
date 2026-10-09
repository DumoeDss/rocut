import { MV_RECIPE_RENDERER_SOURCE } from "./mv-recipe-renderer";
import { SEQUENCE_IMAGE_DECODER_SOURCE } from "./sequence-image-decoder";
import { IMAGE_DIMENSIONS_WORKER_SOURCE } from "./image-dimensions-worker";
import { MV_NATIVE_CONNECT, MV_NATIVE_PROTOCOL } from "./mv-native-protocol";
import { IMAGE_PREPROCESS_RENDERER_SOURCE } from "./image-preprocess-renderer";

/** Fixed interpreter only. Project text never enters this document/script.
 * Unlike the authored Worker broker, this CSP cannot eval, spawn Workers,
 * fetch resources, or embed another frame. Binary FontFace/ImageBitmap inputs
 * arrive solely over the parent-created private MessagePort.
 */
export const MV_NATIVE_DOCUMENT = `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; worker-src 'none'; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; style-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<script>
"use strict";
(() => {
  const nativeCreateImageBitmap = globalThis.createImageBitmap.bind(globalThis);
  let disposed = false, started = false, iterator;
  const bitmaps = new Set(), faces = new Set(), canvases = new Set();
  let rasterBytes=0, rasterByteLimit;
  const check = () => { if (disposed) throw Error('Native MV frame cancelled'); };
  // This lexical wrapper also covers asynchronous decoders shared with Worker.
  // A bitmap completing after cancellation is closed before it can be used.
  const createImageBitmap = async (...args) => {
    check();
    const bitmap = await nativeCreateImageBitmap(...args);
    if (disposed) { bitmap.close(); check(); }
    bitmaps.add(bitmap);
    return bitmap;
  };
  function createSurface(width, height) {
    check();
    if (![width,height].every(v => Number.isSafeInteger(v) && v > 0 && v <= 4096))
      throw Error('Invalid native MV surface dimensions');
    if(rasterByteLimit!==undefined){
      rasterBytes=width*height*8;
      for(const existing of canvases)rasterBytes+=existing.width*existing.height*8;
      if(rasterBytes>rasterByteLimit)throw Error('Native MV joint raster budget exceeded');
    }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height; canvases.add(canvas);
    return canvas;
  }
  const cleanup = () => {
    if (iterator) { try { iterator.return(); } finally { iterator = undefined; } }
    for (const bitmap of bitmaps) bitmap.close(); bitmaps.clear();
    for (const face of faces) document.fonts.delete(face); faces.clear();
    for (const canvas of canvases) canvas.width = canvas.height = 1; canvases.clear();
  };
  async function loadFont(resource, body) {
    check();
    if (!(body instanceof ArrayBuffer) || body.byteLength !== resource.byteLength)
      throw Error('Font attachment length mismatch');
    const f = resource.font;
    if (!f) throw Error('Missing declared font descriptor');
    const axes = Object.entries(f.axes || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const face = new FontFace(f.family, body, {
      style:f.style, weight:String(f.weight),
      ...(axes.length ? {variationSettings:axes.map(([tag,value]) => JSON.stringify(tag) + ' ' + value).join(', ')} : {})
    });
    faces.add(face);
    await face.load(); check(); document.fonts.add(face);
  }
  ${SEQUENCE_IMAGE_DECODER_SOURCE}
  ${IMAGE_DIMENSIONS_WORKER_SOURCE}
  ${IMAGE_PREPROCESS_RENDERER_SOURCE}
  ${MV_RECIPE_RENDERER_SOURCE}
  addEventListener('message', function connect(event) {
    const message = event.data;
    if (event.source !== parent || !message || message.type !== ${JSON.stringify(MV_NATIVE_CONNECT)}
      || typeof message.requestId !== 'string' || message.requestId.length < 1 || message.requestId.length > 128
      || event.ports.length !== 1) return;
    removeEventListener('message', connect);
    const port = event.ports[0], requestId = message.requestId;
    const send = (type, data = {}, transfer = []) => port.postMessage({
      protocol:${JSON.stringify(MV_NATIVE_PROTOCOL)}, requestId, type, ...data
    }, transfer);
    async function render(input) {
      let imageAssets, sequenceAssets;
      try {
        check();
        if (!input || typeof input !== 'object' || Array.isArray(input)
          || Object.keys(input).some(k => !['width','height','frame','resources','sequenceImages','imageAdmissions','preparedPatches','rasterByteLimit'].includes(k)))
          throw Error('Invalid native MV payload');
        const {width,height,frame,resources,sequenceImages,imageAdmissions} = input;
        if(input.preparedPatches!==undefined){
          if(!Array.isArray(input.preparedPatches)||!Number.isSafeInteger(input.rasterByteLimit)||input.rasterByteLimit<1)throw Error('Invalid preprocessing raster residency');
          rasterByteLimit=input.rasterByteLimit;
        }
        if (!frame || !frame.recipePlan || !Array.isArray(resources) || !Array.isArray(sequenceImages))
          throw Error('Missing admitted native MV inputs');
        const resourceBytes = new Map(), descriptors = new Map();
        for (const {resource,body} of resources) {
          check();
          if (!resource || descriptors.has(resource.id) || !(body instanceof ArrayBuffer)
            || body.byteLength !== resource.byteLength
            || !['image','imageSequence','font','model','environment','analysis'].includes(resource.kind))
            throw Error('Invalid admitted native MV resource');
          resourceBytes.set(resource.id,body); descriptors.set(resource.id,Object.freeze(resource));
          if (resource.kind === 'font') await loadFont(resource,body);
        }
        const budget = createMvImageDecodeBudget(frame.imageDecodeLimits);
        imageAssets = await decodeMvDeclaredImages(frame,resources,imageAdmissions,'render',budget); check();
        sequenceAssets = await decodeMvSequenceImages(frame,sequenceImages,budget); check();
        const assets = Object.freeze({
          preparedPatch:createMvPreparedPatches(input.preparedPatches||[]),
          image(id) { if (!imageAssets.images.has(id)) throw Error('Unknown native image'); return imageAssets.images.get(id); },
          sequenceImage(key) { if (!sequenceAssets.images.has(key)) throw Error('Unknown native sequence image'); return sequenceAssets.images.get(key); },
          bytes(id) { if (!resourceBytes.has(id)) throw Error('Unknown native resource'); return resourceBytes.get(id).slice(0); },
          descriptor(id) { if (!descriptors.has(id)) throw Error('Unknown native descriptor'); return descriptors.get(id); }
        });
        const canvas = createSurface(width,height);
        iterator = renderMvRecipeSteps(canvas,frame.recipePlan,assets,createSurface);
        let completed = false;
        while (!completed) {
          for (let count = 0; count < 64; count++) {
            check();
            if (iterator.next().done) { completed = true; break; }
          }
          if (!completed) await new Promise(resolve => setTimeout(resolve,0));
          check();
        }
        iterator = undefined;
        const bitmap = await createImageBitmap(canvas); check();
        send('rendered',{bitmap},[bitmap]); bitmaps.delete(bitmap);
      } catch (error) {
        if (!disposed) send('error',{error:String(error).slice(0,2000)});
      } finally {
        if (imageAssets) imageAssets.close();
        if (sequenceAssets) sequenceAssets.close();
        cleanup();
      }
    }
    port.onmessage = ({data}) => {
      if (!data || data.protocol !== ${JSON.stringify(MV_NATIVE_PROTOCOL)} || data.requestId !== requestId) return;
      if (data.type === 'dispose') {
        disposed = true; cleanup(); send('disposed'); port.close(); return;
      }
      if (disposed || started || data.type !== 'render') return;
      started = true; void render(data.input);
    };
    port.onmessageerror = () => { disposed = true; cleanup(); port.close(); };
    send('ready');
  });
})();
</script>`;
