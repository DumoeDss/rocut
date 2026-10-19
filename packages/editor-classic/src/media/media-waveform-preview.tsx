"use client";

import { useEffect, useState } from "react";
import { useEditor } from "../editor/use-editor";
import type { MediaAsset } from "./types";
import {
	requestMediaWaveform,
	type MediaWaveformState,
} from "./media-waveform-request";

export function MediaWaveformPreview({
	asset,
	className,
}: {
	asset: MediaAsset;
	className?: string;
}) {
	const cache = useEditor((editor) => editor.media.getWaveformCache());
	const projectId = useEditor(
		(editor) => editor.project.getActiveOrNull()?.metadata.id,
	);
	const [attempt, setAttempt] = useState(0);
	const [preview, setPreview] = useState<{
		cache: typeof cache;
		projectId?: string;
		id: string;
		file: File;
		url?: string;
		attempt: number;
		state: MediaWaveformState;
	}>();
	const { id, file, url } = asset;
	useEffect(() => {
		return requestMediaWaveform({
			asset: { id, file, url },
			cache,
			onChange: (state) =>
				setPreview({ cache, projectId, id, file, url, attempt, state }),
		});
	}, [cache, projectId, id, file, url, attempt]);
	const state: MediaWaveformState =
		preview?.cache === cache &&
		preview.projectId === projectId &&
		preview.id === id &&
		preview.file === file &&
		preview.url === url &&
		preview.attempt === attempt
			? preview.state
			: { status: file.size ? "loading" : "offline" };
	if (state.status !== "ready") {
		const label =
			state.status === "loading"
				? "正在读取波形"
				: state.status === "offline"
					? "音频离线"
					: state.status === "unsupported"
						? "暂不支持音频波形"
						: "波形解码失败";
		return (
			<div
				className={`${className ?? ""} flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground`}
				data-waveform-status={state.status}
			>
				<span role="status">{label}</span>
				{state.status !== "loading" && (
					<button
						type="button"
						className="underline"
						onPointerDown={(event) => event.stopPropagation()}
						onMouseDown={(event) => event.stopPropagation()}
						onDoubleClick={(event) => event.stopPropagation()}
						onKeyDown={(event) => event.stopPropagation()}
						onClick={(event) => {
							event.preventDefault();
							event.stopPropagation();
							setAttempt((value) => value + 1);
						}}
					>
						重试波形
					</button>
				)}
			</div>
		);
	}
	return (
		<svg
			viewBox="0 0 144 48"
			className={className}
			aria-label="音频波形"
			role="img"
			data-waveform-status="ready"
			preserveAspectRatio="none"
		>
			<path d="M0 24H144" fill="none" stroke="currentColor" opacity="0.3" />
			{state.values.map((value, i) => (
				<path
					key={i}
					d={`M${i * 3 + 1} ${24 - value * 22}V${24 + value * 22}`}
					stroke="currentColor"
					strokeWidth="1.5"
				/>
			))}
		</svg>
	);
}
