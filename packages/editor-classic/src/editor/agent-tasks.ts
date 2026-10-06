import {
	isEditorTaskRequest,
	type EditorTaskRequest,
} from "@opencut/editor-contracts";
import type { EditorCore } from "../core";
import { extractTimelineAudio } from "../media/mediabunny";
import { decodeAudioToFloat32 } from "../media/audio";
import { DEFAULT_TRANSCRIPTION_SAMPLE_RATE } from "../transcription/audio";
import { TRANSCRIPTION_LANGUAGES } from "../transcription/supported-languages";
import { TRANSCRIPTION_MODELS } from "../transcription/models";
import { buildCaptionChunks } from "../transcription/caption";
import { parseSubtitleFile } from "../subtitles/parse";
import { planAgentCaptions } from "../subtitles/agent-plan";

/** Session-owned execution; HTTP adapters transport tasks but cannot write native state. */
export function createEditorTaskRunner({
	editor,
	audio = { extract: extractTimelineAudio, decode: decodeAudioToFloat32 },
}: {
	editor: EditorCore;
	/** Platform codec seam; production uses the editor's existing audio pipeline. */
	audio?: {
		extract: typeof extractTimelineAudio;
		decode: typeof decodeAudioToFloat32;
	};
}) {
	let busy = false;
	return {
		async run({
			request,
			signal,
			onProgress,
		}: {
			request: EditorTaskRequest;
			signal: AbortSignal;
			onProgress?: (progress: unknown) => void;
		}) {
			if (!isEditorTaskRequest(request)) throw new Error("invalid-editor-task");
			if (busy) throw new Error("editor-task-busy");
			const projectId = editor.project.getActive().metadata.id;
			busy = true;
			const assertCurrent = async () => {
				signal.throwIfAborted();
				if (
					editor.project.getActiveOrNull()?.metadata.id !== projectId ||
					Number(await editor.transactions.revision()) !==
						request.expectedRevision
				) {
					throw new Error("revision-conflict");
				}
				if (
					"sceneId" in request &&
					editor.scenes.getActiveScene().id !== request.sceneId
				) {
					throw new Error("scene-conflict");
				}
			};
			try {
				await editor.command.whenIdle();
				await assertCurrent();
				if (
					request.kind === "history.undo" ||
					request.kind === "history.redo"
				) {
					await editor.command.travelHistory({
						direction: request.kind === "history.undo" ? "undo" : "redo",
						expectedRevision: request.expectedRevision,
					});
					return {
						revision: Number(await editor.transactions.revision()),
						canUndo: editor.command.canUndo(),
						canRedo: editor.command.canRedo(),
					};
				}
				if (request.kind === "history.status") {
					return {
						revision: request.expectedRevision,
						canUndo: editor.command.canUndo(),
						canRedo: editor.command.canRedo(),
						count: editor.command.getHistoryCount(),
						scope: "attached-session",
					};
				}
				let parsed;
				if (request.kind === "captions.import") {
					parsed = parseSubtitleFile(request);
				} else if (request.kind === "captions.transcribe") {
					const model =
						request.modelId === undefined
							? undefined
							: TRANSCRIPTION_MODELS.find(
									(entry) => entry.id === request.modelId,
								);
					const language =
						request.language === undefined || request.language === "auto"
							? undefined
							: TRANSCRIPTION_LANGUAGES.find(
									(entry) => entry.code === request.language,
								);
					if (request.modelId !== undefined && !model)
						throw new Error("unknown-transcription-model");
					if (request.language && request.language !== "auto" && !language)
						throw new Error("unknown-transcription-language");
					onProgress?.({ step: "extracting-audio" });
					const audioBlob = await audio.extract({
						tracks: editor.scenes.getActiveScene().tracks,
						mediaAssets: editor.media.getAssets(),
						totalDuration: editor.timeline.getTotalDuration(),
						resources: editor.resources,
					});
					await assertCurrent();
					const { samples } = await audio.decode({
						audioBlob,
						sampleRate: DEFAULT_TRANSCRIPTION_SAMPLE_RATE,
						resources: editor.resources,
					});
					await assertCurrent();
					const result = await editor.transcription.transcribe({
						audioData: samples,
						language: language?.code,
						modelId: model?.id,
						signal,
						onProgress,
					});
					parsed = {
						captions: buildCaptionChunks({ segments: result.segments }),
						warnings: [],
						skippedCueCount: 0,
					};
				} else throw new Error("unsupported-editor-task");
				await assertCurrent();
				const batch = planAgentCaptions({
					editor,
					captions: parsed.captions,
					...request,
				});
				return {
					...parsed,
					sourceRevision: request.expectedRevision,
					sceneId: request.sceneId,
					batch,
				};
			} finally {
				busy = false;
			}
		},
	};
}
