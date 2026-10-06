import { Button } from "../../components/ui/button";
import { PanelView } from "../../components/editor/panels/assets/views/base-panel";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../components/ui/select";
import { useRef, useState } from "react";
import { extractTimelineAudio } from "../../media/mediabunny";
import { useEditor, useEditorInstance } from "../../editor/use-editor";
import { TRANSCRIPTION_DIAGNOSTICS_SCOPE } from "../../transcription/diagnostics";
import { DEFAULT_TRANSCRIPTION_SAMPLE_RATE } from "../../transcription/audio";
import { TRANSCRIPTION_LANGUAGES } from "../../transcription/supported-languages";
import type {
	CaptionChunk,
	TranscriptionLanguage,
	TranscriptionProgress,
} from "../../transcription/types";
import { decodeAudioToFloat32 } from "../../media/audio";
import { buildCaptionChunks } from "../../transcription/caption";
import { insertCaptionChunksAsTextTrack } from "../insert";
import { parseSubtitleFile } from "../parse";
import { Spinner } from "../../components/ui/spinner";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
} from "../../components/section";
import { AlertCircleIcon, CloudUploadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "../../components/ui/tooltip";
import type { DiagnosticSeverity } from "../../diagnostics/types";
import { useCaptionTask } from "../use-caption-task";

const DIAGNOSTIC_BUTTON_VARIANT: Record<
	DiagnosticSeverity,
	"caution" | "destructive-foreground"
> = {
	caution: "caution",
	error: "destructive-foreground",
};

export function Captions() {
	const [selectedLanguage, setSelectedLanguage] =
		useState<TranscriptionLanguage>("auto");
	const { processing, begin, cancel } = useCaptionTask();
	const containerRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const importButtonRef = useRef<HTMLButtonElement>(null);
	const generateButtonRef = useRef<HTMLButtonElement>(null);
	const editor = useEditorInstance();
	const transcriptionService = editor.transcription;

	const isProcessing = processing.status === "processing";

	const activeDiagnostics = useEditor((e) =>
		e.diagnostics.getActive({ scope: TRANSCRIPTION_DIAGNOSTICS_SCOPE }),
	);

	const insertCaptions = async ({
		captions,
	}: {
		captions: CaptionChunk[];
	}): Promise<boolean> => {
		const trackId = await insertCaptionChunksAsTextTrack({ editor, captions });
		return trackId !== null;
	};

	const handleGenerateTranscript = async () => {
		const task = begin({
			step: "Extracting audio...",
			onCancel: () => transcriptionService.cancel(),
		});
		if (!task) return;
		try {
			const audioBlob = await extractTimelineAudio({
				tracks: editor.scenes.getActiveScene().tracks,
				mediaAssets: editor.media.getAssets(),
				totalDuration: editor.timeline.getTotalDuration(),
				resources: editor.resources,
			});
			if (!task.isCurrent()) return;

			task.updateStep({ step: "Preparing audio..." });
			const { samples } = await decodeAudioToFloat32({
				audioBlob,
				sampleRate: DEFAULT_TRANSCRIPTION_SAMPLE_RATE,
				resources: editor.resources,
			});
			if (!task.isCurrent()) return;

			const result = await transcriptionService.transcribe({
				audioData: samples,
				language: selectedLanguage === "auto" ? undefined : selectedLanguage,
				onProgress: (progress: TranscriptionProgress) => {
					if (progress.status === "loading-model") {
						task.updateStep({
							step: `Loading model ${Math.round(progress.progress)}%`,
						});
					} else if (progress.status === "transcribing") {
						task.updateStep({ step: "Transcribing..." });
					}
				},
			});
			if (!task.isCurrent()) return;

			task.updateStep({ step: "Generating captions..." });
			const captionChunks = buildCaptionChunks({ segments: result.segments });

			if (!task.beginCommit()) return;
			if (!(await insertCaptions({ captions: captionChunks }))) {
				task.fail({ error: "No captions were generated" });
				return;
			}

			task.succeed();
		} catch (error) {
			if (!task.isCurrent()) return;
			console.error("Transcription failed:", error);
			task.fail({
				error:
					error instanceof Error
						? error.message
						: "An unexpected error occurred",
			});
		}
	};

	const handleImportClick = () => {
		if (isProcessing) return;
		fileInputRef.current?.click();
	};

	const handleImportFile = async ({ file }: { file: File }) => {
		const task = begin({ step: "Reading subtitle file..." });
		if (!task) return;
		try {
			const input = await file.text();
			if (!task.isCurrent()) return;
			const result = parseSubtitleFile({
				fileName: file.name,
				input,
			});

			if (result.captions.length === 0) {
				task.fail({
					error: "No valid subtitle cues were found in the subtitle file",
				});
				return;
			}

			task.updateStep({ step: "Importing subtitles..." });

			if (!task.beginCommit()) return;
			if (!(await insertCaptions({ captions: result.captions }))) {
				task.fail({ error: "No captions were generated" });
				return;
			}

			const nextWarnings = [...result.warnings];
			if (result.skippedCueCount > 0) {
				nextWarnings.unshift(
					`Imported ${result.captions.length} subtitle cue(s) and skipped ${result.skippedCueCount} malformed cue(s).`,
				);
			}

			task.succeed({ warnings: nextWarnings });
		} catch (error) {
			if (!task.isCurrent()) return;
			console.error("Subtitle import failed:", error);
			task.fail({
				error:
					error instanceof Error
						? error.message
						: "An unexpected error occurred",
			});
		}
	};

	const handleFileChange = async ({
		event,
	}: {
		event: React.ChangeEvent<HTMLInputElement>;
	}) => {
		const file = event.target.files?.[0];
		if (event.target) {
			event.target.value = "";
		}
		if (!file) return;

		await handleImportFile({ file });
	};

	const handleLanguageChange = ({ value }: { value: string }) => {
		if (value === "auto") {
			setSelectedLanguage("auto");
			return;
		}

		const matchedLanguage = TRANSCRIPTION_LANGUAGES.find(
			(language) => language.code === value,
		);
		if (!matchedLanguage) return;
		setSelectedLanguage(matchedLanguage.code);
	};

	const error = processing.status === "idle" ? processing.error : null;
	const warnings = processing.status === "idle" ? processing.warnings : [];

	return (
		<PanelView
			title="Captions"
			contentClassName="px-0 flex flex-col h-full"
			actions={
				<TooltipProvider>
					<div className="flex items-center gap-1.5">
						{!isProcessing &&
							activeDiagnostics.map((diagnostic) => (
								<Tooltip key={diagnostic.id}>
									<TooltipTrigger asChild>
										<Button
											variant={DIAGNOSTIC_BUTTON_VARIANT[diagnostic.severity]}
											size="icon"
											aria-label={diagnostic.message}
										>
											<HugeiconsIcon icon={AlertCircleIcon} size={16} />
										</Button>
									</TooltipTrigger>
									<TooltipContent>{diagnostic.message}</TooltipContent>
								</Tooltip>
							))}
						<Button
							ref={importButtonRef}
							type="button"
							variant="outline"
							size="sm"
							onClick={handleImportClick}
							aria-disabled={isProcessing}
							className="items-center justify-center gap-1.5"
						>
							<HugeiconsIcon icon={CloudUploadIcon} />
							Import
						</Button>
					</div>
				</TooltipProvider>
			}
			ref={containerRef}
		>
			<input
				ref={fileInputRef}
				type="file"
				accept=".srt,.ass"
				className="hidden"
				onChange={(event) => void handleFileChange({ event })}
			/>
			<Section
				showTopBorder={false}
				showBottomBorder={false}
				className="flex-1"
			>
				<SectionContent className="flex flex-col gap-4 h-full pt-1">
					<SectionFields>
						<SectionField label="Language">
							<Select
								value={selectedLanguage}
								onValueChange={(value) => handleLanguageChange({ value })}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select a language" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">Auto detect</SelectItem>
									{TRANSCRIPTION_LANGUAGES.map((language) => (
										<SelectItem key={language.code} value={language.code}>
											{language.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>
					</SectionFields>

					<Button
						ref={generateButtonRef}
						type="button"
						className="mt-auto w-full"
						onClick={handleGenerateTranscript}
						disabled={activeDiagnostics.length > 0}
						aria-disabled={isProcessing || activeDiagnostics.length > 0}
						aria-busy={isProcessing}
					>
						{isProcessing && <Spinner className="mr-1" />}
						{isProcessing ? processing.step : "Generate transcript"}
					</Button>
					{processing.status === "processing" && processing.cancellable && (
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								cancel();
								if (generateButtonRef.current?.disabled)
									importButtonRef.current?.focus();
								else generateButtonRef.current?.focus();
							}}
						>
							Cancel caption operation
						</Button>
					)}
					{error && (
						<div
							role="alert"
							className="bg-destructive/10 border-destructive/20 rounded-md border p-3"
						>
							<p className="text-destructive text-sm">{error}</p>
						</div>
					)}
					{warnings.length > 0 && (
						<div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3">
							<ul className="space-y-1 text-sm text-amber-700">
								{warnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						</div>
					)}
				</SectionContent>
			</Section>
		</PanelView>
	);
}
