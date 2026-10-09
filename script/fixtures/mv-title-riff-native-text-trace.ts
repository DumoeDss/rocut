import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { createTitleRiffReference } from "./mv-title-riff-reference-browser";
import type { TitleRiffReferenceFrame } from "./mv-title-riff-reference-contract";
import {
	captureTitleRiff,
	originalTitleRiffPixels,
} from "./mv-title-riff-native-capture";
import { check, difference } from "./mv-afterimage-capture";
import {
	traceTitleRiffRingBoundaries,
	traceTitleRiffScheduling,
} from "./mv-title-riff-native-replay-diagnostics";

/** Observation only. Both observed paths must retain the unobserved pixels. */
export async function traceTitleRiffText(
	oracle: Awaited<ReturnType<typeof createTitleRiffReference>>,
	sample: TitleRiffReferenceFrame,
	source: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
	index: number,
	actual: Uint8ClampedArray,
	expected: Uint8ClampedArray,
) {
	let beforeRingPixels: Uint8ClampedArray | undefined;
	let afterRingPixels: Uint8ClampedArray | undefined;
	const original: unknown[] = [],
		native: unknown[] = [];
	const rings: { original: unknown[]; native: unknown[] } = {
		original: [],
		native: [],
	};
	const traced = await originalTitleRiffPixels(
		oracle,
		sample,
		(ctx, text, x, y) => {
			if (!ctx.font.includes("1000px")) return;
			const m = ctx.getTransform();
			original.push({
				text,
				position: [x, y],
				transform: [m.a, m.b, m.c, m.d, m.e, m.f],
				alpha: ctx.globalAlpha,
			});
		},
		(ctx, args) => {
			if (args[2] < 300 || args[2] > 400 || ctx.lineWidth !== 6) return;
			if (!beforeRingPixels) {
				beforeRingPixels = ctx.getImageData(0, 0, 1920, 1080).data;
				const stroke = ctx.stroke;
				ctx.stroke = function (...args: [] | [Path2D]) {
					try {
						const result = Reflect.apply(stroke, this, args);
						afterRingPixels = this.getImageData(0, 0, 1920, 1080).data;
						return result;
					} finally {
						ctx.stroke = stroke;
					}
				};
			}
			const m = ctx.getTransform();
			rings.original.push({
				arc: [...args],
				canvasSize: [ctx.canvas.width, ctx.canvas.height],
				transform: [m.a, m.b, m.c, m.d, m.e, m.f],
				paint: {
					strokeStyle: String(ctx.strokeStyle),
					lineWidth: ctx.lineWidth,
					lineCap: ctx.lineCap,
					lineJoin: ctx.lineJoin,
					miterLimit: ctx.miterLimit,
					lineDash: ctx.getLineDash(),
					lineDashOffset: ctx.lineDashOffset,
					globalAlpha: ctx.globalAlpha,
					globalCompositeOperation: ctx.globalCompositeOperation,
					filter: ctx.filter,
					shadowColor: ctx.shadowColor,
					shadowBlur: ctx.shadowBlur,
					shadowOffsetX: ctx.shadowOffsetX,
					shadowOffsetY: ctx.shadowOffsetY,
				},
			});
		},
	);
	check(
		difference(traced.pixels, expected).max === 0,
		"Original text/ring observer changed pixels",
	);
	const canvas = document.createElement("canvas"),
		ctx = canvas.getContext("2d")!;
	try {
		const replayed = await captureTitleRiff(source, resources, index, {
			mutate: (plan) => {
				for (const command of plan.commands) {
					const draws =
						command.kind === "surface" ? command.commands : [command];
					for (const draw of draws) {
						const isRing =
							draw.kind === "path" &&
							draw.path.some(
								(step) =>
									step.kind === "arc" &&
									step.radius >= 300 &&
									step.radius <= 400,
							) &&
							draw.paints.some(
								(paint) => paint.kind === "stroke" && paint.width === 6,
							);
						if (!isRing && (draw.kind !== "text" || draw.fontSize !== 1000))
							continue;
						ctx.setTransform(...draw.transform);
						for (const operation of draw.operations ?? []) {
							if (operation.kind === "translate")
								ctx.translate(...operation.offset);
							else if (operation.kind === "scale")
								ctx.scale(...operation.factors);
							else if (operation.kind === "copyTransform")
								ctx.setTransform(ctx.getTransform());
							else ctx.rotate(operation.radians);
						}
						const m = ctx.getTransform();
						if (isRing) {
							rings.native.push({
								surface: command.kind === "surface" ? command.id : "root",
								command: structuredClone(draw),
								computedTransform: [m.a, m.b, m.c, m.d, m.e, m.f],
							});
							continue;
						}
						if (draw.kind !== "text")
							throw Error("Expected traced native text or ring");
						native.push({
							text: draw.text,
							position: draw.position,
							transform: [m.a, m.b, m.c, m.d, m.e, m.f],
							alpha: draw.opacity,
						});
					}
				}
			},
		});
		check(
			difference(replayed, actual).max === 0,
			"Native plan observer changed pixels",
		);
		const boundaries = await traceTitleRiffRingBoundaries(
			source,
			resources,
			index,
			beforeRingPixels,
			afterRingPixels,
		);
		return {
			original,
			native,
			rings,
			...boundaries,
			scheduling: await traceTitleRiffScheduling(
				source,
				resources,
				index,
				actual,
				expected,
			),
			observedPixelsExact: true,
		};
	} finally {
		canvas.width = canvas.height = 1;
	}
}
