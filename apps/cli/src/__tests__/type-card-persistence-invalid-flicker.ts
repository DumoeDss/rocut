import type { MvTypeCardFlicker } from "../../../../packages/editor-contracts/src/mv-type-card";

/** Author/schema rejection cases, never a replacement validator. */
export function invalidTypeCardFlickerCases(
	flicker: MvTypeCardFlicker,
	f: (patch: Record<string, unknown>) => unknown,
): [string, unknown][] {
	const layout = (patch: Record<string, unknown>) =>
		f({
			layouts: [
				{ ...flicker.layouts[0], ...patch },
				...flicker.layouts.slice(1),
			],
		});
	return [
		["flicker too few layouts", f({ layouts: flicker.layouts.slice(0, 3) })],
		["flicker no parts", layout({ parts: [] })],
		["flicker unknown hold", layout({ hold: { kind: "auto" } })],
		["flicker zero pulse", layout({ hold: { kind: "pulse", seconds: 0 } })],
		["flicker missing explicit frame", layout({ frame: undefined })],
		["flicker excessive glitch", layout({ glitch: 1.01 })],
		[
			"beats unsorted",
			f({ beats: { kind: "manual", songTicks: [2000, 1000] } }),
		],
		[
			"beats duplicate",
			f({ beats: { kind: "manual", songTicks: [1000, 1000] } }),
		],
		["beats negative", f({ beats: { kind: "manual", songTicks: [-1] } })],
		["beats fractional", f({ beats: { kind: "manual", songTicks: [1000.5] } })],
		[
			"beats unsafe integer",
			f({ beats: { kind: "manual", songTicks: [9007199254740992] } }),
		],
		[
			"beats over budget",
			f({
				beats: {
					kind: "manual",
					songTicks: Array.from({ length: 4097 }, (_, i) => i * 1000),
				},
			}),
		],
		["unknown beat mode", f({ beats: { kind: "inferred", bpm: 120 } })],
		[
			"analysis beats without reviewed binding",
			f({ beats: { kind: "analysis" } }),
		],
		["unknown manual beat field", f({ beats: { ...flicker.beats, bpm: 120 } })],
		[
			"unsupported Morse element",
			f({ morse: { ...flicker.morse, elements: [2] } }),
		],
		["empty Morse elements", f({ morse: { ...flicker.morse, elements: [] } })],
		[
			"reversed flood radii",
			f({ flood: { ...flicker.flood, radiusFrom: 2, radiusTo: 1 } }),
		],
		[
			"opaque flood outer stop",
			f({
				flood: {
					...flicker.flood,
					colors: [...flicker.flood.colors.slice(0, 3), [0.2, 0.1, 0.1, 0.1]],
				},
			}),
		],
		[
			"negative label controls",
			f({ negative: { ...flicker.negative, text: "bad\tlabel" } }),
		],
		["unknown flicker setting", f({ hiddenDefault: true })],
	];
}
