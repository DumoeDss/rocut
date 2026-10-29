import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSurfacePortalContainer } from "../../editor/surface/embedding/surface-portal";
import type {
	MusicGridSourceAvailabilityProbe,
	TransactionRead,
} from "@opencut/editor-contracts";
import { mediaTimeToSeconds } from "opencut-wasm";
import {
	loadMusicAnchorFile,
	projectMusicAnchorFile,
	type MusicAnchorFile,
} from "../music-anchor-view";
import type { TimelineMusicGridView } from "../music-grid-view";

export function MusicAnchorOverlay({
	engine,
	sourceAvailability,
	bindingId,
	view,
	pixelsPerSecond,
	viewportLeft,
}: {
	engine: TransactionRead;
	sourceAvailability: MusicGridSourceAvailabilityProbe;
	bindingId: string;
	view: TimelineMusicGridView;
	pixelsPerSecond: number;
	viewportLeft: number;
}) {
	const [file, setFile] = useState<MusicAnchorFile | null>(null);
	const portal = useSurfacePortalContainer();
	const [enabled, setEnabled] = useState(true);
	const [error, setError] = useState("");
	const [open, setOpen] = useState(false);
	const fileGeneration = useRef(0);
	const [projection, setProjection] = useState<Awaited<
		ReturnType<typeof projectMusicAnchorFile>
	> | null>(null);
	useEffect(() => {
		let cancelled = false;
		if (!file || !enabled || !bindingId || view.status !== "ready") return;
		void projectMusicAnchorFile({
			engine,
			sourceAvailability,
			file,
			bindingId,
			expectedNativeRevision: view.nativeRevision,
			expectedGridRevision: view.gridRevision,
			expectedMappingHash: view.mappingHash,
		})
			.then((result) => {
				if (!cancelled) {
					setProjection(result);
					setError("");
				}
			})
			.catch((failure: unknown) => {
				if (!cancelled)
					setError(
						failure instanceof Error ? failure.message : "锚点投影不可用",
					);
			});
		return () => {
			cancelled = true;
		};
	}, [
		engine,
		sourceAvailability,
		file,
		enabled,
		bindingId,
		view.status,
		view.nativeRevision,
		view.gridRevision,
		view.mappingHash,
	]);
	const currentProjection =
		projection?.mappingHash === view.mappingHash &&
		projection?.nativeRevision === view.nativeRevision
			? projection
			: null;
	return (
		<>
			{enabled && currentProjection?.status === "ready" && (
				<div
					className="pointer-events-none absolute inset-0"
					aria-label="独立审定音乐锚点"
				>
					{currentProjection.points.map((point) => (
						<span
							key={point.key}
							data-testid={`music-anchor-${point.key}`}
							title={`${point.label} · ${file?.kind === "lyrics" ? "源歌词锚点；原生歌词位置独立" : "审定乐段"}`}
							className="absolute bottom-0 h-full border-l border-dashed border-lime-400 text-[9px] text-lime-300"
							style={{
								left:
									mediaTimeToSeconds({
										time: Math.min(point.startTick, point.endTick),
									}) * pixelsPerSecond,
							}}
						>
							<span className="absolute bottom-3 max-w-24 truncate">
								{point.label}
							</span>
						</span>
					))}
				</div>
			)}
			<button
				type="button"
				className="absolute top-6 z-30 rounded border bg-background px-2 py-1 text-xs"
				style={{ left: viewportLeft }}
				onMouseDown={(event) => event.stopPropagation()}
				onClick={(event) => {
					event.stopPropagation();
					setOpen(!open);
				}}
				aria-expanded={open}
			>
				歌词 / 乐段独立锚点
			</button>
			{open &&
				portal &&
				createPortal(
					// eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- Portal event boundary prevents source controls from scrubbing the timeline ruler.
					<div
						role="dialog"
						aria-label="音乐源锚点"
						className="fixed bottom-16 left-4 z-[1000] w-[28rem] max-w-[calc(100vw-2rem)] space-y-2 rounded border bg-background p-3 text-xs shadow-xl"
						onMouseDown={(event) => event.stopPropagation()}
						onClick={(event) => event.stopPropagation()}
					>
						<div className="flex justify-between">
							<strong>独立审定源锚点</strong>
							<button
								type="button"
								aria-label="关闭源锚点"
								onClick={() => setOpen(false)}
							>
								关闭
							</button>
						</div>
						<p>
							{view.mode === "manual" ? "人工" : "测量"} · 已审定{" "}
							{view.reviewReference ?? "引用未知"} ·{" "}
							{view.structureLabels?.join(" / ") || "拍号未知"}
						</p>
						<label className="flex items-center gap-2">
							<input
								type="checkbox"
								checked={enabled}
								onChange={(event) => setEnabled(event.target.checked)}
							/>
							显示审定源锚点
						</label>
						<label className="block">
							审定锚点 JSON{" "}
							<input
								type="file"
								accept=".json,application/json"
								aria-label="审定锚点 JSON"
								onChange={(event) => {
									const chosen = event.target.files?.[0];
									if (!chosen) return;
									const current = ++fileGeneration.current;
									setFile(null);
									setProjection(null);
									void loadMusicAnchorFile({ file: chosen })
										.then((result) => {
											if (current !== fileGeneration.current) return;
											setFile(result);
											setError("");
										})
										.catch((failure: unknown) => {
											if (current !== fileGeneration.current) return;
											setError(
												failure instanceof Error
													? failure.message
													: "锚点文件不可用",
											);
										});
								}}
							/>
						</label>
						<p>
							读取固定文件并校验内容指纹，Rust
							按当前歌曲位置、裁剪和速率投影。已有歌词片段的手动位置独立保留。
						</p>
						{file && (
							<p title={file.anchorSource.resourceSha256}>
								{file.name} · {file.kind === "lyrics" ? "歌词" : "乐段"} ·
								已审定 {file.anchorSource.reviewReference} · SHA{" "}
								{file.anchorSource.resourceSha256.slice(0, 12)}
							</p>
						)}
						<p role="status">
							{error ||
								currentProjection?.reason ||
								(currentProjection?.status === "ready"
									? `${currentProjection.points.length} 个锚点可见 · ${currentProjection.unavailableCount} 个超出可播放范围`
									: "选择歌曲网格与审定资源；分析候选不会自动升级为审定锚点")}
						</p>
						{currentProjection?.status === "ready" && (
							<ul className="max-h-32 overflow-auto">
								{currentProjection.points.map((point) => (
									<li key={point.key}>
										{point.label} · {point.startTick}—{point.endTick} scene tick
									</li>
								))}
							</ul>
						)}
					</div>,
					portal,
				)}
		</>
	);
}
