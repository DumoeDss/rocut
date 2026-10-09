import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { TProject } from "../../packages/editor-classic/src/project/types";
import type {
	GraphicElement,
	GraphicTrack,
} from "../../packages/editor-classic/src/timeline/types";
import {
	createStarterMotionTextSequence,
	mutateMotionTextSequence,
} from "../../packages/editor-classic/src/wasm/motion-text-factory";
import { MOTION_TEXT_RENDERER_SUPPORT } from "../../packages/editor-classic/src/services/renderer/motion-text/support-manifest";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";

export function mixedLyricsProject(
	sources: Record<string, ProgrammaticSource>,
	version: number,
): TProject {
	const created = createStarterMotionTextSequence({
		sequenceId: "mixed-lyrics",
		source: "[00:00.00]SYNC\n[00:00.50]BEAT",
		sourceFormat: "lrc",
		language: "en",
		duration: 120000,
		seed: 7,
		starterPreset: "clean-caption",
		rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
	});
	if (!created.sequence)
		throw Error(`Native lyric factory: ${JSON.stringify(created.diagnostics)}`);
	let sequence = created.sequence;
	for (const [group, presetId] of [
		["enter", "cut"],
		["exit", "cut"],
	] as const) {
		const result = mutateMotionTextSequence({
			sequence,
			mutation: { kind: "apply-preset", group, presetId },
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
		});
		if (!result.sequence)
			throw Error(`Native lyric preset: ${JSON.stringify(result.diagnostics)}`);
		sequence = result.sequence;
	}
	const styled = mutateMotionTextSequence({
		sequence,
		mutation: {
			kind: "update-defaults",
			font: { mode: "set", fontId: "mono" },
			colors: { mode: "set", foreground: "#ffffff", accent: "#ffffff" },
		},
		rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
	});
	if (!styled.sequence)
		throw Error(`Native lyric font: ${JSON.stringify(styled.diagnostics)}`);
	sequence = styled.sequence;
	const duration = mediaTime({ ticks: 120000 }),
		zero = mediaTime({ ticks: 0 });
	const graphic = (id: string, source: ProgrammaticSource): GraphicElement => ({
		type: "graphic",
		id,
		name: id,
		definitionId: "programmatic",
		programmatic: source,
		duration,
		startTime: zero,
		trimStart: zero,
		trimEnd: zero,
		params: {},
	});
	const track = (
		id: string,
		element: GraphicTrack["elements"][number],
	): GraphicTrack => ({
		id,
		name: id,
		type: "graphic",
		hidden: false,
		elements: [element],
	});
	const date = new Date("2026-10-08T00:00:00.000Z");
	return {
		metadata: {
			id: "mixed-engine-lyrics",
			name: "Mixed engine lyrics",
			duration,
			createdAt: date,
			updatedAt: date,
		},
		version,
		currentSceneId: "scene",
		settings: {
			fps: { numerator: 25, denominator: 1 },
			canvasSize: { width: 96, height: 96 },
			background: { type: "color", color: "#000000" },
		},
		motionTextSequences: [sequence],
		scenes: [
			{
				id: "scene",
				name: "Mixed scene",
				isMain: true,
				bookmarks: [],
				createdAt: date,
				updatedAt: date,
				tracks: {
					main: {
						id: "main",
						name: "Main",
						type: "video",
						elements: [],
						hidden: false,
						muted: false,
					},
					audio: [],
					// Overlay order is explicitly top-to-bottom; buildScene reverses it.
					overlay: [
						track("foreground", graphic("foreground-clip", sources.recipe)),
						track("lyrics", {
							type: "motion-text",
							id: "lyrics-clip",
							name: "Native lyrics",
							sequenceId: sequence.id,
							duration,
							startTime: zero,
							trimStart: zero,
							trimEnd: zero,
							params: {},
						}),
						track("remotion", graphic("remotion-clip", sources.remotion)),
						track(
							"hyperframes",
							graphic("hyperframes-clip", sources.hyperframes),
						),
					],
				},
			},
		],
	};
}
