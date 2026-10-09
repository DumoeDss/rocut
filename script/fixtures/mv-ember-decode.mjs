import { decodeTypeCard } from "./mv-type-card-decode.mjs";

/** Codec statistics only are shared; every expected PNG is full original Ember. */
export function decodeEmber({ file, ffmpeg, ffprobe, oracleDirectory }) {
	const result = decodeTypeCard({
		file,
		ffmpeg,
		ffprobe,
		oracleDirectory,
		width: 1920,
		height: 1080,
	});
	return {
		...result,
		violations: result.violations.map((message) =>
			message.replaceAll("TypeCard", "Ember").replaceAll("typeCard", "ember"),
		),
		oracle:
			"Complete unmodified original Ember breathe/ignite/collapse draw at native1080p, independently decoded through FFmpeg",
	};
}
