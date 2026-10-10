import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bubbleExportContract as spec, bubbleExportSegments } from "./bubble-export-contract.mjs";
import { bubbleExportReferences, bubbleExportSource } from "./bubble-export-reference.mjs";
import { blazePipelinePng } from "../probe-blaze-pipeline-png.mjs";
import { decodeBlazeEditorSourcePng, modelBlazeEditorPremultiplication } from "./blaze-editor-export-source.mjs";

export const bubbleExportHash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function bubbleExportScratch(root) {
	assert(/^c:[/\\]tmps(?:[/\\]|$)/i.test(root));
	assert.equal((await realpath(root)).toLowerCase(), resolve(root).toLowerCase(), "Redirected export artifact directory");
}
export async function bubbleExportSave(root, name, value) {
	assert(/^[a-z0-9][a-z0-9.-]*$/.test(name));
	const bytes = ArrayBuffer.isView(value)
		? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
		: Buffer.from(JSON.stringify(value, null, 2) + "\n");
	await writeFile(join(root, name), bytes, { flag: "wx" });
	return { filename: name, bytes: bytes.length, sha256: bubbleExportHash(bytes) };
}
export async function saveBubbleExportReferences(root, source, prefix, canonicalBrowserInputEstablished = false) {
	assert(/^[a-z-]+$/.test(prefix));
	const records = [];
	for (const { id } of bubbleExportSegments) {
		const { expected, baseline, ...metadata } = bubbleExportReferences(source, id);
		records.push({ ...metadata,
			expected: await bubbleExportSave(root, `${prefix}-${id}-expected.rgba`, Buffer.concat(expected.map((frame) => Buffer.from(frame)))),
			baseline: await bubbleExportSave(root, `${prefix}-${id}-baseline.rgba`, baseline) });
	}
	return { ok: records.every((record) => record.discrimination.accepted), records,
		canonicalBrowserInputEstablished, sourceSha256: bubbleExportHash(source), reference: "Frozen independent Bubble f64 oracle; source-over black; never production rendered expected pixels" };
}
export async function prepareBubbleExportCpu(root) {
	await bubbleExportScratch(root);
	const png = blazePipelinePng(bubbleExportSource(), spec.width, spec.height), decoded = decodeBlazeEditorSourcePng(png);
	const source = await bubbleExportSave(root, "source.png", png), reports = [];
	for (const [prefix, pixels] of [["straight-png", decoded.pixels], ["premultiplication-model", modelBlazeEditorPremultiplication(decoded.pixels)]]) {
		const rgba = await bubbleExportSave(root, `${prefix}.rgba`, pixels);
		reports.push({ prefix, rgba, ...await saveBubbleExportReferences(root, pixels, prefix) });
	}
	const report = { ok: reports.every((item) => item.ok), kind: "bubble-export-cpu-negative-preflight",
		contract: spec, source, reports, renderingTested: false, videoExportTested: false,
		note: "Pure CPU discrimination before any production export. Browser-independent 2D source decode and fresh oracle expected generation remain required at real execution." };
	await bubbleExportSave(root, "cpu-evidence.json", report);
	assert.equal(bubbleExportHash(await readFile(join(root, source.filename))), source.sha256);
	return report;
}
