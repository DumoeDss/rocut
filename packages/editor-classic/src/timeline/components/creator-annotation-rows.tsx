import { useEffect, useRef, useState } from "react";
import { useCreatorWorkspace } from "../../editor/surface/creator-workspace-context";
import type {
	CreatorTimelineAnnotations,
	CreatorTimelineLyric,
	CreatorWorkspaceBridge,
} from "../../editor/surface/creator-workspace-types";
import { useEditor, useEditorInstance } from "../../editor/use-editor";
import { UpdateElementsCommand } from "../../commands/timeline/element/update-elements";
import { mediaTime } from "../../wasm";
import {
	getTimelinePixelsPerSecond,
	timelineTimeToPixels,
} from "../pixel-utils";

export const CREATOR_ANNOTATION_ROW_HEIGHT = 30;

export function useCreatorTimelineAnnotations() {
	const editor = useEditorInstance();
	const { bridge, snapshot } = useCreatorWorkspace();
	const projectId = useEditor((e) => e.project.getActiveOrNull()?.metadata.id);
	const scene = useEditor((e) => e.scenes.getActiveSceneOrNull());
	const [loaded, setLoaded] = useState<{
		bridge: CreatorWorkspaceBridge;
		projectId: string;
		sceneId: string;
		annotations: CreatorTimelineAnnotations | null;
		failure: string | null;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(
		() => editor.save.observePublications(() => setError(null)),
		[editor],
	);
	const current =
		loaded?.bridge === bridge &&
		loaded.projectId === projectId &&
		loaded.sceneId === scene?.id
			? loaded
			: null;
	const annotations = current?.annotations;
	useEffect(() => {
		let cancelled = false;
		if (!bridge || !projectId || !scene?.id) return;
		const owner = { bridge, projectId, sceneId: scene.id };
		void bridge
			.execute({
				type: "timeline.annotations",
				nativeProjectId: projectId,
				sceneId: scene.id,
			})
			.then((result) => {
				if (cancelled) return;
				setLoaded({
					...owner,
					annotations:
						result.annotations?.status === "available"
							? result.annotations
							: null,
					failure: null,
				});
			})
			.catch((failure: unknown) => {
				if (!cancelled)
					setLoaded({
						...owner,
						annotations: null,
						failure:
							failure instanceof Error ? failure.message : "无法读取歌词轨",
					});
			});
		return () => {
			cancelled = true;
		};
	}, [bridge, projectId, scene?.id, snapshot?.revision]);
	const tracks = scene
		? [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]
		: [];
	const live = annotations
		? {
				...annotations,
				lyrics: annotations.lyrics.flatMap((line) => {
					const element = tracks
						.find((track) => track.id === line.trackId)
						?.elements.find((row) => row.id === line.clipId);
					return element
						? [
								{
									...line,
									startTick: element.startTime,
									endTick: element.startTime + element.duration,
								},
							]
						: [];
				}),
			}
		: null;
	const move = async ({
		line,
		startTick,
	}: {
		line: CreatorTimelineLyric;
		startTick: number;
	}) => {
		try {
			setError(null);
			await editor.command.execute({
				command: new UpdateElementsCommand({
					updates: [
						{
							trackId: line.trackId,
							elementId: line.clipId,
							patch: { startTime: mediaTime({ ticks: startTick }) },
						},
					],
				}),
			});
			await editor.save.flush();
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "歌词位置保存失败，请重试保存",
			);
		}
	};
	return { annotations: live, error: current?.failure ?? error, move };
}

export function CreatorAnnotationLabels() {
	return (
		<div
			className="pointer-events-none absolute inset-x-0 bottom-0 text-right text-xs"
			aria-hidden="true"
		>
			{["段落", "歌词"].map((label) => (
				<div
					key={label}
					className="flex items-center justify-end border-t px-3"
					style={{ height: CREATOR_ANNOTATION_ROW_HEIGHT }}
				>
					{label}
				</div>
			))}
		</div>
	);
}

