import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import * as wasm from "opencut-wasm";
import { CURRENT_PROJECT_VERSION } from "@opencut/editor-classic/transactions";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { loadProgrammaticResource, loadProgrammaticResources } from "../../apps/cli/src/programmatic/resources";
import { resolveHtmlDocumentCode } from "../../apps/cli/src/programmatic/document-resource";
import { htmlCaptureExpression } from "../../apps/cli/src/programmatic/html-document";
import { launchFrameBrowser } from "../../apps/cli/src/programmatic/chromium-process";
import { captureHtmlBrowserFrame } from "../../apps/cli/src/programmatic/particle-capture-frame";
import { pinInkHostToolchain } from "./ink-object-host-toolchain.mjs";
import { pngPixels } from "./liquid-object-capture-probe-pixels.mjs";
import { P1D_TIMES, P1D_SUPPORTED_SVG, checkP1dPose, checkP1dPixels, checkP1dSequence } from "./p1d-three-browser-oracle.mjs";
import { p1dError, preserveP1dCapture, withP1dCleanup } from "./p1d-three-browser-observation.mjs";
import { threeRevisionDigest as hash } from "../../apps/cli/src/__tests__/programmatic-three-build-revision-fixture";

const root = resolve(import.meta.dirname, "../.."), mode = process.argv[2], group = resolve(process.argv[3]);
const parse = async (path: string) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path)));
const plan = await parse(join(group, "plan.json"));
assert.equal(plan.root, root); assert.equal(plan.group, await realpath(group));
async function write(path: string, body: string | Buffer) {
	assert(!relative(group, path).startsWith(".."));
	assert.equal(await realpath(group), group);
	await mkdir(dirname(path), { recursive: true }); await writeFile(path, body, { flag: "wx" });
}
async function copy(source: string, destination: string) {
	assert.equal(await realpath(source), resolve(source));
	const pin = await pinInkHostToolchain(source);
	for (const file of pin.files) {
		const stat = await lstat(file.path); assert(stat.isFile() && !stat.isSymbolicLink());
		const bytes = await readFile(file.path); assert.equal(hash(bytes), file.sha256);
		await write(join(destination, relative(source, file.path)), bytes);
	}
	assert.deepEqual(await pinInkHostToolchain(source), pin); return pin;
}
async function open(id: string, executable = "") {
	const projectRoot = join(group, id, "project");
	const host = await startHost({ projectRoot, registry: new TargetRegistry(join(group, id, "registry")),
		engineToolchainDirectory: id === "ordinary" ? plan.ordinaryToolchain : plan.featureToolchain, htmlBrowserExecutable: executable, htmlFrameConnectionFile: "" });
	const store = new FileProjectStore({ root: projectRoot, schemaVersion: CURRENT_PROJECT_VERSION });
	const context = { store, projectId: host.automation.projectId };
	const request = async (route: string, input?: unknown) => {
		const response = await fetch(new URL(`api/${route}`, host.editorUrl), { ...(input === undefined ? {} : { method: "POST", body: JSON.stringify(input) }) });
		if (!response.ok) throw Error(`Host ${route}: ${response.status} ${await response.text()}`);
		return response.json();
	};
	const snapshot = async () => ({ project: await host.automation.project(), revision: await host.automation.revision(),
		tracks: [...await host.automation.tracks()].sort((a, b) => a.id.localeCompare(b.id)), clips: [...await host.automation.clips()].sort((a, b) => a.id.localeCompare(b.id)) });
	return { host, context, request, snapshot, record: () => readFile(join(projectRoot, "project.json")) };
}

const diagnosticScene = `import * as THREE from 'three';
import {createModelAnimation} from '@elftia/three-assets';
export async function createScene({assets,signal}) {
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1.5,1.5,1.5,-1.5,.1,20);camera.position.z=4;
 scene.add(new THREE.AmbientLight(0xffffff,3));
 const model=await assets.model('assets/p1d.glb');
 const shape=await assets.svg('assets/shape.svg',{modeling:{kind:'flat'},curveSegments:8});
 shape.value.scale.setScalar(.01);shape.value.position.set(-.8,.8,-.2);
 scene.add(model.value,shape.value);signal.throwIfAborted();
 const animation=createModelAnimation(model,{clip:'P1DTranslation',mode:'clamp'});
 return {scene,camera,renderFrame(frame){
   animation.seek(frame.time);const mesh=model.value.getObjectByName('P1DAnimatedMesh');
   let svgMeshCount=0,svgVertices=0;shape.value.traverse(object=>{if(object.isMesh){svgMeshCount++;svgVertices+=object.geometry.getAttribute('position').count;}});
   parent.postMessage({tag:'p1d-observation',observation:{time:frame.time,index:frame.index,name:mesh.name,position:mesh.position.toArray(),animationName:animation.clipName,svgMeshCount,svgVertices}},'*');
 },dispose(){animation.dispose();}};
}`;

