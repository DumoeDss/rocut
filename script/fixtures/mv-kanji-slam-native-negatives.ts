import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type {
	MvEmberCommand,
	MvEmberSurfaceDraw,
} from "../../packages/editor-contracts/src/mv-ember-plan";
import type {
	KanjiSlamFrame,
	KanjiSlamSong,
} from "./mv-kanji-slam-reference-contract";
import { captureKanjiSlam } from "./mv-kanji-slam-native-capture";
import { kanjiSlamNativeSource } from "./mv-kanji-slam-native-source";
import { check, difference } from "./mv-afterimage-capture";

export function kanjiNativeParity(diff: ReturnType<typeof difference>) {
	return diff.max <= 2 && diff.mae < 0.025;
}

/** Mutations happen only after production admission on owned fixture data.
 * Each deliberate omission must actually fail the unchanged parity gate. */
export async function kanjiSlamNegativeControls(
	input: KanjiSlamFrame,
	song: KanjiSlamSong,
	source: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
	progress: (label: string) => void,
) {
	const variant = input.args.variant,
		index = 48;
	progress(`${variant}/negative/public-baseline`);
	const baseline = await captureKanjiSlam(source, resources, index);
	const unmodified = await captureKanjiSlam(source, resources, index, {
		controlled: true,
	});
	const controlled = difference(unmodified, baseline);
	check(
		controlled.max === 0,
		`Controlled replay differs from public kanjiSlam: ${variant}`,
	);
	const results: Record<
		string,
		{ removed?: number; diff: ReturnType<typeof difference> }
	> = {};
	const omissions: {
		label: string;
		remove: (draw: MvEmberSurfaceDraw) => boolean;
	}[] = [
		{ label: "ink-strokes", remove: (draw) => draw.kind === "textStroke" },
		{ label: "print-speckle", remove: (draw) => draw.kind === "rectBatch" },
		{ label: "film-grain", remove: (draw) => draw.kind === "grain" },
		{
			label: "character-image",
			remove: (draw) => draw.kind === "image" && draw.image === input.args.char,
		},
		...(input.args.fire
			? [
					{
						label: "flame-noise",
						remove: (draw: MvEmberSurfaceDraw) =>
							draw.kind === "surfacePatternRect",
					},
				]
			: []),
	];
	for (const omission of omissions) {
		progress(`${variant}/negative/omitted-${omission.label}`);
		let removed = 0;
		const keep = (draw: MvEmberSurfaceDraw) => {
			if (!omission.remove(draw)) return true;
			removed++;
			return false;
		};
		const changed = await captureKanjiSlam(source, resources, index, {
			mutate: (data) => {
				const commands = data.commands.flatMap<MvEmberCommand>((command) => {
					if (command.kind === "releaseSurface") return [command];
					if (command.kind === "surface")
						return [{ ...command, commands: command.commands.filter(keep) }];
					return keep(command) ? [command] : [];
				});
				Reflect.set(data, "commands", commands);
			},
		});
		const diff = difference(changed, baseline);
		results[`${variant}/omitted-${omission.label}`] = { removed, diff };
		check(
			removed > 0 && !kanjiNativeParity(diff),
			`Omitting ${omission.label} must fail the real ${variant} parity gate`,
		);
	}
	progress(`${variant}/negative/wrong-clock`);
	const shifted = kanjiSlamNativeSource(
		input,
		{ ...song, beats: song.beats.map((time) => time + 0.125) },
		resources,
	);
	const diff = difference(
		await captureKanjiSlam(shifted, resources, index),
		baseline,
	);
	results[`${variant}/wrong-song-clock`] = { diff };
	check(
		!kanjiNativeParity(diff),
		`Wrong song clock must fail the real ${variant} parity gate`,
	);
	return { controlled, negatives: results };
}
