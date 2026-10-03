"use client";

import type {
	MotionTextCue,
	MotionTextSequence,
} from "@opencut/editor-contracts";
import { useRef, useState } from "react";
import type { MotionTextElement } from "../../timeline";
import { Button } from "../../components/ui/button";
import { useEditor, useEditorInstance } from "../../editor/use-editor";
import { cn } from "../../utils/ui";
import {
	mapMotionTextClipTimeValue,
	mapMotionTextSequenceTimeToTimelineValue,
	mediaTime,
	TICKS_PER_SECOND,
} from "../../wasm";
import { MotionTextAudioBindingEditor } from "./audio-binding-editor";
import { MotionTextCandidateControls } from "./candidate-controls";
import { MotionTextCutTimingEditor } from "./cut-timing-editor";
import { MotionTextCueRangeControls } from "./cue-range-controls";
import { MotionTextLockEditor } from "./lock-editor";
import { MotionTextPlanningControlsEditor } from "./planning-controls";
import {
	MotionTextCueEditor,
	MotionTextDefaultsEditor,
} from "./sequence-editors";
import { MotionTextTapControls } from "./tap-controls";

function formatTime(value: number): string {
	return `${(value / TICKS_PER_SECOND).toFixed(2)}s`;
}

function isTimeWithinRange({
	time,
	startTime,
	duration,
}: {
	readonly time: number | null;
	readonly startTime: number;
	readonly duration: number;
}): boolean {
	return time !== null && time >= startTime && time < startTime + duration;
}

function getOverrideSummary(cue: MotionTextCue): string[] {
	const groups: string[] = [];
	if (cue.overrides.preset && Object.keys(cue.overrides.preset).length > 0) {
		groups.push("style");
	}
	if (cue.overrides.fontId !== undefined) groups.push("font");
	if (cue.overrides.colors && Object.keys(cue.overrides.colors).length > 0) {
		groups.push("color");
	}
	if (
		cue.overrides.parameters &&
		Object.keys(cue.overrides.parameters).length > 0
	) {
		groups.push("parameters");
	}
	return groups;
}

function SequenceDefaults({
	sequence,
	isEditing,
	onEdit,
}: {
	readonly sequence: MotionTextSequence;
	readonly isEditing: boolean;
	readonly onEdit: (trigger: HTMLButtonElement) => void;
}) {
	const preset = sequence.defaults.preset;
	const colors = Object.entries(sequence.defaults.colors);
	return (
		<section className="border-b px-3 py-3">
			<div className="mb-2 flex items-baseline justify-between gap-2">
				<h3 className="text-sm font-medium">Sequence defaults</h3>
				<span className="text-muted-foreground text-[11px] tabular-nums">
					r{sequence.revision}
				</span>
			</div>
			<div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
				<span>Style {preset.style}</span>
				<span>Layout {preset.layout}</span>
				<span>Enter {preset.enter}</span>
				<span>Hold {preset.hold}</span>
			</div>
			<div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
				<span className="text-muted-foreground">Font</span>
				<span className="min-w-0 break-all">{sequence.defaults.fontId ?? "Renderer default"}</span>
				{colors.length > 0 && (
					<div
						className="ml-auto flex items-center gap-1"
						aria-label="Default colors"
					>
						{colors.slice(0, 4).map(([name, color]) => (
							<span
								key={name}
								title={`${name}: ${color}`}
								className="size-3 rounded-full border"
								style={{ backgroundColor: color }}
							/>
						))}
					</div>
				)}
			</div>
			<Button
				variant="outline"
				size="sm"
				className="mt-2 h-auto min-h-7 w-full whitespace-normal"
				onClick={(event) => onEdit(event.currentTarget)}
			>
				{isEditing ? "Close defaults editor" : "Edit font and colors"}
			</Button>
		</section>
	);
}

