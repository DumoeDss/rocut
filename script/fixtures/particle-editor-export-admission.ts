import { isProgrammaticSource } from "@opencut/editor-contracts";
import { decodeProject } from "../../packages/editor-classic/src/editor/persistence/project-codec";
import type { TimelineElement } from "../../packages/editor-classic/src/timeline/types";

function check(value: unknown, message: string): asserts value {
	if (!value) throw Error(`Final UI project export: ${message}`);
}

export function admitFinalUiProject(input: unknown) {
	check(input && typeof input === "object", "persisted wrapper required");
	const wrapper = input as {
		wrapperVersion?: unknown;
		record?: { id?: unknown; schemaVersion?: unknown; data?: unknown };
	};
	check(
		wrapper.wrapperVersion === 1 && wrapper.record?.schemaVersion === 32,
		"FileProjectStore schema mismatch",
	);
	const project = decodeProject(wrapper.record.data);
	check(
		project.metadata.id === wrapper.record.id && project.version === 32,
		"record identity mismatch",
	);
	check(project.scenes.length === 1, "exact single saved scene required");
	const scene = project.scenes.find(
		(value) => value.id === project.currentSceneId,
	);
	check(scene && scene.isMain, "saved active scene missing");
	const elements = [
		...scene.tracks.overlay,
		scene.tracks.main,
		...scene.tracks.audio,
	].flatMap<TimelineElement>((track) => track.elements);
	check(
		elements.length === 1 && elements[0].id === "particle-model",
		"saved clip set differs",
	);
	const clip = elements[0];
	check(
		clip.type === "graphic" &&
			clip.definitionId === "programmatic" &&
			isProgrammaticSource(clip.programmatic),
		"saved source missing",
	);
	check(
		clip.programmatic.runtime === "html-document" &&
			clip.programmatic.build?.engine === "three" &&
			clip.programmatic.build.capabilities?.join() === "particle-surface-v1",
		"saved archived particle source required",
	);
	check(
		clip.params.opacity === 0.55,
		"must consume the real final UI opacity, not replay or substitute it",
	);
	check(
		clip.startTime === 0 &&
			clip.duration === 484000 &&
			clip.trimStart === 0 &&
			clip.trimEnd === 0 &&
			clip.programmatic.durationFrames === 121,
		"complete unchanged clip duration required",
	);
	check(
		project.metadata.duration === 484000,
		"complete saved timeline duration required",
	);
	check(
		project.settings.canvasSize.width === 1920 &&
			project.settings.canvasSize.height === 1080,
		"cannot resize the saved project",
	);
	check(
		project.settings.fps.numerator === 30 &&
			project.settings.fps.denominator === 1,
		"saved FPS must be 30/1",
	);
	check(
		project.settings.background.type === "color" &&
			project.settings.background.color === "#000000",
		"saved black background required",
	);
	check(
		clip.programmatic.audio === undefined &&
			scene.tracks.audio.length === 0 &&
			project.motionTextSequences.length === 0,
		"this fixture does not certify audio or motion-text",
	);
	return { project, scene, clip };
}
