"use client";

import { useEffect, useState } from "react";
import type { MediaAsset } from "./types";
import { useEditor } from "../editor/use-editor";
import type { MediaPreviewResult } from "./preview-resource";

export function useMediaPreview({
	asset,
	timeSeconds,
}: {
	asset?: MediaAsset;
	timeSeconds?: number;
}) {
	const projectId = useEditor(
		(editor) => editor.project.getActiveOrNull()?.metadata.id,
	);
	const resources = useEditor((editor) => editor.media.getPreviewResources());
	const [attempt, setAttempt] = useState(0);
	const retry = () => setAttempt((current) => current + 1);
	const [result, setResult] = useState<{
		file: File;
		projectId?: string;
		time: number;
		attempt: number;
		value: MediaPreviewResult;
	}>();
	const time = timeSeconds ?? 0;
	const file = asset?.file;
	const type = asset?.type;
	const sourceSha256 = asset?.sourceSha256;
	const mediaId = asset?.id;
	const reportError = () => {
		if (file)
			setResult({
				file,
				projectId,
				time,
				attempt,
				value: {
					status: "failed",
					error: "Preview image could not be displayed",
				},
			});
	};
	useEffect(() => {
		if (!file || type !== "video") return;
		let current = true;
		const request = resources.acquire({
			mediaId,
			file,
			time,
			sourceSha256,
			projectId,
			retry: attempt > 0,
			priority: timeSeconds === undefined ? 1 : 0,
		});
		void request.promise.then((value) => {
			if (current) setResult({ file, projectId, time, attempt, value });
		});
		return () => {
			current = false;
			request.release();
		};
	}, [
		resources,
		file,
		type,
		mediaId,
		sourceSha256,
		projectId,
		attempt,
		time,
		timeSeconds,
	]);
	if (!asset || !asset.file.size)
		return { status: "offline" as const, retry, reportError };
	if (asset.type === "image")
		return asset.url
			? { status: "ready" as const, url: asset.url, retry, reportError }
			: { status: "offline" as const, retry, reportError };
	if (
		result?.file === asset.file &&
		result.time === time &&
		result.attempt === attempt &&
		result.projectId === projectId
	)
		return { ...result.value, retry, reportError };
	return { status: "loading" as const, retry, reportError };
}
