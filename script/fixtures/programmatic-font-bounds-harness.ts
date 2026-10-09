import type { ProgrammaticResource } from "@opencut/editor-contracts";
import type {
	FontBoundsRequest,
	FontMeasurement,
	FontMetricRequest,
} from "../../packages/editor-classic/src/services/renderer/programmatic/font-metrics-contract";
import { FONT_METRICS_WORKER_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/font-metrics-worker";

export const boundsResource = (id = "bounds"): ProgrammaticResource => ({
	id,
	kind: "font",
	attachmentKey: "bounds.ttf",
	mimeType: "font/ttf",
	byteLength: 4,
	sha256: "a".repeat(64),
	font: { family: id, weight: 900, style: "normal", axes: { TEST: 700 } },
});
export const boundsRequest = (
	change: Partial<FontBoundsRequest> = {},
): FontBoundsRequest => ({
	version: 1,
	text: "残",
	fontSizePx: 1000,
	letterSpacingPx: 0,
	align: "left",
	baseline: "alphabetic",
	...change,
});
export const boundsMetrics = (
	bounds: readonly FontBoundsRequest[] = [boundsRequest()],
	id = "bounds",
): FontMetricRequest => ({ resource: boundsResource(id), glyphs: [], bounds });

export function boundsHarness(
	options: {
		tracking?: boolean;
		context?: boolean;
		ignoreAlign?: boolean;
		throws?: boolean;
		extents?: readonly number[];
	} = {},
) {
	const calls: { text: string; state: Record<string, unknown> }[] = [];
	const sizes: number[] = [];
	const ctx: Record<string, unknown> = {
		...(options.tracking === false ? {} : { letterSpacing: "0px" }),
		measureText(text: string) {
			calls.push({ text, state: { ...ctx } });
			if (options.throws) throw Error("bounds fixture failure");
			const v =
				options.extents ?? (text === "" ? [0, 0, 0, 0] : [-3, 17, 19, -2]);
			return {
				width: text === "" ? 0 : 25,
				actualBoundingBoxLeft: v[0],
				actualBoundingBoxRight: v[1],
				actualBoundingBoxAscent: v[2],
				actualBoundingBoxDescent: v[3],
			};
		},
	};
	if (options.ignoreAlign)
		Object.defineProperty(ctx, "textAlign", {
			get: () => "start",
			set: () => {},
		});
	class Canvas {
		set width(value: number) {
			sizes.push(value);
		}
		set height(value: number) {
			sizes.push(value);
		}
		getContext() {
			return options.context === false ? null : ctx;
		}
	}
	const measure = new Function(
		"OffscreenCanvas",
		`${FONT_METRICS_WORKER_SOURCE}; return measureProgrammaticFonts;`,
	)(Canvas) as (
		requests: readonly FontMetricRequest[],
		descriptors: Map<string, ProgrammaticResource>,
	) => FontMeasurement[];
	return { calls, sizes, measure };
}

export const boundsDescriptors = (...ids: string[]) =>
	new Map(ids.map((id) => [id, boundsResource(id)]));
