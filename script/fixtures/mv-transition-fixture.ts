import type {
	MvTransition,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";

export const transitionStyles: readonly MvTransition[] = [
	{ kind: "cut" },
	{ kind: "xfade" },
	{ kind: "flash", color: [1, 1, 1, 1] },
	{ kind: "black" },
	{ kind: "iris", center: [0.5, 0.5] },
	{ kind: "irisClose", center: [0.5, 0.5] },
	{
		kind: "barrier",
		pivot: [-0.03, 0.5],
		colors: [
			[1, 1, 0, 1],
			[0, 0, 0, 1],
		],
		width: 0.06,
		stripes: 32,
		role: "foreground",
	},
	{ kind: "wipe", angle: 0 },
	{ kind: "slices", count: 4 },
	{ kind: "push", direction: "left" },
	{ kind: "zoom" },
	{ kind: "ink", seed: 37, blobs: 1 },
	{ kind: "shatter", seed: 37, center: [0.5, 0.5], columns: 9, rows: 5 },
];
export function transitionSource(style: MvTransition): ProgrammaticSource {
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 64,
		height: 64,
		frameRate: { numerator: 24, denominator: 1 },
		durationFrames: 24,
		seed: 7,
		recipe: {
			version: 1,
			root: "mix",
			songStartSeconds: 12.25,
			outputRoles: ["foreground"],
			nodes: [
				{
					id: "a",
					scene: { kind: "solid", role: "foreground", color: [1, 0, 0, 1] },
				},
				{
					id: "b",
					scene: { kind: "solid", role: "foreground", color: [0, 0, 1, 1] },
				},
				{
					id: "mix",
					scene: {
						kind: "transition",
						from: "a",
						to: "b",
						span: { startFrame: 4, durationFrames: 8 },
						easing: "linear",
						style,
					},
				},
			],
		},
	};
}
export async function pictureResource(
	id: string,
	second: boolean,
): Promise<ResolvedProgrammaticResource> {
	const c = new OffscreenCanvas(64, 64),
		ctx = c.getContext("2d")!;
	ctx.fillStyle = second ? "#173cd9" : "#d93a17";
	ctx.fillRect(0, 0, 64, 64);
	for (let y = 0; y < 64; y += 8)
		for (let x = 0; x < 64; x += 8) {
			ctx.fillStyle =
				(x + y) % 16 === 0
					? second
						? "#46e094"
						: "#ffd164"
					: second
						? "#4d1c8f"
						: "#661329";
			ctx.fillRect(x + 1, y + 1, 6, 6);
		}
	ctx.fillStyle = "white";
	ctx.fillRect(second ? 43 : 3, 3, 18, 8);
	const body = await (
		await c.convertToBlob({ type: "image/png" })
	).arrayBuffer();
	const sha256 = [
		...new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
	]
		.map((v) => v.toString(16).padStart(2, "0"))
		.join("");
	return {
		body,
		resource: {
			id,
			kind: "image",
			mimeType: "image/png",
			byteLength: body.byteLength,
			sha256,
			attachmentKey: `programmatic-sha256-${sha256}`,
		},
	};
}
export function texturedSource(
	style: MvTransition,
	resources: ResolvedProgrammaticResource[],
): ProgrammaticSource {
	const source = transitionSource(style),
		recipe = source.recipe!;
	return {
		...source,
		resources: resources.map((r) => r.resource),
		recipe: {
			...recipe,
			nodes: [
				...resources.map((r, i) => ({
					id: i === 0 ? "a" : "b",
					scene: {
						kind: "illust" as const,
						motion: { startFrame: 0, durationFrames: 24 },
						easing: "linear" as const,
						sprites: [
							{
								image: r.resource.id,
								role: "foreground" as const,
								from: { x: 0.5, y: 0.5, height: 1.2, rotation: 0, opacity: 1 },
								to: {
									x: i === 0 ? 0.6 : 0.4,
									y: 0.5,
									height: 1.2,
									rotation: 0,
									opacity: 1,
								},
								anchor: [0.5, 0.5] as const,
							},
						],
					},
				})),
				recipe.nodes[2],
			],
		},
	};
}
export const equal = (name: string, a: unknown, b: unknown) => {
	if (JSON.stringify(a) !== JSON.stringify(b))
		throw Error(`${name}: ${JSON.stringify({ a, b })}`);
};
export const pixels = (image: CanvasImageSource) => {
	const c = new OffscreenCanvas(64, 64),
		ctx = c.getContext("2d")!;
	ctx.drawImage(image, 0, 0);
	return ctx.getImageData(0, 0, 64, 64).data;
};
export const at = (bytes: Uint8ClampedArray, x: number, y: number) => [
	...bytes.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4),
];
export const hash = async (image: CanvasImageSource) =>
	[
		...new Uint8Array(await crypto.subtle.digest("SHA-256", pixels(image))),
	].join(",");
