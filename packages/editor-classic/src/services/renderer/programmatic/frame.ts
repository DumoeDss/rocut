import type {
	FrameRate,
	MvRecipePlan,
	ProgrammaticSource,
	ProgrammaticResourceLimits,
	ImageSequenceManifestInput,
	SequenceImage,
	SequenceImageLimits,
	MvTunnelFontLimits,
	MvTunnelBoundStack,
	MvTunnelMetricRequest,
	MvTunnelMeasurement,
	ProgrammaticResource,
} from "@opencut/editor-contracts";
import * as wasm from "opencut-wasm";
import type {
	FontMetricRequest,
	FontMeasurement,
} from "./font-metrics-contract";
import type {
	ImageDimensionRequest,
	ImageDimensionMeasurement,
} from "./image-dimensions-contract";
import type { TunnelFontPacket } from "./mv-tunnel-font-packet";
type TunnelResolver = (
	input: string,
	layout: string,
	bytes: Uint8Array,
) => string;
function isTunnelResolver(value: unknown): value is TunnelResolver {
	return typeof value === "function";
}

export interface ProgrammaticFrame {
	readonly index: number;
	/** Quantized source seconds. All other time fields use 120,000 ticks/second. */
	readonly time: number;
	readonly timelineTime: number;
	readonly sourceTime: number;
	/** Original unquantized source ticks across all deferred resource facts. */
	readonly sampleTime?: number;
	readonly frameRate: FrameRate;
	readonly durationFrames: number;
	readonly seed: number;
	readonly recipePlan?: MvRecipePlan;
	readonly fontMetricRequests?: readonly FontMetricRequest[];
	/** Transient platform facts retained only with this evaluated frame. */
	readonly fontMetrics?: readonly FontMeasurement[];
	readonly tunnelFontByteRequests?: readonly ProgrammaticResource[];
	readonly tunnelFontMetricRequests?: readonly MvTunnelMetricRequest[];
	readonly tunnelFontMeasurements?: readonly MvTunnelMeasurement[];
	readonly tunnelFontStacks?: readonly MvTunnelBoundStack[];
	readonly tunnelFontLimits?: MvTunnelFontLimits;
	readonly imageDimensionRequests?: readonly ImageDimensionRequest[];
	readonly imageDimensions?: readonly ImageDimensionMeasurement[];
	readonly imageDecodeLimits?: SequenceImageLimits;
	readonly sequenceImages?: readonly SequenceImage[];
	readonly sequenceLimits?: SequenceImageLimits;
	readonly resourceLimits?: ProgrammaticResourceLimits;
	readonly videoLimits?: {
		readonly maxBytes: number;
		readonly maxDimension: number;
		readonly maxElements: number;
	};
}

export function resolveProgrammaticFrame(input: {
	source: ProgrammaticSource;
	clipStart: number;
	clipDuration: number;
	trimStart: number;
	timelineTime: number;
	/** Verified analysis attachment; omitted for the initial time-only resolution. */
	analysis?: unknown;
	sequenceManifests?: readonly ImageSequenceManifestInput[];
	fontMetrics?: readonly FontMeasurement[];
	imageDimensions?: readonly ImageDimensionMeasurement[];
	tunnelFontMeasurements?: readonly MvTunnelMeasurement[];
	tunnelFontPacket?: TunnelFontPacket;
}): ProgrammaticFrame | null {
	if (typeof wasm.resolveProgrammaticFrameJson !== "function") {
		throw new Error(
			"Programmatic source requires the matching rebuilt Rocut WASM runtime",
		);
	}
	const { tunnelFontPacket, ...request } = input;
	const inputJson = JSON.stringify({
		...request,
		deferRecipe:
			(!!input.source.recipe?.audio && input.analysis === undefined) ||
			(!!input.source.resources?.some((r) => r.kind === "imageSequence") &&
				input.sequenceManifests === undefined),
	});
	let resultJson: string;
	if (tunnelFontPacket) {
		const resolve: unknown = Reflect.get(
			wasm,
			"resolveProgrammaticFrameTunnelJson",
		);
		if (!isTunnelResolver(resolve))
			throw Error(
				"Tunnel requires matching rebuilt native font-stack WASM runtime",
			);
		resultJson = resolve(
			inputJson,
			tunnelFontPacket.layout,
			tunnelFontPacket.bytes,
		);
	} else resultJson = wasm.resolveProgrammaticFrameJson(inputJson);
	const result: { frame?: ProgrammaticFrame | null; error?: string } =
		JSON.parse(resultJson);
	if (result.error) throw new Error(`Programmatic source: ${result.error}`);
	if (result.frame === undefined)
		throw new Error("Invalid programmatic frame response");
	return result.frame &&
		(input.fontMetrics || input.imageDimensions || input.tunnelFontMeasurements)
		? {
				...result.frame,
				...(input.fontMetrics ? { fontMetrics: input.fontMetrics } : {}),
				...(input.imageDimensions
					? { imageDimensions: input.imageDimensions }
					: {}),
				...(input.tunnelFontMeasurements
					? { tunnelFontMeasurements: input.tunnelFontMeasurements }
					: {}),
			}
		: result.frame;
}
