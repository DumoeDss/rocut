import { MV_RECIPE_RENDERER_SOURCE } from "./mv-recipe-renderer";
import { SEQUENCE_IMAGE_DECODER_SOURCE } from "./sequence-image-decoder";
import { FONT_METRICS_WORKER_SOURCE } from "./font-metrics-worker";
import { IMAGE_DIMENSIONS_WORKER_SOURCE } from "./image-dimensions-worker";
import { MV_REFERENCE_POST_SOURCE } from "./mv-reference-post";
import { MV_ROAD_REFERENCE_POST_SOURCE } from "./mv-road-reference-post";
import { MV_ROAD_POST_BACKEND_SOURCE } from "./mv-road-post-backend";

const WORKER_SOURCE =
	SEQUENCE_IMAGE_DECODER_SOURCE +
	IMAGE_DIMENSIONS_WORKER_SOURCE +
	FONT_METRICS_WORKER_SOURCE +
	MV_RECIPE_RENDERER_SOURCE +
	MV_REFERENCE_POST_SOURCE +
	MV_ROAD_REFERENCE_POST_SOURCE +
	MV_ROAD_POST_BACKEND_SOURCE +
	`onmessageerror = () => postMessage({error:"Programmatic Worker request deserialization failed"});
onmessage = async ({data}) => {
  const {source, frame, resources = [], sequenceImages = [], imageAdmissions = [], operation = 'render'} = data;
  const send = postMessage.bind(self);
  send({sandboxStage:"worker-started"});
  const resourceBytes = new Map();
  const descriptors = new Map();
  let sequenceAssets;
  let imageAssets;
  let tunnelFonts;
  try {
    if (resources.length !== (source.resources || []).length) throw Error("Missing programmatic resources");
    for (let i = 0; i < resources.length; i++) {
      const {resource, body} = resources[i];
      if (JSON.stringify(resource) !== JSON.stringify(source.resources[i])) throw Error("Resource manifest mismatch");
      if (!['image', 'imageSequence', 'font', 'model', 'environment', 'analysis'].includes(resource.kind)) throw Error('Unsupported Canvas resource kind: ' + resource.kind);
      resourceBytes.set(resource.id, body);
      descriptors.set(resource.id, Object.freeze({...resource, ...(resource.font ? {font: Object.freeze({...resource.font, ...(resource.font.axes ? {axes: Object.freeze({...resource.font.axes})} : {})})} : {})}));
      if (resource.kind === 'font') {
        await loadProgrammaticFont(resource, body);
      }
    }
    if (operation === 'measure-fonts') {
      if (!Array.isArray(frame.fontMetricRequests)) throw Error('Missing font metric requests');
      send({fontMetrics: measureProgrammaticFonts(frame.fontMetricRequests, descriptors)});
      return;
    }
    const fontAssets = Object.freeze({
      bytes(id) { if (!resourceBytes.has(id)) throw Error('Unknown Tunnel resource'); return resourceBytes.get(id).slice(0); },
      descriptor(id) { if (!descriptors.has(id)) throw Error('Unknown Tunnel descriptor'); return descriptors.get(id); }
    });
    if (operation === 'measure-tunnel-fonts') {
      if (!Array.isArray(frame.tunnelFontMetricRequests)) throw Error('Missing Tunnel font requests');
      tunnelFonts=await mvTunnelFontStacks(fontAssets,self.fonts);
      const context=new OffscreenCanvas(1,1).getContext('2d');
      if (!context) throw Error('Tunnel metrics require Canvas2D');
      const measured=[];
      for (const request of frame.tunnelFontMetricRequests) measured.push(await tunnelFonts.measure(context,request));
      send({tunnelFontMeasurements:measured});return;
    }
    if (operation !== 'render' && operation !== 'measure-resources') throw Error('Unknown Canvas operation');
    const budget = createMvImageDecodeBudget(frame.imageDecodeLimits);
    imageAssets = await decodeMvDeclaredImages(frame, resources, imageAdmissions, operation, budget);
    if (operation === 'measure-resources') {
      const measured = {fontMetrics:measureProgrammaticFonts(frame.fontMetricRequests || [], descriptors),imageDimensions:imageAssets.facts};
      // Release decoded measurement images before publishing facts. A caller
      // may immediately admit/render the next phase after receiving this reply.
      imageAssets.close(); imageAssets = undefined;
      send(measured);
      return;
    }
    sequenceAssets = await decodeMvSequenceImages(frame, sequenceImages, budget);
    if (frame.tunnelFontStacks?.length) {
      tunnelFonts=await mvTunnelFontStacks(fontAssets,self.fonts);
      for (const bound of frame.tunnelFontStacks) await tunnelFonts.load(bound.fontStack);
    }
    // Explicit face.load() above is the resource barrier. Worker FontFaceSet
    // readiness can await a rendering turn that does not exist until we draw.
    const assets = Object.freeze({
      tunnelFonts,
      referencePost:Object.freeze({
        ...createRoadPostBackend({
          createSurface:(width,height)=>new OffscreenCanvas(width,height),
          releaseSurface(canvas){canvas.width=canvas.height=1;},
          check(){},renderReferencePost,executeRoadPost:applyRoadReferencePost
        }),
        apply(ctx,nativePost){
        if (!nativePost.plan || nativePost.plan.songTicks !== nativePost.songTicks || nativePost.plan.profile !== nativePost.profile) throw Error('Tunnel native post receipt mismatch');
        const output=new OffscreenCanvas(source.width,source.height);
        try {renderReferencePost({canvas:output,scene:ctx.canvas,plan:nativePost.plan});
          ctx.save();try{ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='copy';ctx.filter='none';ctx.drawImage(output,0,0);}finally{ctx.restore();}
        } finally {output.width=output.height=1;}
      }}),
      image(id) { if (!imageAssets.images.has(id)) throw Error('Unknown image resource: ' + id); return imageAssets.images.get(id); },
      sequenceImage(key) { if (!sequenceAssets.images.has(key)) throw Error('Unknown selected sequence image: ' + key); return sequenceAssets.images.get(key); },
      bytes(id) { if (!resourceBytes.has(id)) throw Error('Unknown resource: ' + id); return resourceBytes.get(id).slice(0); },
      descriptor(id) { if (!descriptors.has(id)) throw Error('Unknown resource: ' + id); return descriptors.get(id); }
    });
    const canvas = new OffscreenCanvas(source.width, source.height);
    let seed = frame.seed >>> 0;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    Math.random = random;
    if (source.recipe) renderMvRecipe(canvas, frame.recipePlan, assets);
    else {
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const render = new AsyncFunction("canvas", "frame", "assets", source.code);
      await render(canvas, Object.freeze({...frame, random}), assets);
    }
    if (canvas.width !== source.width || canvas.height !== source.height) throw Error("Source resized its canvas");
    const bitmap = canvas.transferToImageBitmap();
    send({bitmap}, [bitmap]);
  } catch (error) { send({error: String(error).slice(0, 2000)}); }
  finally { if (tunnelFonts) tunnelFonts.dispose(); if (imageAssets) imageAssets.close(); if (sequenceAssets) sequenceAssets.close(); }
};`;

