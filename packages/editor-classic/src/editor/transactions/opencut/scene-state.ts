import type { Marker } from "@opencut/editor-contracts";
import type { TransactionEngineDocument } from "@opencut/editor-contracts/engine";
import type { TProject } from "../../../project/types";
import type {
	Bookmark,
	SceneTracks,
	TimelineTrack,
	TScene,
} from "../../../timeline/types";

/** Only relative order inside a scene's overlay/audio lane affects the native editor. */
export function projectTrackOrder(
	document: Pick<TransactionEngineDocument, "project" | "tracks">,
) {
	return (
		document.project?.sceneState?.scenes.map((scene) => ({
			id: scene.id,
			overlay: document.tracks
				.filter(
					(track) =>
						track.sceneId === scene.id &&
						track.id !== scene.mainTrackId &&
						track.kind !== "audio",
				)
				.map((track) => track.id),
			audio: document.tracks
				.filter((track) => track.sceneId === scene.id && track.kind === "audio")
				.map((track) => track.id),
		})) ?? document.tracks.map((track) => track.id)
	);
}

/** Native/public serialization only; topology policy is implemented in Rust. */
export function overlaySceneState({
	project,
	document,
	tracks,
	overlayMarkers,
}: {
	project: TProject;
	document: TransactionEngineDocument;
	tracks: ReadonlyMap<string, TimelineTrack>;
	overlayMarkers: (
		current: readonly Bookmark[],
		markers: readonly Marker[],
	) => Bookmark[];
}): void {
	const topology = document.project?.sceneState;
	if (!topology) throw new Error("Native editing requires scene topology");
	const previous = new Map(project.scenes.map((scene) => [scene.id, scene]));
	const previousTrackScene = new Map(
		project.scenes.flatMap((scene) =>
			[scene.tracks.main, ...scene.tracks.overlay, ...scene.tracks.audio].map(
				(track) => [track.id, scene.id] as const,
			),
		),
	);
	project.scenes = topology.scenes.map((descriptor) => {
		const old = previous.get(descriptor.id);
		const selected = document.tracks.filter(
			(track) =>
				(track.sceneId ??
					previousTrackScene.get(track.id) ??
					topology.currentSceneId) === descriptor.id,
		);
		const main = tracks.get(descriptor.mainTrackId);
		if (
			!main ||
			main.type !== "video" ||
			!selected.some((track) => track.id === main.id)
		) {
			throw new Error("Each scene requires its own canonical video main track");
		}
		const sceneTracks: SceneTracks = {
			main,
			overlay: selected
				.filter((track) => track.id !== main.id && track.kind !== "audio")
				.map((track) => tracks.get(track.id))
				.filter(
					(track): track is SceneTracks["overlay"][number] =>
						track !== undefined && track.type !== "audio",
				),
			audio: selected
				.filter((track) => track.kind === "audio")
				.map((track) => tracks.get(track.id))
				.filter(
					(track): track is SceneTracks["audio"][number] =>
						track?.type === "audio",
				),
		};
		return {
			...old,
			id: descriptor.id,
			name: descriptor.name,
			isMain: descriptor.isMain,
			createdAt: old?.createdAt ?? new Date(),
			updatedAt: old?.updatedAt ?? new Date(),
			tracks: sceneTracks,
			bookmarks: overlayMarkers(
				old?.bookmarks ?? [],
				document.markers.filter(
					(marker) =>
						(marker.sceneId ?? topology.currentSceneId) === descriptor.id,
				),
			),
		} satisfies TScene;
	});
	project.currentSceneId = topology.currentSceneId;
}
