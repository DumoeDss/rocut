import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createProgrammaticAudioService } from "../../apps/cli/src/programmatic/audio-service";
import type { NativeVideoDecoder } from "../../apps/cli/src/programmatic/video-decoder";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { ProgrammaticAudioRuntime } from "../../packages/editor-classic/src/media/programmatic-audio-runtime";
import { pcmDifference, digest } from "./hyperframes-variable-rate-io";
import type { rateHostProject } from "./hyperframes-variable-rate-host-project";

/** This is the actual editor source-audio consumer (default 44.1k) and actual
 * HTTP provider. It does not claim device playback or encoded-video export. */
export async function verifyRateHostConsumer(
	project: Awaited<ReturnType<typeof rateHostProject>>,
	toolchainDirectory: string,
	decoder: NativeVideoDecoder,
	expected: Buffer,
	hasAudio: boolean,
	signal: AbortSignal,
) {
	const service = createProgrammaticAudioService({
		...project,
		toolchainDirectory,
		decoder,
		connectionFile: "",
	});
	let renderRequests = 0,
		identityRequests = 0;
	const server = createServer((request, response) => {
		const action = request.url?.endsWith("/identity") ? "identity" : "render";
		if (action === "render") renderRequests++;
		else identityRequests++;
		void service.handle(request, response, action);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const provider = createHttpProgrammaticFrames({
		base: `http://127.0.0.1:${address.port}`,
	});
	const runtime = new ProgrammaticAudioRuntime(provider);
	try {
		assert.equal(service.capability.hyperframesGraph.configured, true);
		// Deliberately omit sampleRate: this is the editor/export native default.
		const loaded = await runtime.load({ source: project.source, signal });
		assert.equal(loaded !== null, hasAudio);
		const fullDifference = loaded
			? pcmDifference(expected, Buffer.from(loaded.data.pcm))
			: null;
		if (loaded) {
			assert.equal(loaded.data.sampleRate, 44100);
			assert.equal(loaded.gain, 1);
			assert.equal(loaded.data.identity?.profile, "hyperframes-graph-v1");
			assert.ok(fullDifference!.maximum < 2e-6);
		}
		const again = await runtime.load({ source: project.source, signal });
		assert.equal(again?.data, loaded?.data);
		assert.equal(
			renderRequests,
			1,
			"Stable current identity permits source PCM cache reuse",
		);
		const identity = await provider.getAudioIdentity!({
			request: { source: project.source, sampleRate: 44100 },
			signal,
		});
		const request = {
			source: project.source,
			sampleRate: 44100,
			firstFrame: 37,
			frameCount: 11,
			expectedIdentity: identity,
		};
		const crop = await provider.renderAudio!({ request, signal });
		assert.equal(crop.hasAudio, hasAudio);
		assert.equal(crop.sampleOrigin, 16317);
		const cropDifference = pcmDifference(
			expected.subarray(16317 * 8, 21168 * 8),
			Buffer.from(crop.pcm),
		);
		assert.ok(cropDifference.maximum < 2e-6);
		if (loaded)
			assert.equal(
				Buffer.from(crop.pcm).equals(
					Buffer.from(loaded.data.pcm).subarray(16317 * 8, 21168 * 8),
				),
				true,
			);
		else
			assert.equal(
				Buffer.from(crop.pcm).equals(Buffer.alloc(crop.pcm.byteLength)),
				true,
			);
		await assert.rejects(
			provider.renderAudio!({
				request: {
					...request,
					expectedIdentity: { ...identity, id: "0".repeat(64) },
				},
				signal,
			}),
			/identity changed/,
		);
		return {
			sampleRate: 44100,
			hasAudio,
			cacheReused: true,
			cropExact: true,
			staleIdentityRejected: true,
			fullDifference,
			cropDifference,
			expectedSha256: digest(expected),
			runtimeLoads: 2,
			identityRequests,
			renderRequests,
			cropFirstSample: 16317,
			cropFrames: 4851,
			pcmSha256: loaded ? digest(Buffer.from(loaded.data.pcm)) : null,
			identity: identity.id,
			boundary:
				"Real archived compilation/browser graph collection/Host HTTP/editor PCM cache. No Electron transport, device playback or encoded video export.",
		};
	} finally {
		await runtime.invalidate();
		await service.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}
