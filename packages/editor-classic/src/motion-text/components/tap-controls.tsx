"use client";

import type { MotionTextSequence } from "@opencut/editor-contracts";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { useEditor, useEditorInstance } from "../../editor/use-editor";
import { MOTION_TEXT_RENDERER_SUPPORT } from "../../services/renderer/motion-text/support-manifest";
import type { MotionTextElement } from "../../timeline";
import {
	mapMotionTextClipTimeValue,
	mutateMotionTextSequence,
	resolveMotionTextBeatGrid,
	snapMotionTextTimeToBeat,
	TICKS_PER_SECOND,
	type MotionTextSequenceBuildDiagnostic,
} from "../../wasm";

const TAP_SNAP_DISTANCE = Math.round(TICKS_PER_SECOND * 0.15);

function diagnosticMessage(
	diagnostics: readonly MotionTextSequenceBuildDiagnostic[],
): string {
	return (
		diagnostics.find((entry) => entry.severity === "error")?.message ??
		diagnostics[0]?.message ??
		"The tapped cue timing could not be applied."
	);
}

function formatTime(time: number): string {
	return `${(time / TICKS_PER_SECOND).toFixed(3)}s`;
}

export function MotionTextTapControls({
	sequence,
	element,
	selectedCueId,
	onSelectCue,
	onMessage,
}: {
	readonly sequence: MotionTextSequence;
	readonly element: MotionTextElement;
	readonly selectedCueId: string | null;
	readonly onSelectCue: (cueId: string) => void;
	readonly onMessage: (message: string | null) => void;
}) {
	const editor = useEditorInstance();
	const playheadTime = useEditor((currentEditor) =>
		currentEditor.playback.getCurrentTime(),
	);
	const [startCueId, setStartCueId] = useState<string | null>(null);
	const [tapTimes, setTapTimes] = useState<readonly number[]>([]);
	const [snapEnabled, setSnapEnabled] = useState(false);
	const [isApplying, setIsApplying] = useState(false);
	const applyingRef = useRef(false);
	const beginRef = useRef<HTMLButtonElement>(null);
	const pendingFocusRef = useRef<HTMLButtonElement | null>(null);
	const [baseRevision, setBaseRevision] = useState(sequence.revision);
	// External edits invalidate an unfinished tapping session without replacing
	// the control tree (which would strand keyboard focus after Apply).
	if (baseRevision !== sequence.revision) {
		setBaseRevision(sequence.revision);
		setStartCueId(null);
		setTapTimes([]);
	}
	useLayoutEffect(() => {
		const action = pendingFocusRef.current;
		if (isApplying || !action) return;
		pendingFocusRef.current = null;
		const active = action.ownerDocument.activeElement;
		if (active === action.ownerDocument.body || active === action) {
			const target = beginRef.current ?? action;
			if (target.isConnected) target.focus({ preventScroll: true });
		}
	});
	const startIndex =
		startCueId === null
			? -1
			: sequence.cues.findIndex((cue) => cue.id === startCueId);
	const nextCue =
		startIndex < 0
			? null
			: (sequence.cues[startIndex + tapTimes.length] ?? null);
	const beatGrid = useMemo(() => {
		const binding = sequence.audioBinding;
		if (!binding) return null;
		try {
			return resolveMotionTextBeatGrid({
				duration: sequence.duration,
				detectedBpm: binding.analysis?.bpm ?? null,
				detectedFirstBeat: binding.analysis?.firstBeat ?? null,
				sourceOffset: binding.sourceOffset,
				bpmOverride: binding.beatOverride?.bpm ?? null,
				firstBeatOverride: binding.beatOverride?.firstBeat ?? null,
			}).grid;
		} catch {
			return null;
		}
	}, [sequence.audioBinding, sequence.duration]);
	const canSnap =
		beatGrid?.bpm !== null &&
		beatGrid?.bpm !== undefined &&
		beatGrid.firstBeat !== null;

	const begin = () => {
		const cueId =
			selectedCueId !== null &&
			sequence.cues.some((cue) => cue.id === selectedCueId)
				? selectedCueId
				: sequence.cues[0]?.id;
		if (!cueId) return;
		onMessage(null);
		setStartCueId(cueId);
		setTapTimes([]);
		onSelectCue(cueId);
	};

	const recordTap = () => {
		if (!nextCue) return;
		onMessage(null);
		let sequenceTime: number;
		try {
			const mapped = mapMotionTextClipTimeValue({
				options: {
					clipStartTime: element.startTime,
					clipDuration: element.duration,
					trimStart: element.trimStart,
					timelineTime: playheadTime,
					sequenceDuration: sequence.duration,
				},
			});
			if (!mapped.active || mapped.sequenceTime === null) {
				onMessage(
					"Move the playhead inside this motion-text clip before tapping.",
				);
				return;
			}
			sequenceTime = mapped.sequenceTime;
		} catch (error) {
			onMessage(
				error instanceof Error
					? error.message
					: "The playhead could not be mapped into the sequence.",
			);
			return;
		}
		if (
			snapEnabled &&
			canSnap &&
			beatGrid?.bpm &&
			beatGrid.firstBeat !== null
		) {
			const snapped = snapMotionTextTimeToBeat({
				time: sequenceTime,
				bpm: beatGrid.bpm,
				firstBeat: beatGrid.firstBeat,
				maxDistance: TAP_SNAP_DISTANCE,
			});
			if (snapped.error) {
				onMessage(snapped.error);
				return;
			}
			sequenceTime = snapped.time;
		}
		const previous = tapTimes.at(-1);
		if (previous !== undefined && sequenceTime <= previous) {
			onMessage("Each tap must be later than the previous tap.");
			return;
		}
		const nextTimes = [...tapTimes, sequenceTime];
		setTapTimes(nextTimes);
		const followingCue = sequence.cues[startIndex + nextTimes.length];
		if (followingCue) onSelectCue(followingCue.id);
	};

	const undoTap = () => {
		if (tapTimes.length === 0 || startIndex < 0) return;
		const nextTimes = tapTimes.slice(0, -1);
		setTapTimes(nextTimes);
		const cue = sequence.cues[startIndex + nextTimes.length];
		if (cue) onSelectCue(cue.id);
		onMessage(null);
	};

	const cancel = (button: HTMLButtonElement) => {
		if (applyingRef.current) return;
		pendingFocusRef.current = button;
		setStartCueId(null);
		setTapTimes([]);
		onMessage(null);
	};

	const apply = async (button: HTMLButtonElement) => {
		if (startCueId === null || tapTimes.length === 0 || applyingRef.current) return;
		applyingRef.current = true;
		setIsApplying(true);
		onMessage(null);
		try {
			const mutated = mutateMotionTextSequence({
				sequence,
				mutation: {
					kind: "apply-cue-taps",
					startCueId,
					tapTimes,
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
			setStartCueId(null);
			setTapTimes([]);
			onMessage("Tapped cue timing applied as one project transaction.");
		} catch (error) {
			onMessage(
				error instanceof Error
					? error.message
					: "The tapped cue timing could not be applied.",
			);
		} finally {
			applyingRef.current = false;
			pendingFocusRef.current = button;
			setIsApplying(false);
		}
	};

	return (
		<section className="space-y-2 border-b px-3 py-3">
			<div className="flex items-baseline justify-between gap-2">
				<h3 className="text-sm font-medium">Manual cue tapping</h3>
				{startCueId !== null && (
					<span className="text-muted-foreground text-[11px] tabular-nums">
						{tapTimes.length} recorded
					</span>
				)}
			</div>
			{startCueId === null ? (
				<Button
					ref={beginRef}
					variant="outline"
					size="sm"
					className="h-auto min-h-7 w-full whitespace-normal"
					disabled={sequence.cues.length === 0}
					onClick={begin}
				>
					{selectedCueId
						? "Start tapping from selected cue"
						: "Start tapping from first cue"}
				</Button>
			) : (
				<>
					<p className="text-muted-foreground text-xs">
						{nextCue
							? `Next: ${nextCue.text || "Interlude"}`
							: "All remaining cues have a tap."}
					</p>
					{tapTimes.length > 0 && (
						<p className="text-muted-foreground text-[11px] tabular-nums">
							Last tap {formatTime(tapTimes.at(-1) ?? 0)}
						</p>
					)}
					<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2">
						<Button
							variant="outline"
							size="sm"
							aria-pressed={snapEnabled}
							disabled={!canSnap || isApplying}
							onClick={() => setSnapEnabled((value) => !value)}
						>
							Beat snap {snapEnabled ? "on" : "off"}
						</Button>
						<Button
							size="sm"
							disabled={!nextCue || isApplying}
							onClick={recordTap}
						>
							Tap current cue
						</Button>
					</div>
					<div className="flex flex-wrap justify-end gap-2">
						<Button variant="ghost" size="sm" disabled={isApplying} onClick={(event) => cancel(event.currentTarget)}>
							Cancel
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={tapTimes.length === 0 || isApplying}
							onClick={undoTap}
						>
							Undo last tap
						</Button>
						<Button
							size="sm"
							disabled={tapTimes.length === 0 || isApplying}
							onClick={(event) => void apply(event.currentTarget)}
						>
							{isApplying ? "Applying…" : "Apply taps"}
						</Button>
					</div>
				</>
			)}
		</section>
	);
}
