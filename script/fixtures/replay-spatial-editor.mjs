import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { decodeSpatialEditor } from "./spatial-editor-decode.mjs";

const [artifacts, ffmpegDirectory] = process.argv.slice(2);
assert(
	artifacts &&
		ffmpegDirectory &&
		isAbsolute(artifacts) &&
		isAbsolute(ffmpegDirectory),
);
const evidence = JSON.parse(
	await readFile(join(artifacts, "evidence.json"), "utf8"),
);
const decoded = decodeSpatialEditor(
	evidence.export.outputPath,
	artifacts,
	ffmpegDirectory,
	evidence.spatialEdits,
);
await writeFile(
	join(artifacts, "aligned-preview-decode.json"),
	JSON.stringify(
		{
			ok: true,
			scope:
				"Existing export and unchanged preview screenshots; DOM-geometry normalization only",
			decoded,
		},
		null,
		2,
	),
	{ flag: "wx" },
);
console.log(JSON.stringify({ ok: true, metrics: decoded.metrics }));
