"use client";

import { useEffect, useRef, useState } from "react";
import type { MediaAsset } from "../../media/types";
import { useMediaPreview } from "../../media/use-media-preview";
import type { VideoElement } from "../types";
import { resolveFilmstripSourceTime } from "../../media/filmstrip-source";
import { TICKS_PER_SECOND } from "../../wasm";
import { findScrollParent } from "../../utils/browser";
import { getVisibleFilmstripTiles } from "./filmstrip-layout";

function Frame({
	asset,
	element,
	offset,
	width,
	pixelsPerSecond,
}: {
	asset: MediaAsset;
	element: VideoElement;
	offset: number;
	width: number;
	pixelsPerSecond: number;
}) {
	const sourceTime = resolveFilmstripSourceTime({
		element,
		offset,
		pixelsPerSecond,
	});
	const result = useMediaPreview({
		asset: sourceTime === null ? undefined : asset,
		timeSeconds: sourceTime === null ? 0 : sourceTime / TICKS_PER_SECOND,
	});
	const statusLabel =
		sourceTime === null
			? "源时间不可用"
			: result.status === "offline"
				? "源文件离线"
				: result.status === "unsupported"
					? "格式不支持"
					: result.status === "failed"
						? "预览失败"
						: "";
	return (
		<div
			data-testid="video-filmstrip-frame"
			data-source-time={sourceTime}
			data-offset={offset}
			className="absolute inset-y-0 overflow-hidden"
			style={{ left: offset, width }}
		>
			{result.status === "ready" && sourceTime !== null ? (
				<img
					src={result.url}
					onError={result.reportError}
					alt=""
					className="size-full object-cover"
					draggable={false}
				/>
			) : (
				<span className="text-[9px] text-white/60" role="status">
					{statusLabel}
				</span>
			)}
		</div>
	);
}

export function VideoFilmstrip({
	asset,
	element,
	tileWidth,
	pixelsPerSecond,
}: {
	asset: MediaAsset;
	element: VideoElement;
	tileWidth: number;
	pixelsPerSecond: number;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [offsets, setOffsets] = useState<number[]>([]);
	useEffect(() => {
		const node = ref.current;
		if (!node) return;
		const parent = findScrollParent({ element: node });
		let request = 0;
		const update = () => {
			cancelAnimationFrame(request);
			request = requestAnimationFrame(() => {
				const bounds = node.getBoundingClientRect();
				const viewport = parent?.getBoundingClientRect();
				setOffsets(
					getVisibleFilmstripTiles({
						clipLeft: bounds.left,
						clipWidth: bounds.width,
						viewportLeft: viewport?.left ?? 0,
						viewportRight: viewport?.right ?? window.innerWidth,
						tileWidth,
					}),
				);
			});
		};
		const observer = new ResizeObserver(update);
		observer.observe(node);
		if (parent) observer.observe(parent);
		parent?.addEventListener("scroll", update, { passive: true });
		window.addEventListener("resize", update);
		update();
		return () => {
			observer.disconnect();
			parent?.removeEventListener("scroll", update);
			window.removeEventListener("resize", update);
			cancelAnimationFrame(request);
		};
	}, [tileWidth, pixelsPerSecond, element.startTime, element.duration]);
	return (
		<div
			ref={ref}
			className="pointer-events-none absolute inset-0 overflow-hidden bg-muted"
		>
			{offsets.map((offset) => {
				return (
					<Frame
						key={offset}
						asset={asset}
						element={element}
						offset={offset}
						width={tileWidth}
						pixelsPerSecond={pixelsPerSecond}
					/>
				);
			})}
		</div>
	);
}
