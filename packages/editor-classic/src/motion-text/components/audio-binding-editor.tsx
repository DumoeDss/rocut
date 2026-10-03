"use client";

import type { MotionTextSequence } from "@opencut/editor-contracts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../components/ui/select";
import { useEditor, useEditorInstance } from "../../editor/use-editor";
import type { MediaAsset } from "../../media/types";
import type { MotionTextAudioAnalysisCacheValue } from "../../services/motion-text-audio-analysis/service";
import { MOTION_TEXT_RENDERER_SUPPORT } from "../../services/renderer/motion-text/support-manifest";
import type {
	AudioTrack,
	MotionTextElement,
	UploadAudioElement,
} from "../../timeline/types";
import {
	assessMotionTextAudioSync,
	mediaTimeFromSeconds,
	mutateMotionTextSequence,
	resolveMotionTextAudioClipBinding,
	TICKS_PER_SECOND,
	type MotionTextAudioSyncAssessment,
	type MotionTextSequenceBuildDiagnostic,
} from "../../wasm";
import { MotionTextBeatOverrideEditor } from "./audio-beat-editor";
import {
	MotionTextAudioEnergyPreview,
	MotionTextAudioTimingPreviewPanel,
} from "./audio-binding-previews";
import { useMotionTextAudioTimingPreview } from "./use-audio-timing-preview";

interface AudioClipChoice {
	readonly clip: UploadAudioElement;
	readonly asset: MediaAsset;
	readonly sourceDuration: number | null;
	readonly supported: boolean;
}

type OperationPhase =
	| "idle"
	| "analyzing"
	| "cancelling"
	| "applying"
	| "clearing";

interface ActiveAnalysis {
	readonly runId: number;
	readonly projectId: string;
	readonly assetId: string;
}

interface SyncPresentation {
	readonly assessment: MotionTextAudioSyncAssessment | null;
	readonly error: string | null;
}

const SYNC_LABELS: Readonly<
	Record<MotionTextAudioSyncAssessment["status"], string>
> = {
	synchronized: "Synchronized",
	unchecked: "Content not checked in this session",
	"missing-asset": "Bound audio asset is missing",
	"missing-clip": "Bound audio clip is missing",
	"asset-changed": "The bound clip now points to another asset",
	"content-changed": "Audio content changed",
	"timing-changed": "Audio clip timing changed",
};

function diagnosticMessage(
	diagnostics: readonly MotionTextSequenceBuildDiagnostic[],
): string {
	return (
		diagnostics.find((entry) => entry.severity === "error")?.message ??
		diagnostics[0]?.message ??
		"The motion-text audio binding could not be updated."
	);
}

function sourceDurationForChoice({
	clip,
	asset,
}: {
	readonly clip: UploadAudioElement;
	readonly asset: MediaAsset;
}): number | null {
	if (clip.sourceDuration !== undefined) return clip.sourceDuration;
	if (asset.duration === undefined) return null;
	return mediaTimeFromSeconds({ seconds: asset.duration });
}

function collectAudioClipChoices({
	assets,
	audioTracks,
}: {
	readonly assets: readonly MediaAsset[];
	readonly audioTracks: readonly AudioTrack[];
}): AudioClipChoice[] {
	const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
	const choices: AudioClipChoice[] = [];
	for (const track of audioTracks) {
		for (const clip of track.elements) {
			if (clip.sourceType !== "upload") continue;
			const asset = assetsById.get(clip.mediaId);
			if (!asset || asset.type !== "audio") continue;
			choices.push({
				clip,
				asset,
				sourceDuration: sourceDurationForChoice({ clip, asset }),
				supported: clip.retime === undefined,
			});
		}
	}
	return choices;
}

function resolveChoiceGeometry({
	sequence,
	element,
	choice,
}: {
	readonly sequence: MotionTextSequence;
	readonly element: MotionTextElement;
	readonly choice: AudioClipChoice;
}) {
	if (!choice.supported) {
		throw new Error(
			"Retimed audio clips cannot be bound until motion-text audio bindings support playback rate.",
		);
	}
	if (choice.sourceDuration === null) {
		throw new Error("The selected audio source has no usable duration.");
	}
	const geometry = resolveMotionTextAudioClipBinding({
		sequenceDuration: sequence.duration,
		sequenceClipStart: element.startTime,
		sequenceTrimStart: element.trimStart,
		sequenceClipDuration: element.duration,
		audioClipStart: choice.clip.startTime,
		audioClipDuration: choice.clip.duration,
		audioTrimStart: choice.clip.trimStart,
		audioSourceDuration: choice.sourceDuration,
	});
	if (geometry.sourceOffset === null || geometry.duration === null) {
		throw new Error(
			geometry.error ?? "The selected audio clip cannot cover this sequence.",
		);
	}
	return {
		sourceOffset: geometry.sourceOffset,
		duration: geometry.duration,
	};
}

