"use client";

import { useEditor, useEditorInstance } from "../../editor/use-editor";
import { formatTimecode } from "opencut-wasm";
import { useActionInvoker } from "../../actions/action-scope";
import { EditableTimecode } from "../../components/editable-timecode";
import { Button } from "../../components/ui/button";
import {
	FullScreenIcon,
	PauseIcon,
	PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Separator } from "../../components/ui/separator";
import {
	Select,
	SelectTrigger,
	SelectContent,
	SelectItem,
	SelectSeparator,
} from "../../components/ui/select";
import { PREVIEW_ZOOM_PRESETS } from "../zoom";
import { usePreviewViewport } from "./preview-viewport";

import { usePlaybackTime } from "./use-playback-time";
import { useEditorMessages } from "../../editor/host/editor-host-context";

export function PreviewToolbar({
	onToggleFullscreen,
}: {
	onToggleFullscreen: () => void;
}) {
	const messages = useEditorMessages();
	return (
		<div
			data-testid="preview-toolbar"
			className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-2 px-3 py-3"
		>
			<TimecodeDisplay />
			<PlayPauseButton />
			<div className="ml-auto flex min-w-0 items-center gap-2">
				<ZoomSelect />
				<Separator orientation="vertical" className="h-4" />

				<Button
					variant="text"
					size="icon"
					aria-label={messages.previewFullscreen}
					onClick={onToggleFullscreen}
				>
					<HugeiconsIcon icon={FullScreenIcon} />
				</Button>
			</div>
		</div>
	);
}

function TimecodeDisplay() {
	const editor = useEditorInstance();
	const totalDuration = useEditor((e) => e.timeline.getTotalDuration());
	const fps = useEditor((e) => e.project.getActive().settings.fps);
	const currentTime = usePlaybackTime();

	return (
		<div className="flex min-w-0 flex-wrap items-center">
			<EditableTimecode
				time={currentTime}
				duration={totalDuration}
				format="HH:MM:SS:FF"
				fps={fps}
				onTimeChange={({ time }) => editor.playback.seek({ time })}
				className="text-center"
			/>
			<span className="text-muted-foreground px-2 font-mono text-xs">/</span>
			<span className="text-muted-foreground font-mono text-xs">
				{formatTimecode({
					time: totalDuration,
					format: "HH:MM:SS:FF",
					rate: fps,
				})}
			</span>
		</div>
	);
}

function ZoomSelect() {
	const messages = useEditorMessages();
	const { isAtFit, zoomPercent, fitToScreen, setViewportPercent } =
		usePreviewViewport();

	const displayLabel = isAtFit ? messages.fitWindow : `${zoomPercent}%`;

	const onValueChange = (value: string) => {
		if (value === "fit") {
			fitToScreen();
		} else {
			setViewportPercent({ percent: Number(value) });
		}
	};

	return (
		<Select
			value={isAtFit ? "fit" : String(zoomPercent)}
			onValueChange={onValueChange}
		>
			<SelectTrigger aria-label={messages.previewZoom} className="tabular-nums">
				{displayLabel}
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="fit">{messages.fitWindow}</SelectItem>
				<SelectSeparator />
				{PREVIEW_ZOOM_PRESETS.map((preset) => (
					<SelectItem key={preset} value={String(preset)}>
						{preset}%
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function PlayPauseButton() {
	const messages = useEditorMessages();
	const invokeAction = useActionInvoker();
	const isPlaying = useEditor((e) => e.playback.getIsPlaying());

	return (
		<Button
			variant="text"
			size="icon"
			aria-label={isPlaying ? messages.previewPause : messages.previewPlay}
			onClick={() => invokeAction("toggle-play")}
		>
			<HugeiconsIcon icon={isPlaying ? PauseIcon : PlayIcon} />
		</Button>
	);
}
