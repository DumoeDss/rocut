import { isProgrammaticSource } from "@opencut/editor-contracts";
import { decodeProject } from "../../packages/editor-classic/src/editor/persistence/project-codec";
import type {
	GraphicElement,
	TimelineElement,
} from "../../packages/editor-classic/src/timeline/types";

export type ProjectExportVariant = "original" | "timing";
export {
	PROJECT_EXPORT_LIMITS,
	projectPixelMetrics,
	acceptsProjectPixels,
} from "./particle-project-export-pixels.mjs";
export const PROJECT_TIMING_FIXTURE = Object.freeze({
	startTime: 240000,
	duration: 24000,
	trimStart: 120000,
	trimEnd: 340000,
	exportStart: 236000,
});
export function projectAssert(value: unknown, message: string): asserts value {
	if (!value) throw Error(`Particle project export: ${message}`);
}
export function admitSavedParticleProject(
	input: unknown,
	clipId: string,
	variant: ProjectExportVariant,
) {
	projectAssert(
		input && typeof input === "object",
		"missing persisted wrapper",
	);
	const wrapper = input as {
		wrapperVersion?: unknown;
		record?: { id?: unknown; schemaVersion?: unknown; data?: unknown };
	};
	projectAssert(
		wrapper.wrapperVersion === 1 && wrapper.record?.schemaVersion === 32,
		"requires actual FileProjectStore v1/schema32 record",
	);
	// This is the same production decoder called by SessionPersistenceCoordinator.loadProject.
	const project = decodeProject(wrapper.record.data);
	projectAssert(
		project.metadata.id === wrapper.record.id && project.version === 32,
		"project record identity mismatch",
	);
	projectAssert(
		project.scenes.length === 1,
		"bounded fixture accepts exactly one actual saved scene",
	);
	const scene = project.scenes.find(
		(value) => value.id === project.currentSceneId,
	);
	projectAssert(scene && scene.isMain, "saved active scene missing");
	const tracks = [
		...scene.tracks.overlay,
		scene.tracks.main,
		...scene.tracks.audio,
	];
	const elements = tracks.flatMap<TimelineElement>((track) => track.elements);
	projectAssert(
		elements.length === 1 && elements[0].id === clipId,
		"fixture must preserve its single saved clip",
	);
	const clip = elements[0];
	projectAssert(
		clip.type === "graphic" &&
			clip.definitionId === "programmatic" &&
			isProgrammaticSource(clip.programmatic),
		"saved clip is not programmatic graphic",
	);
	projectAssert(
		clip.programmatic.runtime === "html-document" &&
			clip.programmatic.build?.engine === "three" &&
			clip.programmatic.build.capabilities?.join() === "particle-surface-v1",
		"saved source lacks particle archive",
	);
	projectAssert(
		clip.programmatic.audio === undefined &&
			scene.tracks.audio.length === 0 &&
			project.motionTextSequences.length === 0,
		"bounded fixture does not certify audio or motion-text",
	);
	projectAssert(
		clip.params.opacity === 0.85,
		"must use the saved C4 opacity 0.85",
	);
	projectAssert(
		project.settings.fps.numerator === 30 &&
			project.settings.fps.denominator === 1,
		"saved project must use 30/1 fps",
	);
	projectAssert(
		project.settings.canvasSize.width === 1920 &&
			project.settings.canvasSize.height === 1080,
		"must not substitute source dimensions for saved 1920x1080 canvas",
	);
	projectAssert(
		project.settings.background.type === "color" &&
			project.settings.background.color === "#000000",
		"saved opaque black background required",
	);
	const expected =
		variant === "original"
			? { startTime: 0, duration: 484000, trimStart: 0, trimEnd: 0 }
			: PROJECT_TIMING_FIXTURE;
	for (const key of ["startTime", "duration", "trimStart", "trimEnd"] as const)
		projectAssert(
			clip[key] === expected[key],
			`unexpected saved ${variant} ${key}`,
		);
	const startTime =
		variant === "original" ? 0 : PROJECT_TIMING_FIXTURE.exportStart;
	const times = Array.from(
		{ length: 6 },
		(_, index) => startTime + index * 4000,
	);
	projectAssert(
		project.metadata.duration >= startTime + 24000,
		"saved project duration cannot cover export window",
	);
	return {
		project,
		scene,
		clip: clip as GraphicElement & {
			programmatic: NonNullable<GraphicElement["programmatic"]>;
		},
		times,
		range: { startTime, endTime: startTime + 24000, duration: 24000 },
		variant,
	};
}
