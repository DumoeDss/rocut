import type { TransitionClip, TransitionLink } from "opencut-wasm";
import { mediaTimeFromSeconds } from "../../wasm";
import type { TimelineTrack } from "../../timeline";
import type { MediaAsset } from "../../media/types";
import type { AnyBaseNode } from "./nodes/base-node";
import { BlurBackgroundNode } from "./nodes/blur-background-node";
import { VideoNode } from "./nodes/video-node";
import { ImageNode } from "./nodes/image-node";
import { TransitionTrackNode } from "./nodes/transition-track-node";

export function pictureClipId(node: AnyBaseNode): string | undefined {
	return node instanceof VideoNode ||
		node instanceof ImageNode ||
		node instanceof BlurBackgroundNode
		? node.params.clipId
		: undefined;
}

/** Serialize the complete track, including hidden endpoints, for Rust validation. */
export function groupTransitionTrack({
	track,
	mediaMap,
	children,
}: {
	track: TimelineTrack;
	mediaMap: ReadonlyMap<string, MediaAsset>;
	children: AnyBaseNode[];
}): AnyBaseNode[] {
	const clips: TransitionClip[] = [];
	const links: TransitionLink[] = [];
	const visibleClipIds = new Set<string>();
	for (const element of track.elements) {
		if (element.type !== "video" && element.type !== "image") continue;
		if (!element.hidden) visibleClipIds.add(element.id);
		if (element.transitionIn)
			links.push({
				outgoingClipId: element.transitionIn.outgoingClipId,
				incomingClipId: element.id,
				durationFrames: element.transitionIn.durationFrames,
			});
		const media = mediaMap.get(element.mediaId);
		if (!media || media.type !== element.type) continue;
		clips.push({
			id: element.id,
			trackId: track.id,
			start: element.startTime,
			duration: element.duration,
			source:
				element.type === "image"
					? { type: "image" }
					: {
							type: "video",
							trimStart: element.trimStart,
							sourceDuration: mediaTimeFromSeconds({
								seconds: media.duration ?? 0,
							}),
							playbackRate: element.retime?.rate ?? 1,
							freezeFrame: element.freezeFrame,
						},
		});
	}
	if (!links.length) return children;
	const node = new TransitionTrackNode({ clips, links, visibleClipIds });
	for (const child of children) node.add(child);
	return [node];
}
