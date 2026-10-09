import type {
	MvEffect,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";

export const spatialEffects: readonly MvEffect[] = [
	{ kind: "lineBoil", amount: 4, cellSize: 12, fps: 12 },
	{ kind: "glitch", amount: 1, bands: 16, fps: 12 },
	{ kind: "chromaticAberration", amount: 4, center: [0, 0.5] },
	{ kind: "zoomBlur", amount: 0.5, center: [0.5, 0.5] },
	{ kind: "bloom", amount: 1, threshold: 0.5, radius: 2, alpha: "expand" },
];
export async function postResource(
	id: string,
	draw: (ctx: OffscreenCanvasRenderingContext2D) => void,
): Promise<ResolvedProgrammaticResource> {
	const canvas = new OffscreenCanvas(64, 64);
	draw(canvas.getContext("2d")!);
	const body = await (
		await canvas.convertToBlob({ type: "image/png" })
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
export function postSource(
	resources: ResolvedProgrammaticResource[],
	effects: readonly MvEffect[] = [],
): ProgrammaticSource {
	const pose = { x: 0.5, y: 0.5, height: 1, rotation: 0, opacity: 1 };
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 64,
		height: 64,
		frameRate: { numerator: 24, denominator: 1 },
		durationFrames: 24,
		seed: 7,
		resources: resources.map((r) => r.resource),
		recipe: {
			version: 1,
			root: "shot",
			songStartSeconds: 12.25,
			outputRoles: ["foreground"],
			nodes: [
				{
					id: "shot",
					scene: {
						kind: "illust",
						motion: { startFrame: 0, durationFrames: 24 },
						easing: "linear",
						sprites: [
							{
								image: resources[0].resource.id,
								role: "foreground",
								from: pose,
								to: pose,
								anchor: [0.5, 0.5],
							},
						],
					},
				},
			],
			post: effects.length ? [{ roles: ["foreground"], effects }] : [],
		},
	};
}
export async function postCapture(
	source: ProgrammaticSource,
	resources: ResolvedProgrammaticResource[],
	index = 0,
) {
	const frame = resolveProgrammaticFrame({
		source,
		clipStart: 0,
		clipDuration: 120000,
		trimStart: 0,
		timelineTime: index * 5000,
	})!;
	return renderProgrammaticCanvas({ source, resources, frame });
}
export const postPixels = (
	image: CanvasImageSource,
	width = 64,
	height = 64,
) => {
	const c = new OffscreenCanvas(width, height),
		ctx = c.getContext("2d")!;
	ctx.drawImage(image, 0, 0);
	return ctx.getImageData(0, 0, width, height).data;
};
export const postAt = (data: Uint8ClampedArray, x: number, y: number) => [
	...data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4),
];
export const postHash = async (data: Uint8ClampedArray) =>
	[
		...new Uint8Array(
			await crypto.subtle.digest("SHA-256", new Uint8Array(data)),
		),
	].join(",");
export function assertPost(ok: unknown, name: string) {
	if (!ok) throw Error(name);
}
