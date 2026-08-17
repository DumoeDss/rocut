/**
 * @opencutSurface provider — the composed-frame proof (S07 agent verification primitive)
 */
// Declared entry "./frame-proof" (S07: "agent verification obtains
// composed-frame proof locally"). Deterministic by construction — pure TS,
// no wasm, no DOM, no clocks: the frame at a tick is described as a canonical
// composition (canvas, ordered visible elements with timing/geometry/params,
// referenced asset identities) and digested with SHA-256 over the canonical
// JSON. The same project revision at the same tick yields the same digest on
// every machine, so an agent can assert "the frame at t is exactly what I
// composed" without a renderer.
//
// What this proves — and honestly does not: the COMPOSITION (what is on the
// frame, in what order, with what geometry, text content and asset
// identities). It does not prove rasterization: decoded media pixels, fonts
// and effects render only in the pane; agents keep directing users there for
// pixel-level confirmation. Frame math is plain integer arithmetic over
// TICKS_PER_SECOND (the wasm module's constant, mirrored here) — no wasm
// dependency keeps this entry loadable wherever the store loads.
import type { ProjectId } from "@opencut/editor-ports";
import type { TProject } from "./project/types";
import type { TScene, TimelineTrack } from "./timeline/types";
import type { MediaAsset } from "./media/types";

/** Mirrors the wasm module's `TICKS_PER_SECOND` (media_time.rs). */
export const TICKS_PER_SECOND = 120_000;

export interface FrameProofAssetEntry {
	readonly id: string;
	readonly kind: "image" | "video" | "audio" | "file";
	readonly name: string;
	readonly duration?: number;
	readonly width?: number;
	readonly height?: number;
}

export interface FrameProofElement {
	readonly id: string;
	readonly type: string;
	readonly trackId: string;
	readonly z: number;
	readonly startTime: number;
	readonly duration: number;
	readonly trimStart: number;
	readonly trimEnd: number;
	readonly mediaId?: string;
	readonly params: unknown;
}

export interface FrameProofDescription {
	readonly schemaVersion: 1;
	readonly projectId: ProjectId;
	readonly projectName: string;
	readonly frameRate: { readonly numerator: number; readonly denominator: number };
	readonly canvas: { readonly width: number; readonly height: number };
	readonly background: unknown;
	readonly at: number;
	readonly frameIndex: number;
	readonly elements: readonly FrameProofElement[];
	readonly assets: readonly FrameProofAssetEntry[];
}

export interface FrameProof {
	readonly revision: number | null;
	readonly description: FrameProofDescription;
	readonly digest: string;
}

/** Canonical JSON: object keys sorted, arrays order-preserving, dates as ISO. */
export function canonicalize(value: unknown): unknown {
	if (value instanceof Date) return { __date: value.toISOString() };
	if (Array.isArray(value)) return value.map(canonicalize);
	if (typeof value === "object" && value !== null) {
		const source = Object.entries(value);
		const record: Record<string, unknown> = {};
		for (const [key, entry] of source.sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0,
		)) {
			record[key] = canonicalize(entry);
		}
		return record;
	}
	return value;
}

/**
 * The frame index a tick falls on. Plain integer arithmetic — identical to
 * the wasm `mediaTimeToFrame` for in-range values, without the module.
 */
export function frameIndexAt(args: {
	readonly at: number;
	readonly frameRate: { readonly numerator: number; readonly denominator: number };
}): number {
	const ticksPerFrame =
		(TICKS_PER_SECOND * args.frameRate.denominator) /
		args.frameRate.numerator;
	return Math.floor(args.at / ticksPerFrame);
}

function activeTracks(args: {
	readonly scenes: readonly TScene[];
	readonly currentSceneId: string;
}): readonly TimelineTrack[] {
	const scene = args.scenes.find(
		(candidate) => candidate.id === args.currentSceneId,
	);
	if (scene === undefined) return [];
	const { main, overlay, audio } = scene.tracks;
	return [...overlay, main, ...audio];
}

/**
 * Compose the frame at a tick: the elements whose [startTime, startTime +
 * duration) contains the tick, on visible tracks, z-ordered bottom-up by
 * track position (overlay, then main, then audio — the editor's own
 * stacking), with timing, geometry params and referenced asset identities.
 *
 * Ordering and every id comparison are codepoint-stable (never
 * `localeCompare`) so the digest cannot vary by machine locale.
 */
