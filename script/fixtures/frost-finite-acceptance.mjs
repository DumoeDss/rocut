import assert from "node:assert/strict";

export function auditFiniteFrostClaim(frost) {
	assert.equal(frost.status, "accepted-registered-finite-frost-video-subset");
	assert.equal(frost.overallGoalComplete, false);
	assert.equal(frost.requirements.length, 6);
	assert.deepEqual(frost.remainingRegisteredFiniteSubset, []);
	assert.match(frost.scope, /not alpha-master/);
	assert.equal(frost.ui.transactions.length, 12);
	for (const item of frost.ui.transactions) {
		assert.equal(item.singleApply, true);
		assert.equal(item.completeClipUndoRedo, true);
	}
	assert.equal(frost.ui.reopen.completeGraphRevisionAndBytesIdentical, true);
	assert.equal(frost.ui.reopen.revision, 37);
	assert.equal(frost.ui.originalPixelAcceptance, false);
	const video = frost.opaqueVideo;
	assert.equal(video.actualQ8EncodeCount, 24);
	assert.equal(video.actualNativeEncoderConfiguration[0].alpha, "discard");
	assert.equal(video.originalGraphAndProjectBytesUnchanged, true);
	assert.equal(video.originalActiveMasksAll24Unchanged, true);
	assert.equal(video.pixelAcceptance.allFrameMean, true);
	assert.equal(video.pixelAcceptance.adequateRegion, true);
	assert.equal(video.pixelAcceptance.allFramesIdentifiable, false);
	assert.deepEqual(video.pixelAcceptance.weakFrames, Array.from({ length: 12 }, (_, index) => index));
	assert(video.pixelAcceptance.maxMean <= 4 && video.maxAdequateActiveRgb <= 6);
	assert.equal(frost.transparentRender.allAlphaErrors, 0);
	assert.equal(frost.transparentRender.transparentHolesRgbaZero, 109);
	assert.equal(frost.transparentRender.fullMeltPositivePixelsExact, 459);
	assert.equal(frost.transparentRender.originalNumericGatesUnchanged, true);
	assert.deepEqual(frost.scheduleClock.jobs.map((job) => job.mode), ["advance", "freeze"]);
	assert.equal(new Set(frost.scheduleClock.jobs.map((job) => job.id)).size, 2);
	for (const job of frost.scheduleClock.jobs) {
		assert.equal(job.adapterRestored, true);
		assert.equal(job.graphAndRevisionUnchanged, true);
		for (const pairs of [job.renderTemporal, job.encodedTemporal]) {
			assert.deepEqual(pairs.map((pair) => pair.id), ["stamp", "recovery"]);
			for (const pair of pairs) {
				assert.equal(pair.identifiable, true);
				assert.equal(pair.accepted, job.mode === "advance");
			}
		}
	}
	return "accepted-bounded-transparent-render-and-opaque-schedule-video";
}
