import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { thresholds } from "./flame-wrap-export-metrics.mjs";
import { prepareFrostExportReferences } from "./frost-editor-export-references.mjs";
import { decodeFrostExport } from "./frost-editor-export-decode.mjs";
import {
	flameWrapExportSnapshot,
	freezeFlameWrapExportState,
	verifyFlameWrapExportState,
} from "./flame-wrap-editor-export-state.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function runFrostEditorExport({ ...options }) {
	try {
		return await exportSameProject(options);
	} catch (error) {
		if (options.artifacts?.root && isAbsolute(options.artifacts.root))
			await writeFile(
				join(options.artifacts.root, "frost-editor-export-failure.json"),
				JSON.stringify(
					{
						ok: false,
						errorName: error.name,
						code: error.code ?? null,
						thresholds,
						decode: error.decodeReceipt,
						message:
							"Export validation failed; see original caller exception. No thresholds changed.",
					},
					null,
					2,
				),
				{ flag: "wx" },
			).catch(() => {});
		throw error;
	}
}
async function exportSameProject({ page, request, artifacts, expectedFrames }) {
	assert(
		page && !page.isClosed(),
		"Actual editor renderer must remain attached",
	);
	assert(isAbsolute(artifacts.root) && isAbsolute(artifacts.projectPath));
	const projectFile = (await stat(artifacts.projectPath)).isDirectory()
		? join(artifacts.projectPath, "project.json")
		: artifacts.projectPath;
	const save = (name, value) =>
		writeFile(join(artifacts.root, name), JSON.stringify(value, null, 2), {
			flag: "wx",
		});
	const snapshot = flameWrapExportSnapshot(request);
	const before = await snapshot();
	const clip = before.clips.find((item) => item.id === artifacts.clipId);
	assert(clip);
	assert(
		clip.editing.effects.some(
			(effect) =>
				effect.id === artifacts.effectId &&
				effect.type === "frost" &&
				effect.enabled !== false,
		),
	);
	const { references, baseline, sensitivity, range } =
		await prepareFrostExportReferences({
			expectedFrames,
			artifacts,
			before,
			clip,
		});
	const { bytes, assetFiles } = await freezeFlameWrapExportState({
		projectFile,
		clip,
		snapshot,
		before,
		root: artifacts.root,
	});
	const registry = await request("export");
	assert(
		Number.isInteger(registry.surfaces) && registry.surfaces >= 1,
		"Host export registry has no attached renderer",
	);
	const started = await request("export", {
		format: "webm",
		quality: "very_high",
		includeAudio: false,
		range,
		...(artifacts.videoChroma === "444" ? { videoChroma: "444" } : {}),
	});
	let finished;
	const exportDeadline = Date.now() + 90000;
	do {
		finished = await request(`export/${started.id}`);
		if (["completed", "failed", "cancelled"].includes(finished.status)) break;
		assert(Date.now() < exportDeadline, "Host export timed out");
		await pause(100);
	} while (true);
	assert.equal(finished.status, "completed", finished.error);
	await verifyFlameWrapExportState({
		snapshot,
		before,
		projectFile,
		bytes,
		assetFiles,
	});
	const contained = relative(
		join(dirname(projectFile), "exports"),
		finished.outputPath,
	);
	assert(contained && !contained.startsWith("..") && !isAbsolute(contained));
	const { metadata, metrics } = await decodeFrostExport({
		outputPath: finished.outputPath,
		artifacts,
		references,
		baseline,
		startTicks: range.startTime,
		videoChroma: artifacts.videoChroma ?? "420",
	});
	const evidence = {
		ok: true,
		encodedNegativeControlsAccepted: Object.values(sensitivity.admission).every(
			Boolean,
		),
		encodingAndPreviewParity: true,
		independentOpticalOracle: false,
		format:
			artifacts.videoChroma === "444"
				? "explicit opaque WebM VP9 4:4:4 (not default 4:2:0 or alpha master)"
				: "default opaque WebM VP9 4:2:0 (not alpha master)",
		range,
		thresholds,
		sensitivity,
		metrics,
		metadata,
		revision: before.revision,
		projectSha256: sha(bytes),
		videoSha256: sha(await readFile(finished.outputPath)),
		outputPath: finished.outputPath,
		unchangedGraphRevisionAndPersistedBytes: true,
		unchangedSourceAssetFiles: assetFiles,
	};
	await save("frost-editor-export-evidence.json", evidence);
	return evidence;
}
