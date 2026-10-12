import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

// Requires a formally initialized dedicated project. Never starts/reaps a Host,
// writes its project document directly, switches UI, or silently reauthors it.
const option = (name) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const project = resolve(option("--project") ?? "");
const output = resolve(option("--output") ?? "");
const cliPath = option("--cli") ?? "C:/Users/Sayo/.elftia/plugins/rocut/vendor/run/rocut.mjs";
const helpers = option("--creator-assets") ?? "C:/Users/Sayo/.elftia/plugins/creator-studio/agent/skills/html-video/assets/rocut-stylized";
assert(process.argv.includes("--project") && process.argv.includes("--output"), "Explicit --project and --output required");
mkdirSync(output, { recursive: true });
const commands = [];
const receipt = { project, cliPath, cliSha256: sha(readFileSync(cliPath)), startedAt: new Date().toISOString(), commands, status: "running" };
function sha(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function spec(name, value) {
	const file = join(output, `${name}.json`);
	writeFileSync(file, JSON.stringify(value, null, 2), { flag: "wx" });
	return file;
}
function cli(args) {
	const result = spawnSync(process.execPath, [cliPath, ...args, "--project", project], { encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
	commands.push({ command: args.slice(0, args[0] === "motion-text" || args[0] === "programmatic" ? 2 : 1).join(" "), exitCode: result.status });
	if (result.status !== 0) throw Error(`CLI ${args[0]} failed: ${(result.stderr || result.error?.message || "unknown").replace(/https?:\/\/[^\s"']+/g, "[URL]").slice(0, 1200)}`);
	return JSON.parse(result.stdout);
}
function png(width, height, second) {
	const crc = (bytes) => { let n = 0xffffffff; for (const b of bytes) { n ^= b; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0); } return (n ^ 0xffffffff) >>> 0; };
	const chunk = (type, bytes) => { const body = Buffer.concat([Buffer.from(type), bytes]), head = Buffer.alloc(4), tail = Buffer.alloc(4); head.writeUInt32BE(bytes.length); tail.writeUInt32BE(crc(body)); return Buffer.concat([head, body, tail]); };
	const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
	const pixels = Buffer.alloc(height * (width * 4 + 1));
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const p = y * (width * 4 + 1) + 1 + x * 4, grid = x % 64 < 2 || y % 64 < 2;
		pixels[p] = second ? 100 + Math.round(x / width * 70) : 12;
		pixels[p + 1] = grid ? 120 : second ? 20 : 25 + Math.round(y / height * 35);
		pixels[p + 2] = grid ? 160 : second ? 48 : 70 + Math.round(x / width * 40); pixels[p + 3] = 255;
	}
	return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
function summarize(state) {
	return { revision: state.revision, canvas: [state.projectEntity.canvasWidth, state.projectEntity.canvasHeight], tracks: state.entities.tracks.map(t => ({ id: t.id, name: t.name, kind: t.kind })), clips: state.entities.clips.map(c => ({ id: c.id, trackId: c.trackId, type: c.editing?.type, startTime: c.startTime, duration: c.duration, effects: c.editing?.effects, transitionIn: c.transitionIn, build: c.editing?.programmatic?.build })) };
}
function verifyMixed(state, motionText) {
	const three = state.entities.clips.find(c => c.id === "installed-mixed-three");
	assert.equal(three?.editing?.programmatic?.build?.engine, "three");
	assert.equal(three.editing.effects[0].params.cellSize, 8);
	assert.deepEqual(state.entities.clips.find(c => c.id === "installed-mixed-image-1")?.transitionIn,
		{ kind: "cross-dissolve", outgoingClipId: "installed-mixed-image-0", durationFrames: 18 });
	const sequence = motionText.sequences.find(s => s.source?.format === "jizura");
	assert(sequence, "Official JIZURA source must survive fresh readback");
	assert.equal(state.entities.tracks[0].name, "JIZURA native lyrics");
	assert.equal(state.entities.clips.length, 4);
	return { threeCompiledSource: true, nativeAsciiParameterEdit: true, nativeTransition: true,
		jizuraSource: true, lyricsFirst: true, pixelRender: "not-checked", uiReopen: "not-checked", encodedExport: "not-checked" };
}
try {
	let state = cli(["read"]);
	if (process.argv.includes("--verify-only")) {
		assert(state.entities.clips.some(c => c.id === "installed-mixed-three"), "Authored mixed project missing");
		receipt.after = summarize(state); receipt.motionText = cli(["motion-text", "list"]);
		receipt.checks = verifyMixed(state, receipt.motionText); receipt.status = "readback";
	} else {
		assert.equal(state.entities.clips.length, 0, "Only an empty dedicated project may be authored");
		assert(!existsSync(join(output, "receipt.json")), "Use a new output directory; previous evidence must remain intact");
		const scene = state.projectEntity.sceneState.scenes.find(s => s.id === state.projectEntity.sceneState.currentSceneId);
		assert(scene?.mainTrackId, "Main scene track missing");
		receipt.before = summarize(state);
		const catalog = cli(["editing", "catalog"]); spec("editing-catalog", catalog);
		const caps = cli(["capabilities"]); spec("capabilities", caps);
		const ids = [];
		for (let i = 0; i < 2; i++) {
			const file = join(output, `installed-mixed-background-${i}.png`), bytes = png(640, 360, i === 1);
			writeFileSync(file, bytes, { flag: "wx" });
			if (process.argv.includes("--resume-imports")) {
				const identity = [`installed-mixed-import-${i}`, sha(bytes), `installed-mixed-background-${i}.png`, { type: "image", mimeType: "image/png", width: 640, height: 360 }];
				const matches = state.entities.assets.filter(asset => asset.id === `media-${sha(JSON.stringify(identity))}`);
				assert.equal(matches.length, 1, "Resume requires the exact deterministic imported image digest");
				ids.push(matches[0].id);
				continue;
			}
			const imported = cli(["media", "import", spec(`import-${i}`, { filePath: file, image: { mimeType: "image/png", width: 640, height: 360 }, expectedRevision: state.revision, idempotencyKey: `installed-mixed-import-${i}` })]);
			assert(imported.asset?.id); ids.push(imported.asset.id); state = cli(["read"]);
		}
		const author = join(output, "three-author"); mkdirSync(author);
		copyFileSync(join(dirname(fileURLToPath(import.meta.url)), "installed-mixed-scene.ts"), join(author, "scene.ts"));
		const build = { version: 1, engine: "three", sourceDirectory: author, entryFile: "scene.ts", files: ["scene.ts"], width: 640, height: 360, durationFrames: 180, frameRate: { numerator: 30, denominator: 1 }, seed: 19, resources: [], inputProps: { spin: 0.02, scale: 1 } };
		const compiled = cli(["programmatic", "compile", spec("three-compile", build)]); assert(compiled.source);
		const { asciiThreeEffect } = await import(pathToFileURL(join(helpers, "model-styles.mjs")));
		const effect = asciiThreeEffect(19, { amount: 0.55, cellSize: 6, color: 0.85 });
		const editing = { type: "graphic", definitionId: "programmatic", params: {}, programmatic: compiled.source, effects: [effect] };
		const mainClips = ids.map((assetId, i) => ({ kind: "create-clip", clip: { id: `installed-mixed-image-${i}`, trackId: scene.mainTrackId, assetId, startTime: i * 360000, duration: 360000, trimStart: 0, trimEnd: 0, editing: { type: "image", params: {} }, ...(i ? { transitionIn: { kind: "cross-dissolve", outgoingClipId: "installed-mixed-image-0", durationFrames: 18 } } : {}) } }));
		cli(["apply", spec("author", { expectedRevision: state.revision, idempotencyKey: "installed-mixed-author-v1", operations: [{ kind: "update-project", projectId: state.projectEntity.id, patch: { name: "Installed Mixed Native + JIZURA + Three", canvasWidth: 640, canvasHeight: 360, background: { type: "color", color: "#101020" } } }, { kind: "create-track", track: { id: "installed-mixed-three-track", sceneId: scene.id, kind: "graphic", name: "Stylized procedural Three", hidden: false } }, ...mainClips, { kind: "create-clip", clip: { id: "installed-mixed-three", trackId: "installed-mixed-three-track", startTime: 0, duration: 720000, trimStart: 0, trimEnd: 0, editing } }] })]);
		state = cli(["read"]);
		const lyrics = { version: 1, title: "Mixed offline signal", lyrics: "NATIVE SIGNAL\nMOTION IN COLOR\nSHAPES IN SYNC", style: "crimson", lang: "en", seed: 19, typeset: false, timing: { bpm: 120, offset: 0, tail: 1.5, lineScale: 1, lineTimes: { "0": 0, "1": 2, "2": 4 } }, colors: { enabled: true, accentOn: true, fg: "#ffffff", accent: "#ef4444" }, fonts: { display: "mono" } };
		receipt.lyrics = cli(["motion-text", "create", spec("jizura-create", { sourceFormat: "jizura", source: JSON.stringify(lyrics), startTime: 0, trackName: "JIZURA native lyrics", expectedRevision: state.revision, idempotencyKey: "installed-mixed-jizura-v1" })]);
		state = cli(["read"]);
		const lyricTrack = receipt.lyrics.trackId; assert(lyricTrack);
		cli(["apply", spec("edit-and-reorder", { expectedRevision: state.revision, idempotencyKey: "installed-mixed-edit-v1", operations: [{ kind: "update-clip", clipId: "installed-mixed-three", patch: { editing: { ...editing, effects: [{ ...effect, params: { ...effect.params, cellSize: 8 } }] } } }, { kind: "reorder-tracks", trackIds: [lyricTrack, ...state.entities.tracks.filter(t => t.id !== lyricTrack).map(t => t.id)] }] })]);
		state = cli(["read"]); assert.equal(state.entities.clips.find(c => c.id === "installed-mixed-three").editing.effects[0].params.cellSize, 8);
		receipt.after = summarize(state); receipt.motionText = cli(["motion-text", "list"]);
		receipt.checks = verifyMixed(state, receipt.motionText); receipt.verify = cli(["verify", "300000"]); receipt.status = "authored";
	}
} catch (error) { receipt.status = "failed"; receipt.error = String(error.message).slice(0, 1800); process.exitCode = 1; }
receipt.completedAt = new Date().toISOString();
const receiptPath = join(output, process.argv.includes("--verify-only") ? "readback-receipt.json" : "receipt.json");
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, project, receiptPath, receiptSha256: sha(readFileSync(receiptPath)), error: receipt.error, revision: receipt.after?.revision }));
