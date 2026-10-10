export const blazeHostSettings = {
	width: 192,
	height: 128,
	durationFrames: 30,
	frameRate: { numerator: 30, denominator: 1 },
	seed: 97,
};

export const blazeHostParams = {
	amount: 0.75,
	flameOpacity: 0.625,
	sparkOpacity: 0.875,
	smokeOpacity: 0.375,
	refraction: 0.03125,
	height: 0.875,
	scale: 0.125,
	speed: 0.5,
	wind: -0.375,
	seed: 31415,
};

export const blazeHostAnimated = {
	amount: [0.25, 0.875],
	flameOpacity: [0.375, 0.75],
	sparkOpacity: [0.875, 0.25],
	smokeOpacity: [0.25, 0.625],
	refraction: [0.015625, 0.0625],
	height: [0.625, 1.125],
	wind: [-0.5, 0.625],
};

export const blazeHostFields = [
	["amount", 0, 1, 0.01, 1, true],
	["flameOpacity", 0, 1, 0.01, 0.8, true],
	["sparkOpacity", 0, 1, 0.01, 0.6, true],
	["smokeOpacity", 0, 1, 0.01, 0.25, true],
	["refraction", 0, 0.08, 0.001, 0.015, true],
	["height", 0.1, 1.5, 0.001, 0.65, true],
	["scale", 0.025, 0.5, 0.001, 0.15, false],
	["speed", 0, 4, 0.01, 0.4, false],
	["wind", -1, 1, 0.001, 0, true],
	["seed", 0, 65535, 1, 1, false],
] as const;

export const blazeHostId = "template-blaze";
export const blazeHostTrack = "blaze-shots";
export const blazeHostSentinel = "blaze-unrelated";
export const blazeHostTargetIds = [
	"blaze-static",
	"blaze-animated",
	"blaze-disabled",
] as const;

export type BlazeHostResource = {
	id: string;
	kind: string;
	sha256: string;
	byteLength: number;
	[key: string]: unknown;
};
export type BlazeHostChannel = {
	keys: {
		id: string;
		time: number;
		value: unknown;
		segmentToNext: string;
		tangentMode: string;
	}[];
};
export type BlazeHostShot = {
	source: Record<string, unknown>;
	effects: {
		id: string;
		type: string;
		enabled: boolean;
		params: Record<string, unknown>;
	}[];
	animations: Record<string, BlazeHostChannel>;
};
export type BlazeHostEditing = {
	type: "graphic";
	name: string;
	definitionId: "programmatic";
	params: Record<string, unknown>;
	programmatic: BlazeHostShot["source"];
	effects: BlazeHostShot["effects"];
	animations: BlazeHostShot["animations"];
};
export type BlazeHostClip = {
	id: string;
	trackId: string;
	startTime: number;
	duration: number;
	trimStart: number;
	trimEnd: number;
	editing: BlazeHostEditing;
};

export function blazeHostChannel(
	key: string,
	value: unknown,
): BlazeHostChannel {
	return {
		keys: [
			{
				id: `${key}-invalid`,
				time: 0,
				value,
				segmentToNext: "linear",
				tangentMode: "auto",
			},
		],
	};
}
