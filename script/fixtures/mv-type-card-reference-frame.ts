import type {
	TypeCardReferenceArgs,
	TypeCardReferenceFrame,
} from "./mv-type-card-reference-contract";
import { typeCardFontFamily } from "./mv-type-card-reference-fonts";

const KEYS = new Set([
	"mode",
	"lines",
	"fam",
	"weight",
	"size",
	"color",
	"paper",
	"ruleColor",
	"rule",
	"vertical",
	"sub",
	"x",
	"y",
	"lead",
	"stagger",
	"fade",
	"gap",
]);

/** Admission only; upstream still computes every beat, easing and draw parameter. */
export function snapshotTypeCardFrame(frame: TypeCardReferenceFrame) {
	const { time, shotStart, duration, includePng } = frame;
	if (
		![time, shotStart, duration, shotStart + duration].every(Number.isFinite) ||
		shotStart < 0 ||
		duration <= 0 ||
		time < shotStart ||
		time > shotStart + duration
	)
		throw Error(
			"Use finite song time within the explicit nonnegative typeCard shot",
		);
	if (includePng !== undefined && typeof includePng !== "boolean")
		throw Error("includePng must be boolean");
	if (!Array.isArray(frame.beats) || frame.beats.length > 100_000)
		throw Error("Supply an explicit bounded whole-song beat list");
	const beats = [...frame.beats];
	if (
		beats.some(
			(beat, i) =>
				!Number.isFinite(beat) || beat < 0 || (i > 0 && beat < beats[i - 1]!),
		)
	)
		throw Error("typeCard beats must be finite, nonnegative and ordered");
	const a = frame.args;
	if (
		!a ||
		Object.keys(a).some((key) => !KEYS.has(key)) ||
		!["quiet", "flicker"].includes(a.mode) ||
		!Array.isArray(a.lines) ||
		a.lines.length < 1 ||
		a.lines.length > 32 ||
		a.lines.some((line) => typeof line !== "string" || line.length > 8192)
	)
		throw Error("Use explicit supported typeCard args and bounded text lines");
	for (const key of [
		"size",
		"weight",
		"x",
		"y",
		"lead",
		"stagger",
		"fade",
		"gap",
	] as const)
		if (a[key] !== undefined && !Number.isFinite(a[key]))
			throw Error(`Invalid typeCard ${key}`);
	for (const key of ["size", "fade"] as const)
		if (a[key] !== undefined && a[key]! <= 0)
			throw Error(`typeCard ${key} must be positive`);
	if (
		a.weight !== undefined &&
		(!Number.isInteger(a.weight) || a.weight < 1 || a.weight > 1000)
	)
		throw Error("Invalid typeCard weight");
	for (const key of ["rule", "vertical"] as const)
		if (a[key] !== undefined && typeof a[key] !== "boolean")
			throw Error(`Invalid typeCard ${key}`);
	for (const key of ["color", "paper", "ruleColor"] as const)
		if (
			a[key] !== undefined &&
			(typeof a[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(a[key]!))
		)
			throw Error(`typeCard ${key} must be a six-digit hex color`);
	if (a.fam !== undefined) typeCardFontFamily(a.fam);
	if (a.sub !== undefined && (typeof a.sub !== "string" || a.sub.length > 8192))
		throw Error("Invalid typeCard subtitle");
	const args: TypeCardReferenceArgs = { ...a, lines: [...a.lines] };
	return { args, time, shotStart, duration, beats, includePng };
}
