import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { blazeHostImage } from "./blaze-host-source";
import { blazeEditorExportReferences } from "./blaze-editor-export-reference";
import {
	decodeBlazeEditorSourcePng,
	modelBlazeEditorPremultiplication,
} from "./blaze-editor-export-source.mjs";

const root = process.argv[2];
assert(/^C:[\\/]tmps[\\/]blaze-editor-export-cpu-[a-zA-Z0-9]+$/.test(root));
assert.equal(
	(await realpath(root)).toLowerCase().replaceAll("\\", "/"),
	root.toLowerCase().replaceAll("\\", "/"),
);
const digest = (bytes: Uint8Array | string) =>
	createHash("sha256").update(bytes).digest("hex");
const png = blazeHostImage(),
	decoded = decodeBlazeEditorSourcePng(png);
const pngSha256 = digest(png);
await writeFile(join(root, "source.png"), png, { flag: "wx" });
const reports = [];
for (const [id, pixels] of [
	["straight-png-decode", decoded.pixels],
	[
		"integer-premultiplication-sensitivity-model",
		modelBlazeEditorPremultiplication(decoded.pixels),
	],
] as const) {
	const sourcePath = join(root, `${id}.rgba`);
	await writeFile(sourcePath, pixels, { flag: "wx" });
	const segments = [];
	for (const segment of ["static", "animated", "disabled"] as const) {
		const { params, negatives, discrimination } = blazeEditorExportReferences(
			pixels,
			segment,
		);
		segments.push({ segment, params, negatives, discrimination });
	}
	reports.push({
		id,
		pngSha256,
		sourceSha256: digest(Buffer.from(pixels)),
		sourcePath,
		segments,
	});
}
const report = {
	kind: "blaze-editor-export-cpu-negative-preflight",
	ok: reports.every((report) =>
		report.segments.every((segment) => segment.discrimination.accepted),
	),
	canonicalBrowserInputEstablished: false,
	note: "PNG decoding and premultiplication sensitivity model only. Runtime independent 2D decode of the imported PNG remains mandatory before computing export expected pixels. No GPU result was used to select intervals, parameters or thresholds.",
	reports,
};
const bytes = JSON.stringify(report, null, 2) + "\n";
await writeFile(join(root, "evidence.json"), bytes, { flag: "wx" });
assert.equal(digest(await readFile(join(root, "source.png"))), pngSha256);
console.log(
	JSON.stringify({
		root,
		ok: report.ok,
		sha256: digest(bytes),
		results: reports.map((report) => ({
			source: report.id,
			segments: report.segments.map((segment) => ({
				id: segment.segment,
				...segment.discrimination,
			})),
		})),
	}),
);
if (!report.ok) process.exitCode = 1;
