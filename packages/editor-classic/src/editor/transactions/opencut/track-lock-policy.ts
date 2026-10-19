import type {
	TransactionEngineDocument,
	TransactionEngineIssue,
	TransactionPlacementPolicy,
} from "@opencut/editor-contracts/engine";
import {
	assertTrackLockRuntime,
	trackLockValidator,
} from "./track-lock-runtime";
import type { TProject } from "../../../project/types";
import { parseEditingIssues } from "./scene-policy";

/** Serialization only. Rust owns all lock semantics and legacy defaults. */
function publicSnapshot(document: TransactionEngineDocument) {
	return {
		tracks: document.tracks.map((track) => ({
			...track,
			lane: document.project?.sceneState?.scenes.some(
				(scene) => scene.mainTrackId === track.id,
			)
				? "main"
				: track.kind === "audio"
					? "audio"
					: "overlay",
		})),
		clips: document.clips,
		assets: document.assets,
		motionTextSequences: document.motionTextSequences ?? [],
	};
}

function nativeSnapshot(project: TProject) {
	const entries = project.scenes.flatMap((scene) => [
		...scene.tracks.overlay.map((track) => ({
			track,
			sceneId: scene.id,
			lane: "overlay",
		})),
		{ track: scene.tracks.main, sceneId: scene.id, lane: "main" },
		...scene.tracks.audio.map((track) => ({
			track,
			sceneId: scene.id,
			lane: "audio",
		})),
	]);
	const clips = entries.flatMap(({ track }) =>
		track.elements.map((element) => ({
			...element,
			trackId: track.id,
			...("mediaId" in element && { assetId: element.mediaId }),
			...(element.type === "motion-text" && {
				content: { kind: "motion-text", sequenceId: element.sequenceId },
			}),
		})),
	);
	return {
		tracks: entries.map(({ track, sceneId, lane }) => {
			const { elements: _elements, ...metadata } = track;
			return { ...metadata, sceneId, lane };
		}),
		clips,
		assets: [
			...new Set([
				...clips.flatMap((clip) =>
					"assetId" in clip && typeof clip.assetId === "string"
						? [clip.assetId]
						: [],
				),
				...(project.motionTextSequences ?? []).flatMap((sequence) => [
					...(sequence.audioBinding ? [sequence.audioBinding.assetId] : []),
					...sequence.fonts.flatMap((font) =>
						font.source === "project" && font.assetId ? [font.assetId] : [],
					),
				]),
			]),
		].map((id) => ({ id })),
		motionTextSequences: project.motionTextSequences ?? [],
	};
}

function issues(input: {
	before: { tracks: readonly { locked?: boolean }[] };
	after: { tracks: readonly { locked?: boolean }[] };
}): TransactionEngineIssue[] {
	const validator = trackLockValidator();
	if (!validator) {
		// Legacy unlocked projects remain usable. Any attempt to create/use a
		// true lock requires the native capability; no TS edit rules substitute.
		if (
			[...input.before.tracks, ...input.after.tracks].some(
				(track) => track.locked === true,
			)
		)
			assertTrackLockRuntime();
		return [];
	}
	return parseEditingIssues(validator(JSON.stringify(input))).map((issue) => ({
		code: "provider:track-locked" as const,
		message: `${issue.path}: ${issue.message}`,
	}));
}

export function assertNativeTrackLocks({
	before,
	after,
}: {
	before: TProject;
	after: TProject;
}): void {
	const rejected = issues({
		before: nativeSnapshot(before),
		after: nativeSnapshot(after),
	});
	if (rejected.length)
		throw new Error(rejected.map((issue) => issue.message).join("; "));
}

export function assertPublicTrackLocks({
	before,
	after,
}: {
	before: TransactionEngineDocument;
	after: TransactionEngineDocument;
}): void {
	const rejected = issues({
		before: publicSnapshot(before),
		after: publicSnapshot(after),
	});
	if (rejected.length)
		throw new Error(rejected.map((issue) => issue.message).join("; "));
}

/** Admission before attachment deletion, not a best-effort rollback afterward. */
export function assertMediaRemovalUnlocked({
	project,
	assetIds,
}: {
	project: TProject;
	assetIds: readonly string[];
}): void {
	const rejected = mediaRemovalIssues({ project, assetIds });
	if (rejected.length)
		throw new Error(rejected.map((issue) => issue.message).join("; "));
}

/** Ask Rust whether byte identity needs protection before hashing large bodies. */
export function mediaSourceRequiresValidation({
	project,
	assetId,
}: {
	project: TProject;
	assetId: string;
}): boolean {
	return mediaRemovalIssues({ project, assetIds: [assetId] }).length > 0;
}

function mediaRemovalIssues({
	project,
	assetIds,
}: {
	project: TProject;
	assetIds: readonly string[];
}): TransactionEngineIssue[] {
	const before = nativeSnapshot(project);
	const after = {
		...before,
		assets: before.assets.filter((asset) => !assetIds.includes(asset.id)),
	};
	return issues({ before, after });
}

/** Byte digests are supplied by the persistence boundary, never trusted metadata. */
export function assertMediaSourceUnlocked({
	project,
	assetId,
	beforeSha256,
	afterSha256,
}: {
	project: TProject;
	assetId: string;
	beforeSha256: string;
	afterSha256: string;
}): void {
	const snapshot = nativeSnapshot(project);
	const before = {
		...snapshot,
		assets: snapshot.assets.map((asset) => ({
			...asset,
			...(asset.id === assetId && { sourceSha256: beforeSha256 }),
		})),
	};
	const after = {
		...snapshot,
		assets: snapshot.assets.map((asset) => ({
			...asset,
			...(asset.id === assetId && { sourceSha256: afterSha256 }),
		})),
	};
	const rejected = issues({ before, after });
	if (rejected.length)
		throw new Error(rejected.map((issue) => issue.message).join("; "));
}

export const openCutTrackLockPolicy: TransactionPlacementPolicy = {
	requiresPreviousDocument: true,
	evaluate(context) {
		if (!context.previousDocument)
			throw new Error("Track lock admission requires the pre-edit document");
		return issues({
			before: publicSnapshot(context.previousDocument),
			after: publicSnapshot(context.document),
		});
	},
};
