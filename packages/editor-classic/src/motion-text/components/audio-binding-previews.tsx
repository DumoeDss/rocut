"use client";

import type { MotionTextSequence } from "@opencut/editor-contracts";
import { Button } from "../../components/ui/button";
import type { MotionTextAudioAnalysisCacheValue } from "../../services/motion-text-audio-analysis/service";
import { TICKS_PER_SECOND } from "../../wasm";
import { hasMotionTextLock } from "../lock-state";

export interface MotionTextAudioTimingPreview {
	readonly baseRevision: number;
	readonly sequence: MotionTextSequence;
	readonly clipId: string;
	readonly movedCueCount: number;
	readonly preservedCueCount: number;
	readonly previousSourceOffset: number;
	readonly nextSourceOffset: number;
}

function cueTimingMatches({
	before,
	after,
}: {
	readonly before: MotionTextSequence["cues"][number];
	readonly after: MotionTextSequence["cues"][number] | undefined;
}): boolean {
	return (
		after !== undefined &&
		before.startTime === after.startTime &&
		before.duration === after.duration
	);
}

export function createMotionTextAudioTimingPreview({
	before,
	after,
	clipId,
}: {
	readonly before: MotionTextSequence;
	readonly after: MotionTextSequence;
	readonly clipId: string;
}): MotionTextAudioTimingPreview {
	const afterCues = new Map(after.cues.map((cue) => [cue.id, cue]));
	const protectedCues = before.cues.filter(
		(cue) =>
			cue.timingSource === "manual" ||
			cue.timingSource === "tap" ||
			hasMotionTextLock({ cue, scope: "cue", key: "all" }),
	);
	if (
		protectedCues.some(
			(cue) => !cueTimingMatches({ before: cue, after: afterCues.get(cue.id) }),
		)
	) {
		throw new Error(
			"The audio timing candidate changed a manual, tapped, or fully locked cue.",
		);
	}
	return {
		baseRevision: before.revision,
		sequence: after,
		clipId,
		movedCueCount: before.cues.filter(
			(cue) => !cueTimingMatches({ before: cue, after: afterCues.get(cue.id) }),
		).length,
		preservedCueCount: protectedCues.length,
		previousSourceOffset: before.audioBinding?.sourceOffset ?? 0,
		nextSourceOffset:
			after.audioBinding?.sourceOffset ??
			before.audioBinding?.sourceOffset ??
			0,
	};
}

export function MotionTextAudioEnergyPreview({
	analysis,
}: {
	readonly analysis: MotionTextAudioAnalysisCacheValue;
}) {
	const energy = analysis.analysis.energy;
	const step = Math.max(1, Math.ceil(energy.length / 48));
	const bars: number[] = [];
	for (let index = 0; index < energy.length; index += step) {
		let maximum = 0;
		for (
			let sample = index;
			sample < Math.min(energy.length, index + step);
			sample++
		) {
			maximum = Math.max(maximum, energy[sample] ?? 0);
		}
		bars.push(maximum);
	}
	return (
		<div
			className="bg-muted flex h-10 items-end gap-px overflow-hidden rounded-sm px-1 py-1"
			aria-label="Analyzed audio energy preview"
		>
			{bars.map((value, index) => (
				<span
					// The downsampled position is the stable identity for this derived preview.
					key={index}
					className="bg-foreground/60 min-h-px flex-1 rounded-[1px]"
					style={{ height: `${Math.max(2, value * 100)}%` }}
				/>
			))}
		</div>
	);
}

export function MotionTextAudioTimingPreviewPanel({
	preview,
	isApplying,
	onCancel,
	onApply,
}: {
	readonly preview: MotionTextAudioTimingPreview;
	readonly isApplying: boolean;
	readonly onCancel: (trigger: HTMLButtonElement) => void;
	readonly onApply: (trigger: HTMLButtonElement) => void;
}) {
	return (
		<div
			className="border-caution/50 bg-muted space-y-1.5 rounded-sm border px-2.5 py-2"
			data-testid="motion-text-audio-sync-preview"
		>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h4 className="text-xs font-medium">Timing preview</h4>
				<span className="text-caution text-[11px]">Preview only</span>
			</div>
			<p className="text-muted-foreground text-xs">
				{preview.movedCueCount === 0 ? (
					<>No derived cue timing needs to move.</>
				) : (
					<>
						{preview.movedCueCount} derived{" "}
						{preview.movedCueCount === 1 ? "cue" : "cues"} will move.
					</>
				)}{" "}
				{preview.preservedCueCount} manual, tapped, or fully locked{" "}
				{preview.preservedCueCount === 1 ? "cue stays" : "cues stay"} unchanged.
			</p>
			<p className="text-muted-foreground text-[11px] tabular-nums">
				Source offset{" "}
				{(preview.previousSourceOffset / TICKS_PER_SECOND).toFixed(3)}s →{" "}
				{(preview.nextSourceOffset / TICKS_PER_SECOND).toFixed(3)}s
			</p>
			<p className="text-muted-foreground text-[11px]">
				Project unchanged until apply.
			</p>
			<div className="flex flex-wrap justify-end gap-2 pt-0.5 [&>button]:h-auto [&>button]:min-h-7 [&>button]:max-w-full [&>button]:whitespace-normal">
				<Button
					variant="ghost"
					size="sm"
					disabled={isApplying}
					onClick={(event) => onCancel(event.currentTarget)}
				>
					Cancel preview
				</Button>
				<Button
					size="sm"
					disabled={isApplying}
					onClick={(event) => onApply(event.currentTarget)}
				>
					{isApplying ? "Applying…" : "Apply sync"}
				</Button>
			</div>
		</div>
	);
}
