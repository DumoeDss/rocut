"use client";

import type {
	MotionTextCue,
	MotionTextResolvedCut,
	MotionTextSequence,
} from "@opencut/editor-contracts";
import { useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { useEditorInstance } from "../../editor/use-editor";
import { MOTION_TEXT_RENDERER_SUPPORT } from "../../services/renderer/motion-text/support-manifest";
import {
	mutateMotionTextSequence,
	resolveMotionTextBeatGrid,
	snapMotionTextTimeToBeat,
	TICKS_PER_SECOND,
	type MotionTextBeatGrid,
	type MotionTextSequenceBuildDiagnostic,
} from "../../wasm";
import { isMotionTextCutBoundaryLocked } from "../lock-state";

const CUT_SNAP_DISTANCE = Math.round(TICKS_PER_SECOND * 0.15);

function diagnosticMessage(
	diagnostics: readonly MotionTextSequenceBuildDiagnostic[],
): string {
	return (
		diagnostics.find((entry) => entry.severity === "error")?.message ??
		diagnostics[0]?.message ??
		"The cut boundary could not be updated."
	);
}

function CutBoundaryRow({
	sequence,
	cue,
	cut,
	nextCut,
	beatGrid,
	snapEnabled,
	onMessage,
}: {
	readonly sequence: MotionTextSequence;
	readonly cue: MotionTextCue;
	readonly cut: MotionTextResolvedCut;
	readonly nextCut: MotionTextResolvedCut;
	readonly beatGrid: MotionTextBeatGrid | null;
	readonly snapEnabled: boolean;
	readonly onMessage: (message: string | null) => void;
}) {
	const editor = useEditorInstance();
	const initialEndTime = cut.startTime + cut.duration;
	const initialEndSeconds = (initialEndTime / TICKS_PER_SECOND).toFixed(3);
	const [endSeconds, setEndSeconds] = useState(initialEndSeconds);
	const [isApplying, setIsApplying] = useState(false);
	const applyingRef = useRef(false);
	const [savedEndTime, setSavedEndTime] = useState(initialEndTime);
	if (savedEndTime !== initialEndTime) {
		setSavedEndTime(initialEndTime);
		setEndSeconds(initialEndSeconds);
	}
	const nextEndTime =
		endSeconds === initialEndSeconds
			? initialEndTime
			: Math.round(Number(endSeconds) * TICKS_PER_SECOND);
	const isDirty = nextEndTime !== initialEndTime;
	const isLocked = isMotionTextCutBoundaryLocked({
		cue,
		cutId: cut.id,
		nextCutId: nextCut.id,
	});

	const apply = async () => {
		if (applyingRef.current || isLocked || !isDirty) return;
		const seconds = Number(endSeconds);
		if (!Number.isFinite(seconds)) {
			onMessage("Cut boundary time must be a valid number.");
			return;
		}
		applyingRef.current = true;
		setIsApplying(true);
		onMessage(null);
		try {
			let endTime = nextEndTime;
			if (
				snapEnabled &&
				typeof beatGrid?.bpm === "number" &&
				typeof beatGrid.firstBeat === "number"
			) {
				const snapped = snapMotionTextTimeToBeat({
					time: endTime,
					bpm: beatGrid.bpm,
					firstBeat: beatGrid.firstBeat,
					maxDistance: CUT_SNAP_DISTANCE,
				});
				if (snapped.error) throw new Error(snapped.error);
				endTime = snapped.time;
			}
			const mutated = mutateMotionTextSequence({
				sequence,
				mutation: {
					kind: "set-cut-boundary",
					cutId: cut.id,
					endTime,
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
			onMessage("Cut boundary saved as one project transaction.");
		} catch (error) {
			onMessage(
				error instanceof Error
					? error.message
					: "The cut boundary could not be updated.",
			);
		} finally {
			applyingRef.current = false;
			setIsApplying(false);
		}
	};

	const label = cut.text || "Interlude";
	return (
		<div className="bg-muted/30 space-y-2 rounded-sm border p-2.5">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<span className="truncate text-xs font-medium">After {label}</span>
				<span className="text-muted-foreground text-[11px]">
					before {nextCut.text || "interlude"}
				</span>
			</div>
			<div className="flex flex-wrap items-end gap-2">
				<div className="min-w-0 flex-1 basis-28 space-y-1.5">
					<Label htmlFor={`motion-text-cut-end-${cut.id}`}>End (sec)</Label>
					<Input
						id={`motion-text-cut-end-${cut.id}`}
						type="number"
						min={(cut.startTime + 1) / TICKS_PER_SECOND}
						max={(nextCut.startTime + nextCut.duration - 1) / TICKS_PER_SECOND}
						step="0.001"
						value={endSeconds}
						disabled={isLocked}
						onChange={(event) => setEndSeconds(event.target.value)}
					/>
				</div>
				<Button
					size="sm"
					disabled={isLocked}
					aria-disabled={!isDirty || isLocked || isApplying}
					aria-busy={isApplying}
					className="h-auto min-h-7 max-w-full whitespace-normal aria-disabled:opacity-50"
					onClick={() => void apply()}
				>
					{isApplying ? "Applying…" : "Apply boundary"}
				</Button>
			</div>
			{isLocked && (
				<p className="text-caution text-xs">
					Clear the adjacent cut locks before moving this boundary.
				</p>
			)}
		</div>
	);
}

export function MotionTextCutTimingEditor({
	sequence,
	cue,
	onMessage,
}: {
	readonly sequence: MotionTextSequence;
	readonly cue: MotionTextCue;
	readonly onMessage: (message: string | null) => void;
}) {
	const [snapEnabled, setSnapEnabled] = useState(false);
	const cuts = useMemo(
		() =>
			(sequence.resolvedPlan?.cuts ?? [])
				.filter((cut) => cut.cueId === cue.id)
				.toSorted(
					(left, right) =>
						left.startTime - right.startTime || left.id.localeCompare(right.id),
				),
		[cue.id, sequence.resolvedPlan?.cuts],
	);
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
		typeof beatGrid?.bpm === "number" && typeof beatGrid.firstBeat === "number";

	if (cuts.length < 2) return null;

	return (
		<section className="space-y-2 border-b px-3 py-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h4 className="text-xs font-medium">Cut timing</h4>
					<p className="text-muted-foreground text-[11px]">
						Move internal boundaries without changing the cue range.
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					aria-pressed={snapEnabled}
					className="h-auto min-h-7 max-w-full whitespace-normal"
					disabled={!canSnap}
					onClick={() => setSnapEnabled((value) => !value)}
				>
					Cut beat snap {snapEnabled ? "on" : "off"}
				</Button>
			</div>
			{cuts.slice(0, -1).map((cut, index) => (
				<CutBoundaryRow
					key={cut.id}
					sequence={sequence}
					cue={cue}
					cut={cut}
					nextCut={cuts[index + 1]!}
					beatGrid={beatGrid}
					snapEnabled={snapEnabled}
					onMessage={onMessage}
				/>
			))}
		</section>
	);
}
