import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { blazeEditorRequest, blazeEditorSnapshot, blazeEditorPoll } from "./blaze-editor-control.mjs";
import { blazePipelinePng } from "../probe-blaze-pipeline-png.mjs";
import { bubbleExportSource } from "./bubble-export-reference.mjs";
import { blazeEditorDeadline, blazeEditorRedact } from "./blaze-editor-lifecycle.mjs";

export const runtime = "C:/tmps/rocut-control-integrated-AYnOOY/runtime";
export const surface = "C:/tmps/rocut-control-integrated-AYnOOY/surface";
export const coreHash = "fb44959548ea4ef46fbea15a2280c7d200bede27bf0bc6e08d6cbbec2337df4c";
const creatorPath = "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized/bubble.mjs";
export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export const save = (root, name, value) => writeFile(join(root, name), typeof value === "string" || Buffer.isBuffer(value)
	? value : JSON.stringify(value, null, 2), { flag: "wx" });

export async function startCurrentBubbleHost(root) {
	const receipt = JSON.parse(await readFile(join(surface, "surface-wasm-package.json"), "utf8"));
	assert.equal(hash(await readFile(join(surface, receipt.coreWasm.path))), coreHash);
	assert.equal(hash(await readFile(join(runtime, "opencut_wasm_bg.wasm"))), coreHash);
	const child = spawn(process.execPath, [join(runtime, "rocut.mjs"), "host", "start", join(root, "project"),
		"--static", surface, "--port", "0", "--targets-root", join(root, "registry")], { windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ROCUT_TARGETS_ROOT: join(root, "registry") } });
	let output = "", errors = "";
	const closed = new Promise(resolve => child.once("exit", resolve));
	const ready = new Promise((resolve, reject) => {
		child.once("error", reject); child.once("exit", code => reject(Error(`Owned Host exited: ${code}`)));
		child.stdout.on("data", bytes => { output += bytes.toString(); const match = output.match(/editorUrl (\S+)/); if (match) resolve(match[1]); });
		child.stderr.on("data", bytes => { errors += bytes.toString(); });
	});
	const editorUrl = await blazeEditorDeadline(ready, 30000, "current standalone Host");
	return { editorUrl, request: blazeEditorRequest(editorUrl), async close() {
		child.kill(); await blazeEditorDeadline(closed, 15000, "owned Host close");
		await save(root, `host-${Date.now()}.log`, blazeEditorRedact(output + errors));
	} };
}

export async function prepareCurrentBubble(root) {
	const host = await startCurrentBubbleHost(root);
	try {
		const { request } = host;
		const author = join(root, "author"); await mkdir(author);
		const png = blazePipelinePng(bubbleExportSource(), 192, 128);
		const filePath = join(author, "bubble.png"); await writeFile(filePath, png, { flag: "wx" });
		const { resource } = await request("programmatic/resources/import", { id: "bubble.png", kind: "image", mimeType: "image/png", filePath });
		const creator = await import(pathToFileURL(creatorPath).href);
		const { nativeEffectLayer } = await import(pathToFileURL(join(creatorPath, "../native-effect-layer.mjs")).href);
		const shot = creator.bubbleImage({ image: resource, settings: { width: 192, height: 128,
			frameRate: { numerator: 30, denominator: 1 }, durationFrames: 240, seed: 97 },
			knots: [{ time: 0, x: .3, y: .5 }, { time: 120000, x: .7, y: .5 }],
			keyframes: { refraction: [{ time: 0, value: .05 }, { time: 120000, value: .15 }] } });
		const unnamedEditing = nativeEffectLayer({ effect: shot.effects[0], animations: shot.animations });
		const animations = unnamedEditing.animations;
		assert(animations["params.refraction"]?.keys?.length === 2);
		const clip = (id, startTime, named) => ({ id, trackId: "bubble-independent-effects", startTime,
			duration: 480000, trimStart: 0, trimEnd: 0, editing: named
				? nativeEffectLayer({ effect: shot.effects[0], animations: shot.animations, name: "Named standalone Bubble" })
				: unnamedEditing });
		const clips = [ { id: "bubble-underlay", trackId: "bubble-underlay-track", startTime: 0, duration: 960000,
			trimStart: 0, trimEnd: 0, editing: { type: "graphic", name: "Bubble underlay", definitionId: "programmatic", params: {}, programmatic: shot.source } },
			clip("bubble-independent-named", 0, true), clip("bubble-independent-unnamed", 480000, false) ];
		const context = await request("context");
		const result = await request("apply", { expectedRevision: context.revision, operations: [
			{ kind: "update-project", projectId: context.project.id, patch: { name: "Current standalone Bubble acceptance", canvasWidth: 192, canvasHeight: 128,
				frameRate: { numerator: 30, denominator: 1 }, background: { type: "color", color: "#000000" } } },
			{ kind: "create-track", track: { id: "bubble-underlay-track", name: "Underlay", hidden: false, kind: "graphic" } },
			{ kind: "create-track", track: { id: "bubble-independent-effects", name: "Standalone effects", hidden: false, kind: "effect" } },
			...clips.map(clip => ({ kind: "create-clip", clip })),
		] });
		assert.equal(result.accepted, true);
		const snapshot = await blazeEditorSnapshot(request);
		assert.equal(Object.hasOwn(snapshot.clips.find(clip => clip.id === "bubble-independent-unnamed").editing, "name"), false);
		await save(root, "prepared.json", { runtime, surface, coreHash, snapshot, resource, unnamedEditing,
			creatorSha256: hash(await readFile(creatorPath)), layerHelperSha256: hash(await readFile(join(creatorPath, "../native-effect-layer.mjs"))),
			scope: "Actual nativeEffectLayer output to packed authenticated plain Node Host/apply; omitted name seed; no browser/GPU yet" });
		return snapshot;
	} finally { await host.close(); }
}

if (process.argv.includes("--prepare")) {
	const root = await mkdtemp("C:/tmps/rocut-bubble-standalone-");
	try { await prepareCurrentBubble(root); console.log(JSON.stringify({ root, prepared: true })); }
	catch (error) { await save(root, "prepare-failure.json", { error: blazeEditorRedact(String(error)) }); throw error; }
}
