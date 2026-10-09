import assert from "node:assert/strict";
import {
	RecordedParam,
	elementWithAutomation,
	nativeBusScheduler,
	nativeTrackGain,
	near,
} from "./hyperframes-audio-graph-oracle-support.mjs";

const timing = { scheduledAt: 0, elapsed: 0, rate: 1 };
const lane = (points) => ({ target: "volume", points });

export function previewCases(native, runtime, check) {
	const bus = nativeBusScheduler(runtime, native);
	check("preview-bus-volume-vs-track-clamp", "native-control-math", () => {
		const floor = lane([
			{ t: 0, v: 0, viaX: 0.5, viaY: 0.001 },
			{ t: 1, v: 1 },
		]);
		const param = new RecordedParam();
		bus.schedule(elementWithAutomation(floor, "HF-AUDIO-GROUP"), param, timing);
		assert.deepEqual(
			param.events.map((event) => event.kind),
			["cancel", "curve"],
		);
		const curve = param.events[1];
		assert.equal(curve.values.length, 100);
		const minimum = Math.min(...curve.values);
		assert.equal(minimum, -0.124232217669487);
		const time = curve.values.indexOf(minimum) / (curve.values.length - 1);
		assert.ok(native.automation.sampleAutomationLane(floor, time) < 0);
		assert.equal(nativeTrackGain(native, floor, time), 0);

		const max = native.gain.MAX_AUDIO_GAIN;
		const ceiling = lane([
			{ t: 0, v: max, viaX: 0.5, viaY: 0.001 },
			{ t: 1, v: 0 },
		]);
		const upper = new RecordedParam();
		bus.schedule(
			elementWithAutomation(ceiling, "HF-AUDIO-GROUP"),
			upper,
			timing,
		);
		const peak = Math.max(...upper.events[1].values);
		assert.ok(peak > max, "Dynamic bus lane must preserve overshoot");
		const at = upper.events[1].values.indexOf(peak) / 99;
		near(nativeTrackGain(native, ceiling, at), max);
		near(
			nativeTrackGain(native, ceiling, at, { fadeIn: 1, fadeOut: 0 }),
			max * at,
		);
		return {
			busHelperSha256: bus.sourceSha256,
			busMinimum: minimum,
			busPeak: peak,
			trackFloor: 0,
			trackCeiling: max,
			boundary:
				"Preview only: recorded native bus scheduling versus native syncRuntimeMedia author gain. No AudioParam PCM interpolation. Engine export uses volumeLaneKeyframes/createEnvelopeWalker, not this preview fader pipeline",
		};
	});
}
