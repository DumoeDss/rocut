/** Separate reference paths deliberately: native buffer fallback, native DOM
 * media clock, exporter filter builder, and raw Web Audio loop probes. */
import { syncRuntimeMedia } from "@fractional/media";
import { buildTrackInputFilter } from "@fractional/export-filter";

const sourceSample = (index) =>
	(index % 2 ? -1 : 1) * (0.125 + (index % 17) / 32);
window.rocutFractionalOracle = {
	async render(request) {
		const {
			sampleRate,
			sourceRate = sampleRate,
			sourceFrames = 32,
			totalFrames = 128,
			startFrames = 0,
			offsetFrames = 0,
			durationFrames = 16,
			elapsedFrames,
			mode = "native-buffer-fallback",
		} = request;
		const context = new OfflineAudioContext(1, totalFrames, sampleRate);
		const buffer = context.createBuffer(1, sourceFrames, sourceRate);
		for (let i = 0; i < sourceFrames; i++)
			buffer.getChannelData(0)[i] = sourceSample(i);
		const source = context.createBufferSource();
		source.buffer = buffer;
		const calls = [];
		const forwardingSource = {
			start(...args) {
				calls.push(args);
				source.start(...args);
			},
		};
		let scheduled;
		if (mode === "native-buffer-fallback") {
			scheduled = window.rocutNativeFractionalStart(forwardingSource, {
				elapsed:
					elapsedFrames === undefined
						? -startFrames / sampleRate
						: elapsedFrames / sampleRate,
				mediaStart: offsetFrames / sourceRate,
				scheduledAt: 0,
				globalRate: 1,
				mediaRate: 1,
				clipDuration: durationFrames / sampleRate,
			});
		} else {
			// NOT an upstream loop implementation: native fallback never enables loop.
			source.loop = true;
			source.loopStart = offsetFrames / sourceRate;
			source.loopEnd = sourceFrames / sourceRate;
			forwardingSource.start(
				startFrames / sampleRate,
				offsetFrames / sourceRate,
				durationFrames / sampleRate,
			);
			scheduled = true;
		}
		source.connect(context.destination);
		const result = await context.startRendering();
		return {
			mode,
			calls,
			scheduled,
			source: [...buffer.getChannelData(0)],
			pcm: [...result.getChannelData(0)],
			sourceLoop: source.loop,
		};
	},
	mediaClock(request) {
		const {
			sampleRate,
			sourceFrames = 32,
			offsetFrames,
			elapsedFrames,
		} = request;
		const element = document.createElement("audio");
		element.loop = true;
		element.currentTime = 1;
		element.volume = 1;
		document.body.append(element);
		const duration = (elapsedFrames + 128) / sampleRate;
		try {
			syncRuntimeMedia({
				clips: [
					{
						el: element,
						start: 0,
						end: duration,
						duration,
						mediaStart: offsetFrames / sampleRate,
						sourceDuration: sourceFrames / sampleRate,
						playbackRate: 1,
						rate: 1,
						loop: true,
						volume: 1,
						volumeKeyframes: [],
						fades: { fadeIn: 0, fadeOut: 0 },
					},
				],
				timeSeconds: elapsedFrames / sampleRate,
				playing: false,
				forceSync: true,
				playbackRate: 1,
				userVolume: 1,
				getCompositionDuration: () => duration,
			});
			return {
				currentTime: element.currentTime,
				sourceFrame: element.currentTime * sampleRate,
				loop: element.loop,
			};
		} finally {
			element.remove();
		}
	},
	exportFilter(request) {
		return buildTrackInputFilter(
			{
				start: request.startFrames / request.sampleRate,
				end:
					(request.startFrames + request.durationFrames) / request.sampleRate,
			},
			0,
			"volume=1",
			request.totalFrames / request.sampleRate,
		);
	},
};
