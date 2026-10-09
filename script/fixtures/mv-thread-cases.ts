import {
	threadFrame,
	threadSong,
	type ThreadFrame,
	type ThreadSong,
} from "./mv-thread-contract";
export interface ThreadCase {
	readonly label: string;
	readonly frame: ThreadFrame;
	readonly song: ThreadSong;
	readonly indices: readonly number[];
	readonly defaults?: boolean;
}
export function threadCases(): ThreadCase[] {
	const frame = threadFrame(),
		song = threadSong();
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
				0, 1, 3, 4, 5, 29, 30, 59, 60, 120, 150, 176, 177, 178, 179, 189, 190,
				200, 239, 120,
			],
		},
		{
			label: "reviewed-stops",
			frame,
			song: { ...song, stops },
			indices: [
				65, 66, 67, 83, 101, 102, 103, 137, 138, 139, 159, 160, 170, 220, 83,
			],
		},
		{
			label: "empty-override",
			frame: { ...frame, args: { ...frame.args, stops: [] } },
			song: { ...song, stops },
			indices: [0, 83, 159, 200, 83],
		},
		{
			label: "overlapping-unsorted",
			frame: {
				...frame,
				args: {
					...frame.args,
					stops: [
						[6.0, 6.8],
						[5.0, 5.6],
						[5.2, 5.8],
					],
				},
			},
			song,
			indices: [60, 80, 108, 168, 200, 80],
		},
		{
			label: "explicit-placement",
			frame: {
				...frame,
				args: {
					...frame.args,
					light: [1440, 375],
					handRot: -0.28,
					handH: 1250,
					handX: 260,
					handY: 1170,
					kickAt: 6.05,
					arriveAt: 6.55,
				},
			},
			song: { ...song, downbeatIndex0: 2 },
			indices: [0, 90, 122, 123, 124, 152, 153, 154, 200, 90],
		},
		{
			label: "empty-beats-explicit-arrival",
			frame: { ...frame, args: { ...frame.args, kickAt: 6.2, arriveAt: 6.65 } },
			song: { ...song, beats: [] },
			indices: [0, 132, 159, 200, 132],
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
			indices: [0, 3, 30, 55, 110, 230, 30],
		},
	];
}
