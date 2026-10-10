import type {
	MvRecipePlan,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
	ResolvedSequenceImage,
} from "@opencut/editor-contracts";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import type { ProgrammaticFrame } from "./frame";
import type { ImageDecodeAdmission } from "./image-dimensions-contract";
import {
	prepareImageAdmissions,
	snapshotImageResources,
} from "./image-dimensions-resources";
import { verifyProgrammaticFontResources } from "./font-resources";
import { resolveCanvasSequenceImages } from "./image-sequence-resources";
import { canonicalMvResourceRequest } from "./mv-canonical-frame";
import { resolveMvResourceFrame } from "./mv-resource-frame";
import type { ImagePreprocessPatch } from "./image-preprocess-patches";
import type { HeartNativeFramePacket } from "./mv-heart-native-transport";
import type { NightNativeFramePacket } from "./mv-night-native-transport";
import type { MemoriesNativeFramePacket } from "./mv-memories-native-transport";
import type { JzNativeFramePacket } from "./mv-jz-native-transport";

export interface MvNativeRasterInput {
	width: number;
	height: number;
	frame: Pick<
		ProgrammaticFrame,
		| "imageDecodeLimits"
		| "sequenceImages"
		| "sequenceLimits"
		| "tunnelFontStacks"
	> & { recipePlan: MvRecipePlan };
	resources: readonly ResolvedProgrammaticResource[];
	sequenceImages: readonly ResolvedSequenceImage[];
	imageAdmissions: readonly ImageDecodeAdmission[];
	/** Private binary side channel, never part of frame.recipePlan. */
	preparedPatches?: readonly ImagePreprocessPatch[];
	/** Actual live-owner output and transferables, never authored Recipe fields. */
	heartFrames?: readonly HeartNativeFramePacket[];
	nightFrames?: readonly NightNativeFramePacket[];
	memoriesFrames?: readonly MemoriesNativeFramePacket[];
	jzFrames?: readonly JzNativeFramePacket[];
	rasterByteLimit?: number;
	/** Private diagnostic only; never an authored ProgrammaticSource field. */
	nativePostMode?: "scene-only";
}

const ticketKind = Symbol("native-mv-admission");
export interface MvNativeRasterTicket {
	readonly [ticketKind]: true;
}
const admitted = new WeakMap<object, MvNativeRasterInput>();

/** An internal one-shot capability, not a serialized frame's claim of origin.
 * No source/code/document enters the native document. Even structurally valid
 * caller-supplied font/image facts are remeasured against our owned bytes.
 */
export async function prepareMvNativeRasterTicket({
	source,
	frame,
	resources = [],
	provider,
	signal,
	diagnosticNativePostMode,
}: {
	source: ProgrammaticSource;
	frame: ProgrammaticFrame;
	resources?: readonly ResolvedProgrammaticResource[];
	provider?: ProgrammaticFrameProvider;
	signal?: AbortSignal;
	diagnosticNativePostMode?: "scene-only";
}): Promise<MvNativeRasterTicket> {
	signal?.throwIfAborted();
	source = structuredClone(source);
	if (source.runtime !== "canvas-worker" || !source.recipe)
		throw Error("Native MV rasterization requires an authored native recipe");
	frame = canonicalMvResourceRequest(source, {
		...structuredClone(frame),
		fontMetrics: undefined,
		tunnelFontMeasurements: undefined,
		imageDimensions: undefined,
	});
	resources = snapshotImageResources(resources);
	frame = await resolveMvResourceFrame({ source, frame, resources, signal });
	if (
		!frame.recipePlan ||
		frame.fontMetricRequests?.length ||
		frame.tunnelFontByteRequests?.length ||
		frame.tunnelFontMetricRequests?.length ||
		frame.imageDimensionRequests?.length
	)
		throw Error("Native MV rasterization requires a resource-complete plan");
	const sequenceImages = await resolveCanvasSequenceImages({
		frame,
		provider,
		signal: signal ?? new AbortController().signal,
	});
	const imageAdmissions = await prepareImageAdmissions({
		source,
		frame,
		resources,
		sequenceImages,
		operation: "render",
		signal,
	});
	resources = await verifyProgrammaticFontResources({ resources, signal });
	signal?.throwIfAborted();
	const ticket = Object.freeze({ [ticketKind]: true as const });
	admitted.set(ticket, {
		width: source.width,
		height: source.height,
		frame: {
			recipePlan: frame.recipePlan,
			imageDecodeLimits: frame.imageDecodeLimits,
			sequenceImages: frame.sequenceImages,
			sequenceLimits: frame.sequenceLimits,
			tunnelFontStacks: frame.tunnelFontStacks,
		},
		resources,
		sequenceImages,
		imageAdmissions,
		...(diagnosticNativePostMode
			? { nativePostMode: diagnosticNativePostMode }
			: {}),
	});
	return ticket;
}

/** Consuming transfers exclusive ownership to the fixed raster backend. A
 * cloned, reconstructed, already consumed, or author-provided object is invalid.
 */
export function consumeMvNativeRasterTicket(
	ticket: unknown,
): MvNativeRasterInput {
	if (!ticket || typeof ticket !== "object")
		throw Error("Invalid or consumed native MV raster ticket");
	const input = admitted.get(ticket);
	if (!input) throw Error("Invalid or consumed native MV raster ticket");
	admitted.delete(ticket);
	return input;
}