export function CreatorAnnotationRows({
	annotations,
	zoomLevel,
	error,
	onMove,
}: {
	annotations: CreatorTimelineAnnotations;
	zoomLevel: number;
	error: string | null;
	onMove(input: {
		line: CreatorTimelineLyric;
		startTick: number;
	}): Promise<void>;
}) {
	const [drag, setDrag] = useState<{
		line: CreatorTimelineLyric;
		start: number;
	} | null>(null);
	const origin = useRef(0);
	const pixels = getTimelinePixelsPerSecond({ zoomLevel });
	const frame =
		(120000 * annotations.frameRate.denominator) /
		annotations.frameRate.numerator;
	const left = (tick: number) =>
		timelineTimeToPixels({ time: tick, zoomLevel });
	return (
		<div data-testid="creator-timeline-annotations" title={error ?? undefined}>
			<div
				className="relative border-t"
				aria-label="段落轨"
				title={annotations.sectionsReason}
				style={{ height: CREATOR_ANNOTATION_ROW_HEIGHT }}
			>
				{annotations.sections.length === 0 && <span className="sticky left-0 px-2 text-xs text-muted-foreground">{annotations.sectionsReason ?? "乐段待审定"}</span>}
				{annotations.sections.map((section) => (
					<div
						key={section.id}
						title={`${section.label}${annotations.sectionsStatus === "candidate" ? "（分析候选）" : ""}`}
						className="absolute inset-y-1 truncate rounded bg-lime-700 px-1 text-xs text-white"
						style={{
							left: left(section.startTick),
							width: Math.max(4, left(section.endTick - section.startTick)),
						}}
					>
						{section.label}
					</div>
				))}
			</div>
			<div
				className="relative border-y"
				aria-label="歌词轨"
				style={{ height: CREATOR_ANNOTATION_ROW_HEIGHT }}
			>
				{annotations.lyrics.map((line) => {
					const start = drag?.line.id === line.id ? drag.start : line.startTick;
					return (
						<button
							key={line.id}
							type="button"
							title={error ?? `${line.label} · 拖动调整，方向键逐帧移动`}
							aria-label={`歌词：${line.label}`}
							className="absolute inset-y-1 touch-none truncate rounded bg-purple-700 px-1 text-left text-xs text-white focus-visible:ring-2"
							style={{
								left: left(start),
								width: Math.max(4, left(line.endTick - line.startTick)),
							}}
							onMouseDown={(event) => event.stopPropagation()}
							onPointerDown={(event) => {
								if (event.button !== 0) return;
								event.stopPropagation();
								origin.current = event.clientX;
								event.currentTarget.setPointerCapture(event.pointerId);
								setDrag({ line, start: line.startTick });
							}}
							onPointerMove={(event) => {
								if (!drag || drag.line.id !== line.id) return;
								setDrag({
									line: drag.line,
									start: Math.max(
										0,
										drag.line.startTick +
											Math.round(
												((event.clientX - origin.current) * 120000) /
													pixels /
													frame,
											) *
												frame,
									),
								});
							}}
							onPointerCancel={() => setDrag(null)}
							onPointerUp={(event) => {
								if (!drag || drag.line.id !== line.id) return;
								event.stopPropagation();
								if (drag.start !== drag.line.startTick)
									void onMove({ line: drag.line, startTick: drag.start });
								setDrag(null);
							}}
							onKeyDown={(event) => {
								if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
									return;
								event.preventDefault();
								event.stopPropagation();
								void onMove({
									line,
									startTick: Math.max(
										0,
										line.startTick +
											(event.key === "ArrowLeft" ? -frame : frame),
									),
								});
							}}
						>
							{line.label}
						</button>
					);
				})}
			</div>
			{error && (
				<span role="alert" className="sticky left-0 text-xs text-destructive">
					歌词位置保存失败：{error}
				</span>
			)}
		</div>
	);
}
