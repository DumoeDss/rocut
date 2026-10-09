const transform = [1, 0, 0, 1, 0, 0];
const color = [0.3, 0.4, 0.8, 0.7];
const rect = {
	kind: "rect",
	transform,
	rect: [0, 0, 4, 3],
	paint: {
		kind: "fill",
		style: { kind: "solid", color },
		opacity: 0.8,
		composite: "source-over",
	},
};
const grain = {
	kind: "grain",
	transform,
	size: [2, 1],
	gray: [13, 244],
	opacity: 0.2,
	rect: [0, 0, 4, 3],
};
const text = {
	font: "font",
	text: "A",
	fontSize: 22,
	tracking: 1,
	color,
	opacity: 0.5,
	position: [2, 2],
	blur: 0,
};
export const grade = {
	seed: 3,
	effect: {
		kind: "grade",
		exposure: 0.2,
		contrast: 0.9,
		saturation: 0.8,
		lift: [0, 0, 0],
		gain: [1, 1, 1],
	},
};
export const leak = {
	effect: { kind: "lightLeak", amount: 0.5, alpha: "expand" },
	lightLeak: {
		gradients: [
			{
				center: [2, 1],
				radius: 3,
				stops: [
					{ offset: 0, color: [255, 120, 30, 0.4] },
					{ offset: 1, color: [255, 0, 0, 0] },
				],
			},
		],
	},
};
export const emberNode = {
	kind: "ember",
	role: "background",
	data: {
		commands: [
			{ kind: "surface", id: "scratch", size: [4, 3], commands: [rect, grain] },
			{
				kind: "blit",
				surface: "scratch",
				transform,
				sourceRect: [0, 0, 4, 3],
				destinationRect: [0, 0, 4, 3],
				opacity: 1,
				composite: "source-over",
			},
		],
	},
};
export const sprite = {
	image: "image",
	role: "subject",
	pose: { opacity: 0.8, height: 0.8, x: 0.5, y: 0.8, rotation: 0.1 },
	anchor: [0.5, 1],
	shadow: { color, offset: [0.1, 0.2], blur: 0.1 },
};
export const illustNode = {
	kind: "illust",
	background: { image: "image", camera: { zoom: 1.2, x: 0.1, y: 0.2 } },
	sprites: [sprite],
};
export const solidNode = { kind: "solid", role: "subject", color };
export const recipePlan = ({
	root = emberNode,
	post = [],
	outputRoles = ["background", "subject"],
}: { root?: unknown; post?: unknown[]; outputRoles?: string[] } = {}) => ({
	version: 1,
	root,
	post,
	outputRoles,
});
export const completeRecipe = recipePlan({
	root: {
		kind: "panels",
		panels: [
			{
				polygon: [
					[0, 0],
					[4, 0],
					[4, 3],
				],
				transform,
				border: { role: "background", color, width: 0.1 },
				input: {
					kind: "ref",
					input: {
						kind: "transition",
						from: emberNode,
						to: solidNode,
						style: { kind: "fade" },
						commands: [
							{
								kind: "image",
								input: "from",
								transform,
								opacity: 0.8,
								blend: "source-over",
							},
							{
								kind: "image",
								input: "to",
								transform,
								opacity: 0.2,
								blend: "source-over",
							},
						],
					},
				},
			},
			{
				polygon: [
					[0, 0],
					[0, 3],
					[4, 3],
				],
				transform,
				input: illustNode,
			},
			{
				polygon: [
					[0, 0],
					[4, 0],
					[4, 3],
				],
				transform,
				input: { kind: "empty" },
			},
		],
	},
	post: [
		{
			roles: ["background"],
			effects: [
				grade,
				{ ...leak, effect: { ...leak.effect, amount: 0 } },
				grade,
				leak,
				grade,
			],
		},
		{ stage: "composite", effects: [grade] },
	],
});

/** Each allocation-heavy 2D helper is exercised independently of scene math. */
export const factoryNodes = [
	emberNode,
	{ kind: "converge", role: "background", data: { commands: [grain] } },
	{
		kind: "typeCard",
		role: "background",
		data: {
			background: color,
			grain: { ...grain, offset: [0, 0] },
			quiet: { glyphs: [text], rule: [], subtitle: text },
		},
	},
	{
		kind: "afterimage",
		role: "background",
		data: {
			background: color,
			transform,
			mask: {
				circle: { center: [2, 1], radius: 1 },
				cutout: { image: "image", rect: [0, 0, 4, 3] },
				glyphs: [],
				titleFont: "font",
				subtitle: text,
			},
			rasters: [
				{ id: "blur", source: "mask", size: [2, 2], blur: 2, tint: color },
			],
			layers: [{ raster: "blur", opacity: 0.7, rect: [0, 0, 4, 3] }],
			grain: { ...grain, offset: [0, 0] },
			credit: text,
		},
	},
	illustNode,
	{
		kind: "grid",
		role: "background",
		data: {
			image: "image",
			rect: [0, 0, 4, 3],
			fit: "cover",
			opacity: 0.7,
			fullImage: true,
			faces: [],
		},
	},
	{
		kind: "imageSequence",
		role: "background",
		imageKey: "sequence",
		view: { zoom: 1, x: 0, y: 0 },
	},
];
