import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeTypeCard } from "./mv-type-card-decode.mjs";
export async function attachFallOracleArtifacts(page, directory) {
	const frames = new Set();
	await page.exposeFunction("__writeFallOraclePng", async (frame, payload) => {
		if (
			!Number.isInteger(frame) ||
			frame < 0 ||
			frame >= 12 ||
			frames.has(frame)
		)
			throw Error("Invalid/duplicate Fall oracle frame");
		if (
			typeof payload !== "string" ||
			payload.length > 32 * 1024 * 1024 ||
			!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)
		)
			throw Error("Invalid bounded Fall PNG payload");
		const bytes = Buffer.from(payload, "base64");
		if (
			bytes.length < 33 ||
			!bytes
				.subarray(0, 8)
				.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
			bytes.toString("ascii", 12, 16) !== "IHDR" ||
			bytes.readUInt32BE(16) !== 1920 ||
			bytes.readUInt32BE(20) !== 1080
		)
			throw Error("Fall oracle must remain native 1920x1080 PNG");
		frames.add(frame);
		await writeFile(
			join(directory, `oracle-${String(frame).padStart(2, "0")}.png`),
			bytes,
			{ flag: "wx" },
		);
	});
	return frames;
}
export function decodeFall({ file, ffmpeg, ffprobe, oracleDirectory }) {
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
		violations: result.violations.map((v) =>
			v.replaceAll("TypeCard", "Fall").replaceAll("typeCard", "Fall"),
		),
		oracle:
			"Complete unchanged dark.js Fall with original freeze/pulse/clock and full1080p marker; independent FFmpeg decode",
	};
}
