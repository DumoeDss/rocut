import type { InkFrame, InkSong } from "./mv-ink-contract";
export interface InkCase {
	readonly label: string;
	readonly frame: InkFrame;
	readonly song: InkSong;
	readonly indices: readonly number[];
	readonly assetVariant?: "changed-body" | "dimensions" | "new-id";
}
export function inkCases(): InkCase[] {
	const song: InkSong = {
		bpm: 120,
		downbeatIndex0: 0,
		beats: Array.from({ length: 40 }, (_, i) => i / 2),
	};
	const frame: InkFrame = {
		shotStart: 4,
		duration: 6,
		time: 4,
		args: { char: "ink-character" },
	};
	// Before/at/after original 12Hz boundaries, all authored delays and late coils.
	// Adjacent early frames expose continuous fog/camera even with held ink drawing.
	const indices = [
		0, 1, 4, 5, 6, 14, 15, 16, 20, 21, 29, 30, 31, 47, 48, 49, 53, 54, 55, 65,
		66, 67, 89, 90, 91, 120, 180, 240, 300, 359, 180, 5, 300, 0,
	];
	return [
		{ label: "defaults-nine-tendrils-and-helix", frame, song, indices },
		{
			label: "explicit-placement",
			frame: {
				...frame,
				args: { char: "ink-character", seed: 19, h: 970, x: 910, y: 1015 },
			},
			song,
			indices,
		},
		{
			label: "zero-seed-original-fallback",
			frame: { ...frame, args: { char: "ink-character", seed: 0 } },
			song,
			indices,
		},
		{
			label: "explicit-seven-seed",
			frame: { ...frame, args: { char: "ink-character", seed: 7 } },
			song,
			indices,
		},
		{
			label: "irregular-beat-lurch",
			frame,
			song: {
				...song,
				beats: [
					0, 0.47, 1.03, 1.46, 2.07, 2.54, 3.01, 3.53, 4.03, 4.49, 5.02, 5.61,
					6.07, 6.54, 7.13, 7.59, 8.04, 8.61, 9.12, 9.64,
				],
			},
			indices,
		},
		{
			label: "off-grid-shot-start",
			frame: { ...frame, shotStart: 4.0375, time: 4.0375 },
			song,
			indices,
		},
		{
			label: "whole-song-offset",
			frame: { ...frame, shotStart: 10, time: 10 },
			song,
			indices,
		},
		{
			label: "before-first-beat",
			frame,
			song: { ...song, beats: [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5] },
			indices,
		},
		{
			label: "exhausted-beat-grid",
			frame,
			song: { ...song, beats: [0, 0.5, 1] },
			indices,
		},
		...(["changed-body", "dimensions", "new-id"] as const).map(
			(assetVariant) => ({
				label: `resource-${assetVariant}`,
				frame: {
					...frame,
					args: {
						char: assetVariant === "new-id" ? "ink-renamed" : "ink-character",
					},
				},
				song,
				indices,
				assetVariant,
			}),
		),
	];
}
