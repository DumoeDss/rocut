import { useMemo } from "react";
import type {
	CreatorWorkspaceBridge,
	CreatorWorkspaceCommand,
} from "@opencut/editor-classic/surface";
import type { EditorCore } from "../../../packages/editor-classic/src/core";
import { CreatorTimelineSave } from "./host/creator-timeline-save";

const nativeKey = "creator-annotation-native";
const timingKey = "creator-annotation-timing";

export function annotationFixtureStart(): number {
	return Number(sessionStorage.getItem(nativeKey) ?? 60000);
}

/** The browser fixture uses the real editor/save barrier and substitutes only the Creator port. */
export function createAnnotationFixture({
	editor,
	projectId,
	sceneId,
}: {
	editor: EditorCore;
	projectId: string;
	sceneId: string;
}) {
	let rejectTiming = false;
	const originalLrc = "[00:00.50]First lyric\n[00:01.50]\n";
	return {
		probe: {
			setTimingSaveFailure: (value: boolean) => {
				rejectTiming = value;
			},
			getTimingJson: () =>
				JSON.parse(
					sessionStorage.getItem(timingKey) ??
						'{"lines":[{"text":"First lyric","manual":{"startSeconds":0.5,"endSeconds":1.5}}]}',
				),
			getOriginalLrc: () => originalLrc,
			undo: () => editor.command.undo(),
			redo: () => editor.command.redo(),
		},
		async execute(command: CreatorWorkspaceCommand) {
			if (command.type === "timeline.annotations")
				return {
					annotations: {
						status: "available" as const,
						timelineId: "timeline",
						frameRate: { numerator: 30, denominator: 1 },
						sectionsStatus: "candidate" as const,
						sections: [
							{ id: "verse", label: "Verse 1", startTick: 0, endTick: 480000 },
						],
						lyrics: [
							{
								id: "first",
								label: "First lyric",
								nodeId: "line",
								clipId: "existing-clip",
								trackId: "text-track",
								startTick: annotationFixtureStart(),
								endTick: annotationFixtureStart() + 120000,
							},
						],
					},
				};
			if (command.type !== "timeline.saved") return undefined;
			if (command.nativeProjectId !== projectId || command.sceneId !== sceneId)
				throw new Error("Unexpected Native identity");
			const saved = await editor.persistence.loadProject({ id: projectId });
			const clip = saved?.scenes
				.find((row) => row.id === sceneId)
				?.tracks.overlay.find((row) => row.id === "text-track")
				?.elements.find((row) => row.id === "existing-clip");
			if (!clip) throw new Error("Saved Native lyric is missing");
			sessionStorage.setItem(nativeKey, String(clip.startTime));
			if (rejectTiming)
				throw new Error("Timing JSON is temporarily unwritable");
			sessionStorage.setItem(
				timingKey,
				JSON.stringify({
					lines: [
						{
							text: "First lyric",
							manual: {
								startSeconds: clip.startTime / 120000,
								endSeconds: (clip.startTime + clip.duration) / 120000,
							},
						},
					],
				}),
			);
			return {};
		},
	};
}

export function AnnotationFixtureSave({
	bridge,
}: {
	bridge: CreatorWorkspaceBridge | null;
}) {
	const connection = useMemo(() => Promise.resolve(bridge), [bridge]);
	return <CreatorTimelineSave connection={connection} />;
}
