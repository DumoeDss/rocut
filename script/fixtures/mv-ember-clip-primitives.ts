import type {
	MvEmberCommand,
	MvEmberPlan,
} from "../../packages/editor-contracts/src/mv-ember-plan";
import { MV_EMBER_RASTER_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-ember-raster";
import { check, clipDifference, clipPixels } from "./mv-ember-clip-input";

type ImageCommand = Extract<MvEmberCommand, { kind: "image" }>;
type Kind = "html" | "offscreen";
type Paint = "fill" | "clip-fill" | "clip-image";
const primitive = new Function(
	`${MV_EMBER_RASTER_SOURCE}; return { transform: mvEmberTransform, path: mvEmberPath };`,
)();

function paint(
	command: ImageCommand,
	image: ImageBitmap,
	kind: Kind,
	mode: Paint,
	settings?: CanvasRenderingContext2DSettings,
) {
	check(command.clip, "Coverage primitive requires an existing clip");
	const canvas =
		kind === "html"
			? document.createElement("canvas")
			: new OffscreenCanvas(1920, 1080);
	canvas.width = 1920;
	canvas.height = 1080;
	const ctx = canvas.getContext("2d", settings) as
		| CanvasRenderingContext2D
		| OffscreenCanvasRenderingContext2D;
	try {
		primitive.transform(ctx, command.clip);
		primitive.path(ctx, command.clip.path);
		ctx.fillStyle = "white";
		if (mode === "fill") ctx.fill("nonzero");
		else {
			ctx.clip("nonzero");
			if (mode === "clip-fill") {
				ctx.setTransform(1, 0, 0, 1, 0, 0);
				ctx.fillRect(0, 0, 1920, 1080);
			} else {
				primitive.transform(ctx, command);
				ctx.imageSmoothingEnabled = command.smoothing;
				ctx.imageSmoothingQuality = command.smoothingQuality;
				ctx.drawImage(image, ...command.destinationRect);
			}
		}
		const getAttributes = Reflect.get(ctx, "getContextAttributes");
		check(typeof getAttributes === "function", "Missing context attributes");
		return {
			pixels: clipPixels(canvas),
			attributes: getAttributes.call(ctx),
		};
	} finally {
		canvas.width = canvas.height = 1;
	}
}

function alphaDifference(a: Uint8ClampedArray, b: Uint8ClampedArray) {
	let max = 0,
		sum = 0,
		changed = 0;
	const points: {
		x: number;
		y: number;
		a: number;
		b: number;
		delta: number;
	}[] = [];
	const histogram = new Map<number, number>();
	for (let i = 3; i < a.length; i += 4) {
		if (a[i] && a[i] !== 255)
			histogram.set(a[i], (histogram.get(a[i]) ?? 0) + 1);
		const delta = Math.abs(a[i] - b[i]);
		max = Math.max(max, delta);
		sum += delta;
		if (delta) {
			changed++;
			if (points.length < 16 || delta > points[points.length - 1].delta) {
				points.push({
					x: ((i - 3) / 4) % 1920,
					y: Math.floor((i - 3) / 4 / 1920),
					a: a[i],
					b: b[i],
					delta,
				});
				points.sort((p, q) => q.delta - p.delta);
				if (points.length > 16) points.pop();
			}
		}
	}
	return {
		max,
		mae: sum / (a.length / 4),
		changedPixels: changed,
		partialAlphaHistogram: Object.fromEntries(
			[...histogram].sort(([a], [b]) => a - b),
		),
		points,
	};
}

export function diagnoseClipPrimitives(plan: MvEmberPlan, image: ImageBitmap) {
	const images = plan.commands.filter(
		(command): command is ImageCommand =>
			command.kind === "image" && !!command.clip,
	);
	const observations = [];
	for (const command of [images[0], images[images.length - 1]]) {
		check(command, "Missing clipped image primitive");
		const htmlClipImage = paint(command, image, "html", "clip-image");
		const htmlClipFill = paint(command, image, "html", "clip-fill");
		for (const kind of ["html", "offscreen"] satisfies Kind[])
			for (const mode of ["fill", "clip-fill", "clip-image"] satisfies Paint[])
				for (const settings of [undefined, { willReadFrequently: true }]) {
					const actual = paint(command, image, kind, mode, settings);
					observations.push({
						slice: images.indexOf(command),
						kind,
						mode,
						settings,
						attributes: actual.attributes,
						alphaVsHtmlClipFill: alphaDifference(
							actual.pixels,
							htmlClipFill.pixels,
						),
						alphaVsHtmlClipImage: alphaDifference(
							actual.pixels,
							htmlClipImage.pixels,
						),
						...(mode === "clip-image"
							? {
									rgbaVsHtmlClipImage: clipDifference(
										actual.pixels,
										htmlClipImage.pixels,
									),
								}
							: {}),
					});
				}
	}
	return observations;
}
