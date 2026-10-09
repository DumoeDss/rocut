import type {
	KanjiSlamArgs,
	KanjiSlamFrame,
	KanjiSlamSong,
} from "./mv-kanji-slam-reference-contract";

export function kanjiKeys(
	value: unknown,
	required: readonly string[],
	optional: readonly string[] = [],
) {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw Error("Expected explicit kanjiSlam object");
	const record = value as Record<string, unknown>;
	if (
		required.some((k) => !Object.hasOwn(record, k)) ||
		Object.keys(record).some(
			(k) => !required.includes(k) && !optional.includes(k),
		)
	)
		throw Error("Missing or unknown kanjiSlam input field");
	return record;
}
export function kanjiText(value: unknown, max: number): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		[...value].length <= max &&
		![...value].some((c) => {
			const cp = c.codePointAt(0)!;
			return cp < 32 || cp === 127 || (cp >= 0xd800 && cp <= 0xdfff);
		})
	);
}
export const kanjiId = (value: unknown): value is string =>
	kanjiText(value, 128) &&
	/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value) &&
	!value.includes("..");
const finite = (value: unknown, min: number, max: number): value is number =>
	typeof value === "number" &&
	Number.isFinite(value) &&
	value >= min &&
	value <= max;
const pair = (value: unknown, min: number, max: number) =>
	Array.isArray(value) &&
	value.length === 2 &&
	value.every((n) => finite(n, min, max));
const color = (value: unknown) =>
	typeof value === "string" && /^#[\da-fA-F]{6}$/.test(value);

/** One immutable whole-song clock per realm: original beatCache intentionally lacks a beat-array key. */
export function snapshotKanjiSong(input: KanjiSlamSong): KanjiSlamSong {
	const v = kanjiKeys(input, ["beats", "bpm", "downbeatIndex0"]);
	if (
		!Array.isArray(v.beats) ||
		v.beats.length > 21600 ||
		v.beats.some(
			(t, i, b) => !finite(t, 0, 21600) || (i > 0 && t <= b[i - 1]),
		) ||
		!finite(v.bpm, 1, 1000) ||
		!Number.isInteger(v.downbeatIndex0) ||
		!finite(v.downbeatIndex0, 0, Math.max(0, v.beats.length - 1))
	)
		throw Error("Invalid explicit kanjiSlam whole-song clock");
	return structuredClone(input);
}

function checkArgs(input: KanjiSlamArgs) {
	const a = kanjiKeys(
		input,
		[
			"variant",
			"fire",
			"char",
			"bg",
			"glyphs",
			"fam",
			"weight",
			"charX",
			"charY",
			"charH",
			"face",
			"color",
			"sky",
			"rim",
			"rimOff",
			"rimA",
			"haloA",
			"voiceDir",
			"wind",
			"slots",
			"frames",
			"lines",
			"noFlash",
		],
		["skyGrad"],
	);
	if (
		!["default", "night", "hand"].includes(a.variant as string) ||
		typeof a.fire !== "boolean" ||
		!kanjiId(a.char) ||
		(a.bg !== null && !kanjiId(a.bg)) ||
		!Array.isArray(a.glyphs) ||
		!a.glyphs.length ||
		a.glyphs.length > 8 ||
		a.glyphs.some((s) => !kanjiText(s, 8)) ||
		[...a.glyphs.join("")].length > 32 ||
		a.fam !== "minchoHeavy" ||
		a.weight !== 900 ||
		!finite(a.charX, -8192, 8192) ||
		!finite(a.charY, -8192, 8192) ||
		!finite(a.charH, 1, 8192) ||
		!pair(a.face, 0, 1) ||
		!color(a.color) ||
		!color(a.rim) ||
		!["sunset", "night", "day"].includes(a.sky as string) ||
		!pair(a.rimOff, -128, 128) ||
		!finite(a.rimA, 0, 1) ||
		!finite(a.haloA, 0, 1) ||
		(a.voiceDir !== null && !finite(a.voiceDir, -32, 32)) ||
		!["ink", "light"].includes(a.lines as string) ||
		typeof a.noFlash !== "boolean"
	)
		throw Error("Invalid complete kanjiSlam artwork/font/geometry args");
	const w = kanjiKeys(a.wind, [
		"axis",
		"from",
		"dir",
		"amp",
		"freq",
		"speed",
		"q",
	]);
	if (
		!["col", "row"].includes(w.axis as string) ||
		!finite(w.from, 0.001, 0.999) ||
		(w.dir !== -1 && w.dir !== 1) ||
		!finite(w.amp, 0, 128) ||
		!finite(w.freq, 0, 32) ||
		!finite(w.speed, -64, 64) ||
		!finite(w.q, 1, 120)
	)
		throw Error("Invalid explicit kanjiSlam wind");
	if (
		!Array.isArray(a.slots) ||
		!a.slots.length ||
		a.slots.length > 16 ||
		!Array.isArray(a.frames) ||
		!a.frames.length ||
		a.frames.length > 16
	)
		throw Error("kanjiSlam needs nonempty explicit slots and reframes");
	for (const slot of a.slots) {
		const s = kanjiKeys(slot, ["x", "y", "s", "r"]);
		if (
			!finite(s.x, -8192, 8192) ||
			!finite(s.y, -8192, 8192) ||
			!finite(s.s, 0.01, 8) ||
			!finite(s.r, -32, 32)
		)
			throw Error("Invalid kanjiSlam slot");
	}
	for (const frame of a.frames) {
		const f = kanjiKeys(frame, ["z", "dx", "dy"]);
		if (
			!finite(f.z, 0.01, 8) ||
			!finite(f.dx, -8192, 8192) ||
			!finite(f.dy, -8192, 8192)
		)
			throw Error("Invalid kanjiSlam reframe");
	}
	if (a.sky === "day" && a.bg === null && !Object.hasOwn(a, "skyGrad"))
		throw Error("Day without a plate needs explicit skyGrad");
	if (Object.hasOwn(a, "skyGrad")) {
		if (
			a.sky !== "day" ||
			a.bg !== null ||
			!Array.isArray(a.skyGrad) ||
			a.skyGrad.length < 2 ||
			a.skyGrad.length > 16 ||
			a.skyGrad.some(
				(stop, i, stops) =>
					!Array.isArray(stop) ||
					stop.length !== 2 ||
					!finite(stop[0], 0, 1) ||
					!color(stop[1]) ||
					(i > 0 && stop[0] <= stops[i - 1][0]),
			)
		)
			throw Error("Invalid or unused explicit kanjiSlam sky gradient");
	}
}

export function snapshotKanjiFrame(input: KanjiSlamFrame): KanjiSlamFrame {
	kanjiKeys(input, ["shotId", "time", "shotStart", "duration", "args"]);
	if (
		!kanjiId(input.shotId) ||
		!finite(input.shotStart, 0, 21600) ||
		!finite(input.duration, 0.001, 3600) ||
		!finite(input.shotStart + input.duration, 0, 21600) ||
		!finite(input.time, input.shotStart, input.shotStart + input.duration)
	)
		throw Error("Invalid explicit kanjiSlam shot identity/time");
	checkArgs(input.args);
	return structuredClone(input);
}

export function kanjiRequiredImages(frame: KanjiSlamFrame) {
	return [
		...new Set([
			frame.args.char,
			...(frame.args.bg === null ? [] : [frame.args.bg]),
		]),
	];
}
