import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { capture } from "./flame-wrap-editor-capture.mjs";
import { seek } from "./flame-wrap-editor-controls.mjs";
import { decodeFlameWrapExport } from "./flame-wrap-editor-export-decode.mjs";
import { prepareFlameWrapExportReferences } from "./flame-wrap-editor-export-references.mjs";
import {
	flameWrapExportSnapshot,
	freezeFlameWrapExportState,
	verifyFlameWrapExportState,
} from "./flame-wrap-editor-export-state.mjs";
import {
	accepts,
	metric,
	opaqueRgb,
	thresholds,
} from "./flame-wrap-export-metrics.mjs";
import {
	preencodeSha,
	savePreencodeJson,
} from "./flame-wrap-preencode-inputs.mjs";
import { blazeEditorDeadline as deadline } from "./blaze-editor-lifecycle.mjs";

export async function runPreencodeExport({
	page,
	request,
	prepared,
	report,
	control,
}) {
	const { root, sourceRoot } = prepared;
	const artifacts = {
		root,
		width: 192,
		height: 128,
		clipId: "flame-static",
		effectId: "template-flame-wrap",
		finalTicks: 40000,
		usePresentationObserver: true,
	};
	const snapshot = flameWrapExportSnapshot(request),
		before = await snapshot();
	const expected = JSON.parse(
		await readFile(
			join(sourceRoot, "flame-wrap-editor-final-expected.json"),
			"utf8",
		),
	);
	assert.deepEqual(
		{
			project: before.project,
			revision: before.revision,
			clips: before.clips,
			tracks: before.tracks,
		},
		expected,
	);
	const expectedFrames = JSON.parse(
		await readFile(
			join(sourceRoot, "flame-wrap-editor-expected-frames.json"),
			"utf8",
		),
	);
	const clip = before.clips.find((c) => c.id === artifacts.clipId);
	assert(clip);
	const { references, baseline, range } =
		await prepareFlameWrapExportReferences({
			expectedFrames,
			artifacts,
			before,
			clip,
		});
	assert.deepEqual(range, { startTime: 20000, endTime: 85000 });
	report.seek = await seek(page, 40000, { numerator: 24, denominator: 1 });
	const preview = await capture(
		page,
		artifacts,
		40000,
		before.revision,
		"preencode-preview",
	);
	const reference = references.find((f) => f.ticks === 40000).rgb;
	const previewRgb = opaqueRgb(Buffer.from(preview.rgbaBase64, "base64"));
	report.preview = {
		...preview,
		rgbaBase64: undefined,
		retainedReferenceMetric: metric(previewRgb, reference, baseline),
		byteIdenticalToRetained: previewRgb.equals(reference),
	};
	const projectFile = join(prepared.projectPath, "project.json");
	const frozen = await freezeFlameWrapExportState({
		projectFile,
		clip,
		snapshot,
		before,
		root,
	});
	report.exportOptions = {
		format: "webm",
		quality: "very_high",
		includeAudio: false,
		range,
		...(control ? { videoQuantizer: control.request.videoQuantizer } : {}),
	};
	const registry = await request("export");
	assert(registry.surfaces >= 1);
	const started = await request("export", report.exportOptions);
	let finished;
	const until = Date.now() + 90000;
	do {
		finished = await request(`export/${started.id}`);
		if (["completed", "failed", "cancelled"].includes(finished.status)) break;
		assert(Date.now() < until, "Export deadline exceeded");
		await new Promise((done) => setTimeout(done, 100));
	} while (true);
	report.exportJob = {
		id: started.id,
		status: finished.status,
		error: finished.error ?? null,
	};
	assert.equal(finished.status, "completed", finished.error);
	const contained = relative(
		join(prepared.projectPath, "exports"),
		finished.outputPath,
	);
	assert(contained && !contained.startsWith("..") && !isAbsolute(contained));
	await verifyFlameWrapExportState({
		snapshot,
		before,
		projectFile,
		...frozen,
	});
	report.projectUnchangedDuringExport = true;
	const observed = await deadline(
		page.evaluate(async () => {
			const observer = globalThis.__flameWrapPreencodeObserver;
			if (!observer) return { status: { phase: "missing" }, sample: null };
			const status = await observer.cleanup();
			return { status, sample: observer.read() };
		}),
		15000,
		"Observer copy/clone cleanup",
	);
	report.observer = observed.status;
	assert(
		observed.status.phase === "complete" &&
			observed.status.matches === 1 &&
			!observed.status.error,
		"Preencode target not independently observed",
	);
	const { rgba, ...metadata } = observed.sample,
		bytes = Buffer.from(rgba);
	assert.equal(bytes.length, 192 * 128 * 4);
	assert.equal(metadata.timestamp, 166666);
	if (control) {
		assert.equal(control.request.videoQuantizer, 0);
		assert.deepEqual(
			metadata.encoderConfig,
			control.plan.nativeConfig,
			"Actual native configure must match the original Rust quantizer plan",
		);
		assert.equal(
			metadata.encodeOptions?.vp9?.quantizer,
			0,
			"Actual native encode must carry explicit q0",
		);
		report.productionQuantizerBranchObserved = true;
	}
	await writeFile(join(root, "preencode-input.rgba"), bytes, { flag: "wx" });
	await savePreencodeJson(root, "preencode-input.json", {
		...metadata,
		sha256: preencodeSha(bytes),
		byteLength: bytes.length,
	});
	const inputRgb = opaqueRgb(bytes);
	report.preencode = {
		metadata,
		sha256: preencodeSha(bytes),
		vsLivePreview: metric(inputRgb, previewRgb, baseline),
		vsRetainedPreview: metric(inputRgb, reference, baseline),
	};
	if (control) {
		assert.equal(
			report.preencode.sha256,
			expectedFrames.find(
				(frame) => frame.ticks === 40000 && frame.role !== "baseline",
			).sha256,
			"Control must retain exact actual native input RGBA",
		);
		assert(
			previewRgb.equals(reference),
			"Control live preview must equal retained preview",
		);
		report.controlInputExact = true;
	}
	try {
		report.decode = await decodeFlameWrapExport({
			outputPath: finished.outputPath,
			artifacts,
			references,
			baseline,
			startTicks: range.startTime,
			videoChroma: "420",
		});
		report.exportParityPassed = true;
	} catch (error) {
		if (error.code !== "FLAME_WRAP_EXPORT_PIXEL_PARITY") throw error;
		report.decode = error.decodeReceipt;
		report.exportParityPassed = false;
		report.parityFailure = String(error.message);
	}
	const encoded = await readFile(join(root, "flame-wrap-export-frame-4.rgb"));
	report.encoded = {
		outputPath: finished.outputPath,
		sha256: preencodeSha(await readFile(finished.outputPath)),
		vsLivePreview: metric(encoded, previewRgb, baseline),
		vsPreencode: metric(encoded, inputRgb, baseline),
		vsRetainedPreview: metric(encoded, reference, baseline),
	};
	report.thresholds = thresholds;
	report.preencodeParityPassed = accepts(report.preencode.vsLivePreview);
	report.diagnosticComplete = true;
}