export function composeFrameDescription(args: {
	readonly project: TProject;
	readonly assets: readonly FrameProofAssetEntry[];
	readonly at: number;
}): FrameProofDescription {
	const tracks = activeTracks({
		scenes: args.project.scenes,
		currentSceneId: args.project.currentSceneId,
	});
	const elements: FrameProofElement[] = [];
	let z = 0;
	const referencedAssets = new Map<string, FrameProofAssetEntry>();
	const knownAssets = new Map(
		args.assets.map((asset) => [asset.id, asset] as const),
	);
	for (const track of tracks) {
		if ("hidden" in track && track.hidden) continue;
		const trackElements = [...track.elements]
			.filter((element) => {
				if ("hidden" in element && element.hidden) return false;
				return (
					element.startTime <= args.at &&
					args.at < element.startTime + element.duration
				);
			})
			.sort((left, right) => {
				if (left.startTime !== right.startTime) {
					return left.startTime - right.startTime;
				}
				return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
			});
		for (const element of trackElements) {
			const mediaId =
				"mediaId" in element &&
				typeof (element as { mediaId?: unknown }).mediaId === "string"
					? (element as { mediaId: string }).mediaId
					: undefined;
			if (mediaId !== undefined && !referencedAssets.has(mediaId)) {
				const known = knownAssets.get(mediaId);
				referencedAssets.set(
					mediaId,
					known ?? {
						id: mediaId,
						kind: "file",
						name: mediaId,
					},
				);
			}
			elements.push({
				id: element.id,
				type: element.type,
				trackId: track.id,
				z,
				startTime: element.startTime,
				duration: element.duration,
				trimStart: element.trimStart,
				trimEnd: element.trimEnd,
				...(mediaId === undefined ? {} : { mediaId }),
				params: canonicalize("params" in element ? element.params : {}),
			});
			z += 1;
		}
	}
	return {
		schemaVersion: 1,
		projectId: args.project.metadata.id,
		projectName: args.project.metadata.name,
		frameRate: {
			numerator: args.project.settings.fps.numerator,
			denominator: args.project.settings.fps.denominator,
		},
		canvas: {
			width: args.project.settings.canvasSize.width,
			height: args.project.settings.canvasSize.height,
		},
		background: canonicalize(args.project.settings.background),
		at: args.at,
		frameIndex: frameIndexAt({
			at: args.at,
			frameRate: args.project.settings.fps,
		}),
		elements,
		assets: [...referencedAssets.values()].sort((left, right) =>
			left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
		),
	};
}

/** SHA-256 over the canonical JSON of a composed frame description. */
export async function digestFrameDescription(
	description: FrameProofDescription,
): Promise<string> {
	const bytes = new TextEncoder().encode(
		JSON.stringify(canonicalize(description)),
	);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/** The composed-frame proof in one call: description + digest. */
export async function frameProof(args: {
	readonly project: TProject;
	readonly assets: readonly FrameProofAssetEntry[];
	readonly at: number;
	readonly revision?: number;
}): Promise<FrameProof> {
	const description = composeFrameDescription({
		project: args.project,
		assets: args.assets,
		at: args.at,
	});
	return {
		revision: args.revision ?? null,
		description,
		digest: await digestFrameDescription(description),
	};
}

/** Adapt the editor's media assets into the proof's asset entries. */
export function frameProofAssetsFromMedia(
	assets: readonly MediaAsset[],
): FrameProofAssetEntry[] {
	return assets.map((asset) => ({
		id: asset.id,
		kind: asset.type,
		name: asset.name,
		...(asset.duration !== undefined && { duration: asset.duration }),
		...(asset.width !== undefined && { width: asset.width }),
		...(asset.height !== undefined && { height: asset.height }),
	}));
}

/**
 * Compose the proof straight off a persisted editor-plane record (the
 * `./transactions` entry's file format): decode the payload, compose the
 * frame, digest. Hosts and offline CLIs share this one path.
 */
export async function frameProofFromRecord(args: {
	readonly record: { readonly data: unknown };
	readonly assets: readonly FrameProofAssetEntry[];
	readonly at: number;
	readonly revision?: number;
}): Promise<FrameProof> {
	const { decodeProject } = await import(
		"./editor/persistence/project-codec"
	);
	return frameProof({
		project: decodeProject(args.record.data),
		assets: args.assets,
		at: args.at,
		...(args.revision === undefined ? {} : { revision: args.revision }),
	});
}
