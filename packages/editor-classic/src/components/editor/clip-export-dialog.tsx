"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ExportClipSelection } from "opencut-wasm";
import { useEditor, useEditorInstance } from "../../editor/use-editor";
import {
	downloadBuffer,
	EXPORT_FORMAT_VALUES,
	EXPORT_QUALITY_VALUES,
	getExportMimeType,
	type ExportFormat,
	type ExportQuality,
	type ExportVideoChroma,
} from "../../export";
import { prepareClipExports } from "../../export/clip-export-plan";
import { runClipExportBatch } from "../../export/clip-export-batch";
import {
	DEFAULT_VIDEO_CHROMA,
	selectedVideoChroma,
} from "../../export/defaults";
import { ExportVideoChromaControl } from "./export-video-chroma";
import { TICKS_PER_SECOND } from "../../wasm";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "../ui/dialog";
import { Progress } from "../ui/progress";

/** Mount only while open: each opening captures exactly the reviewed timeline. */
export function ClipExportDialog({
	selection,
	onClose,
	onCloseAutoFocus,
}: {
	selection: ExportClipSelection;
	onClose: () => void;
	onCloseAutoFocus?: (event: Event) => void;
}) {
	const editor = useEditorInstance();
	const controlId = useId();
	const [prepared] = useState(() => {
		try {
			return { plan: prepareClipExports({ editor, selection }), error: null };
		} catch (error) {
			return {
				plan: null,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});
	const clips = prepared.plan?.clips ?? [];
	const [selected, setSelected] = useState(
		() => new Set(clips.map((_, index) => index)),
	);
	const [format, setFormat] = useState<ExportFormat>("mp4");
	const [quality, setQuality] = useState<ExportQuality>("high");
	const [videoChroma, setVideoChroma] =
		useState<ExportVideoChroma>(DEFAULT_VIDEO_CHROMA);
	const [includeAudio, setIncludeAudio] = useState(true);
	const [running, setRunning] = useState(false);
	const [status, setStatus] = useState("");
	const [error, setError] = useState(prepared.error);
	const [index, setIndex] = useState(0);
	const controller = useRef<AbortController | null>(null);
	const mounted = useRef(true);
	const exportState = useEditor((instance) =>
		instance.project.getExportState(),
	);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			if (controller.current) {
				controller.current.abort();
				editor.project.cancelExport();
			}
		};
	}, [editor]);
	const cancel = () => {
		controller.current?.abort();
		editor.project.cancelExport();
	};
	const start = async () => {
		if (
			!prepared.plan ||
			controller.current ||
			exportState.isExporting ||
			selected.size === 0
		)
			return;
		const abort = new AbortController();
		controller.current = abort;
		setRunning(true);
		setError(null);
		const result = await runClipExportBatch({
			clips: clips.filter((_, itemIndex) => selected.has(itemIndex)),
			options: {
				format,
				quality,
				includeAudio,
				fps: prepared.plan.fps,
				...selectedVideoChroma(videoChroma),
			},
			signal: abort.signal,
			assertCurrent: prepared.plan.assertCurrent,
			render: (options) => editor.project.export({ options }),
			publish: ({ buffer, filename }) =>
				downloadBuffer({
					buffer,
					filename,
					mimeType: getExportMimeType({ format }),
					resources: editor.resources,
				}),
			onClip: ({ index: nextIndex, name }) => {
				setIndex(nextIndex);
				setStatus(`正在渲染 ${nextIndex + 1}/${selected.size}：${name}`);
			},
		});
		controller.current = null;
		editor.project.clearExportState();
		if (mounted.current) {
			setRunning(false);
			setError(result.error ?? null);
			setStatus(
				`${result.cancelled ? "已取消。" : ""}已将 ${result.completed}/${selected.size} 个文件发送至下载。`,
			);
		}
	};
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) {
					if (running) cancel();
					onClose();
				}
			}}
		>
			<DialogContent
				onCloseAutoFocus={onCloseAutoFocus}
				className="flex max-h-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden"
			>
				<div className="shrink-0 border-b p-5 pr-14">
					<DialogTitle>导出片段</DialogTitle>
					<DialogDescription className="mt-2">
						每个选中的时间线片段导出为一个文件，包含该时间范围内叠加的图层、效果和音频，并非原始素材文件。
					</DialogDescription>
				</div>
				<div
					className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5"
					data-testid="clip-export-scroll"
				>
					{clips.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							暂无可导出的时间线片段。请先将素材添加到时间线，再重新打开“导出片段”。
						</p>
					) : (
						<fieldset disabled={running} className="space-y-2">
							<legend className="mb-2 text-sm font-medium">
								选择片段（{selected.size}/{clips.length}）
							</legend>
							<div className="flex gap-2">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setSelected(new Set(clips.map((_, i) => i)))}
								>
									全选
								</Button>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setSelected(new Set())}
								>
									清空选择
								</Button>
							</div>
							{clips.map((clip, itemIndex) => (
								<label
									key={clip.filenameStem}
									htmlFor={`${controlId}-clip-${itemIndex}`}
									className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent/40"
								>
									<Checkbox
										id={`${controlId}-clip-${itemIndex}`}
										aria-label={`导出 ${clip.name}（${itemIndex + 1}）`}
										checked={selected.has(itemIndex)}
										onCheckedChange={(checked) =>
											setSelected((previous) => {
												const next = new Set(previous);
												if (checked) next.add(itemIndex);
												else next.delete(itemIndex);
												return next;
											})
										}
									/>
									<span className="min-w-0 flex-1">
										<span className="block break-words text-sm font-medium">
											{clip.name}
										</span>
										<span className="mt-1 block break-words text-xs text-muted-foreground">
											<span className="block">{clip.trackName}</span>
											{(clip.startTime / TICKS_PER_SECOND).toFixed(2)}s –{" "}
											{(clip.endTime / TICKS_PER_SECOND).toFixed(2)}s
										</span>
										<span className="block break-all text-xs text-muted-foreground">
											{clip.filenameStem}.{format}
										</span>
									</span>
								</label>
							))}
						</fieldset>
					)}
					<fieldset
						disabled={running}
						className="mt-5 grid grid-cols-2 gap-3 text-sm"
					>
						<label className="flex flex-col gap-1">
							格式
							<select
								aria-label="片段导出格式"
								value={format}
								onChange={(event) => {
									const next = EXPORT_FORMAT_VALUES.find(
										(value) => value === event.target.value,
									);
									if (next) {
										setFormat(next);
										if (next !== "webm") setVideoChroma(DEFAULT_VIDEO_CHROMA);
									}
								}}
								className="rounded border bg-background p-2"
							>
								<option value="mp4">MP4 (H.264)</option>
								<option value="webm">WebM (VP9)</option>
							</select>
						</label>
						<label className="flex flex-col gap-1">
							质量
							<select
								aria-label="片段导出质量"
								value={quality}
								onChange={(event) => {
									const next = EXPORT_QUALITY_VALUES.find(
										(value) => value === event.target.value,
									);
									if (next) setQuality(next);
								}}
								className="rounded border bg-background p-2"
							>
								<option value="low">低</option>
								<option value="medium">中</option>
								<option value="high">高</option>
								<option value="very_high">极高</option>
							</select>
						</label>
						{format === "webm" && (
							<div className="col-span-2">
								<ExportVideoChromaControl
									value={videoChroma}
									onChange={setVideoChroma}
								/>
							</div>
						)}
						<label
							htmlFor={`${controlId}-audio`}
							className="col-span-2 flex items-center gap-2"
						>
							<Checkbox
								id={`${controlId}-audio`}
								checked={includeAudio}
								onCheckedChange={(checked) => setIncludeAudio(checked === true)}
							/>
							包含时间线音频
						</label>
					</fieldset>
				</div>
				<div className="shrink-0 space-y-3 border-t p-5">
					{error && (
						<p role="alert" className="break-words text-sm text-destructive">
							{error}
						</p>
					)}
					{status && (
						<p
							role="status"
							className="break-words text-sm text-muted-foreground"
						>
							{status}
						</p>
					)}
					{running && (
						<Progress
							aria-label="片段导出进度"
							value={((index + exportState.progress) / selected.size) * 100}
						/>
					)}
					<div className="flex justify-end gap-2">
						{running ? (
							<Button variant="outline" onClick={cancel}>
								取消导出
							</Button>
						) : (
							<>
								<Button variant="outline" onClick={onClose}>
									关闭
								</Button>
								<Button
									disabled={
										!prepared.plan ||
										selected.size === 0 ||
										exportState.isExporting
									}
									onClick={() => void start()}
								>
									导出 {selected.size} 个片段
								</Button>
							</>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
