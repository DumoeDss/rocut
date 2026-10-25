import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
	inspectMotionTextFont,
	mapMotionTextClipTime,
} from "opencut-wasm/sync";

type Json = Record<string, any>;
const object = (value: unknown): value is Json =>
	!!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function canonical(value: any): any {
	if (Array.isArray(value)) return value.map(canonical);
	if (object(value))
		return Object.fromEntries(
			Object.keys(value)
				.sort((a, b) => a.localeCompare(b))
				.map((key) => [key, canonical(value[key])]),
		);
	return value;
}
export const motionTextScopeHash = (value: unknown) =>
	createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex");

/** Read-only byte/coverage proof. A prior completed export still owns the FontFace-load proof. */
export async function motionTextSegmentScopes(args: {
	input: unknown;
	staticDir?: string;
	readRecord: () => Promise<unknown>;
	readClips: () => Promise<readonly unknown[]>;
	readTracks: () => Promise<readonly unknown[]>;
	readSequences: () => Promise<readonly unknown[]>;
	inspectFont?: typeof inspectMotionTextFont;
	mapTime?: typeof mapMotionTextClipTime;
}) {
	const input = args.input;
	if (
		!object(input) ||
		Object.keys(input).some(
			(key) => !["sourceDigest", "revision", "sceneId", "ranges"].includes(key),
		) ||
		typeof input.sourceDigest !== "string" ||
		!/^[a-f0-9]{64}$/.test(input.sourceDigest) ||
		!integer(input.revision) ||
		typeof input.sceneId !== "string" ||
		!Array.isArray(input.ranges) ||
		input.ranges.length < 1 ||
		input.ranges.length > 1024 ||
		!input.ranges.every(
			(range: unknown) =>
				object(range) &&
				Object.keys(range).length === 2 &&
				integer(range.startTick) &&
				integer(range.endTick) &&
				range.startTick < range.endTick,
		)
	)
		throw new Error("Invalid bounded motion-text scope request");
	const record = await args.readRecord();
	if (
		!object(record) ||
		!object(record.data) ||
		motionTextScopeHash(record) !== input.sourceDigest ||
		record.data.__opencutTransaction?.revision !== input.revision
	)
		throw new Error("Motion-text scope source changed");
	if (!args.staticDir) return { status: "unavailable" };
	const clips = await args.readClips();
	const tracks = await args.readTracks();
	const sequences = await args.readSequences();
	if (
		clips.length > 10000 ||
		sequences.length > 10000 ||
		record.data.currentSceneId !== input.sceneId
	)
		return { status: "unavailable" };
	const inScene = (clip: Json) => {
		const track = tracks.find(
			(track) => object(track) && track.id === clip.trackId,
		);
		return (
			(clip.sceneId ??
				(object(track) ? track.sceneId : undefined) ??
				record.data.currentSceneId) === input.sceneId
		);
	};
	const root = await realpath(args.staticDir);
	const byId = new Map<string, Json>();
	const byteProofs: unknown[] = [];
	const loaded = new Map<string, Uint8Array>();
	for (const clip of clips) {
		if (!object(clip) || !inScene(clip) || clip.editing?.type !== "motion-text")
			continue;
		const candidates = sequences.filter(
			(value) => object(value) && value.id === clip.content?.sequenceId,
		);
		if (candidates.length !== 1 || !object(candidates[0]))
			return { status: "unavailable" };
		const sequence = candidates[0];
		if (byId.has(sequence.id)) continue;
		if (
			!object(sequence.defaults) ||
			!object(sequence.resolvedPlan) ||
			sequence.resolvedPlan.sequenceRevision !== sequence.revision ||
			!Array.isArray(sequence.resolvedPlan.cuts) ||
			sequence.resolvedPlan.cuts.length > 10000 ||
			!Array.isArray(sequence.fonts) ||
			sequence.fonts.length > 256 ||
			!Array.isArray(sequence.cues) ||
			sequence.cues.length > 10000
		)
			return { status: "unavailable" };
		const texts = new Map<string, string[]>();
		let textSize = 0;
		for (const cut of sequence.resolvedPlan.cuts) {
			if (
				!object(cut) ||
				typeof cut.text !== "string" ||
				cut.text.length > 20000 ||
				!integer(cut.startTime) ||
				!integer(cut.duration)
			)
				return { status: "unavailable" };
			const id = cut.fontId ?? sequence.defaults.fontId;
			if (typeof id !== "string") return { status: "unavailable" };
			textSize += cut.text.length;
			if (textSize > 2000000) return { status: "unavailable" };
			texts.set(id, [...(texts.get(id) ?? []), cut.text]);
		}
		for (const [id, text] of texts) {
			const fonts = sequence.fonts.filter(
				(font: unknown) => object(font) && font.id === id,
			);
			const font = fonts[0];
			if (
				fonts.length !== 1 ||
				!object(font) ||
				font.source !== "builtin" ||
				typeof font.builtinPath !== "string" ||
				!/^motion-text\/fonts\/[A-Za-z0-9_.-]+\.(?:ttf|otf|woff2?)$/.test(
					font.builtinPath,
				) ||
				typeof font.contentDigest !== "string" ||
				!/^sha256:[a-f0-9]{64}$/.test(font.contentDigest)
			)
				return { status: "unavailable" };
			const file = await realpath(path.join(root, font.builtinPath));
			const relative = path.relative(root, file);
			if (relative.startsWith("..") || path.isAbsolute(relative))
				throw new Error("Builtin font escaped surface");
			let bytes = loaded.get(file);
			if (!bytes) {
				if ((await stat(file)).size > 32 * 1024 * 1024)
					throw new Error("Builtin font exceeds byte limit");
				bytes = await readFile(file);
				loaded.set(file, bytes);
			}
			const checked = (args.inspectFont ?? inspectMotionTextFont)({
				bytes,
				text: text.join("\n"),
				faceIndex: 0,
			});
			if (
				!checked.inspection ||
				checked.error ||
				checked.inspection.contentDigest !== font.contentDigest ||
				checked.inspection.missingCodePoints.length
			)
				return { status: "unavailable" };
			byteProofs.push({
				sequenceId: sequence.id,
				fontId: id,
				contentDigest: checked.inspection.contentDigest,
			});
		}
		byId.set(sequence.id, sequence);
	}
	const unprovedClock = Symbol("unproved-clock");
	let ranges;
	try {
		ranges = input.ranges.map((range: Json) => {
			const scopes: unknown[] = [];
			for (const clip of clips) {
				if (
					!object(clip) ||
					!inScene(clip) ||
					clip.editing?.type !== "motion-text" ||
					!integer(clip.startTime) ||
					!integer(clip.duration)
				)
					continue;
				const sequence = byId.get(clip.content?.sequenceId);
				if (
					!sequence ||
					clip.startTime >= range.endTick ||
					clip.startTime + clip.duration <= range.startTick
				)
					continue;
				if (!integer(clip.trimStart) || !integer(sequence.duration))
					throw unprovedClock;
				const map = (timelineTime: number) =>
					(args.mapTime ?? mapMotionTextClipTime)({
						clipStartTime: clip.startTime,
						clipDuration: clip.duration,
						trimStart: clip.trimStart,
						timelineTime,
						sequenceDuration: sequence.duration,
					});
				const first = map(Math.max(range.startTick, clip.startTime));
				const last = map(
					Math.min(range.endTick, clip.startTime + clip.duration) - 1,
				);
				if (
					!first.active ||
					!last.active ||
					!integer(first.sequenceTime) ||
					!integer(last.sequenceTime) ||
					first.sequenceTime > last.sequenceTime
				)
					throw unprovedClock;
				const cuts = [...sequence.resolvedPlan.cuts].sort(
					(a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id),
				);
				const selected = new Set<number>();
				cuts.forEach((cut, index) => {
					if (
						cut.startTime <= last.sequenceTime! &&
						cut.startTime + cut.duration > first.sequenceTime!
					) {
						selected.add(index);
						if (
							index > 0 &&
							cuts[index - 1].startTime + cuts[index - 1].duration ===
								cut.startTime
						)
							selected.add(index - 1);
					}
				});
				const current = [...selected]
					.sort((a, b) => a - b)
					.map((index) => cuts[index]);
				const cueIds = new Set(current.map((cut) => cut.cueId));
				const global = { ...sequence };
				delete global.revision;
      if (object(sequence.source)) {
        global.source = { ...sequence.source };
        delete global.source.text;
      }
				delete global.cues;
				global.resolvedPlan = { ...sequence.resolvedPlan };
				delete global.resolvedPlan.sequenceRevision;
				delete global.resolvedPlan.cuts;
				const knownCue = new Set([
					"id",
					"text",
					"startTime",
					"duration",
					"timingSource",
					"sourceLine",
					"interlude",
					"gapBefore",
					"impact",
					"emphasis",
					"segments",
					"locks",
					"overrides",
				]);
				const opaqueCues = sequence.cues.flatMap((cue: Json) => {
					const opaque = Object.fromEntries(
						Object.entries(cue).filter(([key]) => !knownCue.has(key)),
					);
					if (object(cue.overrides)) {
						const overrides = Object.fromEntries(
							Object.entries(cue.overrides).filter(
								([key]) =>
									!["preset", "fontId", "parameters", "colors"].includes(key),
							),
						);
						if (Object.keys(overrides).length) opaque.overrides = overrides;
					}
					return Object.keys(opaque).length ? [{ id: cue.id, opaque }] : [];
				});
				const knownCut = new Set([
					"id",
					"cueId",
					"text",
					"startTime",
					"duration",
					"seed",
					"preset",
					"fontId",
					"parameters",
				]);
				const opaqueCuts = cuts.flatMap((cut) => {
					const opaque = Object.fromEntries(
						Object.entries(cut).filter(([key]) => !knownCut.has(key)),
					);
					return Object.keys(opaque).length ? [{ id: cut.id, opaque }] : [];
				});
				scopes.push({
					clipId: clip.id,
					global,
					cuts: current,
					cues: sequence.cues.filter((cue: Json) => cueIds.has(cue.id)),
					opaqueCues,
					opaqueCuts,
				});
			}
			return { ...range, scopeDigest: motionTextScopeHash(scopes) };
		});
	} catch (error) {
		if (error === unprovedClock) return { status: "unavailable" };
		throw error;
	}
	// Re-read bytes as well as the authoritative record: no stale proof after replacement.
	for (const [file, bytes] of loaded)
		if (!Buffer.from(bytes).equals(await readFile(file)))
			throw new Error("Builtin font changed during scope proof");
	if (motionTextScopeHash(await args.readRecord()) !== input.sourceDigest)
		throw new Error("Motion-text scope source changed");
	return {
		status: "ready",
		revision: input.revision,
		sourceDigest: input.sourceDigest,
		fontReadinessDigest: motionTextScopeHash(byteProofs),
		ranges,
	};
}
