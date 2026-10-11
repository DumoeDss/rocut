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
					<h3 className="text-sm font-medium">Picture transition</h3>
					<p className="text-muted-foreground mt-1 text-xs">
						Transition from the outgoing picture into this clip, centered on the
						cut. Clip timing stays unchanged.
					</p>
				</div>
				<label className="flex flex-col gap-1.5 text-xs">
					Transition type
					<select
						aria-label="Transition type"
						data-testid="transition-kind"
						value={state.kind}
						disabled={state.isSaving}
						onChange={(event) =>
							state.setKind(event.target.value as typeof state.kind)
						}
						className="border-border bg-background h-8 min-w-0 rounded-sm border px-2 text-sm"
					>
						<option value="cross-dissolve">Cross dissolve</option>
						<option value="peel" disabled={!state.peelAvailable}>
							Peel
						</option>
						<option value="bend" disabled={!state.bendAvailable}>
							Bend
						</option>
					</select>
				</label>
				{state.peelError && (
					<p className="text-muted-foreground text-xs">{state.peelError}</p>
				)}
				{state.bendError && (
					<p className="text-muted-foreground text-xs">{state.bendError}</p>
				)}
				{state.kind === "bend" && state.bend && (
					<fieldset
						disabled={state.isSaving}
						className="flex min-w-0 flex-col gap-2 text-xs"
					>
						<legend>Bend style</legend>
						<label className="flex flex-col gap-1.5">
							Direction
							<select
								aria-label="Bend direction"
								data-testid="transition-bend-direction"
								value={state.bend.direction}
								onChange={(event) =>
									state.setBend("direction", event.target.value)
								}
								className="border-border bg-background h-8 min-w-0 rounded-sm border px-2 text-sm"
							>
								{["left", "right", "up", "down"].map((direction) => (
									<option key={direction} value={direction}>
										{direction}
									</option>
								))}
							</select>
						</label>
						{(["hinge", "angle", "perspective", "shading"] as const).map(
							(key) => (
								<label key={key} className="flex flex-col gap-1.5">
									{key}
									<Input
										type="number"
										step="any"
										aria-label={`Bend ${key}`}
										data-testid={`transition-bend-${key}`}
										value={state.bend![key]}
										onChange={(event) => state.setBend(key, event.target.value)}
									/>
								</label>
							),
						)}
						<p className="text-muted-foreground">
							Catalog suggestions are visible for confirmation. Native Rust
							validates all Bend style parameters when saving.
						</p>
					</fieldset>
				)}
				{state.kind === "peel" && state.peel && (
					<fieldset
						disabled={state.isSaving}
						className="flex min-w-0 flex-col gap-2 text-xs"
					>
						<legend>Peel style</legend>
						<label className="flex flex-col gap-1.5">
							Direction
							<select
								aria-label="Peel direction"
								data-testid="transition-peel-direction"
								value={state.peel.direction}
								onChange={(event) =>
									state.setPeel("direction", event.target.value)
								}
								className="border-border bg-background h-8 min-w-0 rounded-sm border px-2 text-sm"
							>
								{["left", "right", "up", "down"].map((direction) => (
									<option key={direction} value={direction}>
										{direction}
									</option>
								))}
							</select>
						</label>
						{(["curl", "segments", "shading", "perspective"] as const).map(
							(key) => (
								<label key={key} className="flex flex-col gap-1.5">
									{key}
									<Input
										type="number"
										step={key === "segments" ? 1 : "any"}
										aria-label={`Peel ${key}`}
										data-testid={`transition-peel-${key}`}
										value={state.peel![key]}
										onChange={(event) => state.setPeel(key, event.target.value)}
									/>
								</label>
							),
						)}
						<p className="text-muted-foreground">
							Catalog suggestions are visible for confirmation. Native Rust
							validates all Peel style parameters when saving.
						</p>
					</fieldset>
				)}
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
