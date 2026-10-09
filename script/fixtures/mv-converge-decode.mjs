import { decodeTypeCard } from "./mv-type-card-decode.mjs";

/** Reuse only the independent FFmpeg/statistics gate, never another scene oracle. */
export function decodeConverge({ file, ffmpeg, ffprobe, oracleDirectory }) {
	const decoded = decodeTypeCard({
		file,
		ffmpeg,
		ffprobe,
		oracleDirectory,
		width: 1920,
		height: 1080,
	});
	return {
		...decoded,
		violations: decoded.violations.map((message) =>
			message
				.replaceAll("typeCard", "converge")
				.replaceAll("TypeCard", "Converge"),
		),
		oracle:
			"Complete unmodified original converge draw at native 1920x1080; actual original makeClock; no production-renderer self-reference",
	};
}
