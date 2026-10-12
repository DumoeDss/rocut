import assert from "node:assert/strict";
import { auditFiniteFrostClaim } from "./frost-finite-acceptance.mjs";

// These claims refer to bounded executed cases, not installed or universal support.
export function auditFiniteClaims({ bubble, canvas, lifecycle, material, flameCurrent, frost }) {
	const author = bubble.authoring;
	assert.equal(author.accepted, true);
	assert.equal(author.transactions, 12);
	assert.equal(author.freshDuplicateTimeRejections, 5);
	for (const key of [
		"fullDTOKeyboardUndoRedo", "singleApplyRecordPUT", "rejectionZeroRecordPUT",
		"rejectionFullGraphAndDiskUnchanged", "rejectedDraftRetained",
	]) assert.equal(author[key], true, `Bubble author: ${key}`);
	assert.equal(author.saveReloadHostReopen.completeDTOgraphRevisionBytesIdentical, true);
	assert.equal(bubble.originalFailure.accepted, false, "Retain original failed stack");
	const supplement = bubble.correctedSupplement;
	assert.equal(supplement.accepted, true);
	assert.equal(supplement.expectedFrozenBeforeAnyExport, true);
	assert.equal(supplement.noRecordPUTDuringBrowserOrExports, true);
	assert.equal(supplement.noCompileRequests, true);
	assert.equal(supplement.originalProjectSHAUnchanged, true);
	assert.equal(supplement.saveReloadHostReopen.completeDTOgraphRevisionBytesIdentical, true);
	assert.deepEqual(supplement.gates, {
		wholeImageMeanRgbaMaximum: 10, enabledActiveRgbMaximum: 15,
		enabledActivePixelsMinimum: 64, activeDelta: 15, ptsMaximumSeconds: 0.0011,
		disabled: "whole-image mean gate only",
	});
	assert.equal(supplement.jobs.length, 6);
	assert.deepEqual(supplement.jobs.map((job) => job.key).sort(), [
		"default-animated", "default-disabled", "default-moving",
		"444-animated", "444-disabled", "444-moving",
	].sort());
	for (const job of supplement.jobs) {
		assert.equal(job.accepted, true);
		assert.equal(job.frames, 6);
		assert.equal(job.codec, "vp9");
		assert.equal(job.chroma, job.key.startsWith("default-") ? "yuv420p" : "yuv444p");
		assert(job.maxMeanRgba <= 10);
		if (!job.key.endsWith("-disabled")) {
			assert(job.maxEnabledActiveRgb <= 15);
			assert(job.minimumEnabledActivePixels >= 64);
		}
	}
	assert.equal(bubble.cleanup.browserClosed, true);
	assert.equal(bubble.cleanup.gpuReleased, true);
	assert.deepEqual(bubble.cleanup.liveJobs, []);

	assert.equal(canvas.status, "passed-current-packaged-author-same-project-export-six-frame-preview-parity");
	assert.equal(canvas.sameProject.authorSavedExportBeforeAfterAndParityAfterBytesIdentical, true);
	assert.equal(canvas.authorLayer.reloadAndHostReopen.completeClipRetained, true);
	assert.equal(canvas.authorLayer.reloadAndHostReopen.savedBytesIdentical, true);
	assert.deepEqual(canvas.authorLayer.errors, []);
	const output = canvas.packagedExportLayer, parity = canvas.previewParityLayer;
	assert.equal(output.status, "completed");
	assert.equal(output.actualWasmPolicy.default, true);
	assert.equal(output.actualWasmPolicy.quantizer, 8);
	assert.equal(output.actualEncoderQ8Frames, 6);
	assert.equal(output.independentDecode.frames, 6);
	assert.equal(output.independentDecode.pixelFormat, "yuv420p");
	assert.equal(output.independentDecode.timestampsPassed, true);
	assert.deepEqual(parity.fixedGates, {
		meanRgbMaximum: 4, activeRgbMaximum: 6, activePixelsMinimum: 48,
		activeDeltaStrictlyGreaterThan: 16, previewMotionMeanStrictlyGreaterThan: 0.1,
	});
	assert.equal(parity.allSixIdentifiableAndAccepted, true);
	assert(parity.maxMeanRgb <= 4 && parity.maxActiveRgb <= 6);
	assert.equal(parity.activePixels.length, 6);
	assert(parity.activePixels.every((count) => count >= 48));
	assert(parity.maxAdjacentPreviewMeanMotion > 0.1);
	assert.equal(parity.allPublicationSerialsFresh, true);
	for (const layer of [output, parity]) {
		for (const key of ["recordWrites", "compileRequests", "pageErrors", "externalRequests"])
			assert.equal(layer[key], 0, `Canvas output: ${key}`);
	}
	assert.equal(canvas.cleanup.gpuReleased, true);

	assert.equal(lifecycle.status, "passed-under-declared-webgl-fence-delay");
	assert.equal(lifecycle.cases.length, 6);
	assert.deepEqual(lifecycle.cases.map((item) => item.kind).sort(), [
		"cancel", "withdraw", "replace-source", "resize", "dispose-owner", "replace-request",
	].sort());
	for (const item of lifecycle.cases) {
		assert.equal(item.outcome.name, "AbortError");
		assert.equal(item.outcome.code, "RENDER_CANCELLED");
		for (const key of ["injectedFenceDelay", "pendingObserved", "mutationExecuted", "matchedContextAndFence", "wasmTimerCall"])
			assert.equal(item.pending[key], true, `Canvas lifecycle: ${key}`);
		assert.equal(item.pending.mutationError, null);
		assert.equal(item.pending.mutationMappedDataReads, 0);
		assert.equal(item.pending.pendingTimerLifecycle.cleared, true);
		assert(item.recovery.max <= 2);
		if (item.noOldPublication) assert.equal(item.noOldPublication.max, 0);
	}
	assert.equal(lifecycle.cleanup.gpuDisposed, true);
	assert.equal(lifecycle.cleanup.browserClosed, true);
	assert.equal(lifecycle.cleanup.serverClosed, true);
	assert.equal(material.status, "accepted-bounded-independent-material-reference");
	assert.equal(material.gates.gpuByteMax, 2);
	assert.equal(material.gates.gpuByteMean, 0.35);
	assert.deepEqual(material.cases.map((item) => item.name).sort(), ["weave", "brush-wet", "brush-dried"].sort());
	for (const item of material.cases) {
		assert.equal(item.ok, true);
		assert(item.metrics.max <= 2 && item.metrics.mean <= 0.35);
		assert.equal(item.metrics.alphaMismatch, 0);
		assert.equal(item.metrics.holeNonzero, 0);
	}
	assert.equal(flameCurrent.ok, true);
	assert.equal(flameCurrent.status, "current-normal-surface-export-passed-with-retained-startup-diagnostics");
	assert(flameCurrent.scope.includes("No admission bypass"));
	const flame = flameCurrent.current;
	assert.equal(flame.jobsSubmitted, 1);
	assert.equal(flame.explicitChromaOrQuantizerOverride, false);
	assert.equal(flame.options.format, "webm");
	assert.equal(flame.options.quality, "very_high");
	assert.equal(flame.options.includeAudio, false);
	assert.deepEqual(flame.options.range, { startTime: 20000, endTime: 85000 });
	assert.deepEqual(flame.observedDefaultPolicy, { chroma: "420", quantizer: 8, actualEncodeCalls: 13 });
	assert.equal(flame.video.codec, "vp9");
	assert.equal(flame.video.pixelFormat, "yuv420p");
	assert.equal(flame.video.frames, 13);
	for (const key of [
		"originalGraphReopenedExact", "freshPresentationEqualsFixedHistoricalRgba",
		"freshPngLosslessRgbaVerified", "independentFfprobeAndFfmpegDecode",
		"originalFilesUnchanged", "cloneExportStageBytesUnchanged", "hostClosed",
		"browserClosed", "gpuLeaseReleased",
	]) assert.equal(flame[key], true, `Flame current: ${key}`);
	assert.deepEqual(flameCurrent.fixedGates, {
		meanRgb: 4, activeRgb: 6, activePixels: 48, activeDelta: 16, timestamp: 0.0011,
	});
	assert.deepEqual(flame.referenceMapping.map((item) => [item.ticks, item.outputFrameIndex]), [
		[20000, 0], [40000, 4], [80000, 12],
	]);
	for (const item of flame.referenceMapping) {
		assert(item.decodedMeanRgb <= 4 && item.decodedActiveRgb <= 6);
		assert(item.activePixels >= 48);
	}
	assert.deepEqual(flame.runtimePinDrift, []);
	assert.deepEqual(flame.pageErrors, []);
	assert.equal(flame.retainedStartupDiagnostics.cleanConsoleClaim, false);
	return {
		bubble: "accepted-bounded-authored-standalone-image-prefix-six-jobs",
		canvas: "accepted-bounded-frozen-prefix-replay-material-and-lifecycle",
		flameWrap: "accepted-bounded-alpha-edge-current-admission-and-default420-export",
		frost: auditFiniteFrostClaim(frost),
		installedOrRelease: false,
	};
}
