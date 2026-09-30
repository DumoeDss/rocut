"use client";

import { useRef, useState } from "react";
import { CloudUploadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { useEditorInstance } from "../../editor/use-editor";
import { MOTION_TEXT_RENDERER_SUPPORT } from "../../services/renderer/motion-text/support-manifest";
import { buildMotionTextElement } from "../../timeline/element-utils";
import { generateUUID } from "../../utils/id";
import { cn } from "../../utils/ui";
import {
	importJizuraMotionTextProject,
	mediaTime,
	type ImportedJizuraMotionTextProject,
} from "../../wasm";

interface ImportNotice {
	readonly kind: "error" | "warning" | "success";
	readonly message: string;
	readonly details: readonly string[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function importedSequenceName(result: ImportedJizuraMotionTextProject): string {
	const metadata = result.sequence?.defaults.parameters["jizura.import"];
	if (
		isRecord(metadata) &&
		typeof metadata.title === "string" &&
		metadata.title.trim().length > 0
	) {
		return `${metadata.title} · JIZURA`;
	}
	return "Imported JIZURA motion text";
}

function resultNotice(result: ImportedJizuraMotionTextProject): ImportNotice {
	const diagnostic =
		result.diagnostics.find((entry) => entry.severity === "error") ??
		result.diagnostics.find((entry) => entry.severity === "warning");
	const missingResources = result.resourcesNeeded.filter(
		(resource) => resource.status === "missing",
	);
	const compatibilityDetails = result.compatibilityReport.items
		.filter(
			(item) => item.status === "unsupported" || item.status === "approximated",
		)
		.map((item) => `${item.path}: ${item.message}`);
	const details = [
		...missingResources.map((resource) => resource.message),
		...compatibilityDetails,
	].filter((detail, index, values) => values.indexOf(detail) === index);
	if (!result.sequence) {
		return {
			kind: "error",
			message:
				diagnostic?.message ?? "The JIZURA project could not be imported.",
			details: details.slice(0, 5),
		};
	}
	if (
		result.compatibilityReport.status === "imported-with-warnings" ||
		diagnostic?.severity === "warning"
	) {
		return {
			kind: "warning",
			message: `Imported ${result.sequence.cues.length} lyric line${result.sequence.cues.length === 1 ? "" : "s"} with compatibility notes.`,
			details: details.slice(0, 5),
		};
	}
	return {
		kind: "success",
		message: `Imported ${result.sequence.cues.length} lyric line${result.sequence.cues.length === 1 ? "" : "s"}.`,
		details: [],
	};
}

export function JizuraImportControl() {
	const editor = useEditorInstance();
	const inputRef = useRef<HTMLInputElement>(null);
	const [isImporting, setIsImporting] = useState(false);
	const [notice, setNotice] = useState<ImportNotice | null>(null);

	const importFile = async ({ file }: { file: File }) => {
		if (isImporting) return;
		setIsImporting(true);
		setNotice(null);
		try {
			const projectJson = await file.text();
			const result = importJizuraMotionTextProject({
				sequenceId: `motion-text:${generateUUID()}`,
				projectJson,
				rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			});
			const nextNotice = resultNotice(result);
			if (!result.sequence) {
				setNotice(nextNotice);
				return;
			}
			await editor.timeline.insertMotionTextSequence({
				sequence: result.sequence,
				element: buildMotionTextElement({
					sequenceId: result.sequence.id,
					name: importedSequenceName(result),
					startTime: editor.playback.getCurrentTime(),
					duration: mediaTime({ ticks: result.sequence.duration }),
				}),
				placement: { mode: "auto" },
			});
			setNotice(nextNotice);
		} catch (error) {
			setNotice({
				kind: "error",
				message:
					error instanceof Error
						? error.message
						: "The JIZURA project could not be imported.",
				details: [],
			});
		} finally {
			setIsImporting(false);
		}
	};

	return (
		<div className="flex flex-col gap-2 rounded-md border p-3">
			<input
				ref={inputRef}
				type="file"
				accept=".jizura.json,.json,application/json"
				className="hidden"
				onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) void importFile({ file });
				}}
			/>
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<p className="text-sm font-medium">JIZURA project</p>
					<p className="text-muted-foreground text-[11px] leading-4">
						Import lyrics, timing, presets, locks, fonts, and provenance.
					</p>
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={isImporting}
					onClick={() => inputRef.current?.click()}
					className="shrink-0 gap-1.5"
				>
					{isImporting ? (
						<Spinner className="size-4" />
					) : (
						<HugeiconsIcon icon={CloudUploadIcon} size={16} />
					)}
					{isImporting ? "Importing…" : "Import"}
				</Button>
			</div>
			{notice && (
				<div
					role={notice.kind === "error" ? "alert" : "status"}
					className={cn(
						"rounded-sm border px-2 py-1.5 text-xs leading-5",
						notice.kind === "error" && "border-destructive/40 text-destructive",
						notice.kind === "warning" && "border-caution/40 text-caution",
						notice.kind === "success" && "border-border text-foreground",
					)}
				>
					<p>{notice.message}</p>
					{notice.details.length > 0 && (
						<ul className="mt-1 list-disc space-y-0.5 pl-4">
							{notice.details.map((detail) => (
								<li key={detail}>{detail}</li>
							))}
						</ul>
					)}
				</div>
			)}
		</div>
	);
}
