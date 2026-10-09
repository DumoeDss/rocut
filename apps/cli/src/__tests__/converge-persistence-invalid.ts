import type { ProgrammaticSource } from "@opencut/editor-contracts";

type Path = readonly (string | number)[];
interface InvalidCase {
	name: string;
	source: unknown;
	overflow?: "1e400" | "-1e400";
}
const scenePath: Path = ["recipe", "nodes", 0, "scene"];
const settingsPath: Path = [...scenePath, "settings"];
function objectAt(
	source: unknown,
	path: Path,
): Record<string | number, unknown> {
	let value = source;
	for (const part of path) {
		if (!value || typeof value !== "object")
			throw Error("Invalid fixture path");
		value = (value as Record<string | number, unknown>)[part];
	}
	if (!value || typeof value !== "object")
		throw Error("Fixture object is missing");
	return value as Record<string | number, unknown>;
}

/** Malformed author inputs only; no reference scene formulas or expected draw plans. */
export function invalidConvergeCases(
	initial: ProgrammaticSource,
): InvalidCase[] {
	const out: InvalidCase[] = [];
	const change = (
		name: string,
		path: Path,
		value: unknown,
		remove = false,
		overflow?: InvalidCase["overflow"],
	) => {
		const source: unknown = structuredClone(initial);
		const target = objectAt(source, path.slice(0, -1));
		const key = path[path.length - 1];
		if (remove) delete target[key];
		else target[key] = value;
		out.push({ name, source, overflow });
	};
	const field = (name: string) => [...settingsPath, name];
	const settings = objectAt(initial, settingsPath);
	for (const key of Object.keys(settings))
		change(`missing settings.${key}`, field(key), undefined, true);
	for (const [key, values] of Object.entries({
		seed: [-1, 0.5, 4294967296],
		grain: [-0.01, 1.01, null, "0.07"],
		whiteAtTicks: [
			-1,
			1.5,
			9007199254740992,
			initial.recipe!.songStartSeconds * 120000,
		],
	}))
		for (const value of values)
			change(`invalid ${key}: ${String(value)}`, field(key), value);
	for (const overflow of ["1e400", "-1e400"] as const)
		change(
			`nonfinite grain ${overflow}`,
			field("grain"),
			"CONVERGE_NONFINITE_WIRE",
			false,
			overflow,
		);
	for (const path of [
		[],
		["recipe"],
		scenePath,
		settingsPath,
		[...settingsPath, "palette"],
	] as Path[])
		change(
			`unknown author field ${path.join(".") || "source"}`,
			[...path, "evaluatedCommands"],
			[],
		);
	change("invalid output role", [...scenePath, "role"], "audio");
	change("zero duration", [...scenePath, "span", "durationFrames"], 0);
	change("unknown settings type", [...scenePath, "kind"], "convergeFake");
	for (const beats of [
		{ kind: "manual", songTicks: [-1] },
		{ kind: "manual", songTicks: [0.5] },
		{ kind: "manual", songTicks: [10, 10] },
		{ kind: "manual", songTicks: [20, 10] },
		{ kind: "manual", songTicks: [9007199254740992] },
		{ kind: "manual", songTicks: Array.from({ length: 4097 }, (_, i) => i) },
		{ kind: "manual" },
		{ kind: "manual", songTicks: [], pulse: 1 },
		{ kind: "analysis" },
		{ kind: "analysis", songTicks: [] },
		{ kind: "guessedBpm", bpm: 130 },
	])
		change(`invalid beats ${out.length}`, field("beats"), beats);
	const colors = (path: Path) => {
		for (const [key, value] of Object.entries(objectAt(initial, path))) {
			const item = [...path, key];
			change(`missing ${item.join(".")}`, item, undefined, true);
			if (Array.isArray(value)) {
				const channel = Array.isArray(value[0])
					? [...item, 0, 0]
					: [...item, 0];
				change(`out-of-range ${item.join(".")}`, channel, 1.01);
			} else colors(item);
		}
	};
	colors([...settingsPath, "palette"]);
	return out;
}
