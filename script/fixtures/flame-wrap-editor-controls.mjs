import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve, win32 } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { blazeEditorHistory } from "./blaze-editor-control.mjs";

export const digest = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
export const history = blazeEditorHistory;
export async function poll(check, timeout = 30000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const value = await check();
		if (value) return value;
		await new Promise((done) => setTimeout(done, 100));
	}
	throw Error("Flame Wrap editor observation deadline exceeded");
}
export function validateArtifacts(artifacts) {
	assert(artifacts && typeof artifacts === "object");
	for (const key of ["root", "clipId", "effectId", "projectPath"])
		assert(typeof artifacts[key] === "string" && artifacts[key]);
	for (const key of ["width", "height"])
		assert(Number.isSafeInteger(artifacts[key]) && artifacts[key] > 0);
	const underTemporary = win32.relative("C:/tmps", resolve(artifacts.root));
	assert(
		underTemporary &&
			!underTemporary.startsWith("..") &&
			!win32.isAbsolute(underTemporary),
	);
	const projectRelative = win32.relative(
		resolve(artifacts.root),
		resolve(artifacts.projectPath),
	);
	assert(
		projectRelative &&
			!projectRelative.startsWith("..") &&
			!win32.isAbsolute(projectRelative),
	);
}
export function writeArtifact(artifacts, name, value) {
	assert(/^[a-z0-9-]+\.(json|rgba)$/.test(name));
	return writeFile(
		join(artifacts.root, name),
		Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + "\n",
		{ flag: "wx" },
	);
}
export async function snapshot(request) {
	const context = await request("context");
	assert(context.project && Number.isSafeInteger(context.revision));
	const clips = await request("clips"),
		tracks = await request("tracks");
	assert(Array.isArray(clips) && Array.isArray(tracks));
	const byId = (a, b) => a.id.localeCompare(b.id);
	return {
		project: context.project,
		revision: context.revision,
		clips: [...clips].sort(byId),
		tracks: [...tracks].sort(byId),
	};
}
export function effectFor(graph, artifacts) {
	const matches = graph.clips.filter((clip) => clip.id === artifacts.clipId);
	assert.equal(matches.length, 1, "Missing or ambiguous UI target clip");
	const clip = matches[0];
	assert(clip.editing && Array.isArray(clip.editing.effects));
	const effects = clip.editing.effects.filter(
		(effect) => effect.id === artifacts.effectId,
	);
	assert.equal(effects.length, 1, "Missing or ambiguous Flame Wrap effect");
	assert.equal(effects[0].type, "flame-wrap");
	assert.equal(effects[0].enabled, true);
	assert(effects[0].params && typeof effects[0].params === "object");
	return { clip, effect: effects[0] };
}
export function finiteField(params, key) {
	assert(Object.hasOwn(params, key), `Missing ${key} author parameter`);
	assert.equal(typeof params[key], "number", `Non-numeric ${key}`);
	assert(Number.isFinite(params[key]), `Non-finite ${key}`);
	return params[key];
}
export function finiteInput(text, label) {
	assert(
		typeof text === "string" && text.trim() !== "",
		`Missing ${label} input value`,
	);
	const value = Number(text);
	assert(Number.isFinite(value), `Non-finite ${label} input value`);
	return value;
}
export function unchangedNeighbors(before, after, clipId) {
	assert.deepEqual(after.project, before.project);
	assert.deepEqual(after.tracks, before.tracks);
	assert.deepEqual(
		after.clips.filter((clip) => clip.id !== clipId),
		before.clips.filter((clip) => clip.id !== clipId),
	);
}
export async function seek(page, ticks, frameRate) {
	assert.equal(frameRate.denominator, 1);
	const fps = frameRate.numerator,
		ticksPerFrame = 120000 / fps;
	assert(
		Number.isSafeInteger(fps) && fps > 0 && Number.isSafeInteger(ticksPerFrame),
	);
	assert(
		Number.isSafeInteger(ticks) && ticks >= 0 && ticks % ticksPerFrame === 0,
	);
	const frames = ticks / ticksPerFrame;
	const timecode = [
		Math.floor(frames / (fps * 3600)),
		Math.floor(frames / (fps * 60)) % 60,
		Math.floor(frames / fps) % 60,
		frames % fps,
	]
		.map((value) => String(value).padStart(2, "0"))
		.join(":");
	await page.evaluate(() => {
		globalThis.__flameWrapPresentationMinSerial =
			globalThis.__flameWrapPresentationObserver?.status().serial ?? 0;
	});
	await page
		.getByRole("button", { name: "Edit playhead time", exact: true })
		.click();
	const input = page.getByRole("textbox", {
		name: "Playhead time",
		exact: true,
	});
	await input.fill(timecode);
	await input.press("Enter");
	await poll(
		async () =>
			(
				await page
					.getByRole("button", { name: "Edit playhead time", exact: true })
					.innerText()
			).trim() === timecode,
	);
	return { ticks, timecode, mechanism: "actual playhead textbox fill + Enter" };
}
export { capture } from "./flame-wrap-editor-capture.mjs";
export async function settledRecord(artifacts, request) {
	let previous = null,
		stableSince = Date.now();
	return poll(async () => {
		const bytes = await readFile(artifacts.projectPath),
			document = JSON.parse(bytes);
		assert(
			document.record && document.summary,
			"Missing persisted record or summary",
		);
		const hash = digest(bytes);
		if (hash !== previous) {
			previous = hash;
			stableSince = Date.now();
		}
		if (Date.now() - stableSince < 1200) return null;
		const observed = await request("record"),
			reread = await readFile(artifacts.projectPath);
		if (
			!reread.equals(bytes) ||
			!isDeepStrictEqual(observed, {
				record: document.record,
				summary: document.summary,
			})
		) {
			stableSince = Date.now();
			return null;
		}
		return bytes;
	});
}
