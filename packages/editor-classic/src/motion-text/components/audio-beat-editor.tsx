"use client";

import type { MotionTextSequence } from "@opencut/editor-contracts";
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { useEditorInstance } from "../../editor/use-editor";
import { MOTION_TEXT_RENDERER_SUPPORT } from "../../services/renderer/motion-text/support-manifest";
import {
	mutateMotionTextSequence,
	resolveMotionTextBeatGrid,
	TICKS_PER_SECOND,
	type MotionTextSequenceBuildDiagnostic,
} from "../../wasm";

interface ParsedOverrides {
	readonly bpm: number | null;
	readonly firstBeat: number | null;
	readonly error: string | null;
}

function diagnosticMessage(
	diagnostics: readonly MotionTextSequenceBuildDiagnostic[],
): string {
	return (
		diagnostics.find((entry) => entry.severity === "error")?.message ??
		diagnostics[0]?.message ??
		"The manual beat override could not be updated."
	);
}

function parseOverrides({
	bpmText,
	firstBeatText,
}: {
	readonly bpmText: string;
	readonly firstBeatText: string;
}): ParsedOverrides {
	const bpm = bpmText.trim() === "" ? null : Number(bpmText);
	const firstBeatSeconds =
		firstBeatText.trim() === "" ? null : Number(firstBeatText);
	if (bpm !== null && (!Number.isFinite(bpm) || bpm < 20 || bpm > 400)) {
		return {
			bpm: null,
			firstBeat: null,
			error: "Manual BPM must be between 20 and 400.",
		};
	}
	if (
		firstBeatSeconds !== null &&
		(!Number.isFinite(firstBeatSeconds) || firstBeatSeconds < 0)
	) {
		return {
			bpm,
			firstBeat: null,
			error: "Manual first beat must be a non-negative sequence time.",
		};
	}
	return {
		bpm,
		firstBeat:
			firstBeatSeconds === null
				? null
				: Math.round(firstBeatSeconds * TICKS_PER_SECOND),
		error: null,
	};
}

export function MotionTextBeatOverrideEditor({
	sequence,
	onMessage,
}: {
	readonly sequence: MotionTextSequence;
	readonly onMessage: (message: string | null) => void;
}) {
	const editor = useEditorInstance();
	const binding = sequence.audioBinding;
	const initialBpm = binding?.beatOverride?.bpm?.toString() ?? "";
	const initialFirstBeat =
		binding?.beatOverride?.firstBeat === undefined
			? ""
			: (binding.beatOverride.firstBeat / TICKS_PER_SECOND).toString();
	const [bpmText, setBpmText] = useState(initialBpm);
	const [firstBeatText, setFirstBeatText] = useState(initialFirstBeat);
	const [isApplying, setIsApplying] = useState(false);
	const parsed = parseOverrides({ bpmText, firstBeatText });
	const isDirty = bpmText !== initialBpm || firstBeatText !== initialFirstBeat;
	const grid = useMemo(() => {
		if (!binding || parsed.error) return null;
		try {
			return resolveMotionTextBeatGrid({
				duration: sequence.duration,
				detectedBpm: binding.analysis?.bpm ?? null,
				detectedFirstBeat: binding.analysis?.firstBeat ?? null,
				sourceOffset: binding.sourceOffset,
				bpmOverride: parsed.bpm,
				firstBeatOverride: parsed.firstBeat,
			}).grid;
		} catch {
			return null;
		}
	}, [binding, parsed.bpm, parsed.error, parsed.firstBeat, sequence.duration]);

	if (!binding) return null;

	const apply = async ({
		bpm,
		firstBeat,
	}: {
		readonly bpm: number | null;
		readonly firstBeat: number | null;
	}) => {
		if (isApplying) return;
		setIsApplying(true);
		onMessage(null);
		try {
			const mutated = mutateMotionTextSequence({
				sequence,
				mutation: {
					kind: "set-audio-beat-override",
					bpm,
					firstBeat,
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
			onMessage(
				bpm === null && firstBeat === null
					? "Manual tempo cleared; detected values are active."
					: "Manual tempo saved as one project transaction.",
			);
		} catch (error) {
			onMessage(
				error instanceof Error
					? error.message
					: "The manual beat override could not be updated.",
			);
		} finally {
			setIsApplying(false);
		}
	};

	return (
		<div className="bg-muted/30 space-y-2 rounded-sm border p-2.5">
			<div className="flex items-baseline justify-between gap-2">
				<span className="text-xs font-medium">Beat grid</span>
				{grid && (
					<span className="text-muted-foreground text-[11px] tabular-nums">
						{grid.beats.length} beats · {grid.bpmSource} BPM
					</span>
				)}
			</div>
			<div className="grid grid-cols-2 gap-2">
				<div className="space-y-1.5">
					<Label htmlFor={`motion-text-bpm-${sequence.id}`}>Manual BPM</Label>
					<Input
						id={`motion-text-bpm-${sequence.id}`}
						type="number"
						min="20"
						max="400"
						step="0.1"
						placeholder={binding.analysis?.bpm?.toFixed(1) ?? "Detected"}
						value={bpmText}
						onChange={(event) => setBpmText(event.target.value)}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor={`motion-text-first-beat-${sequence.id}`}>
						First beat (sequence sec)
					</Label>
					<Input
						id={`motion-text-first-beat-${sequence.id}`}
						type="number"
						min="0"
						step="0.001"
						placeholder={
							grid?.firstBeat === null || grid?.firstBeat === undefined
								? "Detected"
								: (grid.firstBeat / TICKS_PER_SECOND).toFixed(3)
						}
						value={firstBeatText}
						onChange={(event) => setFirstBeatText(event.target.value)}
					/>
				</div>
			</div>
			{parsed.error && (
				<p className="text-destructive text-xs" role="alert">
					{parsed.error}
				</p>
			)}
			<div className="flex justify-end gap-2">
				{binding.beatOverride && (
					<Button
						variant="ghost"
						size="sm"
						disabled={isApplying}
						onClick={() => void apply({ bpm: null, firstBeat: null })}
					>
						Use detected
					</Button>
				)}
				<Button
					size="sm"
					disabled={!isDirty || parsed.error !== null || isApplying}
					onClick={() =>
						void apply({ bpm: parsed.bpm, firstBeat: parsed.firstBeat })
					}
				>
					{isApplying ? "Applying…" : "Apply tempo"}
				</Button>
			</div>
		</div>
	);
}
