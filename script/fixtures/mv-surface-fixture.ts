import type {
	MvEmberCommand,
	MvEmberDraw,
	MvEmberPlan,
} from "../../packages/editor-contracts/src/mv-ember-plan";
import type { MvDrawComposite } from "../../packages/editor-contracts/src/mv-draw-paint";

export const size = 96;
const transform = [1, 0, 0, 1, 0, 0] as const;
const rect = [0, 0, size, size] as const;
export const modes: MvDrawComposite[] = [
	"source-in",
	"source-atop",
	"destination-in",
	"multiply",
	"soft-light",
	"difference",
];
const text = {
	kind: "text",
	font: "font",
	text: "A",
	fontSize: 85,
	tracking: 0,
	transform,
	position: [48, 80],
	align: "center",
	baseline: "alphabetic",
	composite: "source-over",
	opacity: 1,
	style: {
		kind: "linear",
		from: [0, 5],
		to: [0, 90],
		stops: [
			{ offset: 0, color: [1, 0, 0, 1] },
			{ offset: 1, color: [0, 0, 1, 1] },
		],
	},
} satisfies MvEmberDraw;
function blit(
	surface: string,
	composite: MvDrawComposite = "source-over",
): MvEmberCommand & { kind: "blit" } {
	return {
		kind: "blit",
		surface,
		transform,
		sourceRect: rect,
		destinationRect: rect,
		composite,
		opacity: 1,
	};
}
export function plan(
	mode: MvDrawComposite,
	{
		omitPaper = false,
		omitGradient = false,
		flatten = false,
	}: {
		omitPaper?: boolean;
		omitGradient?: boolean;
		flatten?: boolean;
	} = {},
): MvEmberPlan {
	const layers: MvEmberCommand[] = flatten
		? [
				{ ...blit("glyph"), opacity: 0.75 },
				{ ...blit("paper", mode), opacity: 0.75 },
			]
		: [
				{
					kind: "surface",
					id: "masked",
					size: [size, size],
					commands: [
						blit("glyph"),
						...(omitPaper ? [] : [blit("paper", mode)]),
					],
				},
				{ ...blit("masked"), opacity: 0.75 },
			];
	return {
		commands: [
			{
				kind: "surface",
				id: "glyph",
				size: [size, size],
				commands: [
					{
						...text,
						...(omitGradient
							? {
									style: {
										kind: "solid" as const,
										color: [1, 1, 1, 1] as const,
									},
								}
							: {}),
					},
				],
			},
			{
				kind: "surface",
				id: "paper",
				size: [size, size],
				commands: [
					{
						kind: "rect",
						transform,
						rect: [0, 0, 70, 96],
						paint: {
							kind: "fill",
							style: { kind: "solid", color: [0.8, 0.7, 0.2, 0.7] },
							composite: "source-over",
							opacity: 1,
						},
					},
					{
						kind: "rect",
						transform,
						rect: [20, 30, 76, 30],
						paint: {
							kind: "fill",
							style: { kind: "solid", color: [0.2, 0.9, 0.6, 0.45] },
							composite: "source-over",
							opacity: 1,
						},
					},
				],
			},
			...layers,
			{ ...blit("glyph"), destinationRect: [20, 8, size, size], opacity: 0.25 },
		],
	};
}
function canvas() {
	const result = document.createElement("canvas");
	result.width = result.height = size;
	return result;
}
// Deliberately handwritten oracle: no production plan walker or raster helpers.
export function original(mode: MvDrawComposite, flatten = false) {
	const glyph = canvas(),
		paper = canvas(),
		mask = canvas(),
		output = canvas();
	const g = glyph.getContext("2d")!,
		p = paper.getContext("2d")!,
		m = mask.getContext("2d")!,
		o = output.getContext("2d")!;
	g.font = 'normal 400 85px "SurfaceFixture"';
	g.textAlign = "center";
	g.textBaseline = "alphabetic";
	const gradient = g.createLinearGradient(0, 5, 0, 90);
	gradient.addColorStop(0, "rgba(255,0,0,1)");
	gradient.addColorStop(1, "rgba(0,0,255,1)");
	g.fillStyle = gradient;
	g.fillText("A", 48, 80);
	p.fillStyle = "rgba(204,178.5,51,0.7)";
	p.fillRect(0, 0, 70, 96);
	p.fillStyle = "rgba(51,229.5,153,0.45)";
	p.fillRect(20, 30, 76, 30);
	if (flatten) {
		o.globalAlpha = 0.75;
		o.drawImage(glyph, 0, 0);
		o.globalCompositeOperation = mode;
		o.drawImage(paper, 0, 0);
		o.globalCompositeOperation = "source-over";
	} else {
		m.drawImage(glyph, 0, 0);
		m.globalCompositeOperation = mode;
		m.drawImage(paper, 0, 0);
		o.globalAlpha = 0.75;
		o.drawImage(mask, 0, 0);
	}
	o.globalAlpha = 0.25;
	o.drawImage(glyph, 20, 8);
	const pixels = o.getImageData(0, 0, size, size).data;
	for (const c of [glyph, paper, mask, output]) c.width = c.height = 1;
	return pixels;
}
export function difference(a: Uint8ClampedArray, b: Uint8ClampedArray) {
	if (a.length !== size * size * 4 || b.length !== a.length)
		throw Error("Surface oracle requires complete same-sized RGBA frames");
	let max = 0,
		sum = 0,
		changed = 0;
	for (let i = 0; i < a.length; i++) {
		const d = Math.abs(a[i]! - b[i]!);
		max = Math.max(max, d);
		sum += d;
		if (d) changed++;
	}
	return { max, mae: sum / a.length, changedChannels: changed };
}