/** No project text is interpolated into executable HTML. The opaque-origin frame
 * only brokers a private MessagePort to a fresh Worker. Blob Workers inherit this
 * document's CSP; source code receives no DOM, network, filesystem or host bridge.
 */
export const PROGRAMMATIC_SANDBOX_DOCUMENT = `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
<script>
"use strict";
addEventListener("message", function connect(event) {
  if (event.source !== parent || event.data !== "rocut-frame-v1" || !event.ports[0]) return;
  removeEventListener("message", connect);
  const port = event.ports[0];
  let worker;
  let url;
  const cleanup = () => {
    const currentWorker = worker, currentUrl = url;
    worker = undefined; url = undefined;
    try { if (currentWorker) currentWorker.terminate(); } catch {}
    try { if (currentUrl) URL.revokeObjectURL(currentUrl); } catch {}
  };
  let terminal = false;
  const fail = error => {
    if (terminal) return;
    terminal = true;
    try { port.postMessage({error}); } catch {} finally { cleanup(); }
  };
  port.onmessageerror = () => fail("Programmatic request deserialization failed");
  port.onmessage = ({data}) => {
    if (data === "dispose") { terminal = true; cleanup(); try { port.close(); } catch {} return; }
    if (terminal || worker) return;
    try {
    url = URL.createObjectURL(new Blob([${JSON.stringify(WORKER_SOURCE)}], {type:"text/javascript"}));
    worker = new Worker(url);
    worker.onmessage = ({data}) => {
      if (terminal) { if (data?.bitmap instanceof ImageBitmap) { try { data.bitmap.close(); } catch {} } return; }
      if (!data || typeof data !== "object") { fail("Invalid worker result"); return; }
      try {
      if (data.sandboxStage === "worker-started" && Object.keys(data).length === 1) { port.postMessage({sandboxStage:"worker-started"}); return; }
      if (data.bitmap instanceof ImageBitmap) port.postMessage({bitmap:data.bitmap}, [data.bitmap]);
      else if (Array.isArray(data.fontMetrics) && Array.isArray(data.imageDimensions)) port.postMessage({fontMetrics:data.fontMetrics,imageDimensions:data.imageDimensions});
      else if (Array.isArray(data.fontMetrics)) port.postMessage({fontMetrics:data.fontMetrics});
      else if (Array.isArray(data.tunnelFontMeasurements)) port.postMessage({tunnelFontMeasurements:data.tunnelFontMeasurements});
      else port.postMessage({error:typeof data.error === "string" ? data.error : "Invalid worker result"});
      terminal = true;
      cleanup();
      } catch {
        if (data.bitmap instanceof ImageBitmap) { try { data.bitmap.close(); } catch {} }
        fail("Programmatic Worker result dispatch failed");
      }
    };
    worker.onerror = () => fail("Programmatic Worker failed");
    worker.onmessageerror = () => fail("Programmatic Worker response deserialization failed");
    worker.postMessage(data);
    } catch { fail("Programmatic Worker startup failed"); }
  };
  port.postMessage("ready");
});
</script>`;
