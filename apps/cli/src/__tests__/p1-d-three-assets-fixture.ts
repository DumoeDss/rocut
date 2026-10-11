import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { threeModel } from "../../../../script/fixtures/three-assets";
import { pinInkHostToolchain } from "../../../../script/fixtures/ink-object-host-toolchain.mjs";
import { loadProgrammaticResource } from "../programmatic/resources";
import { threeRevisionFixture, threeRevisionRoot, threeRevisionDigest } from "./programmatic-three-build-revision-fixture";

export function p1dModelAuthor() {
	// Derive real geometry from the existing tiny local fixture, not a new loader.
	const original = threeModel();
	const jsonLength = original.readUInt32LE(12);
	const document = JSON.parse(original.toString("utf8", 20, 20 + jsonLength));
	const originalBinary = original.subarray(28 + jsonLength);
	document.bufferViews = document.bufferViews.slice(0, 4);
	const geometryLength = Math.max(...document.bufferViews.map((view: { byteOffset: number; byteLength: number }) => view.byteOffset + view.byteLength));
	assert.equal(geometryLength % 4, 0);
	const times = Buffer.from(new Float32Array([0, 1]).buffer);
	const translations = Buffer.from(new Float32Array([0, 0, 0, 0.5, 0, 0]).buffer);
	const binary = Buffer.concat([originalBinary.subarray(0, geometryLength), times, translations]);
	document.bufferViews.push({ buffer: 0, byteOffset: geometryLength, byteLength: times.length },
		{ buffer: 0, byteOffset: geometryLength + times.length, byteLength: translations.length });
	document.accessors.push({ bufferView: 4, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1] },
		{ bufferView: 5, componentType: 5126, count: 2, type: "VEC3" });
	document.nodes[0].name = "P1DAnimatedMesh";
	document.animations = [{ name: "P1DTranslation", samplers: [{ input: 4, output: 5, interpolation: "LINEAR" }],
		channels: [{ sampler: 0, target: { node: 0, path: "translation" } }] }];
	document.buffers = [{ uri: "mesh.bin", byteLength: binary.length }];
	delete document.images; delete document.textures; delete document.samplers;
	document.materials = [{ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.9, 0.3, 0.2, 1], metallicFactor: 0, roughnessFactor: 1 } }];
	return { gltf: Buffer.from(JSON.stringify(document, null, 2), "utf8"), binary,
		origin: "script/fixtures/three-assets.ts threeModel(): existing geometry, texture removed for CPU loader; appended bounded local LINEAR node-translation animation" };
}

export const p1dScene = `import * as THREE from 'three';
export async function createScene({assets,signal}) {
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1.5,1.5,1.5,-1.5,.1,20);camera.position.z=4;
 const instance=await assets.model('assets/p1d.glb');
 if(instance.animations.length!==1 || instance.animations[0].name!=='P1DTranslation') throw Error('P1D real glTF animation missing');
 const mixer=new THREE.AnimationMixer(instance.value);mixer.clipAction(instance.animations[0]).play();
 scene.add(instance.value);signal.throwIfAborted();
 return {scene,camera,renderFrame(frame){mixer.setTime(frame.time);},dispose(){mixer.stopAllAction();mixer.uncacheRoot(instance.value);}};
}`;

