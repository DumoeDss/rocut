import type {
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import type { MvColor } from "../../packages/editor-contracts/src/mv-recipe";
import type {
	MvTypeCard,
	MvTypeCardLayout,
} from "../../packages/editor-contracts/src/mv-type-card";
import type { TypeCardReferenceArgs } from "./mv-type-card-reference-contract";

export const TYPE_CARD_START = 12.25;
export const TYPE_CARD_DURATION = 4;
export const TYPE_CARD_BEATS = [
	11.9, 12.25, 13, 13.75, 14.5, 15.25, 16.25,
] as const;
export const TYPE_CARD_FONTS = [
	{
		id: "mincho",
		family: "Shippori Mincho B1",
		weight: 500,
		file: "shippori-mincho-b1-extrabold.ttf",
	},
	{
		id: "dela",
		family: "Dela Gothic One",
		weight: 400,
		file: "dela-gothic-one-regular.ttf",
	},
	{
		id: "dot",
		family: "DotGothic16",
		weight: 400,
		file: "dot-gothic-16-regular.ttf",
	},
] as const;
export const color = (r: number, g: number, b: number, a = 1): MvColor => [
	r / 255,
	g / 255,
	b / 255,
	a,
];

/** Only author data mirrors upstream defaults. No evaluated/easing/randomness formula lives here. */
export function typeCardCase(mode: "quiet" | "flicker", vertical = false) {
	const args: TypeCardReferenceArgs =
		mode === "quiet"
			? {
					mode,
					lines: ["静かなもA"],
					fam: "mincho",
					weight: 500,
					size: 96,
					color: "#F4EFE6",
					paper: "#060408",
					ruleColor: "#C8373A",
					rule: true,
					vertical,
					sub: "TEST かな",
					x: 960,
					y: 507.6,
					lead: 0.1,
					stagger: 0.12,
					fade: 0.6,
					gap: 0.36,
				}
			: { mode, lines: ["光A"], fam: "dela", weight: 400, paper: "#040305" };
	let settings: MvTypeCard;
	if (mode === "quiet") {
		settings = {
			mode,
			font: "mincho",
			glyphs: [
				{ text: "静", opticalScale: 1 },
				{ text: "か", opticalScale: 0.93 },
				{ text: "な", opticalScale: 0.93 },
				{ text: "も", opticalScale: 0.88 },
				{ text: "A", opticalScale: 1 },
			],
			fontSize: 96 / 1080,
			center: [0.5, 0.47],
			orientation: vertical ? "vertical" : "horizontal",
			gap: 0.36,
			lead: 0.1,
			stagger: 0.12,
			fade: 0.6,
			color: color(244, 239, 230),
			background: color(6, 4, 8),
			rule: {
				color: color(200, 55, 58),
				offset: (96 * 1.05) / 1080,
				lengthScale: 0.66,
				lengthPadding: 30 / 1080,
				width: 1.5 / 1080,
				tickLength: 9 / 1080,
			},
			subtitle: {
				font: "mincho",
				text: "TEST かな",
				position: [0.5, (507.6 + 96 * 1.05 + 36) / 1080],
				fontSize: 15 / 1080,
				tracking: 4 / 1080,
				color: color(244, 239, 230),
			},
			grain: 0.035,
		};
	} else {
		const part = (text: string, x: number, y: number, size: number) => ({
			text,
			position: [x / 1920, y / 1080] as const,
			fontSize: size / 1080,
		});
		const layout = (
			parts: MvTypeCardLayout["parts"],
			hold: MvTypeCardLayout["hold"],
			glitch: number,
			glow = false,
		): MvTypeCardLayout => ({
			parts,
			hold,
			glitch,
			frame: null,
			kickGlow: glow
				? {
						center: [0.5, 0.5],
						radius: 900 / 1080,
						color: color(255, 246, 238),
					}
				: null,
		});
		settings = {
			mode,
			font: "dela",
			background: color(4, 3, 5),
			beats: {
				kind: "manual",
				songTicks: TYPE_CARD_BEATS.map((beat) => Math.round(beat * 120000)),
			},
			layouts: [
				{
					...layout(
						[part("光A", 960, 540, 250)],
						{ kind: "pulse", seconds: 0.2 },
						1,
					),
					frame: {
						rect: [580 / 1920, 375 / 1080, 760 / 1920, 330 / 1080],
						color: color(244, 239, 230, 0.55),
						width: 2 / 1080,
						indicator: {
							rect: [594 / 1920, 389 / 1080, 10 / 1920, 10 / 1080],
							color: color(200, 55, 58, 0.9),
						},
					},
				},
				layout(
					[part("光", 560, 520, 760), part("A", 1380, 700, 300)],
					{ kind: "pulse", seconds: 0.3 },
					0.8,
				),
				layout([part("光A", 960, 540, 560)], { kind: "sustain" }, 0.6, true),
				layout([part("光A", 960, 530, 720)], { kind: "sustain" }, 0.45, true),
			],
			rgbColors: [color(255, 0, 0), color(0, 255, 0), color(0, 0, 255)],
			noiseColors: [
				color(255, 40, 60, 0.5),
				color(60, 220, 255, 0.45),
				color(255, 255, 255, 0.3),
			],
			scanlineOpacity: 0.5,
			idleScanColor: color(244, 239, 230, 0.07),
			morse: {
				elements: [1, 1, 1, 3, 3, 3, 1, 1, 1],
				position: [0.5, 984 / 1080],
				unit: 14 / 1080,
				gap: 12 / 1080,
				height: 4 / 1080,
				litColor: color(200, 55, 58, 0.95),
				unlitColor: color(244, 239, 230, 0.16),
				label: {
					font: "dot",
					text: "SOS",
					position: [963 / 1920, 1010 / 1080],
					fontSize: 16 / 1080,
					tracking: 6 / 1080,
					color: color(244, 239, 230, 0.45),
				},
			},
			flood: {
				center: [0.5, 0.5],
				radiusFrom: 220 / 1080,
				radiusTo: 2220 / 1080,
				colors: [
					color(255, 250, 240),
					color(255, 222, 180),
					color(240, 140, 110),
					color(200, 90, 90, 0),
				],
				white: color(255, 244, 230, 0.94),
			},
			negative: {
				...part("光A", 960, 540, 560),
				color: color(24, 70, 86, 0.55),
			},
			grain: 0.05,
		};
	}
	return { args, settings };
}

export function typeCardSource(
	resources: readonly ProgrammaticResource[],
	settings: MvTypeCard,
): ProgrammaticSource {
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 1920,
		height: 1080,
		frameRate: { numerator: 60, denominator: 1 },
		durationFrames: 240,
		seed: 0,
		resources,
		recipe: {
			version: 1,
			root: "card",
			songStartSeconds: TYPE_CARD_START,
			outputRoles: ["graphics"],
			post: [],
			nodes: [
				{
					id: "card",
					scene: {
						kind: "typeCard",
						role: "graphics",
						span: { startFrame: 0, durationFrames: 240 },
						settings,
					},
				},
			],
		},
	};
}
