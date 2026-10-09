import {
	fallFrame,
	fallSong,
	type FallFrame,
	type FallSong,
} from "./mv-fall-contract";
export interface FallCase {
	readonly label: string;
	readonly frame: FallFrame;
	readonly song: FallSong;
	readonly indices: readonly number[];
	readonly defaults?: boolean;
}
export function fallCases(): FallCase[] {
	const frame = fallFrame(),
		song = fallSong();
	const stops = [
		{ kind: "gap", start: 4.2, end: 6.9 },
		{ kind: "stop", start: 5.1, end: 5.7 },
		{ kind: "stop", start: 6.3, end: 6.65 },
	] as const;
	return [
		{
			label: "default",
			frame,
			song,
			defaults: true,
			indices: [
				0, 1, 3, 4, 5, 36, 59, 60, 61, 110, 120, 150, 176, 177, 178, 189, 200,
				239, 120,
			],
		},
		{
			label: "reviewed-stops",
			frame,
			song: { ...song, stops },
			indices: [
				65, 66, 67, 83, 98, 99, 100, 101, 102, 103, 137, 138, 159, 160, 170,
				220, 83,
			],
		},
		{
			label: "empty-freeze-override",
			frame: { ...frame, args: { ...frame.args, freeze: [] } },
			song: { ...song, stops },
			indices: [0, 83, 99, 159, 200, 83],
		},
		{
			label: "empty-pulse-override",
			frame: { ...frame, args: { ...frame.args, pulse: [] } },
			song: { ...song, stops },
			indices: [83, 99, 100, 101, 102, 110, 120, 200, 99],
		},
		{
			label: "overlapping-unsorted",
			frame: {
				...frame,
				args: {
					...frame.args,
					freeze: [
						[6, 6.8],
						[5, 5.6],
						[5.2, 5.8],
					],
				},
			},
			song,
			indices: [0, 60, 80, 108, 165, 166, 167, 168, 169, 200, 80],
		},
		{
			label: "explicit-placement",
			frame: {
				...frame,
				args: {
					...frame.args,
					freeze: [[5.01, 5.713337]],
					pulse: [4.4, 6.5, 6.62],
					vp: [890, 155],
					speed: 1.5,
					h: 830,
				},
			},
			song,
			indices: [
				0, 24, 25, 60, 100, 102, 103, 149, 150, 151, 152, 157, 158, 200, 100,
			],
		},
		{
			label: "empty-beats",
			frame,
			song: { ...song, beats: [] },
			indices: [0, 36, 83, 120, 200, 83],
		},
		{
			label: "stationary",
			frame: {
				...frame,
				args: { ...frame.args, freeze: [], pulse: [6], speed: 0 },
			},
			song,
			indices: [0, 60, 120, 121, 132, 200, 121],
		},
		{
			label: "global-open-overlap-boundaries",
			frame,
			song: {
				...song,
				stops: [
					{ kind: "stop", start: 3.2, end: 4 },
					{ kind: "stop", start: 8, end: 8.4 },
					{ kind: "gap", start: 3.1, end: 8.9 },
					{ kind: "stop", start: 6.1, end: 6.8 },
					{ kind: "stop", start: 3.9, end: 4.4 },
				],
			},
			indices: [0, 3, 24, 25, 110, 165, 166, 167, 168, 230, 30, 0],
		},
	];
}
