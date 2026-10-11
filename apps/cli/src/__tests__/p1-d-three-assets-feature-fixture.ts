import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { pinInkHostToolchain } from "../../../../script/fixtures/ink-object-host-toolchain.mjs";
import { loadProgrammaticResource } from "../programmatic/resources";
import { p1dModelAuthor } from "./p1-d-three-assets-fixture";
import { threeRevisionFixture, threeRevisionRoot, threeRevisionDigest } from "./programmatic-three-build-revision-fixture";

export const p1dFeatureScene = `import * as THREE from 'three';
import {createModelAnimation} from '@elftia/three-assets';
export async function createScene({assets,signal}) {
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1.5,1.5,1.5,-1.5,.1,20);camera.position.z=4;
 const instance=await assets.model('assets/p1d.glb');
 const shape=await assets.svg('assets/shape.svg',{modeling:{kind:'flat'},curveSegments:8});
 shape.value.scale.setScalar(.01);shape.value.position.set(-.8,-.8,-.2);
 scene.add(instance.value,shape.value);signal.throwIfAborted();
 const animation=createModelAnimation(instance,{clip:'P1DTranslation',mode:'clamp'});
 return {scene,camera,renderFrame(frame){animation.seek(frame.time);},dispose(){animation.dispose();}};
}`;

