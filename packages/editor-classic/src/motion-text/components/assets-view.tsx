"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { PanelView } from "../../components/editor/panels/assets/views/base-panel";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { Textarea } from "../../components/ui/textarea";
import { useEditor, useEditorInstance } from "../../editor/use-editor";
import { MOTION_TEXT_RENDERER_SUPPORT } from "../../services/renderer/motion-text/support-manifest";
import { buildMotionTextElement } from "../../timeline/element-utils";
import { generateUUID } from "../../utils/id";
import { cn } from "../../utils/ui";
import {
	createStarterMotionTextSequence,
	mediaTime,
	type MotionTextSequenceBuildDiagnostic,
	type MotionTextStarterPresetId,
	TICKS_PER_SECOND,
} from "../../wasm";
import { MOTION_TEXT_STARTER_PRESETS } from "../starter-presets";
import { JizuraImportControl } from "./jizura-import-control";
import { MotionTextPresetBrowser } from "./preset-browser";

const STARTER_DURATION = 15 * TICKS_PER_SECOND;
const STARTER_SOURCE = "让画面说话\n让节奏被看见\n每一句都有动作";

function diagnosticMessage(
	diagnostics: readonly MotionTextSequenceBuildDiagnostic[],
): string | null {
	const diagnostic =
		diagnostics.find((entry) => entry.severity === "error") ??
		diagnostics.find((entry) => entry.severity === "warning");
	if (!diagnostic) return null;
	return diagnostic.sourceLine === null
		? diagnostic.message
		: `Line ${diagnostic.sourceLine}: ${diagnostic.message}`;
}

export function MotionTextAssetsView() {
	const editor = useEditorInstance();
	const projectId = useEditor(
		(instance) => instance.project.getActiveOrNull()?.metadata.id ?? "none",
	);
	const [source, setSource] = useState(STARTER_SOURCE);
	const [selectedPreset, setSelectedPreset] =
		useState<MotionTextStarterPresetId>("clean-caption");
	const [isComposing, setIsComposing] = useState(false);
	const [isAdding, setIsAdding] = useState(false);
	const [message, setMessage] = useState<{
		kind: "error" | "warning";
		text: string;
	} | null>(null);
	const lineCount = useMemo(
		() =>
			source.split(/\r?\n/u).filter((line) => line.trim().length > 0).length,
		[source],
	);

	const addAtPlayhead = async () => {
		if (isAdding || isComposing || source.trim().length === 0) return;
		setIsAdding(true);
		setMessage(null);
		try {
			const sequenceId = `motion-text:${generateUUID()}`;
			const created = createStarterMotionTextSequence({
				sequenceId,
				source,
				duration: STARTER_DURATION,
				starterPreset: selectedPreset,
				rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			});
			if (!created.sequence) {
				setMessage({
					kind: "error",
					text:
						diagnosticMessage(created.diagnostics) ??
						"The motion-text sequence could not be created.",
				});
				return;
			}
			const startTime = editor.playback.getCurrentTime();
			await editor.timeline.insertMotionTextSequence({
				sequence: created.sequence,
				element: buildMotionTextElement({
					sequenceId: created.sequence.id,
					name: MOTION_TEXT_STARTER_PRESETS.find(
						(entry) => entry.id === selectedPreset,
					)?.name,
					startTime,
					duration: mediaTime({ ticks: created.sequence.duration }),
				}),
				placement: { mode: "auto" },
			});
			const warning = diagnosticMessage(
				created.diagnostics.filter((entry) => entry.severity === "warning"),
			);
			if (warning) setMessage({ kind: "warning", text: warning });
		} catch (error) {
			setMessage({
				kind: "error",
				text:
					error instanceof Error
						? error.message
						: "Motion text could not be added to the timeline.",
			});
		} finally {
			setIsAdding(false);
		}
	};

	return (
		<PanelView
			title="Motion text"
			contentClassName="pb-3"
			footer={
				<Button
					data-testid="motion-text-add"
					onClick={() => void addAtPlayhead()}
					disabled={isAdding || isComposing || source.trim().length === 0}
					className="w-full"
				>
					{isAdding && <Spinner className="size-4" />}
					{isAdding ? "Adding motion text…" : "Add at playhead"}
				</Button>
			}
		>
			<div className="flex flex-col gap-4">
				<JizuraImportControl />
				<div className="flex flex-col gap-1.5">
					<div className="flex items-baseline justify-between gap-2">
						<label htmlFor="motion-text-source" className="text-sm font-medium">
							Lines
						</label>
						<span className="text-muted-foreground text-xs tabular-nums">
							{lineCount} {lineCount === 1 ? "line" : "lines"} · 15 sec
						</span>
					</div>
					<Textarea
						id="motion-text-source"
						value={source}
						onChange={(event) => setSource(event.target.value)}
						onCompositionStart={() => setIsComposing(true)}
						onCompositionEnd={() => setIsComposing(false)}
						onKeyDown={(event) => {
							if (
								!isComposing &&
								(event.metaKey || event.ctrlKey) &&
								event.key === "Enter"
							) {
								event.preventDefault();
								void addAtPlayhead();
							}
						}}
						placeholder="Enter one lyric line per row"
						aria-invalid={message?.kind === "error"}
						aria-describedby={message ? "motion-text-message" : undefined}
						className="min-h-28 resize-y leading-6"
					/>
					<p className="text-muted-foreground text-xs">
						Use Ctrl+Enter to add. Chinese input composition is preserved.
					</p>
				</div>

				<div className="flex flex-col gap-2">
					<p className="text-sm font-medium">Starter preset</p>
					<div className="grid grid-cols-2 gap-2">
						{MOTION_TEXT_STARTER_PRESETS.map((preset) => {
							const selected = preset.id === selectedPreset;
							return (
								<button
									key={preset.id}
									type="button"
									aria-pressed={selected}
									onClick={() => setSelectedPreset(preset.id)}
									className={cn(
										"bg-background focus-visible:ring-ring overflow-hidden rounded-md border text-left outline-none focus-visible:ring-1",
										selected ? "border-foreground" : "border-border",
									)}
								>
									<div
										className={cn(
											"relative flex h-16 items-center overflow-hidden px-3",
											preset.previewClassName,
										)}
									>
										<span className={preset.textClassName}>
											{preset.previewText}
										</span>
										{selected && (
											<span className="bg-background text-foreground absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full">
												<HugeiconsIcon icon={Tick02Icon} size={11} />
											</span>
										)}
									</div>
									<div className="flex flex-col gap-0.5 p-2">
										<span className="text-xs font-medium">{preset.name}</span>
										<span className="text-muted-foreground text-[11px] leading-4">
											{preset.description}
										</span>
									</div>
								</button>
							);
						})}
					</div>
				</div>

				<MotionTextPresetBrowser key={projectId} projectId={projectId} />

				{message && (
					<div
						id="motion-text-message"
						role={message.kind === "error" ? "alert" : "status"}
						className={cn(
							"flex items-start gap-2 rounded-md border p-2 text-xs leading-5",
							message.kind === "error"
								? "border-destructive/40 text-destructive"
								: "border-caution/40 text-caution",
						)}
					>
						<HugeiconsIcon icon={Alert02Icon} size={14} className="mt-0.5" />
						<span>{message.text}</span>
					</div>
				)}
			</div>
		</PanelView>
	);
}