if (mode === "--prepare") {
	const prepared: any = { version: 1, browserLaunched: false, cases: [] };
	for (const original of plan.originalCases) {
		const sourceEvidence = await parse(join(root, original.evidence));
		assert.equal(sourceEvidence.ok, true);
		const sourceDirectory = join(root, original.artifact, "project");
		const before = await copy(sourceDirectory, join(group, original.id, "project"));
		let current = await open(original.id);
		try {
			const saved = await current.record(), snapshot = await current.snapshot();
			assert.deepEqual(await current.request("programmatic/build/rebuild", sourceEvidence.compiled.source), { source: sourceEvidence.compiled.source, reusedDocument: true });
			assert(!existsSync(join(root, original.artifact, "author")), "Original author must be unavailable");
			for (const resource of sourceEvidence.compiled.source.resources) await loadProgrammaticResource({ ...current.context, resource });
			await current.host.close(); current = await open(original.id);
			assert.deepEqual(await current.record(), saved); assert.deepEqual(await current.snapshot(), snapshot);
			prepared.cases.push({ id: original.id, source: sourceEvidence.compiled.source, originalEvidence: original.evidence,
				originalProjectPin: before, authorUnavailable: true, reopenedProjectBytesSha256: hash(saved), snapshotExact: true,
				expected: original.expected, frameRateNote: "Original 30 fps source quantizes requested .75/.25 seconds to 22/30 and 7/30; expectations use the actual WASM-mapped time" });
			if (original.id !== "feature") continue;
			const restored = await current.request("programmatic/resources/restore-model-source", {
				resource: sourceEvidence.imported.model.archive.resource, outputDirectory: join(group, "feature", "restored-source") });
			assert.equal(restored.status, "complete");
			assert.equal(hash(await readFile(join(restored.sourceDirectory, "scene.gltf"))), sourceEvidence.assets.gltfSha256);
			assert.equal(hash(await readFile(join(restored.sourceDirectory, "mesh.bin"))), sourceEvidence.assets.binarySha256);
			const author = join(group, "feature", "diagnostic-author");
			await write(join(author, "scene.ts"), diagnosticScene); await write(join(author, "shape.svg"), P1D_SUPPORTED_SVG);
			const svg = await current.request("programmatic/resources/import", { id: "assets/shape.svg", kind: "model", mimeType: "image/svg+xml", filePath: join(author, "shape.svg") });
			const model = sourceEvidence.compiled.source.resources.find((resource: any) => resource.id === "assets/p1d.glb"); assert(model);
			const compiled = await current.request("programmatic/build/compile", { version: 1, engine: "three", sourceDirectory: author, entryFile: "scene.ts", files: ["scene.ts"],
				width: 64, height: 64, frameRate: { numerator: 60, denominator: 1 }, durationFrames: 60, seed: 7, inputProps: {}, resources: [model, svg.resource] });
			const context = await current.request("context");
			await current.request("apply", { expectedRevision: context.revision, operations: [
				{ kind: "create-track", track: { id: "p1d-browser-track", name: "P1-D browser authority", kind: "graphic", hidden: false } },
				{ kind: "create-clip", clip: { id: "p1d-browser-clip", trackId: "p1d-browser-track", startTime: 0, duration: 120000, trimStart: 0, trimEnd: 0,
					editing: { type: "graphic", name: "P1-D legal SVG and model pose", definitionId: "programmatic", params: {}, effects: [], programmatic: compiled.source } } },
			] });
			const unavailable = join(group, "feature", "diagnostic-author-unavailable"); assert(!existsSync(unavailable)); await rename(author, unavailable);
			const positiveSaved = await current.record(), positiveSnapshot = await current.snapshot();
			await current.host.close(); current = await open(original.id);
			assert.deepEqual(await current.record(), positiveSaved); assert.deepEqual(await current.snapshot(), positiveSnapshot);
			assert.deepEqual(await current.request("programmatic/build/rebuild", compiled.source), { source: compiled.source, reusedDocument: true });
			const resources = [];
			for (const resource of compiled.source.resources) resources.push({ ...resource, actualSha256: hash(new Uint8Array((await loadProgrammaticResource({ ...current.context, resource })).body)) });
			prepared.cases.push({ id: "legal-feature", projectId: "feature", source: compiled.source, resources, restored,
				authorUnavailable: !existsSync(author), snapshotExact: true, reopenedProjectBytesSha256: hash(positiveSaved),
				expected: "positive-pose-svg-pixels", diagnosticSourceSha256: hash(diagnosticScene), svgSha256: hash(P1D_SUPPORTED_SVG),
				frameRateNote: "60 fps produces exact .75/.25 seconds at integer frames 45/15" });
		} finally { await current.host.close(); }
		assert.deepEqual(await pinInkHostToolchain(sourceDirectory), before);
	}
	for (const item of prepared.cases) {
		item.mappedFrames = P1D_TIMES.map((time: number) => {
			const mapped = JSON.parse(wasm.resolveProgrammaticFrameJson(JSON.stringify({ source: item.source, clipStart: 0, clipDuration: 120000, trimStart: 0, timelineTime: time * 120000 })));
			assert(!mapped.error && mapped.frame);
			if (item.id === "legal-feature") { assert.equal(mapped.frame.time, time); assert.equal(mapped.frame.index, time * 60); }
			return { requestedTime: time, frame: mapped.frame, expectedModelX: mapped.frame.time * .5 };
		});
	}
	await write(join(group, "case-plan.json"), JSON.stringify(prepared, null, 2) + "\n");
	console.log(JSON.stringify({ prepared: true, browserLaunched: false, cases: prepared.cases.map((item: any) => item.id) }));
} else if (mode === "--run") {
	assert.equal(process.env.ROCUT_BROWSER_WINDOW_AUTHORIZED, "1");
	const prepared = await parse(join(group, "case-plan.json"));
	const evidence: any = { version: 2, passed: false, browserTested: true, exportTested: false, cases: [], attempts: [], cleanupErrors: [], scope: "Small real glTF/animation and bounded legal SVG rectangle only; not arbitrary SVG or codecs" };
	const captureWrite = (name: string, bytes: string | Buffer) => write(join(group, "frames", name), bytes);
	let primaryError: unknown;
	try {
		for (const item of prepared.cases) {
			evidence.activeCase = item.id; evidence.activeStage = "host-open";
			const current = await open(item.projectId ?? item.id, plan.browserExecutable);
			await withP1dCleanup(async () => {
				evidence.activeStage = "project-record";
				const saved = await current.record();
				evidence.activeStage = "source-identity";
				assert.equal(hash(saved), item.id === "ordinary" ? item.reopenedProjectBytesSha256 : prepared.cases.find((value: any) => value.id === "legal-feature").reopenedProjectBytesSha256);
				const frames: any[] = [], resources = await loadProgrammaticResources(current.context, item.source.resources, new AbortController().signal);
				const code = resolveHtmlDocumentCode(item.source, resources);
				for (const time of P1D_TIMES) {
					evidence.activeStage = "frame-map";
					const request = { source: item.source, clipStart: 0, clipDuration: 120000, trimStart: 0, timelineTime: time * 120000 };
					const mapped = JSON.parse(wasm.resolveProgrammaticFrameJson(JSON.stringify(request))); assert(!mapped.error && mapped.frame);
					const frame = mapped.frame;
					const attempt: any = { id: item.id, kind: "http", requestedTime: time, frame, source: item.source, passed: false, stage: "http-capture" };
					evidence.attempts.push(attempt);
					const response = await fetch(new URL("api/programmatic/frame", current.host.editorUrl), { method: "POST", body: JSON.stringify(request) });
					attempt.responseStatus = response.status;
					if (item.expected === "unsupported-svg-negative") {
						const error = await response.text(); attempt.responseBody = error; attempt.stage = "rejection-assertions";
						assert.equal(response.status, 422); assert.match(error, /Unsupported SVG attribute or reference/);
						attempt.passed = true; attempt.stage = "complete";
						frames.push({ requestedTime: time, frame, expectedRejection: error }); break;
					}
					if (!response.ok) { attempt.responseBody = await response.text(); throw Error(`Host frame: ${response.status} ${attempt.responseBody}`); }
					const png = Buffer.from(await response.arrayBuffer());
					const checked = await preserveP1dCapture({ png, name: `${item.id}-${frames.length}`, write: captureWrite, decode: pngPixels, attempt,
						validate: (image: any) => { assert.equal(response.status, 200); return checkP1dPixels(image, frame.time, { svg: item.id === "legal-feature", lit: item.id === "legal-feature" }); } });
					let observation;
					if (item.id === "legal-feature") {
						const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
						let browser: Awaited<ReturnType<typeof launchFrameBrowser>> | undefined;
						const directAttempt: any = { id: item.id, kind: "direct", requestedTime: time, frame, source: item.source, passed: false, stage: "browser-launch" };
						evidence.attempts.push(directAttempt);
						await withP1dCleanup(async () => {
							const activeBrowser = browser = await launchFrameBrowser(plan.browserExecutable, controller.signal); directAttempt.stage = "direct-capture";
							const target = await activeBrowser.send("Target.createTarget", { url: "about:blank" });
							const attached = await activeBrowser.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
							const send = (method: string, params: Record<string, unknown> = {}) => activeBrowser.send(method, params, String(attached.sessionId));
							await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
							await send("Network.setBlockedURLs", { urls: ["http://*", "https://*", "file://*", "ws://*", "wss://*"] });
							await send("Emulation.setDeviceMetricsOverride", { width: 64, height: 64, deviceScaleFactor: 1, mobile: false });
							await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
							await send("Runtime.evaluate", { expression: "window.__p1d=[];addEventListener('message',e=>{if(e.source===document.querySelector('iframe')?.contentWindow&&e.data?.tag==='p1d-observation')window.__p1d.push(e.data.observation)});" });
							const directPng = await captureHtmlBrowserFrame({ send, expression: htmlCaptureExpression(code, frame, resources, false), signal: controller.signal,
								failures: [], check: async () => {}, beforeEvaluate() {} });
							await preserveP1dCapture({ png: directPng, name: `${item.id}-${frames.length}-observed`, write: captureWrite, decode: pngPixels, attempt: directAttempt,
								observe: () => send("Runtime.evaluate", { expression: "window.__p1d", returnByValue: true }),
								validate: (image: any, observed: any) => {
									directAttempt.stage = "pose-assertions";
									assert(!observed.exceptionDetails); const observations = observed.result.value;
									assert.equal(observations.length, 1); observation = observations[0]; checkP1dPose(observation, frame);
									directAttempt.stage = "pixel-assertions";
									const directChecked = checkP1dPixels(image, frame.time, { svg: true, lit: true });
									directAttempt.stage = "parity-assertions";
									assert.equal(directChecked.rgbaSha256, checked.rgbaSha256, "Real HTTP Host and production capture seam pixels agree after independent gates");
									return directChecked;
								} });
						}, async () => { clearTimeout(timer); await browser?.close(); }, (error: string) => evidence.cleanupErrors.push({ id: item.id, kind: "browser", error }));
					}
					frames.push({ requestedTime: time, frame, ...checked, observation });
				}
				evidence.activeStage = "sequence-assertions";
				if (item.expected !== "unsupported-svg-negative") checkP1dSequence(frames);
				evidence.activeStage = "project-identity";
				assert.deepEqual(await current.record(), saved); evidence.cases.push({ id: item.id, passed: true, projectBytesUnchanged: true, frames });
				evidence.activeStage = "host-close";
			}, () => current.host.close(), (error: string) => evidence.cleanupErrors.push({ id: item.id, kind: "host", error }));
		}
		evidence.passed = true;
	} catch (error) {
		primaryError = error; evidence.error = p1dError(error);
		const lastAttempt = evidence.attempts.at(-1);
		if (lastAttempt && !lastAttempt.passed && !lastAttempt.error) lastAttempt.error = evidence.error;
		evidence.failedContext = { id: evidence.activeCase, stage: lastAttempt && !lastAttempt.passed ? `${lastAttempt.kind}:${lastAttempt.stage}` : evidence.activeStage };
		throw error;
	} finally {
		try { await write(join(group, "browser-evidence.json"), JSON.stringify(evidence, null, 2) + "\n"); }
		catch (error) { if (!primaryError) throw error; console.error(JSON.stringify({ evidencePersistenceError: p1dError(error), primaryError: evidence.error })); }
	}
	console.log(JSON.stringify({ passed: evidence.passed, group, cases: evidence.cases.length }));
} else throw Error("Explicit --prepare or --run required");
