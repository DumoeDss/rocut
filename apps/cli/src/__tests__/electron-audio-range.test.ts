import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer, get } from "node:http";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { ProgrammaticResourceStore } from "../programmatic/resources";
import { renderRemotionAudioRange } from "../programmatic/remotion-audio-render";
import { performProgrammaticAudio } from "../programmatic/audio-operation";
import { ELECTRON_NATIVE_AUDIO_PROTOCOL } from "../programmatic/electron-audio-transport";
import { ELECTRON_NATIVE_VIDEO_PROTOCOL } from "../programmatic/electron-native-video-server";
import { nativeAudioWav } from "../../../../script/fixtures/native-audio-fixture";

const ffmpeg = process.env.ROCUT_TEST_FFMPEG ?? Bun.which("ffmpeg");
const ffprobe = process.env.ROCUT_TEST_FFPROBE ?? Bun.which("ffprobe");
test.skipIf(!ffmpeg || !ffprobe)("Electron range admits native facts, preserves absolute frame/sample clocks and decodes admitted stereo bytes", async () => {
	const root = await mkdtemp("C:/tmps/rocut-electron-range-");
	const wav = nativeAudioWav({ seconds: 0.3, sample: (i, c) => i / 48000 * (c ? -0.5 : 1) });
	const src = `data:audio/wav;base64,${wav.toString("base64")}`;
	const code = Buffer.from(`<html><audio src="${src}"></audio></html>`);
	const hash = createHash("sha256").update(code).digest("hex");
	const audioId = createHash("sha256").update("audio/wav").update("\0").update(wav).digest("hex");
	const archive = (id: string) => ({ id, kind: "source", mimeType: "application/octet-stream", byteLength: 1,
		sha256: "a".repeat(64), attachmentKey: `programmatic-source-sha256-${"a".repeat(64)}` });
	const document = { id: "build.html", kind: "document", mimeType: "text/html", byteLength: code.length,
		sha256: hash, attachmentKey: `programmatic-sha256-${hash}` };
	const source = { version: 1, runtime: "html-document", code: "", documentId: document.id,
		width: 64, height: 64, frameRate: { numerator: 30, denominator: 1 }, durationFrames: 8, seed: 1,
		resources: [document], audio: { version: 1, mode: "native" }, build: { version: 1, engine: "remotion",
			engineVersion: "4.0.440", compositionId: "Audio", entryFile: "index.tsx", inputs: [archive("index.tsx")],
			toolchainLock: archive("_rocut/toolchain-lock.json") } } as ProgrammaticSource;
	const resourceStore = { projectId: "fixture", store: { async loadAttachment() { return {
		body: code.buffer.slice(code.byteOffset, code.byteOffset + code.byteLength), metadata: {
			kind: "programmatic-resource", version: 1, sha256: hash, byteLength: code.length, mimeType: "text/html" } }; } } } as unknown as ProgrammaticResourceStore;
	const seen: number[] = []; let malformed = false; let falseFacts = false; let needsVideo = false;
	let lastVideoCallback: { endpoint: string; token: string } | undefined;
	const token = "b".repeat(64);
	const server = createServer(async (request, response) => {
		const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
		const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		expect(request.url).toBe("/v1/audio-analysis"); expect(request.headers.authorization).toBe(`Bearer ${token}`);
		const documentMatch = /iframe.srcdoc = (.*);/.exec(input.expression);
		if (!documentMatch) throw Error("Missing native document");
		const match = /const frame=(.*?);const nativeVideoBridge=/.exec(JSON.parse(documentMatch[1]));
		if (!match) throw Error("Missing admitted frame");
		const frame = JSON.parse(match[1]); seen.push(frame.index);
		expect(JSON.parse(documentMatch[1])).toContain(`const nativeVideoBridge=${needsVideo};`);
		expect(!!input.nativeVideo).toBe(needsVideo);
		lastVideoCallback = input.nativeVideo;
		const value = falseFacts ? false : malformed ? [{ resourceId: "unadmitted" }] : [{ id: "native", resourceId: audioId, type: "audio",
			frame: frame.index, mediaFrame: frame.index, audioStartFrame: 0, playbackRate: 1, volume: 0.5, toneFrequency: 1, audioStreamIndex: 0 }];
		response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ version: 1, value }));
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const connectionFile = join(root, "connection.json");
	try {
		await writeFile(connectionFile, JSON.stringify({ version: 1, backend: "elftia-electron", token,
			endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/frame`,
			capabilities: { nativeAudioAnalysis: { version: 1, protocol: ELECTRON_NATIVE_AUDIO_PROTOCOL } } }), "utf8");
		const options = { source, firstFrame: 3, frameCount: 2, sampleRate: 48000 as const, connectionFile,
			resourceStore, decoder: { ffmpeg: ffmpeg!, ffprobe: ffprobe! }, signal: AbortSignal.timeout(15000) };
		const result = await renderRemotionAudioRange(options);
		expect(seen).toEqual([3, 4]);
		expect(result).toMatchObject({ firstFrame: 3, frameCount: 2, frames: 3200, sampleOrigin: 4800, hasAudio: true, artifacts: [] });
		for (const index of [0, 1599, 1600, 3199]) for (const channel of [0, 1])
			expect(result.pcm.readFloatLE(index * 8 + channel * 4)).toBeCloseTo((4800 + index) / 48000 * 0.5 * (channel ? -0.5 : 1), 6);
		malformed = true;
		await expect(renderRemotionAudioRange(options)).rejects.toThrow();
		expect(seen).toEqual([3, 4, 3]);
		falseFacts = true;
		await expect(renderRemotionAudioRange(options)).rejects.toThrow();
		expect(seen).toEqual([3, 4, 3, 3]);
		falseFacts = false;
		await expect(performProgrammaticAudio({ ...options, action: "produced", input: {}, graphConfigured: false, sessionNonce: "test" })).rejects.toThrow("session grant");
		expect(seen).toEqual([3, 4, 3, 3]);
		const videoCode = Buffer.from(`${code.toString("utf8")}<video src="data:video/webm;base64,AQID"></video>`);
		const videoHash = createHash("sha256").update(videoCode).digest("hex");
		const videoDocument = { ...document, byteLength: videoCode.length, sha256: videoHash, attachmentKey: `programmatic-sha256-${videoHash}` };
		const videoOptions = { ...options, frameCount: 1, source: { ...source, resources: [videoDocument] } as ProgrammaticSource,
			resourceStore: { projectId: "fixture", store: { async loadAttachment() { return { body: videoCode.buffer.slice(videoCode.byteOffset, videoCode.byteOffset + videoCode.length),
				metadata: { kind: "programmatic-resource", version: 1, sha256: videoHash, byteLength: videoCode.length, mimeType: "text/html" } }; } } } as unknown as ProgrammaticResourceStore };
		malformed = false; needsVideo = true;
		await expect(renderRemotionAudioRange(videoOptions)).rejects.toThrow("grant");
		expect(seen).toEqual([3, 4, 3, 3]);
		await writeFile(connectionFile, JSON.stringify({ version: 1, backend: "elftia-electron", token,
			endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/frame`, capabilities: {
				nativeAudioAnalysis: { version: 1, protocol: ELECTRON_NATIVE_AUDIO_PROTOCOL },
				nativeVideoCapture: { version: 1, protocol: ELECTRON_NATIVE_VIDEO_PROTOCOL } } }), "utf8");
		expect((await renderRemotionAudioRange(videoOptions)).frames).toBe(1600);
		expect(seen).toEqual([3, 4, 3, 3, 3]);
		expect(lastVideoCallback?.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1\/native-video\/frame$/);
		expect(lastVideoCallback?.token).toMatch(/^[a-f0-9]{64}$/);
		// Callback lifetime belongs to this frame and ends before the result escapes.
		await expect(new Promise((resolve, reject) => {
			get(lastVideoCallback!.endpoint, response => { response.resume(); resolve(response.statusCode); }).once("error", reject);
		})).rejects.toThrow();
	} finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true }); }
});
