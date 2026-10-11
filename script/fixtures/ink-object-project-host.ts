import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startHost, type RunningHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { inkObjectGpuAssets } from "./ink-object-gpu-assets";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function record(value: unknown): Record<string, unknown> {
 if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Expected Host response object");
 return Object.fromEntries(Object.entries(value));
}

export async function runInkProjectHost(options: { root: string; creator: string; pkg: string; threeToolchain: string }) {
 const { root, creator, pkg, threeToolchain } = options;
 const projectRoot = join(root, "project"), input = join(root, "input");
 const report: Record<string, unknown> = { ok: false, stage: "CPU-host-open", scope: "actual HeadlessHost transactions/FileProjectStore persistence, not editor UI history" };
 const persist = () => writeFile(join(root, "persistence-evidence.json"), JSON.stringify(report, null, 2));
 let host: RunningHost | undefined, opened = 0, closed = 0;
 const open = async () => { host = await startHost({ projectRoot, registry: new TargetRegistry(join(root, "registry")), engineToolchainDirectory: threeToolchain, htmlBrowserExecutable: "", htmlFrameConnectionFile: "" }); opened++; };
 const close = async () => { if (host) { await host.close(); host = undefined; closed++; } };
 const request = async ({ route, body }: { route: string; body?: unknown }) => {
  assert(host);
  const response = await fetch(new URL(`api/${route}`, host.editorUrl), { signal: AbortSignal.timeout(30000), ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  const value: unknown = await response.json();
  assert.equal(response.status, 200, `Host route ${route}: ${JSON.stringify(value)}`);
  return value;
 };
 try {
  await mkdir(input);
  await open();
  const initial = record(await request({ route: "context" }));
  const wasm = await import(pathToFileURL(join(pkg, "opencut_wasm_sync.js")).href);
  const resolveInk = (wasm as Record<string, unknown>).resolveInkObjectParamsJson;
  if (typeof resolveInk !== "function") throw Error("Actual Ink resolver missing");
  const resolveParams = (json: string) => { const result = (resolveInk as (input: string) => unknown)(json); if (typeof result !== "string") throw Error("Resolver returned nontext"); return result; };
  const THREE = await import(pathToFileURL(join(threeToolchain, "node_modules/three/build/three.module.js")).href);
  const assets = inkObjectGpuAssets(THREE);
  const resources: Record<string, unknown>[] = [];
  for (const asset of assets) {
   const filePath = join(input, asset.id);
   await writeFile(filePath, asset.body, { flag: "wx" });
   const imported = record(await request({ route: "programmatic/resources/import", body: { id: asset.id, kind: asset.kind, mimeType: asset.mimeType, filePath } }));
   const model = record(imported.resource);
   assert.equal(model.sha256, sha(asset.body));
   resources.push(model);
  }
  const creatorApi = await import(pathToFileURL(join(creator, "ink-object.mjs")).href);
  const shot = await (creatorApi as Record<string, (input: unknown) => Promise<{ spec: unknown }>>).inkObjectThree({
   sourceDirectory: creator, model: resources[0], environment: resources[1],
   settings: { width: 192, height: 128, durationFrames: 49, frameRate: { numerator: 24, denominator: 1 } },
   ink: { contourWidth: 4, inkDensity: 0.85, paperTexture: 0.65, paperScale: 12, seed: 19 },
   resolveParams,
  });
  report.stage = "CPU-compile"; await persist();
  const compiled = record(await request({ route: "programmatic/build/compile", body: shot.spec }));
  const source = record(compiled.source);
  const build = record(source.build);
  assert.equal(build.engine, "three");
  const project = record(initial.project);
  const applied = record(await request({ route: "apply", body: { expectedRevision: initial.revision, operations: [
   { kind: "update-project", projectId: project.id, patch: { name: "Private Ink persistence probe", canvasWidth: 192, canvasHeight: 128, frameRate: record(record(shot.spec).frameRate) } },
   { kind: "create-track", track: { id: "ink-track", name: "Ink Object", kind: "graphic", hidden: false } },
   { kind: "create-clip", clip: { id: "ink-object", trackId: "ink-track", startTime: 0, duration: 245000, trimStart: 0, trimEnd: 0, editing: { type: "graphic", name: "Ink Object", definitionId: "programmatic", params: {}, effects: [], programmatic: source } } },
  ] } }));
  assert.equal(applied.accepted, true);
  await close();
  const beforeBytes = await readFile(join(projectRoot, "project.json"));
  await open();
  const after = record(await request({ route: "context" }));
  const projectId = record(after.project).id;
  if (typeof projectId !== "string") throw Error("Persisted project ID missing");
  const attachments: Record<string, unknown>[] = [];
  const sourceRecord = record(source);
  const declared = [...(Array.isArray(sourceRecord.resources) ? sourceRecord.resources : []), ...(Array.isArray(build.inputs) ? build.inputs : []), record(build.toolchainLock)];
  for (const resource of declared) {
   const item = record(resource);
   const key = item.attachmentKey;
   if (typeof key !== "string") continue;
   const bytes = await readFile(join(projectRoot, "attachments", key, "body.bin"));
   assert.equal(sha(bytes), item.sha256);
   attachments.push({ id: item.id, key, sha256: item.sha256, bytes: bytes.length });
  }
  report.ok = true; report.stage = "CPU-persistence-passed";
  report.projectSha256 = sha(beforeBytes); report.attachments = attachments;
  return { report, projectRoot };
 } catch (error) {
  report.failure = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { name: "UnknownError", message: String(error) };
  throw error;
 } finally {
  await close();
  report.hostOpened = opened; report.hostClosed = closed;
  assert.equal(opened, closed);
  await persist();
 }
}
