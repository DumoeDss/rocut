import assert from "node:assert/strict";
import test from "node:test";
import { exportMediaFacts } from "../installed-export-media-facts.mjs";

function fixture() {
	return {
		streams: [
			{
				codec_type: "video",
				width: 1920,
				height: 1080,
				r_frame_rate: "30/1",
				start_time: "0",
				duration: "2",
				nb_read_frames: "60",
			},
			{ codec_type: "audio", start_time: "0", duration: "2" },
		],
		format: { duration: "2" },
	};
}

test("aligned export reports decoded frames and zero stream-boundary offset", () => {
	const facts = exportMediaFacts(fixture());
	assert.equal(facts.frameCount, 60);
	assert.equal(facts.audioVideoOffsetFrames, 0);
	assert.equal(facts.alignmentScope, "stream-boundaries-not-content-sync");
});

test("six-frame end misalignment is retained, never clipped to the passing one-frame budget", () => {
	const probe = fixture();
	probe.streams[1].duration = "2.2";
	const facts = exportMediaFacts(probe);
	assert(Math.abs(facts.audioVideoOffsetFrames - 6) < 1e-10);
	assert(facts.audioVideoOffsetFrames > 1);
});

test("equal end times cannot hide a late audio start", () => {
	const probe = fixture();
	probe.streams[1].start_time = "0.25";
	probe.streams[1].duration = "1.75";
	const facts = exportMediaFacts(probe);
	assert.equal(facts.audioVideoStartOffsetFrames, 7.5);
	assert.equal(facts.audioVideoEndOffsetFrames, 0);
	assert.equal(facts.audioVideoOffsetFrames, 7.5);
});

test("frame count is not estimated from container duration", () => {
	const probe = fixture();
	probe.streams[0].nb_read_frames = "59";
	probe.format.duration = "40";
	assert.equal(exportMediaFacts(probe).frameCount, 59);
	assert.equal(exportMediaFacts(probe).audioVideoOffsetFrames, 0);
});

test("missing stream timing or frame-count evidence fails instead of assuming zero alignment", () => {
	for (const [index, field] of [
		[0, "start_time"],
		[1, "duration"],
		[0, "nb_read_frames"],
	]) {
		for (const value of [undefined, null, "", "N/A", "Infinity"]) {
			const probe = fixture();
			probe.streams[index][field] = value;
			assert.throws(() => exportMediaFacts(probe), /measured|integer/);
		}
	}
});

test("extra or missing A/V streams are rejected", () => {
	for (const type of ["video", "audio"]) {
		const extra = fixture();
		extra.streams.push({ ...extra.streams.find((s) => s.codec_type === type) });
		assert.throws(() => exportMediaFacts(extra), /exactly one/);
		const missing = fixture();
		missing.streams = missing.streams.filter((s) => s.codec_type !== type);
		assert.throws(() => exportMediaFacts(missing), /exactly one/);
	}
});

test("fractional frame rates remain rational and invalid rates fail", () => {
	const probe = fixture();
	probe.streams[0].r_frame_rate = "30000/1001";
	assert.equal(exportMediaFacts(probe).fpsDenominator, 1001);
	for (const rate of ["0/0", "30/0", "NaN/1", "30", "30/1/2"]) {
		probe.streams[0].r_frame_rate = rate;
		assert.throws(() => exportMediaFacts(probe), /frame rate|integer|measured/);
	}
});
