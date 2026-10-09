import {
	buildFxChain,
	chainNeedsWorklets,
	ensureAudioFxWorklets,
} from "/upstream/audio/audioFxGraph.js";
import { parseAudioFxChain } from "/upstream/audioFx.js";
import { scheduleParamLane } from "/upstream/audio/audioFxAutomation.js";

export const rate = 48000;
export const chain = (nodes) =>
	parseAudioFxChain(JSON.stringify({ version: 1, nodes }));
export function check(ok, message) {
	if (!ok) throw Error(message);
}
export function distance(a, b) {
	check(
		a.length === b.length &&
			a.every((channel, c) => channel.length === b[c].length),
		"PCM shape mismatch",
	);
	let max = 0,
		sum = 0,
		count = 0;
	for (let c = 0; c < a.length; c++)
		for (let i = 0; i < a[c].length; i++) {
			const error = Math.abs(a[c][i] - b[c][i]);
			max = Math.max(max, error);
			sum += error * error;
			count++;
		}
	return { max, rms: Math.sqrt(sum / count) };
}
export function scale(channels, gain) {
	return channels.map((channel) =>
		Float32Array.from(channel, (value) => value * gain),
	);
}
export function sum(a, b) {
	return a.map((channel, c) =>
		Float32Array.from(channel, (value, i) => value + b[c][i]),
	);
}
export function slice(channels, start, end) {
	return channels.map((channel) => channel.slice(start, end));
}
export async function nativeRender(channels, fx, automation) {
	return globalThis.__HF_AUDIO_FX.render(
		channels,
		rate,
		JSON.stringify(fx),
		automation && JSON.stringify(automation),
	);
}
export function source(context, channels) {
	const node = context.createBufferSource(),
		buffer = context.createBuffer(channels.length, channels[0].length, rate);
	channels.forEach((channel, c) => buffer.copyToChannel(channel, c));
	node.buffer = buffer;
	return node;
}
function gain(context, value) {
	const node = context.createGain();
	if (typeof value === "number") node.gain.value = value;
	else
		scheduleParamLane([{ param: node.gain }], value, "linear", {
			scheduledAt: 0,
			elapsed: 0,
			rate: 1,
		});
	return node;
}
export async function renderGraph({
	tracks,
	busFx = chain([]),
	busGain = 1,
	gainBeforeTrackFx = false,
	gainBeforeBusFx = false,
}) {
	const context = new OfflineAudioContext(
		2,
		tracks[0].channels[0].length,
		rate,
	);
	if ([busFx, ...tracks.map((track) => track.fx)].some(chainNeedsWorklets))
		await ensureAudioFxWorklets(context);
	const handles = [],
		sources = [],
		gains = [],
		bus = context.createGain();
	const busChain = buildFxChain(context, busFx),
		outputGain = gain(context, busGain);
	handles.push(busChain);
	gains.push(bus, outputGain);
	if (gainBeforeBusFx)
		(bus.connect(outputGain).connect(busChain.input),
			busChain.output.connect(context.destination));
	else
		(bus.connect(busChain.input),
			busChain.output.connect(outputGain).connect(context.destination));
	try {
		for (const track of tracks) {
			const input = source(context, track.channels),
				fx = buildFxChain(context, track.fx),
				volume = gain(context, track.gain);
			handles.push(fx);
			sources.push(input);
			gains.push(volume);
			if (gainBeforeTrackFx)
				(input.connect(volume).connect(fx.input), fx.output.connect(bus));
			else (input.connect(fx.input), fx.output.connect(volume).connect(bus));
			input.start();
		}
		const output = await context.startRendering();
		return Array.from({ length: output.numberOfChannels }, (_, c) =>
			output.getChannelData(c).slice(),
		);
	} finally {
		sources.forEach((node) => node.disconnect());
		handles.forEach((handle) => handle.dispose());
		gains.forEach((node) => node.disconnect());
	}
}
export async function pcmArtifact(name, channels) {
	const interleaved = new Float32Array(channels[0].length * channels.length);
	for (let i = 0; i < channels[0].length; i++)
		for (let c = 0; c < channels.length; c++)
			interleaved[i * channels.length + c] = channels[c][i];
	const bytes = new Uint8Array(interleaved.buffer),
		hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
	let binary = "";
	for (let i = 0; i < bytes.length; i += 8192)
		binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
	return {
		name,
		sampleRate: rate,
		channels: channels.length,
		frames: channels[0].length,
		sha256: [...hash]
			.map((value) => value.toString(16).padStart(2, "0"))
			.join(""),
		base64: btoa(binary),
	};
}
