import { decodeTypeCard } from "./mv-type-card-decode.mjs";

/** Shared codec math only: every expected PNG comes from full original titleRiff. */
export function decodeTitleRiff({ file, ffmpeg, ffprobe, oracleDirectory }) {
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
			message
				.replaceAll("TypeCard", "titleRiff")
				.replaceAll("typeCard", "titleRiff"),
		),
		oracle:
			"Complete unmodified original titleRiff intro/outro at native1080p; independently decoded through FFmpeg",
	};
}
