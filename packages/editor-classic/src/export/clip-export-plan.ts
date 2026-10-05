import { planClipExports, type ExportClipSelection } from "opencut-wasm";
import type { EditorCore } from "../core";
import type { SessionResourceLifecycle } from "../editor/session/session-resources";

function hasActivityGuard(
	resources: EditorCore["resources"],
): resources is EditorCore["resources"] &
	Pick<
		SessionResourceLifecycle,
		"getActivityGeneration" | "assertActivityGeneration"
	> {
	return (
		"getActivityGeneration" in resources &&
		typeof resources.getActivityGeneration === "function" &&
		"assertActivityGeneration" in resources &&
		typeof resources.assertActivityGeneration === "function"
	);
}

/** Adapt UI state to the Rust planner; never edit or temporarily solo the timeline. */
export function prepareClipExports({
	editor,
	selection,
}: {
	editor: EditorCore;
	selection: ExportClipSelection;
}) {
	const project = editor.project.getActive();
	const scene = editor.scenes.getActiveScene();
	const tracks = scene.tracks;
	const resources = editor.resources;
	if (!hasActivityGuard(resources))
		throw new Error("Clip export requires session lifecycle guards");
	const generation = resources.getActivityGeneration();
	const plan = planClipExports({
		selection,
		timelineDuration: editor.timeline.getTotalDuration(),
		clips: [tracks.main, ...tracks.overlay, ...tracks.audio].flatMap((track) =>
			track.elements.map((clip) => ({
				reference: { trackId: track.id, elementId: clip.id },
				name: clip.name,
				trackName: track.name,
				mediaId: "mediaId" in clip ? clip.mediaId : undefined,
				startTime: clip.startTime,
				duration: clip.duration,
			})),
		),
	});
	if (plan.error) throw new Error(plan.error);
	return {
		clips: plan.clips,
		fps: project.settings.fps,
		assertCurrent() {
			resources.assertActivityGeneration({ generation });
			const current = editor.project.getActiveOrNull();
			const currentScene = editor.scenes.getActiveSceneOrNull();
			if (
				current?.metadata.id !== project.metadata.id ||
				currentScene?.id !== scene.id ||
				currentScene.tracks !== tracks ||
				current.settings !== project.settings ||
				current.motionTextSequences !== project.motionTextSequences
			) {
				throw new Error(
					"The timeline changed. Close and reopen Export clips before exporting.",
				);
			}
		},
	};
}

export type PreparedClipExports = ReturnType<typeof prepareClipExports>;