export function MotionTextAudioBindingEditor({
	sequence,
	element,
	onMessage,
}: {
	readonly sequence: MotionTextSequence;
	readonly element: MotionTextElement;
	readonly onMessage: (message: string | null) => void;
}) {
	const editor = useEditorInstance();
	const projectId = useEditor(
		(currentEditor) => currentEditor.project.getActive().metadata.id,
	);
	const assets = useEditor((currentEditor) => currentEditor.media.getAssets());
	const audioTracks = useEditor(
		(currentEditor) => currentEditor.scenes.getActiveScene().tracks.audio,
	);
	const choices = useMemo(
		() => collectAudioClipChoices({ assets, audioTracks }),
		[assets, audioTracks],
	);
	const [selectedClipId, setSelectedClipId] = useState(
		sequence.audioBinding?.clipId ?? "",
	);
	const [phase, setPhase] = useState<OperationPhase>("idle");
	const analyzeButtonRef = useRef<HTMLButtonElement>(null);
	const clearedTriggerRef = useRef<HTMLButtonElement | null>(null);
	const [analysis, setAnalysis] =
		useState<MotionTextAudioAnalysisCacheValue | null>(null);
	const nextRunId = useRef(0);
	const activeAnalysis = useRef<ActiveAnalysis | null>(null);
	const cache = editor.media.getMotionTextAudioAnalysisCache();
	const {
		activePreview: activeTimingPreview,
		isApplying: isApplyingTimingPreview,
		publishPreview: publishTimingPreview,
		clearPreview: clearTimingPreview,
		cancelPreview: cancelTimingPreview,
		applyPreview: applyTimingPreview,
	} = useMotionTextAudioTimingPreview({
		sequence,
		selectedClipId,
		onMessage,
	});

	useLayoutEffect(() => {
		const trigger = clearedTriggerRef.current;
		if (phase !== "idle" || isApplyingTimingPreview || !trigger) return;
		clearedTriggerRef.current = null;
		const active = trigger.ownerDocument.activeElement;
		if (active === trigger.ownerDocument.body || active === trigger) {
			const target = trigger.isConnected ? trigger : analyzeButtonRef.current;
			target?.focus({ preventScroll: true });
		}
	});

	useEffect(() => {
		if (choices.some((choice) => choice.clip.id === selectedClipId)) return;
		const preferred = choices.find(
			(choice) => choice.clip.id === sequence.audioBinding?.clipId,
		);
		clearTimingPreview();
		setSelectedClipId(preferred?.clip.id ?? choices[0]?.clip.id ?? "");
	}, [
		choices,
		clearTimingPreview,
		selectedClipId,
		sequence.audioBinding?.clipId,
	]);

	useEffect(
		() => () => {
			nextRunId.current += 1;
			const active = activeAnalysis.current;
			activeAnalysis.current = null;
			if (active) {
				void cache.clearSource({
					projectId: active.projectId,
					assetId: active.assetId,
				});
			}
		},
		[cache, element.id, projectId, sequence.id],
	);

	const selectedChoice =
		choices.find((choice) => choice.clip.id === selectedClipId) ?? null;
	const binding = sequence.audioBinding;
	const sync = useMemo<SyncPresentation>(() => {
		if (!binding) return { assessment: null, error: null };
		const boundAsset = assets.find((asset) => asset.id === binding.assetId);
		const boundChoice = choices.find(
			(choice) => choice.clip.id === binding.clipId,
		);
		let currentSourceOffset: number | null = null;
		let currentDuration: number | null = null;
		let geometryError: string | null = null;
		if (boundChoice) {
			try {
				const geometry = resolveChoiceGeometry({
					sequence,
					element,
					choice: boundChoice,
				});
				currentSourceOffset = geometry.sourceOffset;
				currentDuration = geometry.duration;
			} catch (error) {
				geometryError =
					error instanceof Error
						? error.message
						: "Audio clip geometry could not be checked.";
			}
		}
		try {
			return {
				assessment: assessMotionTextAudioSync({
					boundAssetId: binding.assetId,
					boundClipId: binding.clipId ?? null,
					boundSourceOffset: binding.sourceOffset,
					boundDuration: binding.duration ?? null,
					boundContentDigest: binding.contentDigest ?? null,
					currentAssetId: boundChoice
						? boundChoice.asset.id
						: (boundAsset?.id ?? null),
					currentClipId: boundChoice?.clip.id ?? null,
					currentSourceOffset,
					currentDuration,
					currentContentDigest:
						analysis?.assetId === binding.assetId
							? analysis.contentDigest
							: null,
				}),
				error: geometryError,
			};
		} catch (error) {
			return {
				assessment: null,
				error:
					error instanceof Error
						? error.message
						: "Audio synchronization could not be checked.",
			};
		}
	}, [analysis, assets, binding, choices, element, sequence]);

	const selectAudioClip = (clipId: string) => {
		if (clipId !== selectedClipId) {
			clearTimingPreview();
			onMessage(null);
		}
		setSelectedClipId(clipId);
	};

	const stopAnalysis = async () => {
		const active = activeAnalysis.current;
		if (!active) return;
		nextRunId.current += 1;
		activeAnalysis.current = null;
		setPhase("cancelling");
		try {
			await cache.clearSource({
				projectId: active.projectId,
				assetId: active.assetId,
			});
			onMessage("Audio analysis cancelled and its pending work was released.");
		} catch (error) {
			onMessage(
				error instanceof Error
					? error.message
					: "Audio analysis cancellation failed.",
			);
		} finally {
			setPhase("idle");
		}
	};

	const analyzeAndBind = async () => {
		if (!selectedChoice || phase !== "idle" || isApplyingTimingPreview) return;
		clearTimingPreview();
		onMessage(null);
		let geometry: ReturnType<typeof resolveChoiceGeometry>;
		try {
			geometry = resolveChoiceGeometry({
				sequence,
				element,
				choice: selectedChoice,
			});
		} catch (error) {
			onMessage(
				error instanceof Error
					? error.message
					: "The selected audio clip cannot be bound.",
			);
			return;
		}
		const runId = (nextRunId.current += 1);
		activeAnalysis.current = {
			runId,
			projectId,
			assetId: selectedChoice.asset.id,
		};
		setPhase("analyzing");
		try {
			const result = await cache.getAnalysis({
				projectId,
				asset: selectedChoice.asset,
			});
			if (activeAnalysis.current?.runId !== runId) return;
			activeAnalysis.current = null;
			const nextAnalysis = {
				version: result.analysis.version,
				contentDigest: result.contentDigest,
				bpm: result.analysis.bpm,
				firstBeat: result.analysis.firstBeat,
			};
			if (binding) {
				const mutated = mutateMotionTextSequence({
					sequence,
					mutation: {
						kind: "sync-audio-timing",
						assetId: selectedChoice.asset.id,
						clipId: selectedChoice.clip.id,
						sourceOffset: geometry.sourceOffset,
						duration: geometry.duration,
						contentDigest: result.contentDigest,
						analysis: nextAnalysis,
					},
					rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
				});
				setAnalysis(result);
				if (!mutated.sequence) {
					onMessage(
						mutated.diagnostics.some(
							(diagnostic) => diagnostic.code === "no-changes",
						)
							? "Audio timing is already synchronized."
							: diagnosticMessage(mutated.diagnostics),
					);
					return;
				}
				publishTimingPreview({
					candidate: mutated.sequence,
					clipId: selectedChoice.clip.id,
				});
				return;
			}

			setPhase("applying");
			const mutated = mutateMotionTextSequence({
				sequence,
				mutation: {
					kind: "set-audio-binding",
					assetId: selectedChoice.asset.id,
					clipId: selectedChoice.clip.id,
					sourceOffset: geometry.sourceOffset,
					duration: geometry.duration,
					contentDigest: result.contentDigest,
					analysis: nextAnalysis,
				},
				rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			});
			if (!mutated.sequence) {
				onMessage(diagnosticMessage(mutated.diagnostics));
				return;
			}
			await editor.project.updateMotionTextSequence({
				sequence: mutated.sequence,
			});
			setAnalysis(result);
			onMessage(
				result.analysis.bpm === null
					? "Audio bound. No reliable fixed tempo was detected."
					: `Audio bound at ${result.analysis.bpm.toFixed(1)} BPM.`,
			);
		} catch (error) {
			if (nextRunId.current === runId) {
				onMessage(
					error instanceof Error
						? error.message
						: "The audio could not be analyzed and bound.",
				);
			}
		} finally {
			if (nextRunId.current === runId) {
				activeAnalysis.current = null;
				setPhase("idle");
			}
		}
	};

	const clearBinding = async (trigger: HTMLButtonElement) => {
		if (!binding || phase !== "idle" || isApplyingTimingPreview) return;
		clearedTriggerRef.current = trigger;
		clearTimingPreview();
		setPhase("clearing");
		onMessage(null);
		try {
			const mutated = mutateMotionTextSequence({
				sequence,
				mutation: { kind: "clear-audio-binding" },
				rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			});
			if (!mutated.sequence) {
				onMessage(diagnosticMessage(mutated.diagnostics));
				return;
			}
			await editor.project.updateMotionTextSequence({
				sequence: mutated.sequence,
			});
			setAnalysis(null);
			onMessage(
				"Audio binding cleared. The timeline audio clip was not removed.",
			);
		} catch (error) {
			onMessage(
				error instanceof Error
					? error.message
					: "The audio binding could not be cleared.",
			);
		} finally {
			setPhase("idle");
		}
	};

	return (
		<section className="min-w-0 space-y-2 border-b px-3 py-3">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h3 className="text-sm font-medium">Audio analysis</h3>
				{sync.assessment && (
					<span
						className={
							sync.assessment.requiresSync
								? "text-caution text-[11px]"
								: "text-muted-foreground text-[11px]"
						}
					>
						{SYNC_LABELS[sync.assessment.status]}
					</span>
				)}
			</div>
			<p className="text-muted-foreground text-xs">
				Link an existing timeline audio clip. Export continues to use that clip
				once; analysis never creates a second track.
			</p>
			{choices.length === 0 ? (
				<p className="text-muted-foreground rounded-sm border border-dashed px-2 py-3 text-center text-xs">
					Add an uploaded audio clip to this scene first.
				</p>
			) : (
				<div className="space-y-1.5">
					<Label>Timeline audio clip</Label>
					<Select
						value={selectedClipId || undefined}
						onValueChange={selectAudioClip}
						disabled={phase !== "idle" || isApplyingTimingPreview}
					>
						<SelectTrigger className="w-full" variant="outline">
							<SelectValue placeholder="Select audio clip" />
						</SelectTrigger>
						<SelectContent>
							{choices.map((choice) => (
								<SelectItem
									key={choice.clip.id}
									value={choice.clip.id}
									disabled={!choice.supported}
								>
									{choice.clip.name}
									{choice.supported ? "" : " · retimed (unsupported)"}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}
			{binding?.analysis && (
				<div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
					<span>BPM {binding.analysis.bpm?.toFixed(1) ?? "unavailable"}</span>
					<span>
						First beat{" "}
						{binding.analysis.firstBeat === undefined
							? "unavailable"
							: `${(binding.analysis.firstBeat / TICKS_PER_SECOND).toFixed(3)}s`}
					</span>
					<span>
						Offset {(binding.sourceOffset / TICKS_PER_SECOND).toFixed(3)}s
					</span>
				</div>
			)}
			{analysis && <MotionTextAudioEnergyPreview analysis={analysis} />}
			{binding && (
				<MotionTextBeatOverrideEditor
					key={sequence.id}
					sequence={sequence}
					onMessage={onMessage}
				/>
			)}
			{sync.error && (
				<p className="text-caution text-xs" role="status">
					{sync.error}
				</p>
			)}
			{activeTimingPreview && (
				<MotionTextAudioTimingPreviewPanel
					preview={activeTimingPreview}
					isApplying={isApplyingTimingPreview}
					onCancel={(trigger) => {
						clearedTriggerRef.current = trigger;
						cancelTimingPreview();
					}}
					onApply={(trigger) => {
						clearedTriggerRef.current = trigger;
						void applyTimingPreview();
					}}
				/>
			)}
			<div className="flex flex-wrap justify-end gap-2 [&>button]:h-auto [&>button]:min-h-7 [&>button]:max-w-full [&>button]:whitespace-normal">
				{binding && (
					<Button
						variant="ghost"
						size="sm"
						disabled={phase !== "idle" || isApplyingTimingPreview}
						onClick={(event) => void clearBinding(event.currentTarget)}
					>
						{phase === "clearing" ? "Clearing…" : "Clear binding"}
					</Button>
				)}
				{phase === "analyzing" || phase === "cancelling" ? (
					<Button
						variant="outline"
						size="sm"
						disabled={phase === "cancelling"}
						onClick={() => void stopAnalysis()}
					>
						{phase === "cancelling" ? "Cancelling…" : "Cancel analysis"}
					</Button>
				) : (
					<Button
						ref={analyzeButtonRef}
						size="sm"
						disabled={
							!selectedChoice || phase !== "idle" || isApplyingTimingPreview
						}
						onClick={() => void analyzeAndBind()}
					>
						{phase === "applying"
							? "Binding…"
							: binding
								? "Preview re-sync"
								: "Analyze and bind"}
					</Button>
				)}
			</div>
		</section>
	);
}
