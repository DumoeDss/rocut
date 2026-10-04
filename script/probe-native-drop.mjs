import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Uses Chromium input, not synthetic DOM events; the caller owns CDP disposal.
export function createNativeDropHelpers({ page, work, cdp, attachments }) {
	const make = (name, audio = false) => {
		const path = join(work, name);
		execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-n",
				"-f",
				"lavfi",
				"-i",
				audio
					? "sine=frequency=440:duration=2"
					: "color=c=red:s=320x180:r=30:d=2",
				...(audio
					? ["-c:a", "pcm_s16le"]
					: ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-an"]),
				path,
			],
			{ windowsHide: true, timeout: 30000 },
		);
		return path;
	};
	const drop = async (files, locator) => {
		const b = await locator.boundingBox();
		assert(b, "Drop target must be visible");
		const data = { items: [], files, dragOperationsMask: 1 };
		const x = b.x + b.width * 0.55,
			y = b.y + b.height * 0.62;
		for (const type of ["dragEnter", "dragOver", "drop"])
			await cdp.send("Input.dispatchDragEvent", { type, x, y, data });
	};
	const verifyBytes = async (paths) => {
		const records = await attachments();
		for (const path of paths) {
			const name = path.split(/[\\/]/).at(-1),
				record = records.find((r) => r.metadata.name === name);
			assert(record, "Persisted drop missing: " + name);
			const hash = await page.evaluate(async (key) => {
				const b = await (
					await fetch(
						new URL("api/attachment/" + encodeURIComponent(key), location.href),
					)
				).arrayBuffer();
				return Array.from(
					new Uint8Array(await crypto.subtle.digest("SHA-256", b)),
					(v) => v.toString(16).padStart(2, "0"),
				).join("");
			}, record.key);
			assert.equal(
				hash,
				createHash("sha256").update(readFileSync(path)).digest("hex"),
			);
		}
	};
	return { make, drop, verifyBytes };
}
