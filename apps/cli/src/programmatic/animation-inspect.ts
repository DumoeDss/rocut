import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as wasm from "opencut-wasm";
import { loadProgrammaticResource, type ProgrammaticResourceStore } from "./resources";
import { loadEngineToolchain } from "./engines/toolchain";
import { readResourceFile } from "./resource-bytes";
import { sourceDescription, LOCK_ID } from "./engines/build-source";

export const PROGRAMMATIC_ANIMATION_INSPECT_CAPABILITY = {
  version: 1, route: "programmatic/animation-inspect", command: "programmatic animation-inspect",
  requiredExport: "loadModelAnimationCatalog", availability: "requires-fixed-toolchain",
  scope: "read-only-imported-glb-metadata; no-playback-or-image-decoder-health",
} as const;

export async function inspectProgrammaticAnimation({ input, signal, ...context }: ProgrammaticResourceStore & { input: unknown; signal: AbortSignal }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Expected animation inspection specification");
  const spec = input as Record<string, unknown>;
  if (Object.keys(spec).some(key => !["resource", "toolchainDirectory"].includes(key)) || typeof spec.toolchainDirectory !== "string")
    throw Error("Animation inspection accepts resource and toolchainDirectory only");
  const resource = spec.resource as Parameters<typeof loadProgrammaticResource>[0]["resource"];
  if (!resource || resource.kind !== "model" || resource.mimeType !== "model/gltf-binary")
    throw Error("Animation inspection requires an imported GLB model resource");
  const loaded = await loadProgrammaticResource({ ...context, resource, signal });
  const toolchain = await loadEngineToolchain({ directory: spec.toolchainDirectory, engine: "three", signal });
  if (!toolchain.threeFeatures) throw Error("Animation inspection requires the fixed Three feature package");
  const identity = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(toolchain.lock.body));
  if (!identity.threeAssetCodecs) throw Error("Animation inspection requires the fixed offline codec closure");
  const assetRoot = join(toolchain.root, "node_modules/@elftia/three-assets");
  // Require the actual new module; older packages never gain an implicit fallback.
  try { await readResourceFile(join(assetRoot, "dist/model-animation-catalog.js"), sourceDescription(LOCK_ID), signal); }
  catch (cause) { signal.throwIfAborted(); throw new Error("Fixed Three animation catalog module unavailable", { cause }); }
  const assets = await import(pathToFileURL(join(assetRoot, "dist/index.js")).href);
  if (typeof assets.loadModelAnimationCatalog !== "function") throw Error("Fixed Three animation catalog export unavailable");
  // Existing Rust source-admission boundary supplies decode policy. This inert
  // admission source is never executed; no animation clock or seek is produced.
  const admitted = JSON.parse(wasm.resolveProgrammaticFrameJson(JSON.stringify({
    source: { version: 1, runtime: "html-document", code: "<div></div>", width: 1, height: 1,
      frameRate: { numerator: 30, denominator: 1 }, durationFrames: 1, seed: 0, resources: [resource] },
    clipStart: 0, clipDuration: 1, trimStart: 0, timelineTime: 0,
  })));
  if (admitted.error || !admitted.frame?.resourceLimits) throw Error(admitted.error ?? "Rust resource policy unavailable");
  const catalog = await assets.loadModelAnimationCatalog({ id: resource.id, mediaType: resource.mimeType,
    byteLength: resource.byteLength, sha256: resource.sha256 }, {
    limits: admitted.frame.resourceLimits, signal,
    resolver: { read: async (id: string) => { if (id !== resource.id) throw Error("Undeclared inspection resource"); return loaded.body.slice(0); } },
  });
  signal.throwIfAborted();
  return { version: 1, resource: { id: resource.id, sha256: resource.sha256, byteLength: resource.byteLength }, clips: catalog.clips };
}
