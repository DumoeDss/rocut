import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	blazeEditorDigest as digest,
	blazeEditorWrite as save,
} from "./blaze-editor-control.mjs";
import { assertBlazeHostRealPath } from "./blaze-host-paths.mjs";
import { blazeEditorExportReferences } from "./blaze-editor-export-reference";
import {
	blazeEditorExportFrameTicks,
	blazeEditorExportThresholds,
} from "./blaze-editor-export-contract.mjs";
import { blazePipelinePng } from "../probe-blaze-pipeline-png.mjs";

const root = process.argv[2];
await assertBlazeHostRealPath(root);
const metadata = JSON.parse(
	await readFile(join(root, "export-source.json"), "utf8"),
);
assert.equal(metadata.kind, "independent-png-imagebitmap-offscreen-2d-decode");
assert.equal(metadata.productionPreviewUsed, false);
const png = await readFile(join(root, "export-source.png"));
const canonical = await readFile(join(root, "export-source-canonical.rgba"));
assert.equal(digest(png), metadata.resource.sha256);
assert.equal(digest(png), metadata.pngSha256);
assert.equal(digest(canonical), metadata.canonicalSha256);
const segments = [];
for (const segment of ["static", "animated", "disabled"] as const) {
	const reference = blazeEditorExportReferences(
		new Uint8ClampedArray(canonical),
		segment,
	);
	const expected = Buffer.concat(
		reference.expected.map((frame) => Buffer.from(frame)),
	);
	const baseline = Buffer.from(reference.baseline);
	const expectedName = `export-expected-${segment}.rgba`,
		baselineName = `export-baseline-${segment}.rgba`;
	await save(root, expectedName, expected);
	await save(root, baselineName, baseline);
	for (const [index, frame] of reference.expected.entries())
		await save(
			root,
			`export-expected-${segment}-${index}.png`,
			blazePipelinePng(frame, 192, 128),
		);
	segments.push({
		segment,
		params: reference.params,
		negatives: reference.negatives,
		discrimination: reference.discrimination,
		expected: {
			filename: expectedName,
			bytes: expected.length,
			sha256: digest(expected),
		},
		baseline: {
			filename: baselineName,
			bytes: baseline.length,
			sha256: digest(baseline),
		},
	});
}
const report = {
	ok: segments.every((segment) => segment.discrimination.accepted),
	source: metadata,
	thresholds: blazeEditorExportThresholds,
	localTicks: blazeEditorExportFrameTicks,
	frameRate: { numerator: 30, denominator: 1 },
	width: 192,
	height: 128,
	segments,
	reference:
		"Frozen independent blazeExpected with independently decoded canonical source RGBA and independent clip-local linear/hold formula, composited over black; never rendered preview pixels",
};
await save(root, "export-expected.json", report);
console.log(
	JSON.stringify({
		ok: report.ok,
		segments: segments.map((segment) => ({
			id: segment.segment,
			...segment.discrimination,
		})),
	}),
);
if (!report.ok) process.exitCode = 1;
