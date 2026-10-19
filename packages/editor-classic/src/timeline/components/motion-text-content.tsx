"use client";

import { useRef } from "react";
import { useEditor } from "../../editor/use-editor";
import type { MotionTextElement } from "../types";
import { resolveMotionTextCueTimelineRange } from "../../motion-text/cue-timeline-range";
import { useContainerSize } from "../../hooks/use-container-size";
import { mergeMotionTextMarkers } from "./motion-text-marker-layout";

export function MotionTextTimelineContent({
	element,
}: {
	element: MotionTextElement;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const { width } = useContainerSize({ containerRef });
	const sequence = useEditor((editor) =>
		editor.project
			.getActiveOrNull()
			?.motionTextSequences.find((entry) => entry.id === element.sequenceId),
	);
	if (!sequence)
		return (
			<div
				ref={containerRef}
				className="pointer-events-none relative size-full overflow-hidden"
			>
				<span className="truncate px-2 text-xs text-white">{element.name}</span>
			</div>
		);
	const cuesById = new Map(sequence.cues.map((cue) => [cue.id, cue]));
	const visibleCues = sequence.cues.flatMap((cue) => {
		const range = resolveMotionTextCueTimelineRange({ element, sequence, cue });
		return range ? [{ ...range, cue }] : [];
	});
	const visibleCuts = (sequence.resolvedPlan?.cuts ?? []).flatMap((cut) => {
		const cue = cuesById.get(cut.cueId);
		if (!cue) return [];
		const range = resolveMotionTextCueTimelineRange({
			element,
			sequence,
			cue: { ...cue, startTime: cut.startTime, duration: cut.duration },
		});
		return range ? [{ ...range, cut }] : [];
	});
	const geometry = {
		clipStartTime: element.startTime,
		clipDuration: element.duration,
		width,
	};
	const cueGroups = mergeMotionTextMarkers({
		...geometry,
		markers: visibleCues,
	});
	const cutGroups = mergeMotionTextMarkers({
		...geometry,
		markers: visibleCuts,
	});
	return (
		<div
			ref={containerRef}
			className="pointer-events-none relative size-full overflow-hidden"
			title={sequence.cues
				.slice(0, 12)
				.map((cue) => cue.text)
				.join(" / ")}
		>
			{cueGroups.map((range) => {
				const { cue } = range.items[0];
				return (
					<div
						key={cue.id}
						data-cue-count={range.items.length}
						className="absolute inset-y-0 flex items-center overflow-hidden border-l border-white/30 px-1 text-xs text-white"
						style={{
							left: `${((range.startTime - element.startTime) / element.duration) * 100}%`,
							width: `${((range.endTime - range.startTime) / element.duration) * 100}%`,
						}}
					>
						<span className="truncate">
							{cue.interlude ? "间奏" : cue.text}
							{range.items.length > 1 ? ` 等 ${range.items.length} 条` : ""}
						</span>
					</div>
				);
			})}
			{cutGroups.map((range) => {
				return (
					<div
						key={range.items[0].cut.id}
						data-cut-count={range.items.length}
						className="absolute inset-y-1 border-l border-dashed border-white/20"
						style={{
							left: `${((range.startTime - element.startTime) / element.duration) * 100}%`,
						}}
					/>
				);
			})}
		</div>
	);
}
