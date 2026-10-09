import { writeFile } from "node:fs/promises";
import { join } from "node:path";

function png(base64) {
	if (
		typeof base64 !== "string" ||
		base64.length > 32 * 1024 * 1024 ||
		!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
	)
		throw Error("Invalid bounded Ember PNG payload");
	const body = Buffer.from(base64, "base64");
	if (
		body.length < 33 ||
		!body
			.subarray(0, 8)
			.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
		body.toString("ascii", 12, 16) !== "IHDR" ||
		body.readUInt32BE(16) !== 1920 ||
		body.readUInt32BE(20) !== 1080
	)
		throw Error("Ember artifacts require native1080p PNG");
	return body;
}

export async function attachEmberArtifacts(page, artifacts, exportEnabled) {
	const diagnostics = new Set(),
		frames = new Set();
	await page.exposeFunction(
		"__writeEmberDiagnostic",
		async (label, kind, payload) => {
			if (
				typeof label !== "string" ||
				!/^[a-z0-9-]{1,80}$/.test(label) ||
				!["actual", "expected", "plan"].includes(kind)
			)
				throw Error("Invalid Ember diagnostic identity");
			const key = `${label}-${kind}`;
			if (
				diagnostics.has(key) ||
				diagnostics.size >= 18 ||
				typeof payload !== "string" ||
				payload.length > 32 * 1024 * 1024
			)
				throw Error("Duplicate/oversized Ember diagnostic");
			const isPng = kind !== "plan";
			const body = isPng ? png(payload) : (JSON.parse(payload), payload);
			diagnostics.add(key);
			await writeFile(
				join(artifacts, `${key}.${isPng ? "png" : "json"}`),
				body,
				{ flag: "wx" },
			);
		},
	);
	if (exportEnabled)
		await page.exposeFunction(
			"__writeEmberOraclePng",
			async (frame, payload) => {
				if (
					!Number.isInteger(frame) ||
					frame < 0 ||
					frame >= 12 ||
					frames.has(frame)
				)
					throw Error("Invalid/duplicate Ember oracle frame");
				const body = png(payload);
				frames.add(frame);
				await writeFile(
					join(artifacts, `oracle-${String(frame).padStart(2, "0")}.png`),
					body,
					{ flag: "wx" },
				);
			},
		);
	return { frames, diagnostics };
}
