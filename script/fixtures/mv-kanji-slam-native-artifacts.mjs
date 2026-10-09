import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** A bounded artifact-only sink, never a general filesystem RPC. */
export async function attachKanjiSlamOracleArtifacts(page, directory) {
	const frames = new Set();
	await page.exposeFunction(
		"__writeKanjiSlamOraclePng",
		async (frame, payload) => {
			if (
				!Number.isInteger(frame) ||
				frame < 0 ||
				frame >= 12 ||
				frames.has(frame)
			)
				throw Error("Invalid/duplicate kanjiSlam oracle frame");
			if (
				typeof payload !== "string" ||
				payload.length > 32 * 1024 * 1024 ||
				!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)
			)
				throw Error("Invalid bounded kanjiSlam PNG payload");
			const body = Buffer.from(payload, "base64");
			if (
				body.length < 33 ||
				!body
					.subarray(0, 8)
					.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
				body.toString("ascii", 12, 16) !== "IHDR" ||
				body.readUInt32BE(16) !== 1920 ||
				body.readUInt32BE(20) !== 1080
			)
				throw Error("kanjiSlam oracle must be a native1080p PNG");
			frames.add(frame);
			await writeFile(
				join(directory, `oracle-${String(frame).padStart(2, "0")}.png`),
				body,
				{ flag: "wx" },
			);
		},
	);
	return frames;
}
