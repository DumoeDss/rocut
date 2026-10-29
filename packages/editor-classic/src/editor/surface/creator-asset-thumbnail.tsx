import type { CreatorAssetVersion } from "./creator-workspace-types";
import { useEditor } from "../use-editor";
import { useMediaPreview } from "../../media/use-media-preview";
import { MediaWaveformPreview } from "../../media/media-waveform-preview";
import { useEffect, useRef, useState } from "react";
import { useCreatorWorkspaceBridge } from "./creator-workspace-context";
import { useCreatorVideoPoster } from "./use-creator-video-poster";
import type {
	CreatorWorkspaceBridge,
	CreatorWorkspaceCommandResult,
} from "./creator-workspace-types";

const summaries = new WeakMap<
	CreatorWorkspaceBridge,
	Map<string, Promise<CreatorWorkspaceCommandResult>>
>();

/** Reuse imported media caches, otherwise consume the host's bounded derivatives. */
export function CreatorAssetThumbnail({
	assetId,
	version,
}: {
	assetId: string;
	version?: CreatorAssetVersion;
}) {
	const bridge = useCreatorWorkspaceBridge();
	const root = useRef<HTMLSpanElement>(null);
	const [summary, setSummary] =
		useState<CreatorWorkspaceCommandResult["summary"]>();
	const [loading, setLoading] = useState(false);
	const nativeAsset = useEditor((editor) =>
		editor.media.getAssets().find((asset) => asset.id === version?.mediaId),
	);
	useEffect(() => {
		setSummary(undefined);
		setLoading(false);
		if (
			!bridge ||
			!version ||
			version.mediaType !== "audio" ||
			nativeAsset ||
			version.waveform?.length ||
			!root.current
		)
			return;
		let active = true;
		const observer = new IntersectionObserver((entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			observer.disconnect();
			let cache = summaries.get(bridge);
			if (!cache) {
				cache = new Map();
				summaries.set(bridge, cache);
			}
			const key = `${assetId}:${version.id}:${version.sha256 ?? ""}`;
			let request = cache.get(key);
			if (!request) {
				request = bridge.execute({
					type: "asset.audio-summary",
					assetId,
					versionId: version.id,
				});
				if (cache.size >= 128) cache.delete(cache.keys().next().value!);
				cache.set(key, request);
			}
			setLoading(true);
			void request
				.then((result) => {
					if (result.summary?.status !== "available") cache?.delete(key);
					if (active) setSummary(result.summary);
				})
				.catch(() => {
					cache?.delete(key);
					if (active)
						setSummary({ status: "unavailable", reason: "音频摘要暂不可用" });
				})
				.finally(() => {
					if (active) setLoading(false);
				});
		});
		observer.observe(root.current);
		return () => {
			active = false;
			observer.disconnect();
		};
	}, [
		bridge,
		assetId,
		version?.id,
		version?.sha256,
		nativeAsset,
		version?.waveform,
	]);
	const preview = useMediaPreview({ asset: nativeAsset });
	const videoPoster = useCreatorVideoPoster(assetId, version, root,
		preview.status !== "ready" && preview.status !== "loading");
	const poster =
		version?.posterUrl ??
		(videoPoster.state.status === "available" ? videoPoster.state.url : undefined) ??
		(version?.mediaType === "image"
			? version.previewUrl
			: preview.status === "ready"
				? preview.url
				: undefined);
	if (poster)
		return (
			<img
				src={poster}
				alt=""
				loading="lazy"
				data-testid="creator-asset-poster"
			/>
		);
	if (version?.mediaType === "audio") {
		if (nativeAsset)
			return (
				<MediaWaveformPreview asset={nativeAsset} className="h-12 w-full" />
			);
		const peaks = (
			version.waveform ??
			(summary?.status === "available" ? summary.waveform : undefined)
		)
			?.slice(0, 128)
			.filter(Number.isFinite);
		if (peaks?.length)
			return (
				<svg
					role="img"
					aria-label="音频波形"
					viewBox={`0 0 ${peaks.length} 100`}
					preserveAspectRatio="none"
					className="h-12 w-full"
				>
					<path
						d={peaks
							.map(
								(peak, index) =>
									`M${index} ${50 - Math.min(1, Math.abs(peak)) * 45}V${50 + Math.min(1, Math.abs(peak)) * 45}`,
							)
							.join(" ")}
						stroke="currentColor"
						strokeWidth="0.7"
					/>
				</svg>
			);
		return (
			<span ref={root} className="text-center px-2">
				音频
				<br />
				<small>
					{loading
						? "正在获取波形"
						: summary?.status === "unavailable"
							? summary.reason
							: "波形尚未生成"}
				</small>
			</span>
		);
	}
	return (
		<span ref={root} title={videoPoster.state.status === "unavailable" ? videoPoster.state.reason : undefined}>
			{version?.mediaType === "video"
				? version.posterStatus === "pending" || preview.status === "loading" || videoPoster.state.status === "loading" || videoPoster.state.status === "idle" && videoPoster.supported
					? "正在获取封面"
					: "视频封面暂不可用"
				: "素材"}
		</span>
	);
}
