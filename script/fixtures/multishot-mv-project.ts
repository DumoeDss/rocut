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

export const multishotTicks = (frame: number) =>
	mediaTime({ ticks: frame * 4800 });

export function multishotProject(
	sources: Record<string, ProgrammaticSource>,
	version: number,
): TProject {
	const created = createStarterMotionTextSequence({
		sequenceId: "multishot-lyrics",
		source: "[00:00.00]SYNC\n[00:02.00]BEAT\n[00:04.00]GLOW",
		sourceFormat: "lrc",
		language: "en",
		duration: 720000,
		seed: 7,
		starterPreset: "clean-caption",
		rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
	});
	if (!created.sequence)
		throw Error(`Lyric factory: ${JSON.stringify(created.diagnostics)}`);
	let sequence = created.sequence;
	for (const group of ["enter", "exit"] as const) {
		const result = mutateMotionTextSequence({
			sequence,
			mutation: { kind: "apply-preset", group, presetId: "cut" },
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
		});
		if (!result.sequence)
			throw Error(`Lyric cut: ${JSON.stringify(result.diagnostics)}`);
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
		throw Error(`Lyric style: ${JSON.stringify(styled.diagnostics)}`);
	const duration = multishotTicks(150),
		zero = multishotTicks(0);
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
			id: "multishot-mv",
			name: "Multishot integration MV",
			duration,
			createdAt: date,
			updatedAt: date,
		},
		version,
		currentSceneId: "scene",
		motionTextSequences: [styled.sequence],
		settings: {
			fps: { numerator: 25, denominator: 1 },
			canvasSize: { width: 160, height: 90 },
			background: { type: "color", color: "#000000" },
		},
		scenes: [
			{
				id: "scene",
				name: "Three native shots",
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
					audio: [
						{
							id: "ordinary",
							name: "Ordinary soundtrack",
							type: "audio",
							muted: false,
							elements: [
								{
									id: "ordinary-clip",
									name: "Local synthetic harmony",
									type: "audio",
									sourceType: "library",
									sourceUrl: "/api/ordinary.wav",
									startTime: multishotTicks(25),
									duration: multishotTicks(100),
									trimStart: mediaTime({ ticks: 15000 }),
									trimEnd: mediaTime({ ticks: 15000 }),
									params: {},
								},
							],
						},
					],
					overlay: [
						track("foreground", graphic("foreground-clip", sources.recipe)),
						track("lyrics", {
							type: "motion-text",
							id: "lyrics-clip",
							name: "Native lyrics",
							sequenceId: styled.sequence.id,
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