function CueRow({
	cue,
	isActive,
	isSelected,
	activeCutLabel,
	onSeek,
}: {
	readonly cue: MotionTextCue;
	readonly isActive: boolean;
	readonly isSelected: boolean;
	readonly activeCutLabel: string | null;
	readonly onSeek: (trigger: HTMLButtonElement) => void;
}) {
	const overrideGroups = getOverrideSummary(cue);
	return (
		<button
			type="button"
			onClick={(event) => onSeek(event.currentTarget)}
			aria-current={isActive ? "true" : undefined}
			aria-expanded={isSelected}
			className={cn(
				"focus-visible:ring-ring grid w-full grid-cols-[3.25rem_1fr] gap-2 border-b border-l-2 border-l-transparent px-3 py-2.5 text-left outline-none focus-visible:ring-1",
				isActive && "bg-accent",
				isSelected && "border-l-foreground",
			)}
		>
			<span className="text-muted-foreground pt-0.5 text-[11px] tabular-nums">
				{formatTime(cue.startTime)}
			</span>
			<span className="min-w-0">
				<span className="flex items-start justify-between gap-2">
					<span className="text-sm leading-5 break-words">
						{cue.text || "Interlude"}
					</span>
					{isActive && (
						<span className="bg-foreground text-background shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium">
							Now
						</span>
					)}
				</span>
				<span className="text-muted-foreground mt-1 flex flex-wrap gap-x-2 text-[11px] leading-4">
					<span>{formatTime(cue.duration)}</span>
					<span>Timing {cue.timingSource ?? "legacy"}</span>
					<span>
						{overrideGroups.length === 0
							? "Inherits sequence"
							: `Local ${overrideGroups.join(", ")}`}
					</span>
					{activeCutLabel && <span>{activeCutLabel}</span>}
				</span>
			</span>
		</button>
	);
}

