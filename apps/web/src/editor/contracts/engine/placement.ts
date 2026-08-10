import type { Asset, Clip, Marker, Track } from "..";
import { TICKS_PER_SECOND, ticksOf } from "..";
import type { PlacementPolicyContext, TransactionEngineIssue } from "./types";

function operationIndexFor(args: {
	readonly context: PlacementPolicyContext;
	readonly ids: readonly string[];
}): number | undefined {
	const { context, ids } = args;
	const indexes = ids
		.map((id) => context.operationIndexByEntityId.get(id))
		.filter((index): index is number => index !== undefined);
	return indexes.length > 0 ? Math.max(...indexes) : undefined;
}

function issue(args: {
	readonly code: TransactionEngineIssue["code"];
	readonly message: string;
	readonly context: PlacementPolicyContext;
	readonly entityIds: readonly string[];
}): TransactionEngineIssue {
	return {
		code: args.code,
		message: args.message,
		operationIndex: operationIndexFor({
			context: args.context,
			ids: args.entityIds,
		}),
		entityIds: args.entityIds,
	};
}

function assertAligned(args: {
	readonly value: number;
	readonly ticksPerFrame: number;
	readonly entityId: string;
	readonly field: string;
	readonly context: PlacementPolicyContext;
}): TransactionEngineIssue | null {
	if (args.value % args.ticksPerFrame === 0) return null;
	return issue({
		code: "timebase-misaligned",
		message: `${args.field} on ${args.entityId} is not aligned to ${args.ticksPerFrame} ticks per frame`,
		context: args.context,
		entityIds: [args.entityId],
	});
}

function laneIsCompatible(args: {
	readonly clip: Clip;
	readonly track: Track;
	readonly asset?: Asset;
}): boolean {
	if (!args.asset) {
		return ["text", "graphic", "effect"].includes(args.track.kind);
	}
	if (args.asset.kind === "audio") return args.track.kind === "audio";
	return args.track.kind === "video" || args.track.kind === "graphic";
}

export function evaluateBasePlacementPolicy(
	context: PlacementPolicyContext,
): readonly TransactionEngineIssue[] {
	const { document } = context;
	const issues: TransactionEngineIssue[] = [];
	const tracks = new Map(document.tracks.map((track) => [track.id, track]));
	const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
	const ticksPerFrame =
		document.project === null
			? null
			: (TICKS_PER_SECOND * document.project.frameRate.denominator) /
				document.project.frameRate.numerator;
	for (const clip of document.clips) {
		if (ticksOf(clip.duration) <= 0) {
			issues.push(
				issue({
					code: "non-positive-duration",
					message: `Clip ${clip.id} must have positive duration`,
					context,
					entityIds: [clip.id],
				}),
			);
		}
		if (ticksPerFrame !== null) {
			for (const [field, value] of [
				["startTime", ticksOf(clip.startTime)],
				["duration", ticksOf(clip.duration)],
				["trimStart", ticksOf(clip.trimStart)],
				["trimEnd", ticksOf(clip.trimEnd)],
			] as const) {
				const alignmentIssue = assertAligned({
					value,
					ticksPerFrame,
					entityId: clip.id,
					field,
					context,
				});
				if (alignmentIssue) issues.push(alignmentIssue);
			}
		} else {
			issues.push(
				issue({
					code: "timebase-misaligned",
					message: `Clip ${clip.id} requires a project with a validated frame rate`,
					context,
					entityIds: [clip.id],
				}),
			);
		}

		const track = tracks.get(clip.trackId);
		if (!track) {
			issues.push(
				issue({
					code: "missing-relation",
					message: `Clip ${clip.id} references missing track ${clip.trackId}`,
					context,
					entityIds: [clip.id, clip.trackId],
				}),
			);
			continue;
		}
		const asset =
			clip.assetId === undefined ? undefined : assets.get(clip.assetId);
		if (clip.assetId !== undefined && !asset) {
			issues.push(
				issue({
					code: "missing-relation",
					message: `Clip ${clip.id} references missing asset ${clip.assetId}`,
					context,
					entityIds: [clip.id, clip.assetId],
				}),
			);
			continue;
		}
		if (!laneIsCompatible({ clip, track, asset })) {
			issues.push(
				issue({
					code: "lane-incompatible",
					message: `Clip ${clip.id} is incompatible with track ${track.id}`,
					context,
					entityIds: asset
						? [clip.id, track.id, asset.id]
						: [clip.id, track.id],
				}),
			);
		}
		if (
			asset?.duration !== undefined &&
			ticksOf(clip.trimStart) + ticksOf(clip.duration) + ticksOf(clip.trimEnd) >
				ticksOf(asset.duration)
		) {
			issues.push(
				issue({
					code: "source-out-of-bounds",
					message: `Clip ${clip.id} exceeds source duration for asset ${asset.id}`,
					context,
					entityIds: [clip.id, asset.id],
				}),
			);
		}
	}

	const byTrack = new Map<string, Clip[]>();
	for (const clip of document.clips) {
		const entries = byTrack.get(clip.trackId) ?? [];
		entries.push(clip);
		byTrack.set(clip.trackId, entries);
	}
	for (const clips of byTrack.values()) {
		const sorted = [...clips].sort(
			(left, right) =>
				ticksOf(left.startTime) - ticksOf(right.startTime) ||
				String(left.id).localeCompare(String(right.id)),
		);
		for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
			const left = sorted[leftIndex];
			const leftEnd = ticksOf(left.startTime) + ticksOf(left.duration);
			for (
				let rightIndex = leftIndex + 1;
				rightIndex < sorted.length;
				rightIndex += 1
			) {
				const right = sorted[rightIndex];
				if (ticksOf(right.startTime) >= leftEnd) break;
				const rightEnd = ticksOf(right.startTime) + ticksOf(right.duration);
				if (ticksOf(left.startTime) < rightEnd) {
					issues.push(
						issue({
							code: "collision",
							message: `Clips ${left.id} and ${right.id} overlap on track ${left.trackId}`,
							context,
							entityIds: [left.id, right.id, left.trackId],
						}),
					);
				}
			}
		}
	}

	for (const marker of document.markers as readonly Marker[]) {
		if (ticksPerFrame !== null) {
			const alignmentIssue = assertAligned({
				value: ticksOf(marker.time),
				ticksPerFrame,
				entityId: marker.id,
				field: "time",
				context,
			});
			if (alignmentIssue) issues.push(alignmentIssue);
		} else {
			issues.push(
				issue({
					code: "timebase-misaligned",
					message: `Marker ${marker.id} requires a project with a validated frame rate`,
					context,
					entityIds: [marker.id],
				}),
			);
		}
	}

	return issues;
}
