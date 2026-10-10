import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { prepareBubbleExportCpu, bubbleExportScratch } from "./fixtures/bubble-export-preflight.mjs";

assert.equal(process.argv.length, 3, "Usage: node script/bubble-export-prepare.mjs <C:/tmps/artifact-parent>");
await bubbleExportScratch(process.argv[2]);
const root = await mkdtemp(join(process.argv[2], "bubble-export-cpu-"));
const report = await prepareBubbleExportCpu(root);
console.log(JSON.stringify({ root, ok: report.ok, videoExportTested: false,
	results: report.reports.map((item) => ({ source: item.prefix, records: item.records.map((record) =>
		({ segment: record.segment, discrimination: record.discrimination })) })) }));
process.exitCode = report.ok ? 0 : 1;