export function MotionTextPropertiesTab({
	element,
}: {
	readonly element: MotionTextElement;
}) {
	const editor = useEditorInstance();
	const sequence = useEditor(
		(currentEditor) =>
			currentEditor.project
				.getActive()
				.motionTextSequences.find(
					(candidate) => candidate.id === element.sequenceId,
				) ?? null,
	);
	const playheadTime = useEditor((currentEditor) =>
		currentEditor.playback.getCurrentTime(),
	);
	const [message, setMessage] = useState<string | null>(null);
	const [defaultsEditorSequenceId, setDefaultsEditorSequenceId] = useState<
		string | null
	>(null);
	const defaultsTriggerRef = useRef<{
		sequenceId: string;
		button: HTMLButtonElement;
	} | null>(null);
	const defaultsRegionRef = useRef<HTMLDivElement>(null);
	const closeDefaultsEditor = (sequenceId: string) => {
		setDefaultsEditorSequenceId((current) =>
			current === sequenceId ? null : current,
		);
		const trigger = defaultsTriggerRef.current;
		if (trigger?.sequenceId !== sequenceId || !trigger.button.isConnected) return;
		const active = trigger.button.ownerDocument.activeElement;
		// A save remounts the revision-keyed form before closing it. Restore its
		// stable opener, but do not steal focus from another panel during a save.
		if (
			active === trigger.button.ownerDocument.body ||
			defaultsRegionRef.current?.contains(active)
		) {
			trigger.button.focus({ preventScroll: true });
		}
	};
	const [selectedCue, setSelectedCue] = useState<{
		readonly sequenceId: string;
		readonly cueId: string;
	} | null>(null);
	const cueTriggerRef = useRef<{
		cueId: string;
		button: HTMLButtonElement;
	} | null>(null);
	const closeCueEditor = (cueId: string) => {
		const trigger = cueTriggerRef.current;
		setSelectedCue((current) => (current?.cueId === cueId ? null : current));
		if (trigger?.cueId !== cueId) return;
		const { button } = trigger;
		const active = button.ownerDocument.activeElement;
		// Return keyboard users to the cue after the form is removed, without
		// stealing focus if they moved to another control during the save.
		if (
			button.isConnected &&
			(active === button.ownerDocument.body ||
				button.parentElement?.contains(active))
		) {
			button.focus({ preventScroll: true });
		}
	};

	if (!sequence) {
		return (
			<div className="text-destructive p-3 text-sm" role="alert">
				The motion-text sequence is missing from this project.
			</div>
		);
	}
	const isEditingDefaults = defaultsEditorSequenceId === sequence.id;

	let sequenceTime: number | null = null;
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
		sequenceTime = mapped.active ? mapped.sequenceTime : null;
	} catch {
		sequenceTime = null;
	}
	const activeCut =
		sequence.resolvedPlan?.cuts.find((cut) =>
			isTimeWithinRange({
				time: sequenceTime,
				startTime: cut.startTime,
				duration: cut.duration,
			}),
		) ?? null;

	const seekToCue = (cue: MotionTextCue) => {
		setMessage(null);
		try {
			const mapped = mapMotionTextSequenceTimeToTimelineValue({
				options: {
					clipStartTime: element.startTime,
					clipDuration: element.duration,
					trimStart: element.trimStart,
					sequenceTime: Math.max(cue.startTime, element.trimStart),
					sequenceDuration: sequence.duration,
				},
			});
			if (!mapped.active || mapped.timelineTime === null) {
				setMessage("This cue is outside the visible part of the clip.");
				return;
			}
			editor.playback.seek({ time: mediaTime({ ticks: mapped.timelineTime }) });
		} catch (error) {
			setMessage(
				error instanceof Error
					? error.message
					: "The cue could not be located.",
			);
		}
	};

	return (
		<div className="flex min-h-full flex-col">
			<SequenceDefaults
				sequence={sequence}
				isEditing={isEditingDefaults}
				onEdit={(button) => {
					defaultsTriggerRef.current = { sequenceId: sequence.id, button };
					setDefaultsEditorSequenceId(isEditingDefaults ? null : sequence.id);
				}}
			/>
			{isEditingDefaults && (
				<div ref={defaultsRegionRef} className="border-b px-3 pb-3">
					<MotionTextDefaultsEditor
						key={`${sequence.id}:${sequence.revision}`}
						sequence={sequence}
						onCancel={() => closeDefaultsEditor(sequence.id)}
					/>
				</div>
			)}
			<MotionTextAudioBindingEditor
				sequence={sequence}
				element={element}
				onMessage={setMessage}
			/>
			<MotionTextPlanningControlsEditor
				key={`planning:${sequence.id}`}
				sequence={sequence}
				onMessage={setMessage}
			/>
			<MotionTextCandidateControls
				key={sequence.id}
				sequence={sequence}
				selectedCueId={
					selectedCue?.sequenceId === sequence.id ? selectedCue.cueId : null
				}
				onMessage={setMessage}
			/>
			<MotionTextTapControls
				key={`tap:${sequence.id}`}
				sequence={sequence}
				element={element}
				selectedCueId={
					selectedCue?.sequenceId === sequence.id ? selectedCue.cueId : null
				}
				onSelectCue={(cueId) => {
					cueTriggerRef.current = null;
					setSelectedCue({ sequenceId: sequence.id, cueId });
				}}
				onMessage={setMessage}
			/>

			<section aria-labelledby="motion-text-cues-heading">
				<div className="flex items-baseline justify-between gap-2 border-b px-3 py-2">
					<h3 id="motion-text-cues-heading" className="text-sm font-medium">
						Lyrics
					</h3>
					<span className="text-muted-foreground text-[11px] tabular-nums">
						{sequence.cues.length} cues
					</span>
				</div>
				{sequence.cues.length === 0 ? (
					<p className="text-muted-foreground px-3 py-6 text-center text-sm">
						This sequence has no cues.
					</p>
				) : (
					sequence.cues.map((cue) => {
						const isActive = isTimeWithinRange({
							time: sequenceTime,
							startTime: cue.startTime,
							duration: cue.duration,
						});
						const isSelected =
							selectedCue?.sequenceId === sequence.id &&
							selectedCue.cueId === cue.id;
						return (
							<div key={cue.id}>
								<CueRow
									cue={cue}
									isActive={isActive}
									isSelected={isSelected}
									activeCutLabel={
										isActive && activeCut?.cueId === cue.id
											? `Cut · ${activeCut.preset.style}/${activeCut.preset.enter}`
											: null
									}
									onSeek={(button) => {
										cueTriggerRef.current = { cueId: cue.id, button };
										setSelectedCue({ sequenceId: sequence.id, cueId: cue.id });
										seekToCue(cue);
									}}
								/>
								{isSelected && (
									<>
										<MotionTextCueRangeControls
											element={element}
											sequence={sequence}
											cue={cue}
											onMessage={setMessage}
										/>
										<MotionTextLockEditor
											key={`locks:${sequence.id}:${cue.id}`}
											sequence={sequence}
											cue={cue}
											onMessage={setMessage}
										/>
										<MotionTextCueEditor
											key={`cue:${cue.id}:${sequence.revision}`}
											sequence={sequence}
											cue={cue}
											onCancel={() => closeCueEditor(cue.id)}
										/>
										<MotionTextCutTimingEditor
											key={`cuts:${sequence.id}:${cue.id}`}
											sequence={sequence}
											cue={cue}
											onMessage={setMessage}
										/>
									</>
								)}
							</div>
						);
					})
				)}
			</section>

			{message && (
				<p className="text-destructive border-t px-3 py-2 text-xs" role="alert">
					{message}
				</p>
			)}
		</div>
	);
}
