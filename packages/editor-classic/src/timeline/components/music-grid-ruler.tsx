import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSurfacePortalContainer } from "../../editor/surface/embedding/surface-portal";
import type { MusicGridBinding } from "@opencut/editor-contracts";
import { mediaTimeToSeconds } from "opencut-wasm";
import { useEditor, useEditorInstance } from "../../editor/use-editor";
import { isMusicGridAvailable } from "../../editor/transactions/opencut/music-grid";
import { roundMediaTime } from "../../wasm";
import {
	readTimelineMusicGrid,
	snapTimelineMusicGrid,
	type TimelineMusicGridView,
} from "../music-grid-view";
import { MusicAnchorOverlay } from "./music-anchor-overlay";

export function MusicGridRuler({
	pixelsPerSecond,
	startTick,
	endTick,
}: {
	pixelsPerSecond: number;
	startTick: number;
	endTick: number;
}) {
	const editor = useEditorInstance();
	const portal = useSurfacePortalContainer();
	const project = useEditor((current) => current.project.getActiveOrNull());
	const [bindings, setBindings] = useState<readonly MusicGridBinding[]>([]);
	const [bindingId, setBindingId] = useState("");
	const [enabled, setEnabled] = useState(false);
	const [pointKind, setPointKind] = useState<"beat" | "downbeat">("beat");
	const [tolerance, setTolerance] = useState("12000");
	const [view, setView] = useState<TimelineMusicGridView>({
		status: "idle",
		points: [],
	});
	const [message, setMessage] = useState("");
	const mappings = useRef(new Map<string, string>());
	const [needsReview, setNeedsReview] = useState(false);
	const viewportLeft =
		mediaTimeToSeconds({ time: startTick }) * pixelsPerSecond + 8;
	const sourceAvailability = useCallback(
		async ({
			assetId,
			sourceSha256,
		}: {
			assetId: string;
			sourceSha256: string;
		}) => {
			try {
				const asset = editor.media
					.getAssets()
					.find((candidate) => candidate.id === assetId);
				if (!asset?.file) return "unavailable" as const;
				const digest = await crypto.subtle.digest(
					"SHA-256",
					await asset.file.arrayBuffer(),
				);
				const hash = Array.from(new Uint8Array(digest), (byte) =>
					byte.toString(16).padStart(2, "0"),
				).join("");
				return hash === sourceSha256
					? ("available" as const)
					: ("unavailable" as const);
			} catch {
				return "unknown" as const;
			}
		},
		[editor],
	);
	useEffect(() => {
		let generation = 0;
		let disposed = false;
		const refresh = async () => {
			const current = ++generation;
			try {
				if (!isMusicGridAvailable()) {
					setView({
						status: "unavailable",
						reason: "音乐网格运行时不可用",
						points: [],
					});
					return;
				}
				const live = await editor.transactions.project();
				const available =
					live?.musicGridState?.bindings.filter(
						(binding) => binding.sceneId === project?.currentSceneId,
					) ?? [];
				if (disposed || current !== generation) return;
				setBindings(available);
				if (!bindingId) {
					setView({ status: "idle", points: [] });
					return;
				}
				const result = await readTimelineMusicGrid(
					editor.transactions,
					{
						kind: "list",
						bindingId,
						pointKind,
						range: { startTick, endTick },
						offset: 0,
						limit: 10000,
					},
					undefined,
					sourceAvailability,
				);
				if (!disposed && current === generation) {
					if (result.status === "ready" && result.mappingHash) {
						const previous = mappings.current.get(bindingId);
						if (previous && previous !== result.mappingHash)
							setNeedsReview(true);
						mappings.current.set(bindingId, result.mappingHash);
					}
					setView(result);
				}
			} catch (error) {
				if (!disposed && current === generation)
					setView({
						status: "unavailable",
						reason: error instanceof Error ? error.message : "音乐网格不可用",
						points: [],
					});
			}
		};
		void refresh();
		const unwatch = editor.transactions.watch(() => {
			void refresh();
		});
		return () => {
			disposed = true;
			unwatch();
		};
	}, [
		editor,
		project?.metadata.id,
		project?.currentSceneId,
		bindingId,
		pointKind,
		startTick,
		endTick,
		sourceAvailability,
	]);
	const snap = async () => {
		const distance = Number(tolerance);
		if (
			!Number.isSafeInteger(distance) ||
			distance < 0 ||
			view.status !== "ready"
		) {
			setMessage("请设置非负整数 tick 容差并选择可用网格");
			return;
		}
		try {
			const result = await snapTimelineMusicGrid(
				editor.transactions,
				{
					kind: "snap",
					bindingId,
					pointKind,
					expectedNativeRevision: view.nativeRevision,
					expectedGridRevision: view.gridRevision,
					expectedMappingHash: view.mappingHash,
					samples: [
						{ key: "playhead", tick: editor.playback.getCurrentTime() },
					],
					direction: "nearest",
					maxDistanceTicks: distance,
					frameQuantize: true,
				},
				undefined,
				sourceAvailability,
			);
			if (result.status === "matched" && result.tick !== undefined) {
				editor.playback.seek({ time: roundMediaTime({ time: result.tick }) });
				setMessage("播放头已吸附；片段位置未改变");
			} else setMessage(result.reason ?? result.status);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "吸附失败");
		}
	};
	return (
		<>
			{enabled && view.status === "ready" && (
				<div
					className="pointer-events-none absolute inset-0"
					aria-label="音乐拍点"
				>
					{view.points.map((point) => (
						<span
							key={point.id}
							title={`${point.id} · ${point.tick} tick${point.downbeat === true ? " · 重拍" : ""}`}
							className={
								point.downbeat === true
									? "absolute bottom-0 h-3 border-l-2 border-amber-400"
									: "absolute bottom-0 h-2 border-l border-cyan-400"
							}
							style={{
								left:
									mediaTimeToSeconds({ time: point.frameTick }) *
									pixelsPerSecond,
							}}
						/>
					))}
				</div>
			)}
			{/* Event boundary keeps controls from seeking the underlying ruler. */}
			{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
			<div
				className="absolute top-0 z-20 flex max-w-full items-center gap-1 bg-background/90 text-[10px]"
				style={{ left: viewportLeft }}
				onMouseDown={(event) => event.stopPropagation()}
				onClick={(event) => event.stopPropagation()}
				role="group"
				aria-label="音乐网格控制"
			>
				<label>
					<input
						type="checkbox"
						checked={enabled}
						onChange={(event) => setEnabled(event.target.checked)}
					/>
					拍点
				</label>
				{enabled && (
					<>
						<select
							className="w-36"
							aria-label="歌曲网格绑定"
							value={bindingId}
							onChange={(event) => {
								setBindingId(event.target.value);
								setMessage("");
							}}
						>
							<option value="">选择歌曲网格</option>
							{bindings.map((binding) => (
								<option key={binding.id} value={binding.id}>
									{binding.clipId} · {binding.gridId}
								</option>
							))}
						</select>
						<select
							aria-label="拍点类型"
							value={pointKind}
							onChange={(event) =>
								setPointKind(
									event.target.value === "downbeat" ? "downbeat" : "beat",
								)
							}
						>
							<option value="beat">拍</option>
							<option value="downbeat">重拍</option>
						</select>
						<input
							className="w-16"
							aria-label="吸附容差 tick"
							title="本次吸附最大距离，单位 tick"
							value={tolerance}
							onChange={(event) => setTolerance(event.target.value)}
						/>
						<button
							type="button"
							disabled={view.status !== "ready"}
							onClick={() => {
								void snap();
							}}
						>
							吸附播放头
						</button>
						<span
							className="max-w-56 truncate"
							role="status"
							title={
								message ||
								view.reason ||
								`${view.mode} · ${view.reviewReference} · ${view.structureLabels?.join(" / ")}`
							}
						>
							{message ||
								view.reason ||
								(view.status === "ready"
									? `${view.mode === "manual" ? "人工" : "测量"} · 已审定 ${view.reviewReference ?? "引用未知"} · r${view.gridRevision}${view.downbeatsKnown ? "" : " · 重拍未知"}${view.structureLabels?.length ? ` · ${view.structureLabels.join(" / ")}` : " · 拍号未知"}`
									: "选择已审定网格")}
						</span>
					</>
				)}
			</div>
			{bindingId && (
				<MusicAnchorOverlay
					engine={editor.transactions}
					sourceAvailability={sourceAvailability}
					bindingId={bindingId}
					view={view}
					pixelsPerSecond={pixelsPerSecond}
					viewportLeft={viewportLeft}
				/>
			)}
			{needsReview &&
				portal &&
				createPortal(
					<div
						className="fixed right-4 top-20 z-[1000] max-w-[32rem] rounded border border-amber-500 bg-background px-3 py-2 text-xs text-amber-400 shadow-xl"
						role="status"
					>
						歌曲映射已改变，请复核镜头、歌词与乐段关系。视觉镜头未自动移动。
						<button
							type="button"
							onMouseDown={(event) => event.stopPropagation()}
							onClick={(event) => {
								event.stopPropagation();
								setNeedsReview(false);
							}}
						>
							已复核关系
						</button>
					</div>,
					portal,
				)}
		</>
	);
}
