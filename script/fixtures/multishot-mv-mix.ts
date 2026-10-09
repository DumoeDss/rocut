import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { ProgrammaticAudioRuntime } from "../../packages/editor-classic/src/media/programmatic-audio-runtime";
import { collectProgrammaticAudio } from "../../packages/editor-classic/src/media/programmatic-audio";
import { createTimelineAudioBuffer } from "../../packages/editor-classic/src/media/audio";
import { multishotTicks } from "./multishot-mv-project";

export async function multishotMix(
	tracks: SceneTracks,
	context: AudioContext,
	resources: SessionResources,
	runtime: ProgrammaticAudioRuntime,
) {
	const signal = new AbortController().signal;
	const collected = await collectProgrammaticAudio({
		tracks,
		runtime,
		audioContext: context,
		signal,
	});
	if (
		collected.length !== 1 ||
		collected[0].buffer.length !== 288000 ||
		collected[0].buffer.sampleRate !== 48000
	)
		throw Error(
			`Native source PCM length differs: ${JSON.stringify({
				contextSampleRate: context.sampleRate,
				sources: collected.map(({ buffer }) => ({
					sampleRate: buffer.sampleRate,
					frames: buffer.length,
					duration: buffer.duration,
				})),
			})}`,
		);
	const args = {
		tracks,
		mediaAssets: [],
		sampleRate: 48000,
		audioContext: context,
		resources,
		programmaticAudio: runtime,
		signal,
	};
	const mixed = await createTimelineAudioBuffer({
		...args,
		duration: multishotTicks(150),
	});
	if (!mixed || mixed.length !== 288000)
		throw Error("Full six-second mix missing");
	const expected = new DataView(
		await (await fetch("/api/expected.f32")).arrayBuffer(),
	);
	if (expected.byteLength !== mixed.length * 8)
		throw Error("Independent oracle duration differs");
	const pcm = new Float32Array(mixed.length * 2);
	let maxError = 0,
		shiftedError = 0;
	for (let i = 0; i < mixed.length; i++)
		for (let c = 0; c < 2; c++) {
			const actual = mixed.getChannelData(c)[i],
				wanted = expected.getFloat32(i * 8 + c * 4, true);
			pcm[i * 2 + c] = actual;
			maxError = Math.max(maxError, Math.abs(actual - wanted));
			if (i >= 1920)
				shiftedError = Math.max(
					shiftedError,
					Math.abs(actual - expected.getFloat32((i - 1920) * 8 + c * 4, true)),
				);
		}
	if (maxError > 2e-7)
		throw Error(`Native/ordinary mix or clock differs ${maxError}`);
	if (shiftedError < 0.02)
		throw Error(`One-frame audio offset is not observable ${shiftedError}`);
	const partial = await createTimelineAudioBuffer({
		...args,
		startTime: multishotTicks(47),
		duration: multishotTicks(57),
	});
	if (!partial || partial.length !== 109440)
		throw Error("Partial mix length differs");
	let partialError = 0;
	for (let c = 0; c < 2; c++)
		for (let i = 0; i < partial.length; i++)
			partialError = Math.max(
				partialError,
				Math.abs(
					partial.getChannelData(c)[i] - mixed.getChannelData(c)[90240 + i],
				),
			);
	if (partialError !== 0) throw Error(`Partial mix drift ${partialError}`);
	return {
		mixed,
		pcm: [...new Uint8Array(pcm.buffer)],
		measurements: {
			nativeSampleRate: collected[0].buffer.sampleRate,
			nativeFrames: collected[0].buffer.length,
			maxError,
			partialError,
			oneFrameOffsetMaxError: shiftedError,
		},
	};
}
