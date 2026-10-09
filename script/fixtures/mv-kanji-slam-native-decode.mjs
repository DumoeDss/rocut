import { decodeTypeCard } from "./mv-type-card-decode.mjs";

/** Shared codec math only: every expected PNG comes from full original kanjiSlam. */
export function decodeKanjiSlam({ file, ffmpeg, ffprobe, oracleDirectory }) {
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
				.replaceAll("TypeCard", "kanjiSlam")
				.replaceAll("typeCard", "kanjiSlam"),
		),
		oracle:
			"Complete unmodified original kanjiSlam default/night/hand at native1080p; independently decoded through FFmpeg",
	};
}
