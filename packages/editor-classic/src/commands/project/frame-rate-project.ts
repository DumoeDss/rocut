import { planFrameGrid, type FrameRate } from "opencut-wasm";
import { TransactionError } from "@opencut/editor-contracts";
import type { MediaAsset } from "../../media/types";
import type { TProject } from "../../project/types";
import type { TimelineTrack, TimelineElement } from "../../timeline/types";
import { mediaTime, mediaTimeFromSeconds } from "../../wasm/media-time";

/** Serialization only: Rust owns rounding, source bounds and collapse refusal. */
export function projectOnFrameGrid({
	project,
	assets,
	fps,
}: {
	project: TProject;
	assets: readonly MediaAsset[];
	fps: FrameRate;
}): TProject {
	const media = new Map(assets.map((asset) => [asset.id, asset]));
	const sequences = new Map<string, NonNullable<TProject["motionTextSequences"]>[number]>(
		(project.motionTextSequences ?? []).map((sequence) => [
			sequence.id,
			sequence,
		]),
	);
	const elements = project.scenes.flatMap((scene) =>
		[
			scene.tracks.main,
			...scene.tracks.overlay,
			...scene.tracks.audio,
		].flatMap<TimelineElement>((track) => track.elements),
	);
	const markers = project.scenes.flatMap((scene) =>
		scene.bookmarks.map((bookmark) => bookmark.time),
	);
	const result = planFrameGrid({
		frameRate: fps,
		markers,
		clips: elements.map((element) => {
			const asset =
				"mediaId" in element ? media.get(element.mediaId) : undefined;
			const sourceDuration =
				element.type === "motion-text"
					? sequences.get(element.sequenceId)?.duration
					: asset &&
						  (asset.type === "video" || asset.type === "audio") &&
						  asset.duration !== undefined
						? mediaTimeFromSeconds({ seconds: asset.duration })
						: undefined;
			return {
				id: element.id,
				start: element.startTime,
				duration: element.duration,
				trimStart: element.trimStart,
				trimEnd: element.trimEnd,
				sourceDuration,
				playbackRate:
					element.type === "video" || element.type === "audio"
						? (element.retime?.rate ?? 1)
						: 1,
				freezeFrame: element.type === "video" ? element.freezeFrame : undefined,
			};
		}),
	});
	if (result.status === "rejected") {
		throw new TransactionError({ code: "validation", message: result.reason });
	}
	const timing = new Map(result.clips.map((clip) => [clip.id, clip]));
	const mapTrack = <T extends TimelineTrack>(track: T): T => ({
		...track,
		elements: track.elements.map((element) => {
			const planned = timing.get(element.id);
			if (!planned) throw new Error("Frame-rate plan omitted a clip");
			return {
				...element,
				startTime: mediaTime({ ticks: planned.start }),
				duration: mediaTime({ ticks: planned.duration }),
				trimStart: mediaTime({ ticks: planned.trimStart }),
				trimEnd: mediaTime({ ticks: planned.trimEnd }),
			};
		}),
	});
	let markerIndex = 0;
	return {
		...project,
		scenes: project.scenes.map((scene) => {
			return {
				...scene,
				tracks: {
					main: mapTrack(scene.tracks.main),
					overlay: scene.tracks.overlay.map((track) => mapTrack(track)),
					audio: scene.tracks.audio.map((track) => mapTrack(track)),
				},
				bookmarks: scene.bookmarks.map((bookmark) => ({
					...bookmark,
					time: mediaTime({ ticks: result.markers[markerIndex++] }),
				})),
			};
		}),
	};
}
