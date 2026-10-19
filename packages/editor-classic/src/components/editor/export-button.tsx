"use client";

import { useState } from "react";
import { TransitionTopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Progress } from "../ui/progress";
import { Checkbox } from "../ui/checkbox";
import { cn } from "../../utils/ui";
import {
	getExportMimeType,
	getExportFileExtension,
	downloadBuffer,
} from "../../export";
import { Check, Copy, Download, RotateCcw } from "lucide-react";
import {
	EXPORT_FORMAT_VALUES,
	EXPORT_QUALITY_VALUES,
	type ExportFormat,
	type ExportQuality,
	type ExportVideoChroma,
} from "../../export";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "../section";
import { useEditor, useEditorInstance } from "../../editor/use-editor";
import { useEditorSession } from "../../editor/session/editor-session-provider";
import {
	DEFAULT_EXPORT_OPTIONS,
	DEFAULT_VIDEO_CHROMA,
	selectedVideoChroma,
} from "../../export/defaults";
import { ExportVideoChromaControl } from "./export-video-chroma";
import { TICKS_PER_SECOND } from "../../wasm";
import { useEditorMessages } from "../../editor/host/editor-host-context";

function isExportFormat(value: string): value is ExportFormat {
	return EXPORT_FORMAT_VALUES.some((formatValue) => formatValue === value);
}

function isExportQuality(value: string): value is ExportQuality {
	return EXPORT_QUALITY_VALUES.some((qualityValue) => qualityValue === value);
}

export function ExportButton() {
	const messages = useEditorMessages();
	const [isExportPopoverOpen, setIsExportPopoverOpen] = useState(false);
	const editor = useEditorInstance();
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const hasProject = !!activeProject;

	const handlePopoverOpenChange = ({ open }: { open: boolean }) => {
		if (!open) {
			editor.project.cancelExport();
			editor.project.clearExportState();
		}
		setIsExportPopoverOpen(open);
	};

	return (
		<Popover
			open={isExportPopoverOpen}
			onOpenChange={(open) => handlePopoverOpenChange({ open })}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					className={cn(
						"flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-[#38BDF8] px-[0.12rem] py-[0.12rem] text-white",
						hasProject ? "cursor-pointer" : "cursor-not-allowed opacity-50",
					)}
					onClick={hasProject ? () => setIsExportPopoverOpen(true) : undefined}
					disabled={!hasProject}
					onKeyDown={(event) => {
						if (hasProject && (event.key === "Enter" || event.key === " ")) {
							event.preventDefault();
							setIsExportPopoverOpen(true);
						}
					}}
				>
					<div className="relative flex items-center gap-1.5 rounded-[0.6rem] bg-linear-270 from-[#2567EC] to-[#37B6F7] px-4 py-1 shadow-[0_1px_3px_0px_rgba(0,0,0,0.65)]">
						<HugeiconsIcon icon={TransitionTopIcon} className="z-50 size-3.5" />
						<span className="z-50 text-[0.875rem]">{messages.export}</span>
						<div className="absolute top-0 left-0 z-10 flex size-full items-center justify-center rounded-[0.6rem] bg-linear-to-t from-white/0 to-white/50">
							<div className="absolute top-[0.08rem] z-50 h-[calc(100%-2px)] w-[calc(100%-2px)] rounded-[0.6rem] bg-linear-270 from-[#2567EC] to-[#37B6F7]"></div>
						</div>
					</div>
				</button>
			</PopoverTrigger>
			{hasProject && (
				<PopoverContent className="bg-background mr-4 flex w-80 flex-col p-0">
					<ExportOptions onOpenChange={setIsExportPopoverOpen} />
				</PopoverContent>
			)}
		</Popover>
	);
}

