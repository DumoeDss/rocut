import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
	decodeFlameWrapExport,
	flameWrapMediaCommand,
} from "./fixtures/flame-wrap-editor-export-decode.mjs";
import {
	metric,
	opaqueRgb,
	thresholds,
} from "./fixtures/flame-wrap-export-metrics.mjs";

const [sourceRoot, outputPath] = process.argv.slice(2);
assert.equal(process.argv.length, 4);
assert(isAbsolute(sourceRoot) && isAbsolute(outputPath));
const root = await mkdtemp("C:/tmps/flame-wrap-retained-decode-");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const input = join(sourceRoot, "flame-wrap-editor-expected-frames.json");
const pinned = [input, outputPath, join(sourceRoot, "evidence.json")];
const pins = await Promise.all(
	pinned.map(async (path) => ({ path, sha256: sha(await readFile(path)) })),
);
const evidence = {
	ok: false,
	sourceRoot,
	root,
	pins,
	thresholds,
	scope:
		"Retained real export independent decode only; not a new browser run or completed Host close/reopen",
};
try {
	const previous = JSON.parse(await readFile(pinned[2], "utf8"));
	assert(
		previous.ui.ok &&
			previous.inputsUnchanged &&
			previous.hostClosed &&
			previous.browserClosed,
	);
	const frames = JSON.parse(await readFile(input, "utf8"));
	const decode = (frame) => {
		assert.equal(frame.width, 192);
		assert.equal(frame.height, 128);
		const rgba = Buffer.from(frame.rgbaBase64, "base64");
		assert.equal(rgba.length, 192 * 128 * 4);
		assert.equal(sha(rgba), frame.sha256);
		return opaqueRgb(rgba);
	};
	const baselineFrame = frames.find((frame) => frame.role === "baseline");
	assert(baselineFrame);
	const references = [20000, 40000, 80000].map((ticks) => {
		const frame = frames.find(
			(item) => item.ticks === ticks && item.role !== "baseline",
		);
		assert(frame);
		return { ticks, rgb: decode(frame) };
	});
	evidence.chromaOnlyDiagnostic = [];
	for (const [index, name] of ["early", "before-reload", "late"].entries()) {
		const rgb = await flameWrapMediaCommand({
			command: "ffmpeg",
			args: [
				"-v",
				"error",
				"-f",
				"rawvideo",
				"-pixel_format",
				"rgba",
				"-video_size",
				"192x128",
				"-i",
				join(sourceRoot, `flame-wrap-editor-${name}.rgba`),
				"-vf",
				"format=yuv420p,format=rgb24",
				"-frames:v",
				"1",
				"-pix_fmt",
				"rgb24",
				"-f",
				"rawvideo",
				"pipe:1",
			],
		});
		assert.equal(rgb.length, 192 * 128 * 3);
		evidence.chromaOnlyDiagnostic.push({
			ticks: references[index].ticks,
			...metric(rgb, references[index].rgb, decode(baselineFrame)),
		});
	}
	evidence.decode = await decodeFlameWrapExport({
		outputPath,
		artifacts: { width: 192, height: 128, root },
		references,
		baseline: decode(baselineFrame),
		startTicks: 20000,
	});
	for (const pin of pins)
		assert.equal(sha(await readFile(pin.path)), pin.sha256);
	evidence.inputsUnchanged = true;
	evidence.ok = true;
} catch (error) {
	if (error.decodeReceipt) evidence.decode = error.decodeReceipt;
	evidence.failure = String(error.stack ?? error);
	process.exitCode = 1;
} finally {
	await writeFile(
		join(root, "evidence.json"),
		JSON.stringify(evidence, null, 2),
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			ok: evidence.ok,
			root,
			metrics: evidence.decode?.metrics,
			failure: evidence.failure,
		}),
	);
}
