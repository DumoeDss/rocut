/** Test-only PCM oracle: actual pinned native scheduler + browser AudioParam.
 * No Rocut schedule evaluator, Rust implementation or production DSP is used. */
import {
	parseAutomation,
	resolveAutomation,
	VOLUME_RANGE,
	VOLUME_TARGET,
} from "@oracle/native-automation";
import { scheduleParamLane } from "@oracle/native-scheduler";
import { clampAudioGain } from "@oracle/native-gain";

let output;
window.rocutBusPcmOracle = {
	async render(request) {
		const context = new OfflineAudioContext(
			2,
			request.frames,
			request.sampleRate,
		);
		const input = context.createBuffer(2, request.frames, request.sampleRate);
		input.getChannelData(0).fill(1);
		input.getChannelData(1).fill(-0.37);
		const source = context.createBufferSource();
		source.buffer = input;
		const fader = context.createGain();
		const staticGain = clampAudioGain(
			window.rocutNativeBusRawGain({ getAttribute: () => request.rawVolume }),
		);
		fader.gain.value = staticGain;
		const staticParamValue = fader.gain.value;
		const events = [];
		const target = {
			cancelScheduledValues(time) {
				events.push({ kind: "cancel", time });
				fader.gain.cancelScheduledValues(time);
			},
			setValueAtTime(value, time) {
				events.push({ kind: "set", value, time });
				fader.gain.setValueAtTime(value, time);
			},
			linearRampToValueAtTime(value, time) {
				events.push({ kind: "ramp", value, time });
				fader.gain.linearRampToValueAtTime(value, time);
			},
			setValueCurveAtTime(values, time, duration) {
				try {
					fader.gain.setValueCurveAtTime(values, time, duration);
					events.push({ kind: "curve", values: [...values], time, duration });
				} catch (error) {
					events.push({
						kind: "curve-rejected",
						time,
						duration,
						error: String(error),
					});
					throw error;
				}
			},
		};
		const automation = request.automation
			? resolveAutomation(parseAutomation(request.automation), {
					version: 1,
					nodes: [],
				})
			: { version: 1, lanes: [] };
		const lane = automation.lanes.find(
			(value) => value.target === VOLUME_TARGET,
		);
		if (lane)
			scheduleParamLane([{ param: target }], lane, VOLUME_RANGE.scale, request);
		source.connect(fader).connect(context.destination);
		source.start(0);
		output = await context.startRendering();
		return { staticGain, staticParamValue, events, frames: output.length };
	},
	read(offset, count) {
		if (
			!output ||
			offset % 8 ||
			count % 8 ||
			count > 65536 ||
			offset + count > output.length * 8
		)
			throw Error("Invalid bus oracle transfer");
		const bytes = new Uint8Array(count),
			view = new DataView(bytes.buffer);
		for (let byte = 0; byte < count; byte += 8) {
			const frame = (offset + byte) / 8;
			view.setFloat32(byte, output.getChannelData(0)[frame], true);
			view.setFloat32(byte + 4, output.getChannelData(1)[frame], true);
		}
		let binary = "";
		for (let byte = 0; byte < count; byte += 8192)
			binary += String.fromCharCode(
				...bytes.subarray(byte, Math.min(byte + 8192, count)),
			);
		return btoa(binary);
	},
};