export function ExportOptions({
	onOpenChange,
}: {
	onOpenChange: (open: boolean) => void;
}) {
	const messages = useEditorMessages();
	const editor = useEditorInstance();
	const activeProject = useEditor((e) => e.project.getActive());
	const exportState = useEditor((e) => e.project.getExportState());
	const exportRangeStart = useEditor(
		(e) => e.project.getExportRange()?.startTime ?? null,
	);
	const exportRangeEnd = useEditor(
		(e) => e.project.getExportRange()?.endTime ?? null,
	);
	const exportRange =
		exportRangeStart === null || exportRangeEnd === null
			? null
			: { startTime: exportRangeStart, endTime: exportRangeEnd };
	const { isExporting, progress, result: exportResult } = exportState;
	const [format, setFormat] = useState<ExportFormat>(
		DEFAULT_EXPORT_OPTIONS.format,
	);
	const [quality, setQuality] = useState<ExportQuality>(
		DEFAULT_EXPORT_OPTIONS.quality,
	);
	const [videoChroma, setVideoChroma] =
		useState<ExportVideoChroma>(DEFAULT_VIDEO_CHROMA);
	const [shouldIncludeAudio, setShouldIncludeAudio] = useState<boolean>(
		DEFAULT_EXPORT_OPTIONS.includeAudio ?? true,
	);

	const handleExport = async () => {
		if (!activeProject) return;

		const result = await editor.project.export({
			options: {
				format,
				quality,
				...selectedVideoChroma(videoChroma),
				fps: activeProject.settings.fps,
				includeAudio: shouldIncludeAudio,
				...(exportRange ? { range: exportRange } : {}),
			},
		});

		if (result.cancelled) {
			editor.project.clearExportState();
			return;
		}

		if (result.success && result.buffer) {
			downloadBuffer({
				buffer: result.buffer,
				filename: `${activeProject.metadata.name}${getExportFileExtension({ format })}`,
				mimeType: getExportMimeType({ format }),
				resources: editor.resources,
			});

			editor.project.clearExportState();
			onOpenChange(false);
		}
	};

	const handleCancel = () => {
		editor.project.cancelExport();
	};

	return (
		<>
			{exportResult && !exportResult.success ? (
				<ExportError
					error={exportResult.error || "Unknown error occurred"}
					onRetry={handleExport}
				/>
			) : (
				<>
					<div className="flex items-center justify-between p-3 border-b">
						<h3 className="font-medium text-sm">
							{isExporting ? messages.exportingProject : messages.exportProject}
						</h3>
					</div>

					<div className="flex flex-col gap-4">
						{!isExporting && (
							<>
								<div className="flex flex-col">
									<Section
										collapsible
										defaultOpen={false}
										showTopBorder={false}
									>
										<SectionHeader>
											<SectionTitle>{messages.exportFormat}</SectionTitle>
										</SectionHeader>
										<SectionContent>
											<RadioGroup
												value={format}
												onValueChange={(value) => {
													if (isExportFormat(value)) {
														setFormat(value);
														if (value !== "webm")
															setVideoChroma(DEFAULT_VIDEO_CHROMA);
													}
												}}
											>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="mp4" id="mp4" />
													<Label htmlFor="mp4">{messages.mp4Compatibility}</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="webm" id="webm" />
													<Label htmlFor="webm">{messages.webmSize}</Label>
												</div>
											</RadioGroup>
										</SectionContent>
									</Section>

									<Section collapsible defaultOpen={false}>
										<SectionHeader>
											<SectionTitle>{messages.exportQuality}</SectionTitle>
										</SectionHeader>
										<SectionContent>
											<RadioGroup
												value={quality}
												onValueChange={(value) => {
													if (isExportQuality(value)) {
														setQuality(value);
													}
												}}
											>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="low" id="low" />
													<Label htmlFor="low">{messages.qualityLow}</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="medium" id="medium" />
													<Label htmlFor="medium">{messages.qualityMedium}</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="high" id="high" />
													<Label htmlFor="high">{messages.qualityHigh}</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="very_high" id="very_high" />
													<Label htmlFor="very_high">{messages.qualityVeryHigh}</Label>
												</div>
											</RadioGroup>
										</SectionContent>
									</Section>

									{format === "webm" && (
										<Section>
											<SectionHeader>
												<SectionTitle>{messages.chroma}</SectionTitle>
											</SectionHeader>
											<SectionContent>
												<ExportVideoChromaControl
													value={videoChroma}
													onChange={setVideoChroma}
												/>
											</SectionContent>
										</Section>
									)}

									<Section collapsible defaultOpen={exportRange !== null}>
										<SectionHeader>
											<SectionTitle>{messages.exportRange}</SectionTitle>
										</SectionHeader>
										<SectionContent>
											<div className="space-y-2 text-sm">
												<p className="text-muted-foreground">
													{exportRange
														? `${(exportRange.startTime / TICKS_PER_SECOND).toFixed(2)}s – ${(exportRange.endTime / TICKS_PER_SECOND).toFixed(2)}s`
														: messages.fullTimeline}
												</p>
												{exportRange && (
													<Button
														variant="outline"
														size="sm"
														onClick={() => editor.project.clearExportRange()}
													>
														{messages.useFullTimeline}
													</Button>
												)}
											</div>
										</SectionContent>
									</Section>

									<Section collapsible defaultOpen={false}>
										<SectionHeader>
											<SectionTitle>{messages.audio}</SectionTitle>
										</SectionHeader>
										<SectionContent>
											<div className="flex items-center space-x-2">
												<Checkbox
													id="include-audio"
													checked={shouldIncludeAudio}
													onCheckedChange={(checked) =>
														setShouldIncludeAudio(!!checked)
													}
												/>
													<Label htmlFor="include-audio">{messages.exportAudio}</Label>
											</div>
										</SectionContent>
									</Section>
								</div>

								<div className="p-3 pt-0">
									<Button onClick={handleExport} className="w-full gap-2">
										<Download className="size-4" />
										{messages.startExport}
									</Button>
								</div>
							</>
						)}

						{isExporting && (
							<div className="space-y-4 p-3">
								<div className="flex flex-col gap-2">
									<div className="flex items-center justify-between text-center">
										<p className="text-muted-foreground text-sm">
											{Math.round(progress * 100)}%
										</p>
										<p className="text-muted-foreground text-sm">100%</p>
									</div>
									<Progress value={progress * 100} className="w-full" />
								</div>

								<Button
									variant="outline"
									className="w-full rounded-md"
									onClick={handleCancel}
								>
									{messages.cancel}
								</Button>
							</div>
						)}
					</div>
				</>
			)}
		</>
	);
}

function ExportError({
	error,
	onRetry,
}: {
	error: string;
	onRetry: () => void;
}) {
	const messages = useEditorMessages();
	const [copied, setCopied] = useState(false);
	const { resources } = useEditorSession();

	const handleCopy = async () => {
		await navigator.clipboard.writeText(error);
		setCopied(true);
		resources.setTimeout({
			handler: () => setCopied(false),
			ms: 1000,
		});
	};

	return (
		<div className="space-y-4 p-3">
			<div className="flex flex-col gap-1.5">
				<p className="text-destructive text-sm font-medium">{messages.exportFailed}</p>
				<p className="text-muted-foreground text-xs">{error}</p>
			</div>

			<div className="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					className="h-8 flex-1 text-xs"
					onClick={handleCopy}
				>
					{copied ? <Check className="text-constructive" /> : <Copy />}
					{messages.copyError}
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="h-8 flex-1 text-xs"
					onClick={onRetry}
				>
					<RotateCcw />
					{messages.retryOperation}
				</Button>
			</div>
		</div>
	);
}
