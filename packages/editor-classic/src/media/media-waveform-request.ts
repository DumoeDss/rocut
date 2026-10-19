import type { WaveformCache } from "../services/waveform-cache/service";
import type { MediaAsset } from "./types";
import {
	buildWaveformSourceKey,
	sampleSourceWaveformSummary,
} from "./waveform-summary";

export type MediaWaveformState =
	| { status: "loading" }
	| { status: "ready"; values: number[] }
	| { status: "offline" | "error" | "unsupported"; error?: string };

export function requestMediaWaveform({
	asset,
	cache,
	onChange,
}: {
	asset: Pick<MediaAsset, "id" | "file" | "url">;
	cache: Pick<WaveformCache, "getSourceSummary">;
	onChange: (state: MediaWaveformState) => void;
}): () => void {
	let current = true;
	if (!asset.file.size) {
		onChange({ status: "offline" });
		return () => {
			current = false;
		};
	}
	onChange({ status: "loading" });
	void cache
		.getSourceSummary({
			sourceKey: buildWaveformSourceKey({ kind: "media", id: asset.id }),
			sourceFile: asset.file,
			audioUrl: asset.url,
		})
		.then((summary) => {
			if (!current) return;
			const values = sampleSourceWaveformSummary({
				summary,
				buckets: Array.from({ length: 48 }, (_, i) => ({
					bucketStart: Math.floor((summary.totalSamples * i) / 48),
					bucketEnd: Math.ceil((summary.totalSamples * (i + 1)) / 48),
				})),
			});
			onChange({ status: "ready", values });
		})
		.catch((error: unknown) => {
			if (!current) return;
			const message = error instanceof Error ? error.message : String(error);
			const unsupported =
				error instanceof Error &&
				(error.name === "NotSupportedError" ||
					message === "Audio waveform decoding is unavailable on this Host.");
			onChange({
				status: unsupported ? "unsupported" : "error",
				error: message,
			});
		});
	// The summary belongs to the shared cache; releasing a card only detaches its listener.
	return () => {
		current = false;
	};
}
