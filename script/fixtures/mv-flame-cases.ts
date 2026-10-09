import type {
	FlameOracleArgs,
	FlameOracleFrame,
	FlameSong,
} from "./mv-flame-oracle-contract";

export interface FlameCase {
	readonly label: string;
	readonly frame: FlameOracleFrame;
	readonly song: FlameSong;
	readonly indices: readonly number[];
	readonly vocal?: "zero";
	readonly assetVariant?: "changed-body" | "dimensions" | "new-id";
}
export function flameCases(): FlameCase[] {
	const song: FlameSong = {
		bpm: 120,
		downbeatIndex0: 0,
		beats: Array.from({ length: 24 }, (_, i) => i / 2),
		envelope: {
			fps: 2,
			vocal: [
				0.1, 0.8, 0.3, 0.95, 0.4, 0.6, 0.2, 0.7, 0.9, 0.25, 0.8, 0.5, 0.1, 0.9,
				0.3, 0.8, 0.2, 0.6, 0.4, 0.95, 0.2, 0.8, 0.1, 0.7,
			],
		},
	};
	const frame = (args: FlameOracleArgs): FlameOracleFrame => ({
		shotStart: 4,
		duration: 4,
		time: 4,
		args,
	});
	const indices = [0, 1, 4, 5, 6, 60, 120, 180, 239, 120];
	const stops = [
		{ kind: "stop", start: 4.2, end: 5.4 },
		{ kind: "gap", start: 3, end: 9 },
		{ kind: "stop", start: 6, end: 6.5 },
	] as const;
	return [
		{
			label: "changed-resource-body",
			assetVariant: "changed-body",
			frame: frame({ mode: "grow" }),
			song,
			indices,
		},
		{
			label: "actual-dimensions",
			assetVariant: "dimensions",
			frame: frame({
				mode: "grow",
				flameAt: [441, 474, 496.5, 112.5, 176.25, 34.5],
			}),
			song,
			indices,
		},
		{
			label: "changed-resource-id",
			assetVariant: "new-id",
			frame: frame({ mode: "grow", img: "flame-native-renamed" }),
			song,
			indices,
		},
		{ label: "breathe-default", frame: frame({}), song, indices },
		{
			label: "breathe-explicit",
			frame: frame({
				mode: "breathe",
				stops: [[4.7, 5.3]],
				zoomAt: 6.2,
				zoomTo: 3,
				flameAt: [588, 632, 662, 150, 235, 46],
			}),
			song,
			indices,
		},
		{
			label: "breathe-zero",
			frame: frame({ mode: "breathe" }),
			song: { ...song, envelope: undefined },
			vocal: "zero",
			indices,
		},
		{
			label: "vocal-start-boundary",
			frame: { ...frame({ mode: "breathe" }), shotStart: 0, time: 0 },
			song,
			indices,
		},
		{
			label: "vocal-after-last",
			frame: { ...frame({ mode: "breathe" }), shotStart: 14, time: 14 },
			song,
			indices,
		},
		{
			label: "breathe-global-stops",
			frame: frame({ mode: "breathe" }),
			song: { ...song, stops },
			indices,
		},
		{
			label: "breathe-empty-stops",
			frame: frame({ mode: "breathe", stops: [] }),
			song: { ...song, stops },
			indices,
		},
		{ label: "grow-default", frame: frame({ mode: "grow" }), song, indices },
		{
			label: "grow-explicit",
			frame: frame({ mode: "grow", zoomAt: 5.4, zoomTo: 4, stops: [[4, 7]] }),
			song,
			indices,
		},
		{
			label: "changed-landmarks",
			frame: frame({ mode: "grow", flameAt: [570, 620, 670, 130, 210, 38] }),
			song,
			indices,
		},
		{ label: "dark-default", frame: frame({ mode: "dark" }), song, indices },
		{
			label: "dark-explicit",
			frame: frame({
				mode: "dark",
				igniteAt: 5.3,
				h: 1070,
				faceAt: [410, 310],
				facePos: [870, 380],
				stops: [[6.1, 6.6]],
			}),
			song,
			indices,
		},
		{
			label: "dark-global-ignition",
			frame: frame({ mode: "dark", stops: [] }),
			song: { ...song, stops },
			indices,
		},
	];
}
