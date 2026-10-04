"use client";

import { useId } from "react";
import { formatTimecode } from "opencut-wasm";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PanelView } from "../components/editor/panels/assets/views/base-panel";
import type { VideoElement, ImageElement } from "../timeline";
import { useTransitionProperties } from "./use-transition-properties";

export function TransitionProperties({
	element,
	trackId,
}: {
	element: VideoElement | ImageElement;
	trackId: string;
}) {
	const state = useTransitionProperties({ element, trackId });
	const durationId = useId();
	return (
		<PanelView title="Incoming transition" contentClassName="px-3 pb-4">
			<div
				className="flex min-w-0 flex-col gap-4"
				data-testid="transition-properties"
				aria-busy={state.isSaving}
			>
				<div>
					<h3 className="text-sm font-medium">Cross dissolve</h3>
					<p className="text-muted-foreground mt-1 text-xs">
						Blend the end of the outgoing picture into this clip, centered on
						the cut.
					</p>
				</div>
				<label className="flex min-w-0 flex-col gap-1.5 text-xs">
					Outgoing clip
					<select
						aria-label="Transition outgoing clip"
						data-testid="transition-outgoing"
						value={state.outgoingId}
						disabled={state.isSaving || state.candidates.length === 0}
						onChange={(event) => state.setOutgoingId(event.target.value)}
						className="border-border bg-background focus-visible:ring-ring h-8 w-full min-w-0 rounded-sm border px-2 text-sm focus-visible:ring-1"
					>
						{!state.candidates.length && (
							<option value="">No other picture clips on this track</option>
						)}
						{state.candidates.map((clip) => (
							<option key={clip.id} value={clip.id}>
								{formatTimecode({
									time: clip.startTime,
									format: "HH:MM:SS:FF",
									rate: state.fps,
								})}{" "}
								{clip.name}
							</option>
						))}
					</select>
				</label>
				<div className="min-w-0 text-xs">
					<span className="text-muted-foreground">Into </span>
					<span className="break-words">{element.name}</span>
					<span className="text-muted-foreground mt-1 block">
						at{" "}
						{formatTimecode({
							time: element.startTime,
							format: "HH:MM:SS:FF",
							rate: state.fps,
						})}
					</span>
				</div>
				<label htmlFor={durationId} className="flex flex-col gap-1.5 text-xs">
					Duration in frames
					<Input
						id={durationId}
						aria-label="Transition duration in frames"
						data-testid="transition-duration"
						type="number"
						min={2}
						step={1}
						value={state.frames}
						disabled={state.isSaving}
						onChange={(event) => state.setFrames(event.target.value)}
					/>
				</label>
				<p
					className="text-muted-foreground text-xs"
					role="status"
					data-testid="transition-validation"
				>
					{state.validation.message}
				</p>
				{state.isHidden && (
					<p className="text-xs">
						A clip or its track is hidden. Unhide both clips and the track to
						see the transition.
					</p>
				)}
				<div className="flex flex-wrap gap-2">
					<Button
						size="sm"
						data-testid="transition-apply"
						className="aria-disabled:opacity-50"
						aria-disabled={
							state.isSaving || !state.validation.valid || state.unchanged
						}
						onClick={() => void state.save()}
					>
						{element.transitionIn ? "Update transition" : "Add transition"}
					</Button>
					<Button
						size="sm"
						variant="outline"
						data-testid="transition-remove"
						className="aria-disabled:opacity-50"
						aria-disabled={state.isSaving || !element.transitionIn}
						onClick={() => void state.save(true)}
					>
						Remove transition
					</Button>
				</div>
				<p
					role="status"
					className="text-xs"
					data-testid="transition-save-status"
				>
					{state.message}
				</p>
				<p className="text-muted-foreground text-xs">
					Video clips need spare source footage on both sides of the cut. Undo
					and redo work after saving.
				</p>
			</div>
		</PanelView>
	);
}
