"use client";

import type {
	MotionTextCue,
	MotionTextSequence,
} from "@opencut/editor-contracts";
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { ColorPicker } from "../../components/ui/color-picker";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { useEditorInstance } from "../../editor/use-editor";
import { MOTION_TEXT_RENDERER_SUPPORT } from "../../services/renderer/motion-text/support-manifest";
import {
	mutateMotionTextSequence,
	resolveMotionTextBeatGrid,
	snapMotionTextTimeToBeat,
	TICKS_PER_SECOND,
	type MotionTextCuePresetMutation,
	type MotionTextSequenceBuildDiagnostic,
	type MotionTextStarterPresetId,
} from "../../wasm";
import { assessMotionTextFontLanguage } from "../font-language-support";
import {
	hasMotionTextLock,
	isMotionTextCueFieldLocked,
	motionTextFieldState,
} from "../lock-state";
import { MOTION_TEXT_STARTER_PRESETS } from "../starter-presets";

const CUE_SNAP_DISTANCE = Math.round(TICKS_PER_SECOND * 0.15);

function diagnosticMessage(
	diagnostics: readonly MotionTextSequenceBuildDiagnostic[],
): string {
	return (
		diagnostics.find((entry) => entry.severity === "error")?.message ??
		diagnostics[0]?.message ??
		"The motion-text sequence could not be updated."
	);
}

function pickerColor({
	value,
	fallback,
}: {
	readonly value: string | undefined;
	readonly fallback: string;
}): string {
	return /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu.test(value ?? "")
		? (value?.slice(1).toUpperCase() ?? fallback)
		: fallback;
}

function cuePresetValue(
	cue: MotionTextCue,
): "inherit" | "custom" | MotionTextStarterPresetId {
	const preset = cue.overrides.preset;
	if (!preset) return "inherit";
	return (
		MOTION_TEXT_STARTER_PRESETS.find(
			(candidate) => candidate.styleId === preset.style,
		)?.id ?? "custom"
	);
}

function presetMutation(
	value: "inherit" | "custom" | MotionTextStarterPresetId,
): MotionTextCuePresetMutation {
	if (value === "inherit") return { mode: "inherit" };
	if (value === "custom") return { mode: "keep" };
	return { mode: "starter", starterPreset: value };
}

