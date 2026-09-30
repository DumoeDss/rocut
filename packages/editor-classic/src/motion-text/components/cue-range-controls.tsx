"use client";

import type {
	MotionTextCue,
	MotionTextSequence,
} from "@opencut/editor-contracts";
import type { MotionTextElement } from "../../timeline";
import { Button } from "../../components/ui/button";
import { useEditor, useEditorInstance } from "../../editor/use-editor";
import { TICKS_PER_SECOND } from "../../wasm";
import { resolveMotionTextCueTimelineRange } from "../cue-timeline-range";

function sameRange({
	startTime,
	endTime,
	range,
}: {
	readonly startTime: number | null;
	readonly endTime: number | null;
	readonly range: { readonly startTime: number; readonly endTime: number };
}): boolean {
	return startTime === range.startTime && endTime === range.endTime;
}

export function MotionTextCueRangeControls({
	element,
	sequence,
	cue,
	onMessage,
}: {
	readonly element: MotionTextElement;
	readonly sequence: MotionTextSequence;
	readonly cue: MotionTextCue;
	readonly onMessage: (message: string | null) => void;
}) {
	const editor = useEditorInstance();
	const loopRangeStart = useEditor(
		(current) => current.playback.getLoopRange()?.startTime ?? null,
	);
	const loopRangeEnd = useEditor(
		(current) => current.playback.getLoopRange()?.endTime ?? null,
	);
	const exportRangeStart = useEditor(
		(current) => current.project.getExportRange()?.startTime ?? null,
	);
	const exportRangeEnd = useEditor(
		(current) => current.project.getExportRange()?.endTime ?? null,
	);
	let range = null;
	try {
		range = resolveMotionTextCueTimelineRange({ element, sequence, cue });
	} catch {
		range = null;
	}
	if (!range) {
		return (
			<p className="text-muted-foreground border-b px-3 py-2 text-xs">
				This cue is outside the visible part of the clip.
			</p>
		);
	}

	const isLooping = sameRange({
		startTime: loopRangeStart,
		endTime: loopRangeEnd,
		range,
	});
	const isExportingRange = sameRange({
		startTime: exportRangeStart,
		endTime: exportRangeEnd,
		range,
	});
	return (
		<div
			className="bg-muted/20 space-y-2 border-b px-3 py-2.5"
			data-motion-text-cue-range="true"
			data-range-start={range.startTime}
			data-range-end={range.endTime}
		>
			<p className="text-muted-foreground text-[11px] tabular-nums">
				Timeline {(range.startTime / TICKS_PER_SECOND).toFixed(2)}s –{" "}
				{(range.endTime / TICKS_PER_SECOND).toFixed(2)}s
			</p>
			<div className="grid grid-cols-2 gap-2">
				<Button
					variant={isLooping ? "default" : "outline"}
					size="sm"
					onClick={() => {
						onMessage(null);
						try {
							if (isLooping) {
								editor.playback.clearLoopRange();
								return;
							}
							editor.playback.setLoopRange({ range });
							editor.playback.play();
						} catch (error) {
							onMessage(
								error instanceof Error ? error.message : "Cue loop failed.",
							);
						}
					}}
				>
					{isLooping ? "Stop cue loop" : "Loop selected cue"}
				</Button>
				<Button
					variant={isExportingRange ? "default" : "outline"}
					size="sm"
					onClick={() => {
						onMessage(null);
						try {
							if (isExportingRange) {
								editor.project.clearExportRange();
								return;
							}
							editor.project.setExportRange({ range });
						} catch (error) {
							onMessage(
								error instanceof Error ? error.message : "Export range failed.",
							);
						}
					}}
				>
					{isExportingRange ? "Clear export range" : "Use cue as export range"}
				</Button>
			</div>
		</div>
	);
}
