import { TITLE_RIFF_CUES, TITLE_RIFF_HUD, type TitleRiffReferenceFrame, type TitleRiffSong } from "./mv-title-riff-reference-contract";

export function exactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Expected explicit titleRiff object");
	const object = value as Record<string, unknown>;
	if (required.some((key) => !Object.hasOwn(object, key)) || Object.keys(object).some((key) => !required.includes(key) && !optional.includes(key)))
		throw Error("Missing or unknown titleRiff input field");
	return object;
}
export function boundedString(value: unknown, max: number, empty = true): value is string {
	return typeof value === "string" && (empty || value.length > 0) && [...value].length <= max &&
		![...value].some((c) => { const cp = c.codePointAt(0)!; return cp < 32 || (cp >= 0xd800 && cp <= 0xdfff); });
}
const finite = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

export function snapshotTitleRiffSong(input: TitleRiffSong): TitleRiffSong {
	const value = exactKeys(input, ["beats", "bpm", "downbeatIndex0", "credit"]);
	if (!Array.isArray(value.beats) || value.beats.length > 21600 || value.beats.some((t, i, b) => !finite(t, 0, 21600) || (i > 0 && t <= b[i - 1])) ||
		!finite(value.bpm, Number.MIN_VALUE, 1000) || !Number.isInteger(value.downbeatIndex0) || !finite(value.downbeatIndex0, 0, Math.max(0, value.beats.length - 1)) || !boundedString(value.credit, 128))
		throw Error("titleRiff requires explicit bounded beats, bpm, downbeat index and credit");
	return structuredClone(input);
}

export function snapshotTitleRiffFrame(input: TitleRiffReferenceFrame): TitleRiffReferenceFrame {
	exactKeys(input, ["time", "shotStart", "duration", "args"]);
	if (!finite(input.shotStart, 0, 21600) || !finite(input.duration, Number.MIN_VALUE, 3600) ||
		!finite(input.shotStart + input.duration, 0, 21600) || !finite(input.time, input.shotStart, input.shotStart + input.duration))
		throw Error("titleRiff requires explicit song time within its authored shot");
	const a = exactKeys(input.args, ["variant", "char", "sky", "glyphs", "ruby", "sub", "hud", "cues", "exit", "grain"], ["recap", "final"]);
	if (!["intro", "outro"].includes(a.variant as string) || !boundedString(a.char, 256, false) || !boundedString(a.sky, 256, false) ||
		!Array.isArray(a.glyphs) || a.glyphs.length !== 2 || a.glyphs.some((s) => !boundedString(s, 32, false)) ||
		(a.ruby !== false && (!Array.isArray(a.ruby) || a.ruby.length !== 2 || a.ruby.some((s) => !boundedString(s, 32)))) ||
		!boundedString(a.sub, 128) || typeof a.exit !== "boolean" || !finite(a.grain, 0, 1))
		throw Error("titleRiff requires complete explicit title, silhouette and rendering args");
	const hud = exactKeys(a.hud, TITLE_RIFF_HUD), cues = exactKeys(a.cues, TITLE_RIFF_CUES);
	if (Object.values(hud).some((s) => !boundedString(s, 256)) || TITLE_RIFF_CUES.some((key) => !Number.isInteger(cues[key]) || !finite(cues[key], key === "neg" || key === "sil" ? -1 : 0, 19)))
		throw Error("Invalid complete titleRiff HUD/cue map");
	if ((cues.lock as number) >= (cues.exit as number) || (cues.sil as number) >= (cues.lock as number)) throw Error("titleRiff lock must follow silhouette and precede exit");
	if (a.variant === "intro" && (Object.hasOwn(a, "recap") || Object.hasOwn(a, "final"))) throw Error("Intro cannot silently ignore recap/final resources");
	if (a.variant === "outro") {
		if (!boundedString(a.final, 256, false) || !Array.isArray(a.recap) || !a.recap.length || a.recap.length > 32) throw Error("Outro requires explicit nonempty recap and final image");
		for (const item of a.recap) {
			const r = exactKeys(item, ["bg", "view", "h", "cx", "cy"], ["char"]), v = exactKeys(r.view, ["zoom", "x", "y", "rot"]);
			if (!boundedString(r.bg, 256, false) || (Object.hasOwn(r, "char") && !boundedString(r.char, 256, false)) ||
				!finite(r.h, Number.MIN_VALUE, 8) || !finite(r.cx, -8, 8) || !finite(r.cy, -8, 8) ||
				!finite(v.zoom, Number.MIN_VALUE, 8) || !finite(v.x, -4, 4) || !finite(v.y, -4, 4) || !finite(v.rot, -32, 32)) throw Error("Invalid explicit recap geometry/resource");
		}
	}
	return structuredClone(input);
}

export function titleRiffRequiredImages(frame: TitleRiffReferenceFrame) {
	const a = frame.args;
	return [...new Set([a.char, a.sky, ...(a.variant === "outro" ? [a.final!, ...a.recap!.flatMap((r) => [r.bg, ...(r.char ? [r.char] : [])])] : [])])];
}
