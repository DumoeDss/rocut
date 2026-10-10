import type {
	ProgrammaticSource,
	ProgrammaticResource,
	ResolvedProgrammaticResource,
	ImageSequenceManifestInput,
} from "@opencut/editor-contracts";
import { resolveProgrammaticFrame, type ProgrammaticFrame } from "./frame";
import { runProgrammaticSandbox } from "./sandbox-runtime";
import { canonicalMvResourceRequest } from "./mv-canonical-frame";
import { prepareTunnelFontPacket } from "./mv-tunnel-font-packet";
import type { TunnelFontPacket } from "./mv-tunnel-font-packet";

async function readRecipeResource({
	declared,
	resources,
	signal,
}: {
	declared: ProgrammaticResource;
	resources: readonly ResolvedProgrammaticResource[];
	signal?: AbortSignal;
}): Promise<unknown> {
	signal?.throwIfAborted();
	const matches = resources.filter((r) => r.resource.id === declared.id);
	const resolved = matches[0];
	if (
		matches.length !== 1 ||
		JSON.stringify(resolved.resource) !== JSON.stringify(declared) ||
		!(resolved.body instanceof ArrayBuffer) ||
		resolved.body.byteLength !== declared.byteLength
	)
		throw Error(
			"MV resource attachment is missing or does not match its manifest",
		);
	const body = resolved.body.slice(0);
	const sha256 = [
		...new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
	]
		.map((v) => v.toString(16).padStart(2, "0"))
		.join("");
	if (sha256 !== declared.sha256) throw Error("MV resource digest mismatch");
	signal?.throwIfAborted();
	return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}

/** Decode only verified attachments and measure declared fonts in isolation.
 * Rust jointly evaluates all facts at the original unquantized sampling instant.
 */
export async function resolveMvResourceFrame({
	source,
	frame,
	resources,
	signal,
}: {
	source: ProgrammaticSource;
	frame: ProgrammaticFrame;
	resources: readonly ResolvedProgrammaticResource[];
	signal?: AbortSignal;
}): Promise<ProgrammaticFrame> {
	signal?.throwIfAborted();
	if (source.recipe) {
		// Own the authoring snapshot across asynchronous resource IO. Resource
		// bytes are still verified/snapshotted by their existing bounded owners.
		source = structuredClone(source);
		frame = canonicalMvResourceRequest(source, structuredClone(frame));
	}
	const binding = source.recipe?.audio;
	const sequences =
		source.resources?.filter((r) => r.kind === "imageSequence") ?? [];
	if (
		!binding &&
		!sequences.length &&
		!frame.fontMetricRequests?.length &&
		!frame.tunnelFontByteRequests?.length &&
		!frame.tunnelFontMetricRequests?.length &&
		!frame.imageDimensionRequests?.length
	)
		return frame;
	let analysis: unknown;
	if (binding) {
		const declared = source.resources?.find((r) => r.id === binding.resource);
		if (!declared || declared.kind !== "analysis")
			throw Error(
				"MV audio analysis attachment is missing or does not match its manifest",
			);
		analysis = await readRecipeResource({ declared, resources, signal });
	}
	const sequenceManifests: ImageSequenceManifestInput[] = [];
	for (const declared of sequences) {
		sequenceManifests.push({
			resourceId: declared.id,
			manifest: await readRecipeResource({ declared, resources, signal }),
		});
	}
	// Dynamic text requests can depend on verified beats and remapped child
	// clocks. Discover them after analysis/manifest IO, before measuring fonts.
	const evaluation = {
		source,
		...(binding ? { analysis } : {}),
		...(sequences.length ? { sequenceManifests } : {}),
		clipStart: 0,
		clipDuration: 1,
		trimStart: frame.sampleTime ?? frame.sourceTime,
		timelineTime: 0,
	};
	let pending = resolveProgrammaticFrame(evaluation);
	if (!pending || pending.index !== frame.index)
		throw Error("Invalid resource-discovery recipe frame");
	let tunnelFontPacket: TunnelFontPacket | undefined;
	if (pending.tunnelFontByteRequests?.length) {
		if (!pending.tunnelFontLimits)
			throw Error("Tunnel font bytes require Rust native limits");
		const prepared = await prepareTunnelFontPacket({
			requests: pending.tunnelFontByteRequests,
			limits: pending.tunnelFontLimits,
			resources,
			signal,
		});
		resources = prepared.resources;
		tunnelFontPacket = prepared.packet;
		pending = resolveProgrammaticFrame({ ...evaluation, tunnelFontPacket });
		if (!pending || pending.index !== frame.index)
			throw Error("Invalid Tunnel native byte-admission frame");
	}
	const tunnelFontMeasurements = pending.tunnelFontMetricRequests?.length
		? await runProgrammaticSandbox({
				source,
				frame: pending,
				resources,
				operation: "measure-tunnel-fonts",
				signal,
			})
		: undefined;
	const measurements =
		pending.imageDimensionRequests?.length && !frame.imageDimensions
			? await runProgrammaticSandbox({
					source,
					frame: pending,
					resources,
					operation: "measure-resources",
					signal,
				})
			: undefined;
	const imageDimensions =
		frame.imageDimensions ?? measurements?.imageDimensions;
	const fontMetrics =
		frame.fontMetrics ??
		measurements?.fontMetrics ??
		(pending.fontMetricRequests?.length
			? await runProgrammaticSandbox({
					source,
					frame: pending,
					resources,
					operation: "measure-fonts",
					signal,
				})
			: undefined);
	const evaluated = resolveProgrammaticFrame({
		...evaluation,
		...(tunnelFontPacket ? { tunnelFontPacket } : {}),
		...(tunnelFontMeasurements ? { tunnelFontMeasurements } : {}),
		...(fontMetrics ? { fontMetrics } : {}),
		...(imageDimensions ? { imageDimensions } : {}),
	});
	if (!evaluated?.recipePlan || evaluated.index !== frame.index)
		throw Error("Invalid resource-resolved recipe frame");
	signal?.throwIfAborted();
	return {
		...evaluated,
		timelineTime: frame.timelineTime,
		fontMetricRequests: undefined,
		fontMetrics,
		tunnelFontByteRequests: undefined,
		tunnelFontMetricRequests: undefined,
		tunnelFontMeasurements,
		imageDimensionRequests: undefined,
		imageDimensions,
		...(sequences.length
			? {
					sequenceImages: evaluated.sequenceImages,
					sequenceLimits: evaluated.sequenceLimits,
				}
			: {}),
	};
}