export async function runP1dThreeAssetsFeature(toolchain: string) {
	const before = await pinInkHostToolchain(toolchain);
	const manifest = JSON.parse(await readFile(join(toolchain, "node_modules/@elftia/three-assets/package.json"), "utf8"));
	assert.equal(manifest.elftiaAssetFeatures, "svg-animation-v1");
	const wasmRoot = realpathSync(join(threeRevisionRoot, "node_modules/opencut-wasm"));
	assert.equal(wasmRoot, realpathSync(join(threeRevisionRoot, "rust/wasm/pkg")));
	const wasmSha256 = threeRevisionDigest(await readFile(join(wasmRoot, "opencut_wasm_bg.wasm")));
	assert.equal(wasmSha256, "084cf7310df5bfdc1b8e4ce3f64bcff842e1b23b9fd0ca57c1c7dcffc0d1fc12");
	const fixture = await threeRevisionFixture(toolchain);
	const evidence: Record<string, any> = { version: 1, ok: false, artifacts: fixture.root, wasmRoot, wasmSha256,
		scope: "Real Host glTF and SVG import/archive/restore, feature-profile compile, CPU feature animation API, save/reopen. No SVG DOM parsing/raster, GPU, browser or export.",
		browserTested: false, svgRuntimeTested: false, exportTested: false, toolchainBefore: before, negativeControls: [],
		preparedBrowserPlan: { frames: [0, 23, 7, 23, 0], frameRate: 30, shortExportDurationFrames: 30, executed: false } };
	try {
		const author = p1dModelAuthor(), modelSource = join(fixture.author, "feature-model");
		await mkdir(modelSource); await writeFile(join(modelSource, "scene.gltf"), author.gltf, { flag: "wx" });
		await writeFile(join(modelSource, "mesh.bin"), author.binary, { flag: "wx" });
		await writeFile(join(fixture.author, "feature-main.ts"), p1dFeatureScene, { flag: "wx" });
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="lime"/></svg>';
		await writeFile(join(fixture.author, "feature-shape.svg"), svg, { flag: "wx" });
		evidence.assets = { origin: author.origin, gltfSha256: threeRevisionDigest(author.gltf), binarySha256: threeRevisionDigest(author.binary),
			svgOrigin: "script/fixtures/html-frame-browser-probe.ts: existing 64x64 lime rectangle", svgSha256: threeRevisionDigest(svg) };
		const importSpec = { id: "assets/p1d.glb", kind: "model", mimeType: "model/gltf-binary", sourceDirectory: modelSource, entryFile: "scene.gltf", files: ["scene.gltf", "mesh.bin"] };
		const record = await fixture.recordBytes(), snapshot = await fixture.snapshot(), ledger = await fixture.ledger();
		let rejected = "";
		try { await fixture.request("programmatic/resources/import", { ...importSpec, files: ["scene.gltf"] }); } catch (error) { rejected = String(error); }
		assert.ok(rejected.includes("422"), rejected);
		assert.deepEqual(await fixture.recordBytes(), record); assert.deepEqual(await fixture.snapshot(), snapshot); assert.deepEqual(await fixture.ledger(), ledger);
		evidence.negativeControls.push({ name: "missing-binary-closure", error: rejected, projectBytesUnchanged: true, snapshotUnchanged: true, attachmentLedgerUnchanged: true });
		const imported = await fixture.request("programmatic/resources/import", importSpec);
		const svgImported = await fixture.request("programmatic/resources/import", { id: "assets/shape.svg", kind: "model", mimeType: "image/svg+xml", filePath: join(fixture.author, "feature-shape.svg") });
		assert.ok(imported.archive); evidence.imported = { model: imported, svg: svgImported };
		const glb = Buffer.from((await loadProgrammaticResource({ ...fixture.context, resource: imported.resource })).body);
		assert.deepEqual(Buffer.from((await loadProgrammaticResource({ ...fixture.context, resource: svgImported.resource })).body), Buffer.from(svg));
		await rename(modelSource, join(fixture.root, "feature-model-author-unavailable"));
		const restored = await fixture.request("programmatic/resources/restore-model-source", { resource: imported.archive.resource, outputDirectory: join(fixture.root, "feature-restored-model") });
		assert.equal(restored.status, "complete");
		assert.deepEqual(await readFile(join(restored.sourceDirectory, "scene.gltf")), author.gltf);
		assert.deepEqual(await readFile(join(restored.sourceDirectory, "mesh.bin")), author.binary);
		evidence.restored = { ...restored, originalAuthorUnavailable: true, allAuthorBytesEqual: true };
		const loader = await import(pathToFileURL(join(toolchain, "node_modules/three/examples/jsm/loaders/GLTFLoader.js")).href);
		const loaded = await new Promise<any>((resolve, reject) => new loader.GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), "", resolve, reject));
		const { modelHandle } = await import(pathToFileURL(join(toolchain, "node_modules/@elftia/three-assets/dist/model-instance.js")).href);
		const { createModelAnimation } = await import(pathToFileURL(join(toolchain, "node_modules/@elftia/three-assets/dist/index.js")).href);
		let sourceDisposals = 0;
		const handle = modelHandle(loaded, { dispose() { sourceDisposals++; } });
		const instance = handle.createInstance(); assert.notEqual(instance.value, loaded.scene); assert.notEqual(instance.animations[0], loaded.animations[0]);
		const animation = createModelAnimation(instance, { clip: "P1DTranslation", mode: "clamp" });
		const samples = [0.75, 0, 0.25, 0.75, 1.5, -0.5].map(time => {
			const sampledTime = animation.seek(time), x = instance.value.getObjectByName("P1DAnimatedMesh").position.x;
			assert.equal(sampledTime, Math.min(1, Math.max(0, time))); assert.equal(x, sampledTime * 0.5); return { time, sampledTime, x };
		});
		assert.equal(loaded.scene.getObjectByName("P1DAnimatedMesh").position.x, 0);
		animation.dispose(); assert.throws(() => animation.seek(0), /disposed/i); instance.dispose(); handle.dispose(); assert.equal(sourceDisposals, 1);
		evidence.cpuAnimation = { actualLoader: "fixed Three GLTFLoader", actualFeatureAPI: "fixed package modelHandle/createModelAnimation", clonedInstanceAndAnimation: true,
			samples, sourceUnchanged: true, disposalCount: sourceDisposals, noWebGL: true };
		const spec = { ...fixture.spec, entryFile: "feature-main.ts", files: ["feature-main.ts"], durationFrames: 30, inputProps: {}, resources: [imported.resource, svgImported.resource] };
		const compiled = await fixture.success("compile", spec); evidence.compiled = compiled;
		assert.equal(compiled.source.build?.engineVersion, "0.185.1");
		const negativeRecord = await fixture.recordBytes(), negativeSnapshot = await fixture.snapshot(), negativeLedger = await fixture.ledger();
		const failure = await fixture.post("compile", { ...spec, entryFile: "missing.ts", files: ["missing.ts"] });
		const failureBody = await failure.text(); assert.equal(failure.status, 422);
		assert.deepEqual(await fixture.recordBytes(), negativeRecord); assert.deepEqual(await fixture.snapshot(), negativeSnapshot); assert.deepEqual(await fixture.ledger(), negativeLedger);
		evidence.negativeControls.push({ name: "missing-source-does-not-publish", status: failure.status, error: failureBody, projectBytesUnchanged: true, snapshotUnchanged: true, attachmentLedgerUnchanged: true, documentPublished: false });
		const context = await fixture.request("context");
		await fixture.request("apply", { expectedRevision: context.revision, operations: [
			{ kind: "create-track", track: { id: "p1d-feature-track", name: "P1-D feature Three", kind: "graphic", hidden: false } },
			{ kind: "create-clip", clip: { id: "p1d-feature-clip", trackId: "p1d-feature-track", startTime: 0, duration: 120000, trimStart: 0, trimEnd: 0,
				editing: { type: "graphic", name: "P1-D SVG and animation", definitionId: "programmatic", params: {}, effects: [], programmatic: compiled.source } } },
		] });
		await fixture.moveAuthor();
		const persisted = await fixture.recordBytes(), savedSnapshot = await fixture.snapshot(), savedLedger = await fixture.ledger(), resources = await fixture.resources(compiled.source);
		await fixture.reopen();
		assert.deepEqual(await fixture.recordBytes(), persisted); assert.deepEqual(await fixture.snapshot(), savedSnapshot); assert.deepEqual(await fixture.ledger(), savedLedger);
		assert.deepEqual(await fixture.resources(compiled.source), resources);
		assert.deepEqual(await fixture.success("rebuild", compiled.source), { source: compiled.source, reusedDocument: true });
		evidence.persistence = { projectBytesSha256: threeRevisionDigest(persisted), snapshotExact: true, ledgerExact: true, resourcesExact: true, archivedBuildReusedAfterAuthorUnavailable: true, resources };
		evidence.toolchainAfter = await pinInkHostToolchain(toolchain); assert.deepEqual(evidence.toolchainAfter, before);
		evidence.featureProfile = { declared: manifest.elftiaAssetFeatures, hostCompileAccepted: true, svgRuntimeAccepted: false };
		evidence.ok = true;
	} catch (error) { evidence.error = String(error instanceof Error ? error.stack : error); throw error; }
	finally { await fixture.close(); await writeFile(join(fixture.root, "p1-d-feature-evidence.json"), JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
		console.log(JSON.stringify({ p1dFeatureArtifact: fixture.root, ok: evidence.ok, error: evidence.error })); }
	return evidence;
}
