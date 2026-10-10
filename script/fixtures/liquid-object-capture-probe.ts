import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { captureThreeLiquidObjectPng } from "../../apps/cli/src/programmatic/liquid-object-capture";
import { loadProgrammaticResource } from "../../apps/cli/src/programmatic/resources";
import { describeResource, saveResourceBytes } from "../../apps/cli/src/programmatic/resource-bytes";
import * as wasm from "opencut-wasm";
import { glassObjectGpuAssets } from "./glass-object-gpu-assets";
import { pngPixels, pixelComparison, visibility } from "./liquid-object-capture-probe-pixels.mjs";
import { InMemoryProjectStore } from "../../packages/editor-ports/src/in-memory";
import type { ProbeOptions, ProbeReport, CompiledProbe, LiquidCreator } from "./liquid-object-capture-probe-types";
import { errorReceipt } from "./liquid-object-capture-probe-types";

/** Actual production compile/archive/capture; filesystem fixture store, no fake native transport. */
export async function runLiquidCaptureProbe(options: ProbeOptions) {
 const { root, creator, threeToolchain, executable } = options;
 const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
 const report: ProbeReport = { ok: false, stage: "initializing", root, scope: "private packed production Chromium compile/archive/capture only; no editor/export/release certification", captures: [], compiled: [] };
 const attachments = new Map<string, ArrayBuffer>();
 const store = new InMemoryProjectStore(), originalSave = store.saveAttachment.bind(store);
 store.saveAttachment = async item => {
  const body = item.body.slice(0);attachments.set(item.key,body);
  await writeFile(join(root, "attachments", item.key), new Uint8Array(body), { flag: "wx" });
  return originalSave(item);
 };
 const context = { projectId: "private-liquid-probe", store };
 const persist = () => writeFile(join(root, "capture-evidence.json"), JSON.stringify(report, null, 2));
 const controller = new AbortController(), signal = controller.signal;
 try {
  await mkdir(join(root, "attachments"));
  const THREE = await import(pathToFileURL(join(threeToolchain, "node_modules/three/build/three.module.js")).href);
  const asset = glassObjectGpuAssets(THREE)[0]!;
  const body = asset.body.buffer.slice(asset.body.byteOffset, asset.body.byteOffset + asset.body.byteLength);
  const model = describeResource({ id: asset.id, kind: "model", mimeType: asset.mimeType }, body.byteLength, sha(asset.body));
  await saveResourceBytes(context, { resource: model, body }, signal);
  const { liquidObjectThree }: LiquidCreator = await import(pathToFileURL(join(creator, "liquid-object.mjs")).href);
  const resolver: unknown = Reflect.get(wasm,"resolveLiquidObjectParamsJson");assert.equal(typeof resolver,"function");
  if(typeof resolver!=="function")throw Error("Specified WASM Liquid resolver missing");
  const resolveParams = (json: string) => { const result: unknown = resolver(json);assert.equal(typeof result,"string");
   if(typeof result!=="string")throw Error("Actual Rust resolver must return JSON text");return result; };
  const compile = async ({ name, amount }: { name: string; amount: number }) => {
   report.stage = `compile-${name}`; await persist();
   const shot = await liquidObjectThree({ sourceDirectory: creator, model,
    settings: { width: 192, height: 128, durationFrames: 61, frameRate: { numerator: 30, denominator: 1 }, seed: 19 },
    liquid: { amount, frequency: 3, speed: 1.5, twist: 0.65 }, resolveParams });
   const compiled = await compileProgrammaticProject({ action: "compile", input: shot.spec,
    toolchainDirectory: threeToolchain, context, signal, enqueue: async task => task() });
   const source = compiled.source;
   const lock = await loadProgrammaticResource({ ...context, resource: source.build!.toolchainLock, signal });
   const archive: unknown = JSON.parse(new TextDecoder().decode(lock.body)); assert(archive && typeof archive === "object" && Object.hasOwn(archive,"threeLiquidObject"));
   const document = await loadProgrammaticResource({ ...context, resource: source.resources!.find(resource => resource.id === source.documentId)!, signal });
   const code = new TextDecoder("utf-8", { fatal: true }).decode(document.body);
   report.compiled.push({ name, source, archive, documentBytes: document.body.byteLength, documentSha256: sha(new Uint8Array(document.body)) });
   await persist();return { source, code };
  };
  const baseline = await compile({ name: "base", amount: 0.45 });
  const capture = async ({ name, compiled, index }: { name: string; compiled: CompiledProbe; index: number }) => {
   report.stage = `capture-${name}`; await persist();
   const mapped = JSON.parse(wasm.resolveProgrammaticFrameJson(JSON.stringify({ source: compiled.source,
    clipStart: 0, clipDuration: 61 * 4000, trimStart: 0, timelineTime: index * 4000 })));
   assert(!mapped.error && mapped.frame, "Actual Rust mapped frame required");
   const mappedFrame = mapped.frame;assert(mappedFrame.resourceLimits);assert.equal(mappedFrame.index,index);
   const resolved = [];
   for (const resource of compiled.source.resources ?? []) if (resource.id !== compiled.source.documentId)
    resolved.push(await loadProgrammaticResource({ ...context, resource, signal }));
   const started = performance.now();
   const png = await captureThreeLiquidObjectPng({ executable, source: compiled.source, mappedFrame,
    code: compiled.code, resources: resolved, resourceStore: context, signal });
   const path = join(root, `${name}.png`); await writeFile(path, png, { flag: "wx" });
   const pixels = pngPixels(png); assert.equal(pixels.width, 192); assert.equal(pixels.height, 128);
   report.captures.push({ name, mappedFrame, path, bytes: png.length, sha256: sha(png), elapsedMs: performance.now() - started,
    captureReturnedAfterProductionPageCleanupBrokerDisposeAndBrowserClose: true,
    observedProcesses: options.observe?.(), visibility: visibility(pixels) });
   await persist();return pixels;
  };
  const base = await capture({ name: "base", compiled: baseline, index: 23 });
  assert(visibility(base).changedPixels > 200, "Stage1 visible curved model required");
  report.stage1 = "visible PNG passed"; await persist();
  const disabled = await compile({ name: "amount-zero", amount: 0 });
  const flat = await capture({ name: "amount-zero", compiled: disabled, index: 23 });
  report.parameterSensitivity = pixelComparison({ a: base, b: flat });
  assert(report.parameterSensitivity.mean > 0.5 && report.parameterSensitivity.changedPixels > 100, "Stage2 amount sensitivity required");
  await persist();
  const late = await capture({ name: "late", compiled: baseline, index: 41 });
  report.motionSensitivity = pixelComparison({ a: base, b: late });
  assert(report.motionSensitivity.mean > 0.5 && report.motionSensitivity.changedPixels > 100, "Stage3 mapped-time sensitivity required");
  const reverse = await capture({ name: "reverse", compiled: baseline, index: 23 });
  report.reverseSeek = pixelComparison({ a: base, b: reverse }); assert.equal(report.reverseSeek.changedPixels, 0);
  report.attachments = [...attachments].map(([key, body]) => ({ key, bytes: body.byteLength, sha256: sha(new Uint8Array(body)) }));
  report.ok = true;report.stage = "completed-4-real-production-captures";
 } catch (error) {
  report.failure = errorReceipt(error);
  throw Object.assign(error instanceof Error ? error : Error(String(error)), { receipt: report });
 } finally { await persist(); }
 return report;
}