function FontSelect({
	sequence,
	value,
	onChange,
	inheritLabel,
	inheritFontId,
	disabled = false,
}: {
	readonly sequence: MotionTextSequence;
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly inheritLabel: string;
	readonly inheritFontId?: string;
	readonly disabled?: boolean;
}) {
	const effectiveFontId =
		value === "" || value === "inherit" ? inheritFontId : value;
	const assessment = assessMotionTextFontLanguage({
		font: sequence.fonts.find((font) => font.id === effectiveFontId),
		language: sequence.language,
	});
	const coverage = assessment.supportedLanguages.join(", ");
	return (
		<div className="space-y-1">
			<Select
				value={value || "inherit"}
				disabled={disabled}
				onValueChange={onChange}
			>
				<SelectTrigger className="w-full" variant="outline">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="inherit">{inheritLabel}</SelectItem>
					{sequence.fonts.map((font) => (
						<SelectItem key={font.id} value={font.id}>
							{font.family} · {font.weight} ·{" "}
							{font.supportedLanguages?.join("/") ?? "coverage unknown"}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p
				className={
					assessment.status === "unsupported"
						? "text-caution text-[11px] leading-4"
						: "text-muted-foreground text-[11px] leading-4"
				}
				data-motion-text-font-language-status={assessment.status}
			>
				{assessment.status === "supported"
					? `Declared coverage includes ${assessment.language}.`
					: assessment.status === "unsupported"
						? `No declared ${assessment.language} coverage (${coverage}); preview may fall back or report missing glyphs.`
						: "Language coverage is not declared for this font choice."}
			</p>
		</div>
	);
}

function FieldState({
	locked,
	local,
}: {
	readonly locked: boolean;
	readonly local: boolean;
}) {
	return (
		<span
			className={
				locked
					? "text-caution text-[10px] font-normal"
					: "text-muted-foreground text-[10px] font-normal"
			}
		>
			{motionTextFieldState({ locked, local })}
		</span>
	);
}

function EditorActions({
	isApplying,
	isDisabled,
	onCancel,
	onApply,
}: {
	readonly isApplying: boolean;
	readonly isDisabled: boolean;
	readonly onCancel: () => void;
	readonly onApply: () => void;
}) {
	return (
		<div className="flex flex-wrap justify-end gap-2 pt-1">
			<Button variant="ghost" size="sm" onClick={onCancel}>
				Cancel
			</Button>
			<Button size="sm" disabled={isDisabled || isApplying} onClick={onApply}>
				{isApplying ? "Applying…" : "Apply changes"}
			</Button>
		</div>
	);
}

export function MotionTextDefaultsEditor({
	sequence,
	onCancel,
}: {
	readonly sequence: MotionTextSequence;
	readonly onCancel: () => void;
}) {
	const editor = useEditorInstance();
	const initialFontId = sequence.defaults.fontId ?? "";
	const initialUsePresetColors =
		sequence.defaults.colors.foreground === undefined &&
		sequence.defaults.colors.accent === undefined;
	const initialForeground = pickerColor({
		value:
			sequence.defaults.colors.foreground ??
			sequence.defaults.colors.fg ??
			sequence.defaults.colors.text,
		fallback: "FFFFFF",
	});
	const initialAccent = pickerColor({
		value: sequence.defaults.colors.accent,
		fallback: "EF4444",
	});
	const [fontId, setFontId] = useState(initialFontId);
	const [usePresetColors, setUsePresetColors] = useState(
		initialUsePresetColors,
	);
	const [foreground, setForeground] = useState(initialForeground);
	const [accent, setAccent] = useState(initialAccent);
	const [isApplying, setIsApplying] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const hasFullCueLock = sequence.cues.some((cue) =>
		hasMotionTextLock({ cue, scope: "cue", key: "all" }),
	);
	const fontDirty = fontId !== initialFontId;
	const colorsDirty =
		usePresetColors !== initialUsePresetColors ||
		(!usePresetColors &&
			(foreground !== initialForeground || accent !== initialAccent));
	const isDirty = fontDirty || colorsDirty;

	const apply = async () => {
		if (isApplying || (hasFullCueLock && colorsDirty)) return;
		setIsApplying(true);
		setMessage(null);
		try {
			const mutated = mutateMotionTextSequence({
				sequence,
				mutation: {
					kind: "update-defaults",
					font: !fontDirty
						? { mode: "keep" }
						: fontId === "" || fontId === "inherit"
							? { mode: "inherit" }
							: { mode: "set", fontId },
					colors: !colorsDirty
						? { mode: "keep" }
						: usePresetColors
							? { mode: "inherit" }
							: {
									mode: "set",
									foreground: `#${foreground}`,
									accent: `#${accent}`,
								},
				},
				rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			});
			if (!mutated.sequence) {
				setMessage(diagnosticMessage(mutated.diagnostics));
				return;
			}
			await editor.project.updateMotionTextSequence({
				sequence: mutated.sequence,
			});
			onCancel();
		} catch (error) {
			setMessage(
				error instanceof Error
					? error.message
					: "Sequence defaults could not be updated.",
			);
		} finally {
			setIsApplying(false);
		}
	};

	return (
		<div className="bg-muted/30 mt-2 space-y-3 rounded-sm border p-2.5">
			<div className="space-y-1.5">
				<div className="flex items-center justify-between gap-2">
					<Label>Default font</Label>
					<FieldState locked={false} local={initialFontId !== ""} />
				</div>
				<FontSelect
					sequence={sequence}
					value={fontId}
					onChange={(value) => setFontId(value === "inherit" ? "" : value)}
					inheritLabel="Renderer default"
				/>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<Label>Palette</Label>
					<FieldState locked={hasFullCueLock} local={!initialUsePresetColors} />
				</div>
				<Button
					variant="ghost"
					size="sm"
					className="h-auto min-h-6 max-w-full whitespace-normal text-xs"
					disabled={hasFullCueLock}
					onClick={() => setUsePresetColors((value) => !value)}
				>
					{usePresetColors ? "Customize" : "Use preset colors"}
				</Button>
			</div>
			{!usePresetColors && (
				<div
					className={`grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2 ${hasFullCueLock ? "pointer-events-none opacity-50" : ""}`}
					aria-disabled={hasFullCueLock}
				>
					<div className="space-y-1.5">
						<Label>Text</Label>
						<ColorPicker
							value={foreground}
							onChange={setForeground}
							contentSide="left"
						/>
					</div>
					<div className="space-y-1.5">
						<Label>Accent</Label>
						<ColorPicker
							value={accent}
							onChange={setAccent}
							contentSide="left"
						/>
					</div>
				</div>
			)}
			{hasFullCueLock && (
				<p className="text-caution text-xs">
					Default font remains editable. Unlock fully locked cues before
					changing the render-time palette.
				</p>
			)}
			{message && (
				<p className="text-destructive text-xs" role="alert">
					{message}
				</p>
			)}
			<EditorActions
				isApplying={isApplying}
				isDisabled={!isDirty || (hasFullCueLock && colorsDirty)}
				onCancel={onCancel}
				onApply={() => void apply()}
			/>
		</div>
	);
}

export function MotionTextCueEditor({
	sequence,
	cue,
	onCancel,
}: {
	readonly sequence: MotionTextSequence;
	readonly cue: MotionTextCue;
	readonly onCancel: () => void;
}) {
	const editor = useEditorInstance();
	const initialPreset = cuePresetValue(cue);
	const initialFontId = cue.overrides.fontId ?? "";
	const initialUseLocalColors = cue.overrides.colors !== undefined;
	const initialForeground = pickerColor({
		value: cue.overrides.colors?.foreground,
		fallback: "FFFFFF",
	});
	const initialAccent = pickerColor({
		value: cue.overrides.colors?.accent,
		fallback: "EF4444",
	});
	const initialStartSeconds = (cue.startTime / TICKS_PER_SECOND).toFixed(2);
	const initialDurationSeconds = (cue.duration / TICKS_PER_SECOND).toFixed(2);
	const [text, setText] = useState(cue.text);
	const [startSeconds, setStartSeconds] = useState(initialStartSeconds);
	const [durationSeconds, setDurationSeconds] = useState(
		initialDurationSeconds,
	);
	const [preset, setPreset] = useState(initialPreset);
	const [fontId, setFontId] = useState(initialFontId);
	const [useLocalColors, setUseLocalColors] = useState(initialUseLocalColors);
	const [foreground, setForeground] = useState(initialForeground);
	const [accent, setAccent] = useState(initialAccent);
	const [snapEnabled, setSnapEnabled] = useState(false);
	const [isComposing, setIsComposing] = useState(false);
	const [isApplying, setIsApplying] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const textLocked = isMotionTextCueFieldLocked({ cue, field: "text" });
	const timingLocked = isMotionTextCueFieldLocked({ cue, field: "timing" });
	const presetLocked = isMotionTextCueFieldLocked({ cue, field: "preset" });
	const fontLocked = isMotionTextCueFieldLocked({ cue, field: "font" });
	const colorsLocked = isMotionTextCueFieldLocked({ cue, field: "colors" });
	const nextStartTime =
		startSeconds === initialStartSeconds
			? cue.startTime
			: Math.round(Number(startSeconds) * TICKS_PER_SECOND);
	const nextDuration =
		durationSeconds === initialDurationSeconds
			? cue.duration
			: Math.round(Number(durationSeconds) * TICKS_PER_SECOND);
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
	const textDirty = text !== cue.text;
	const timingDirty =
		nextStartTime !== cue.startTime || nextDuration !== cue.duration;
	const presetDirty = preset !== initialPreset;
	const fontDirty = fontId !== initialFontId;
	const colorsDirty =
		useLocalColors !== initialUseLocalColors ||
		(useLocalColors &&
			(foreground !== initialForeground || accent !== initialAccent));
	const isDirty =
		textDirty || timingDirty || presetDirty || fontDirty || colorsDirty;
	const hasLockedChanges =
		(textLocked && textDirty) ||
		(timingLocked && timingDirty) ||
		(presetLocked && presetDirty) ||
		(fontLocked && fontDirty) ||
		(colorsLocked && colorsDirty);

	const apply = async () => {
		if (isApplying || isComposing || hasLockedChanges) return;
		const start = Number(startSeconds);
		const duration = Number(durationSeconds);
		if (!Number.isFinite(start) || !Number.isFinite(duration)) {
			setMessage("Start and duration must be valid numbers.");
			return;
		}
		setIsApplying(true);
		setMessage(null);
		try {
			let appliedStartTime = nextStartTime;
			let appliedDuration = nextDuration;
			if (
				snapEnabled &&
				typeof beatGrid?.bpm === "number" &&
				typeof beatGrid.firstBeat === "number"
			) {
				const { bpm, firstBeat } = beatGrid;
				const snap = (time: number): number => {
					const result = snapMotionTextTimeToBeat({
						time,
						bpm,
						firstBeat,
						maxDistance: CUE_SNAP_DISTANCE,
					});
					if (result.error) throw new Error(result.error);
					return result.time;
				};
				if (nextStartTime !== cue.startTime) {
					appliedStartTime = snap(nextStartTime);
				}
				if (nextDuration !== cue.duration) {
					const desiredEndTime = nextStartTime + nextDuration;
					appliedDuration = snap(desiredEndTime) - appliedStartTime;
				}
			}
			const mutated = mutateMotionTextSequence({
				sequence,
				mutation: {
					kind: "update-cue",
					cueId: cue.id,
					text,
					startTime: appliedStartTime,
					duration: appliedDuration,
					preset: !presetDirty ? { mode: "keep" } : presetMutation(preset),
					font: !fontDirty
						? { mode: "keep" }
						: fontId === "" || fontId === "inherit"
							? { mode: "inherit" }
							: { mode: "set", fontId },
					colors: !colorsDirty
						? { mode: "keep" }
						: useLocalColors
							? {
									mode: "set",
									foreground: `#${foreground}`,
									accent: `#${accent}`,
								}
							: { mode: "inherit" },
				},
				rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			});
			if (!mutated.sequence) {
				setMessage(diagnosticMessage(mutated.diagnostics));
				return;
			}
			await editor.project.updateMotionTextSequence({
				sequence: mutated.sequence,
			});
			onCancel();
		} catch (error) {
			setMessage(
				error instanceof Error
					? error.message
					: "The cue could not be updated.",
			);
		} finally {
			setIsApplying(false);
		}
	};

	return (
		<div className="bg-muted/30 space-y-3 border-b px-3 py-3">
			<div className="space-y-1.5">
				<div className="flex items-center justify-between gap-2">
					<Label htmlFor={`motion-text-cue-${cue.id}`}>Lyric text</Label>
					<FieldState locked={textLocked} local />
				</div>
				<Textarea
					id={`motion-text-cue-${cue.id}`}
					value={text}
					disabled={textLocked}
					onChange={(event) => setText(event.target.value)}
					onCompositionStart={() => setIsComposing(true)}
					onCompositionEnd={() => setIsComposing(false)}
					onKeyDown={(event) => {
						if (
							!isComposing &&
							(event.ctrlKey || event.metaKey) &&
							event.key === "Enter"
						) {
							event.preventDefault();
							void apply();
						}
					}}
					className="min-h-20 resize-y"
				/>
			</div>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2">
				<div className="space-y-1.5">
					<div className="flex items-center justify-between gap-2">
						<Label htmlFor={`motion-text-start-${cue.id}`}>Start (sec)</Label>
						<FieldState locked={timingLocked} local />
					</div>
					<Input
						id={`motion-text-start-${cue.id}`}
						type="number"
						min="0"
						step="0.01"
						size="sm"
						value={startSeconds}
						disabled={timingLocked}
						onChange={(event) => setStartSeconds(event.target.value)}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor={`motion-text-duration-${cue.id}`}>
						Duration (sec)
					</Label>
					<FieldState locked={timingLocked} local />
					<Input
						id={`motion-text-duration-${cue.id}`}
						type="number"
						min="0.01"
						step="0.01"
						size="sm"
						value={durationSeconds}
						disabled={timingLocked}
						onChange={(event) => setDurationSeconds(event.target.value)}
					/>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					aria-pressed={snapEnabled}
					className="h-auto min-h-7 max-w-full whitespace-normal"
					disabled={!canSnap || timingLocked || isApplying}
					onClick={() => setSnapEnabled((value) => !value)}
				>
					Cue beat snap {snapEnabled ? "on" : "off"}
				</Button>
				<p className="text-muted-foreground text-[11px] leading-4">
					{canSnap
						? "Changed start/end boundaries snap within 150 ms on apply."
						: "Bind analyzed audio or set a usable beat grid to enable snapping."}
				</p>
			</div>
			<div className="space-y-1.5">
				<div className="flex items-center justify-between gap-2">
					<Label>Local style</Label>
					<FieldState
						locked={presetLocked}
						local={cue.overrides.preset !== undefined}
					/>
				</div>
				<Select
					value={preset}
					disabled={presetLocked}
					onValueChange={(value) => {
						if (value === "inherit" || value === "custom") {
							setPreset(value);
							return;
						}
						const starter = MOTION_TEXT_STARTER_PRESETS.find(
							(candidate) => candidate.id === value,
						);
						if (starter) setPreset(starter.id);
					}}
				>
					<SelectTrigger className="w-full" variant="outline">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="inherit">Inherit sequence style</SelectItem>
						{preset === "custom" && (
							<SelectItem value="custom">Keep custom local style</SelectItem>
						)}
						{MOTION_TEXT_STARTER_PRESETS.map((starter) => (
							<SelectItem key={starter.id} value={starter.id}>
								{starter.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="space-y-1.5">
				<div className="flex items-center justify-between gap-2">
					<Label>Local font</Label>
					<FieldState
						locked={fontLocked}
						local={cue.overrides.fontId !== undefined}
					/>
				</div>
				<FontSelect
					sequence={sequence}
					value={fontId}
					onChange={(value) => setFontId(value === "inherit" ? "" : value)}
					inheritLabel="Inherit sequence font"
					inheritFontId={sequence.defaults.fontId}
					disabled={fontLocked}
				/>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<Label>Local palette</Label>
					<FieldState
						locked={colorsLocked}
						local={cue.overrides.colors !== undefined}
					/>
				</div>
				<Button
					variant="ghost"
					size="sm"
					className="h-auto min-h-6 max-w-full whitespace-normal text-xs"
					disabled={colorsLocked}
					onClick={() => setUseLocalColors((value) => !value)}
				>
					{useLocalColors ? "Restore inheritance" : "Override colors"}
				</Button>
			</div>
			{useLocalColors && (
				<div
					className={`grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2 ${colorsLocked ? "pointer-events-none opacity-50" : ""}`}
					aria-disabled={colorsLocked}
				>
					<div className="space-y-1.5">
						<Label>Text</Label>
						<ColorPicker
							value={foreground}
							onChange={setForeground}
							contentSide="left"
						/>
					</div>
					<div className="space-y-1.5">
						<Label>Accent</Label>
						<ColorPicker
							value={accent}
							onChange={setAccent}
							contentSide="left"
						/>
					</div>
				</div>
			)}
			{cue.locks.length > 0 && (
				<p className="text-caution text-xs">
					Locked fields are disabled; unrelated local and inherited fields
					remain editable.
				</p>
			)}
			{message && (
				<p className="text-destructive text-xs" role="alert">
					{message}
				</p>
			)}
			<EditorActions
				isApplying={isApplying}
				isDisabled={
					hasLockedChanges ||
					isComposing ||
					text.trim().length === 0 ||
					!isDirty
				}
				onCancel={onCancel}
				onApply={() => void apply()}
			/>
		</div>
	);
}
