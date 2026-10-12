import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { importProgrammaticResource } from "../../apps/cli/src/programmatic/resource-import";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { loadProgrammaticResources } from "../../apps/cli/src/programmatic/resources";
import { parseThreeParticleArchive } from "../../apps/cli/src/programmatic/three-particle-provenance";
import { springControl } from "./particle-control-cases";

export async function runControlledInstancedCompile({ root, toolchain, creator }: { root: string; toolchain: string; creator: string }) {
  assert(resolve(root).startsWith("C:\\tmps\\rocut-controlled-instanced-compile-"));
  const projectRoot = join(root, "project"), author = join(root, "author");
  await mkdir(author);
  const host = await startHost({ projectRoot, registry: new TargetRegistry(join(root, "registry")), htmlBrowserExecutable: "", htmlFrameConnectionFile: "" });
  try {
    const response = await fetch(new URL("api/context", host.editorUrl));
    assert.equal(response.status, 200);
    const info = await response.json();
    const context = { store: new FileProjectStore({ root: projectRoot, schemaVersion: 1 }), projectId: info.project.id };
    const retainedModelPath = "C:/tmps/rocut-particle-instanced-YCCYuY/original-unavailable.glb";
    const bytes = await readFile(retainedModelPath), filePath = join(root, "static-copy.glb");
    await writeFile(filePath, bytes, { flag: "wx" });
    const resource = (await importProgrammaticResource({ ...context, input: { id: "assets/static.glb", kind: "model", mimeType: "model/gltf-binary", filePath } })).resource;
    const { particleControlledInstancedThree } = await import(pathToFileURL(join(creator, "particle-controlled-object.mjs")).href);
    const instances = [[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], [-1,0,0,0,0,1,0,0,0,0,1,0,3,0,0,1]];
    const instanceColors = [[1,0,0], [0,1,0]];
    const control = structuredClone(springControl);
    const value = particleControlledInstancedThree({ sourceDirectory: author, model: resource, instances, instanceColors, control,
      settings: { width: 64, height: 64, durationFrames: 30, frameRate: { numerator: 30, denominator: 1 }, seed: 1977 }, inputProps: { count: 32 } });
    assert.deepEqual(value.spec.inputProps.motion.control, springControl);
    control.knots[0].position[0] = 99;
    assert.deepEqual(value.spec.inputProps.motion.control, springControl);
    assert.deepEqual(value.spec.files, ["particle-instanced-scene.ts", "particle-instanced-geometry.mjs", "particle-scene.ts"]);
    for (const file of value.spec.files) await copyFile(join(creator, file), join(author, file));
    const compile = (action: "compile" | "rebuild", input: unknown) => compileProgrammaticProject({ action, input, toolchainDirectory: toolchain,
      context, signal: AbortSignal.timeout(30000), enqueue: async task => task() });
    const { source } = await compile("compile", value.spec);
    assert.deepEqual(source.build!.capabilities, ["particle-surface-v1"]);
    assert.deepEqual(source.build!.inputProps, value.spec.inputProps);
    assert.deepEqual(source.build!.inputs.map(input => input.id).sort(), [...value.spec.files].sort());
    const archived = await loadProgrammaticResources(context, [...source.build!.inputs, source.build!.toolchainLock, ...source.resources!], new AbortController().signal);
    for (const input of source.build!.inputs) assert.deepEqual(Buffer.from(archived.find(item => item.resource.id === input.id)!.body), await readFile(join(author, input.id)));
    assert.deepEqual(Buffer.from(archived.find(item => item.resource.id === resource.id)!.body), bytes);
    const lock = archived.find(item => item.resource.id === source.build!.toolchainLock.id)!;
    const identity = parseThreeParticleArchive(source, lock.body);
    assert(identity, "Formal compiler must archive the actual native Particle identity");
    const document = archived.find(item => item.resource.id === source.documentId)!;
    assert(document.body.byteLength > 100000);
    // Both exact move targets are inside this run's allocated root. Never touch
    // the prior YCCYuY producer or its archives.
    await rename(author, join(root, "author-unavailable"));
    await rename(filePath, join(root, "original-copy-unavailable.glb"));
    const rebuilt = await compile("rebuild", source);
    assert.deepEqual(rebuilt.source, source);
    assert.equal(rebuilt.reusedDocument, true);
    assert.deepEqual(parseThreeParticleArchive(rebuilt.source, lock.body), identity);
    assert.deepEqual(await readFile(retainedModelPath), bytes);
    await writeFile(join(root, "source.json"), JSON.stringify(source, null, 2), { flag: "wx" });
    const receipt = { ok: true, root, toolchain, creator, retainedModelPath, resource, identity, authorFiles: value.spec.files,
      inputProps: source.build!.inputProps, compiledBytes: document.body.byteLength, completePropsVerified: true,
      exactThreeAuthorFilesAndGlbReadback: true, onlyDedicatedCopiesMoved: true, priorGlbUntouched: true,
      archiveOnlyRebuild: true, reusedDocument: rebuilt.reusedDocument, identityUnchanged: true,
      scope: "actual resource import/helper/formal compile/archive-only rebuild; no authored scene execution/GPU/new WASM/Vite/runtime pack" };
    await writeFile(join(root, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
    return receipt;
  } finally { await host.close(); await writeFile(join(root, "cleanup.json"), JSON.stringify({ ownedHostClosed: true }), { flag: "wx" }); }
}
