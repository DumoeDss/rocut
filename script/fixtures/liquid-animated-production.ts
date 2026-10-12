import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as wasm from "opencut-wasm";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { importProgrammaticResource } from "../../apps/cli/src/programmatic/resource-import";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { loadProgrammaticResource } from "../../apps/cli/src/programmatic/resources";
import { captureThreeLiquidObjectPng } from "../../apps/cli/src/programmatic/liquid-object-capture";
import { particlePoseGlb } from "./particle-input-resources";
import { pngPixels, pixelComparison, visibility } from "./liquid-object-capture-probe-pixels.mjs";

export async function runLiquidAnimatedProduction({ root, creator, toolchain, executable, observe }: {
	root: string; creator: string; toolchain: string; executable: string; observe: () => unknown;
}) {
	const report: Record<string, any> = { ok: false, root, stage: "prepare", captures: [],
		scope: "3 small production captureThreeLiquidObjectPng frames: real GLB/named animator/current node-skin-morph pose/native Rust Liquid phase/WebGL renderer; no editor UI/export/long clip/release certification" };
	const persist = () => writeFile(join(root, "capture-evidence.json"), JSON.stringify(report, null, 2));
	const author = join(root, "author"), projectRoot = join(root, "project");
	await mkdir(author);
	const host = await startHost({ projectRoot, registry: new TargetRegistry(join(root, "registry")), htmlBrowserExecutable: "", htmlFrameConnectionFile: "" });
	try {
		const request = async (method: string, route: string, input?: unknown) => {
			const response = await fetch(new URL(`api/${route}`, host.editorUrl), { method, signal: AbortSignal.timeout(15_000),
				...(input === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(input) }) });
			const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
		};
		const hostContext = await request("GET", "context"), context = {
			projectId: hostContext.project.id, store: new FileProjectStore({ root: projectRoot, schemaVersion: 1 }),
		};
		const filePath = join(root, "pose.glb"); await writeFile(filePath, particlePoseGlb(), { flag: "wx" });
		const model = (await importProgrammaticResource({ ...context, input: { id: "assets/pose.glb", kind: "model", mimeType: "model/gltf-binary", filePath } })).resource;
		const { liquidAnimatedObjectThree } = await import(pathToFileURL(join(creator, "liquid-animated-object.mjs")).href);
		const { rocutObjectParamsResolver } = await import(pathToFileURL(join(creator, "object-params-resolver.mjs")).href);
		const shot = await liquidAnimatedObjectThree({ sourceDirectory: author, model,
			settings: { width: 192, height: 128, durationFrames: 31, frameRate: { numerator: 30, denominator: 1 }, seed: 19 },
			inputProps: { animation: { clip: "pose", mode: "clamp", speed: 1, offset: 0 } },
			// Nonzero deformation remains real, but time-dependent Liquid motion is
			// disabled so differences between frames are attributable to GLB pose.
			liquid: { amount: 0.35, speed: 0 }, resolveParams: rocutObjectParamsResolver({ object: "liquid", request }) });
		for (const file of shot.spec.files) await copyFile(join(creator, file), join(author, file));
		report.stage = "compile"; await persist();
		const { source } = await compileProgrammaticProject({ action: "compile", input: shot.spec, toolchainDirectory: toolchain,
			context, signal: AbortSignal.timeout(30_000), enqueue: async task => task() });
		const lock = await loadProgrammaticResource({ ...context, resource: source.build!.toolchainLock, signal: AbortSignal.timeout(15_000) });
		report.archive = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(lock.body));
		assert.equal(report.archive.threeLiquidObject.workerIdentity.files.find((item: { role: string }) => item.role === "wasm").sha256,
			"fb44959548ea4ef46fbea15a2280c7d200bede27bf0bc6e08d6cbbec2337df4c");
		const document = await loadProgrammaticResource({ ...context, resource: source.resources!.find(item => item.id === source.documentId)!, signal: AbortSignal.timeout(15_000) });
		const code = new TextDecoder("utf-8", { fatal: true }).decode(document.body);
		report.source = source; report.compiledBytes = document.body.byteLength;
		const resources = [];
		for (const resource of source.resources ?? []) if (resource.id !== source.documentId)
			resources.push(await loadProgrammaticResource({ ...context, resource, signal: AbortSignal.timeout(15_000) }));
		const images = [];
		for (const [name, index] of [["early", 6], ["late", 24], ["early-repeat", 6]] as const) {
			report.stage = `capture-${name}`; await persist();
			const mapped = JSON.parse(wasm.resolveProgrammaticFrameJson(JSON.stringify({ source, clipStart: 0,
				clipDuration: 31 * 4000, trimStart: 0, timelineTime: index * 4000 })));
			assert(!mapped.error && mapped.frame); assert.equal(mapped.frame.index, index);
			const png = await captureThreeLiquidObjectPng({ executable, source, mappedFrame: mapped.frame, code, resources,
				resourceStore: context, signal: AbortSignal.timeout(45_000) });
			const path = join(root, `${name}.png`); await writeFile(path, png, { flag: "wx" });
			const image = pngPixels(png); assert.equal(image.width, 192); assert.equal(image.height, 128);
			assert(visibility(image).changedPixels > 100, "Animated deformed model must be visible");
			images.push(image);
			report.captures.push({ name, index, frame: mapped.frame, path, sha256: createHash("sha256").update(png).digest("hex"),
				bytes: png.length, visibility: visibility(image), returnedAfterProductionPageBrokerBrowserCleanup: true, processes: observe() });
			await persist();
		}
		report.poseChange = pixelComparison({ a: images[0]!, b: images[1]! });
		assert(report.poseChange.changedPixels > 100, "Different GLB poses must visibly change the real rendered image");
		report.repeatedSeek = pixelComparison({ a: images[0]!, b: images[2]! });
		assert.equal(report.repeatedSeek.changedPixels, 0); assert.deepEqual(images[0]!.pixels, images[2]!.pixels);
		report.ok = true; report.stage = "three-production-captures-complete";
	} catch (error) {
		report.failure = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
		throw error;
	} finally { await host.close(); report.hostClosed = true; await persist(); }
	return report;
}