export async function runP1dThreeAssets(toolchain: string) {
	const before = await pinInkHostToolchain(toolchain);
	const wasmRoot = realpathSync(join(threeRevisionRoot, "node_modules/opencut-wasm"));
	assert.equal(wasmRoot, realpathSync(join(threeRevisionRoot, "rust/wasm/pkg")));
	const wasmSha256 = threeRevisionDigest(await readFile(join(wasmRoot, "opencut_wasm_bg.wasm")));
	assert.equal(wasmSha256, "084cf7310df5bfdc1b8e4ce3f64bcff842e1b23b9fd0ca57c1c7dcffc0d1fc12");
	const fixture = await threeRevisionFixture(toolchain);
	const evidence: Record<string, any> = { version: 1, ok: false, artifacts: fixture.root, wasmRoot, wasmSha256,
		scope: "Real offline import/archive/restore, Three compile and Host save/reopen. No browser, frames, GPU or export.",
		browserTested: false, exportTested: false, toolchainBefore: before,
		preparedBrowserPlan: { frames: [0, 23, 7, 23, 0], frameRate: 30, shortExportDurationFrames: 30, executed: false },
		negativeControls: [] };
	try {
		const assetManifest = JSON.parse(await readFile(join(toolchain, "node_modules/@elftia/three-assets/package.json"), "utf8"));
		evidence.assetFeatureCompatibility = { version: assetManifest.version, declaredFeatureProfile: assetManifest.elftiaAssetFeatures ?? null,
			missingFiles: ["svg-model.js", "model-animation.js"].filter(file => !existsSync(join(toolchain, "node_modules/@elftia/three-assets/dist", file))),
			ordinaryModelAnimations: "Legacy ModelInstance exposes cloned animations; tested with actual GLTFLoader and AnimationMixer below",
			svgAcceptance: false, svgAnimationFeatureProfileAcceptance: false };
		const author = p1dModelAuthor(), modelAuthor = join(fixture.author, "model-source");
		await mkdir(modelAuthor);
		await writeFile(join(modelAuthor, "scene.gltf"), author.gltf, { flag: "wx" });
		await writeFile(join(modelAuthor, "mesh.bin"), author.binary, { flag: "wx" });
		await writeFile(join(fixture.author, "p1d-main.ts"), p1dScene, { flag: "wx" });
		// Exact existing fixture SVG; rejection is a compatibility test, not raster.
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="lime"/></svg>';
		await writeFile(join(fixture.author, "shape.svg"), svg, { flag: "wx" });
		evidence.assets = { origin: author.origin, svgOrigin: "script/fixtures/html-frame-browser-probe.ts: existing 64x64 lime rectangle",
			gltfSha256: threeRevisionDigest(author.gltf), binarySha256: threeRevisionDigest(author.binary), binaryBytes: author.binary.length,
			svgSha256: threeRevisionDigest(svg) };
		// The existing helper's build post already retains the real current Host URL.
		const rejectBuild = async (name: string, input: unknown, message: string) => {
			const record = await fixture.recordBytes(), snapshot = await fixture.snapshot(), ledger = await fixture.ledger();
			const response = await fixture.post("compile", input), body = await response.text();
			assert.equal(response.status, 422); assert.ok(body.includes(message), body);
			assert.deepEqual(await fixture.recordBytes(), record); assert.deepEqual(await fixture.snapshot(), snapshot); assert.deepEqual(await fixture.ledger(), ledger);
			evidence.negativeControls.push({ name, status: response.status, error: body, projectBytesUnchanged: true, snapshotUnchanged: true, attachmentLedgerUnchanged: true, documentPublished: false });
		};
		// Resource routes use the real helper request; expected rejection is caught
		// without deriving or inventing the Host URL.
		const rejectResource = async (name: string, action: string, input: unknown) => {
			const record = await fixture.recordBytes(), snapshot = await fixture.snapshot(), ledger = await fixture.ledger();
			let error = "";
			try { await fixture.request(`programmatic/resources/${action}`, input); } catch (caught) { error = String(caught); }
			assert.ok(error.includes("422"), error);
			assert.deepEqual(await fixture.recordBytes(), record); assert.deepEqual(await fixture.snapshot(), snapshot); assert.deepEqual(await fixture.ledger(), ledger);
			evidence.negativeControls.push({ name, error, projectBytesUnchanged: true, snapshotUnchanged: true, attachmentLedgerUnchanged: true });
		};
		const importInput = { id: "assets/p1d.glb", kind: "model", mimeType: "model/gltf-binary", sourceDirectory: modelAuthor, entryFile: "scene.gltf", files: ["scene.gltf", "mesh.bin"] };
		await rejectResource("missing-binary-closure", "import", { ...importInput, files: ["scene.gltf"] });
		const imported = await fixture.request("programmatic/resources/import", importInput);
		assert.ok(imported.archive);
		const glb = Buffer.from((await loadProgrammaticResource({ ...fixture.context, resource: imported.resource })).body);
		assert.equal(glb.readUInt32LE(0), 0x46546c67);
		evidence.imported = imported;
		evidence.archivedGlbSha256 = threeRevisionDigest(glb);
		const unavailable = join(fixture.root, "model-author-unavailable");
		assert.equal(relative(fixture.root, modelAuthor), join("author", "model-source"));
		assert.ok(!existsSync(unavailable)); await rename(modelAuthor, unavailable); assert.ok(!existsSync(modelAuthor));
		const restored = await fixture.request("programmatic/resources/restore-model-source", { resource: imported.archive.resource, outputDirectory: join(fixture.root, "restored-model") });
		assert.equal(restored.status, "complete");
		assert.deepEqual(await readFile(join(restored.sourceDirectory, "scene.gltf")), author.gltf);
		assert.deepEqual(await readFile(join(restored.sourceDirectory, "mesh.bin")), author.binary);
		evidence.restored = { ...restored, originalAuthorUnavailable: true, allAuthorBytesEqual: true };
		await rejectResource("restore-never-overwrites", "restore-model-source", { resource: imported.archive.resource, outputDirectory: join(fixture.root, "restored-model") });
		const loaderModule = await import(pathToFileURL(join(toolchain, "node_modules/three/examples/jsm/loaders/GLTFLoader.js")).href);
		const THREE = await import(pathToFileURL(join(toolchain, "node_modules/three/build/three.module.js")).href);
		const loaded = await new Promise<any>((resolve, reject) => new loaderModule.GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), "", resolve, reject));
		assert.equal(loaded.animations.length, 1); assert.equal(loaded.animations[0].name, "P1DTranslation");
		const mixer = new THREE.AnimationMixer(loaded.scene); mixer.clipAction(loaded.animations[0]).play();
		const samples = [0.75, 0, 0.25, 0.75].map(time => { mixer.setTime(time); const x = loaded.scene.getObjectByName("P1DAnimatedMesh").position.x; assert.equal(x, time * 0.5); return { time, x }; });
		mixer.stopAllAction(); mixer.uncacheRoot(loaded.scene);
		evidence.cpuAnimation = { actualLoader: "fixed Three GLTFLoader", actualMixer: "fixed Three AnimationMixer", samples, noWebGL: true };
		const spec = { ...fixture.spec, entryFile: "p1d-main.ts", files: ["p1d-main.ts"], durationFrames: 30, resources: [imported.resource], inputProps: {} };
		const compiled = await fixture.success("compile", spec);
		evidence.compiled = compiled;
		assert.equal(compiled.source.build?.engineVersion, "0.185.1");
		const svgImported = await fixture.request("programmatic/resources/import", { id: "assets/shape.svg", kind: "model", mimeType: "image/svg+xml", filePath: join(fixture.author, "shape.svg") });
		await rejectBuild("svg-feature-profile-unavailable", { ...spec, resources: [imported.resource, svgImported.resource] }, "SVG models require");
		const context = await fixture.request("context");
		await fixture.request("apply", { expectedRevision: context.revision, operations: [
			{ kind: "create-track", track: { id: "p1d-three-track", name: "P1-D Three", kind: "graphic", hidden: false } },
			{ kind: "create-clip", clip: { id: "p1d-three-clip", trackId: "p1d-three-track", startTime: 0, duration: 120000, trimStart: 0, trimEnd: 0,
				editing: { type: "graphic", name: "P1-D glTF animation", definitionId: "programmatic", params: {}, effects: [], programmatic: compiled.source } } },
		] });
		await fixture.moveAuthor();
		const persisted = await fixture.recordBytes(), snapshot = await fixture.snapshot(), ledger = await fixture.ledger(), resources = await fixture.resources(compiled.source);
		await fixture.reopen();
		assert.deepEqual(await fixture.recordBytes(), persisted); assert.deepEqual(await fixture.snapshot(), snapshot); assert.deepEqual(await fixture.ledger(), ledger);
		assert.deepEqual(await fixture.resources(compiled.source), resources);
		assert.deepEqual(await fixture.success("rebuild", compiled.source), { source: compiled.source, reusedDocument: true });
		evidence.persistence = { projectBytesSha256: threeRevisionDigest(persisted), snapshotExact: true, ledgerExact: true, resourcesExact: true, archivedBuildReusedAfterAuthorUnavailable: true, resources };
		evidence.toolchainAfter = await pinInkHostToolchain(toolchain);
		assert.deepEqual(evidence.toolchainAfter, before);
		evidence.ok = true;
	} catch (error) {
		evidence.error = String(error instanceof Error ? error.stack : error);
		throw error;
	} finally {
		await fixture.close();
		await writeFile(join(fixture.root, "p1-d-evidence.json"), JSON.stringify(evidence, null, 2), { flag: "wx" });
		console.log(JSON.stringify({ p1dArtifact: fixture.root, ok: evidence.ok, svgAccepted: false, error: evidence.error }));
	}
	return evidence;
}
