import { strict as assert } from "node:assert";
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { renderRemotionAudioRange } from "../../apps/cli/src/programmatic/remotion-audio-render";
import { nativeAudioWav } from "./native-audio-fixture";
import { createProgrammaticAudioService } from "../../apps/cli/src/programmatic/audio-service";
import { renderHtmlPng } from "../../apps/cli/src/programmatic/html-rasterizer";
import type { ProgrammaticFrameRequest } from "@opencut/editor-contracts";
import { resolveProbeBrowserExecutable } from "./browser-probe-identity.mjs";

const toolchainDirectory = process.argv[2];
const ffmpeg = process.env.ROCUT_TEST_FFMPEG, ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (!toolchainDirectory || !ffmpeg || !ffprobe) throw Error("Configure isolated toolchain and native audio decoder paths");
const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, "rocut-remotion-pcm-"));
const require = createRequire(new URL("../../apps/vite-example/package.json", import.meta.url));
const { chromium } = await import(pathToFileURL(require.resolve("@playwright/test")).href);
const executable = resolveProbeBrowserExecutable({ configured: process.env.ROCUT_PROBE_BROWSER_PATH, fallback: chromium.executablePath() });
const sourceDirectory = join(root, "author"), storeOptions = { root: join(root, "target"), schemaVersion: 1 };
let context = { store: new FileProjectStore(storeOptions), projectId: "audio-pcm-probe" };
const a = nativeAudioWav({ sample: (i, c) => Math.sin(i * 441 * Math.PI * 2 / 48000) * (c ? -0.2 : 0.4) });
const b = nativeAudioWav({ sample: (i, c) => Math.sin(i * 883 * Math.PI * 2 / 48000) * (c ? 0.35 : 0.15) });
let server: ReturnType<typeof createServer> | undefined;
let audioService: ReturnType<typeof createProgrammaticAudioService> | undefined;
try {
  await mkdir(sourceDirectory);
  await copyFile(fileURLToPath(new URL("./remotion/audio-pcm.tsx", import.meta.url)), join(sourceDirectory, "index.tsx"));
  await writeFile(join(sourceDirectory, "tone.wav"), a);
  await writeFile(join(sourceDirectory, "other.wav"), b);
  const compile = async (mode: string) => (await compileProgrammaticProject({ action: "compile", input: {
    version: 1, engine: "remotion", sourceDirectory, entryFile: "index.tsx", files: ["index.tsx", "tone.wav", "other.wav"],
    compositionId: mode === "fractional" ? "Fractional" : "AudioPcm", inputProps: { mode }, width: 64, height: 64,
    frameRate: mode === "fractional" ? { numerator: 30000, denominator: 1001 } : { numerator: 30, denominator: 1 }, durationFrames: 60, seed: 7,
  }, toolchainDirectory, context, signal: AbortSignal.timeout(30000), enqueue: task => task() })).source;
  let exportPcm: Buffer | undefined;
  if (!process.argv.includes("--editor-only")) {
  const mixed = await compile("mix"), looped = await compile("loop");
  const render = (source = mixed, firstFrame = 1, frameCount = 5, signal = AbortSignal.timeout(90000), sampleRate: 44100 | 48000 = 48000) =>
    renderRemotionAudioRange({ source, firstFrame, frameCount, sampleRate, decoder: { ffmpeg, ffprobe },
      executable, resourceStore: context, signal });
  // No browser executable may be consulted on these rejected ranges.
  for (const frameCount of [0, 60, 36001]) await assert.rejects(renderRemotionAudioRange({ source: mixed,
    firstFrame: 1, frameCount, sampleRate: 48000, decoder: { ffmpeg, ffprobe }, executable: "not-a-browser",
    resourceStore: context, signal: AbortSignal.timeout(1000) }), /range|duration/i);
  await assert.rejects(render(mixed, 1, 5, AbortSignal.abort()), /abort/i);
  for (const [mode, source] of [["mix", mixed], ["loop", looped]] as const) {
    const result = await render(source);
    if (mode === "mix") exportPcm = result.pcm;
    assert.equal(result.sampleOrigin, 1600); assert.equal(result.frames, 8000);
    assert.equal(result.channels, 2); assert.equal(result.sampleRate, 48000); assert.equal(result.hasAudio, true);
    let worst = 0;
    for (let sample = 0; sample < 8000; sample++) for (let channel = 0; channel < 2; channel++) {
      const frame = 1 + Math.floor(sample / 1600), local = sample % 1600;
      const read = (wav: Buffer, sourceFrame: number) => wav.readFloatLE(44 + ((sourceFrame * 1600 + local) * 2 + channel) * 4);
      let expected = 0;
      if (mode === "loop") expected = read(a, 6 + frame % 2) * (0.25 + (frame % 2) / 4);
      else {
        if (frame >= 2 && frame < 5) expected += read(a, 6 + frame - 2) * (0.25 + (frame - 2) / 4);
        if (frame === 3) expected += read(b, 3) * 0.5;
      }
      worst = Math.max(worst, Math.abs(result.pcm.readFloatLE(sample * 8 + channel * 4) - expected));
    }
    assert.ok(worst < 1e-7, `${mode} native-to-PCM sample error ${worst}`);
    console.log(`${mode}: 16000 stereo samples independently verified; peak absolute error ${worst}`);
  }
  const silence = await render(mixed, 1, 1);
  assert.equal(silence.hasAudio, false); assert.ok(silence.pcm.every(value => value === 0));
  const fractional = await compile("fractional");
  const full = await render(fractional, 2, 4, AbortSignal.timeout(90000), 44100);
  const partial = await render(fractional, 3, 1, AbortSignal.timeout(30000), 44100);
  assert.equal(full.sampleOrigin, 2942); assert.equal(partial.sampleOrigin, 4414);
  assert.equal(partial.frames, 1471);
  assert.deepEqual(partial.pcm, full.pcm.subarray(1472 * 8, (1472 + 1471) * 8));
  console.log("29.97 fps / 44.1 kHz: native Sequence+trim partial output exactly matches the full-range sample slice");
  await rename(sourceDirectory, join(root, "author-moved"));
  context = { store: new FileProjectStore(storeOptions), projectId: "audio-pcm-probe" };
  const rebuilt = await compileProgrammaticProject({ action: "rebuild", input: JSON.parse(JSON.stringify(mixed)),
    toolchainDirectory, context, signal: AbortSignal.timeout(30000), enqueue: task => task() });
  assert.equal(rebuilt.reusedDocument, true);
  const archived = await render(rebuilt.source, 3, 1);
  for (let i = 0; i < 1600; i++) for (let c = 0; c < 2; c++) {
    const expected = (a.readFloatLE(44 + ((7 * 1600 + i) * 2 + c) * 4)
      + b.readFloatLE(44 + ((3 * 1600 + i) * 2 + c) * 4)) * 0.5;
    assert.ok(Math.abs(archived.pcm.readFloatLE(i * 8 + c * 4) - expected) < 1e-7);
  }
  console.log("Native composition -> PCM: silence, trim/gain/overlap, loops, partial range, archive rebuild and rejection checks passed");
  }
  if (process.argv.includes("--fixture-server")) {
    const editorDirectory = join(root, "editor-author");
    await mkdir(editorDirectory);
    await copyFile(fileURLToPath(new URL("./remotion/audio-editor.tsx", import.meta.url)), join(editorDirectory, "index.tsx"));
    await writeFile(join(editorDirectory, "editor.wav"), nativeAudioWav({ sampleRate: 44100, seconds: 0.2,
      sample: (i, c) => Math.sin(i * 441 * Math.PI * 2 / 44100) * (c ? -0.2 : 0.4) }));
    const editorSource = (await compileProgrammaticProject({ action: "compile", input: {
      version: 1, engine: "remotion", sourceDirectory: editorDirectory, entryFile: "index.tsx", files: ["index.tsx", "editor.wav"],
      compositionId: "EditorAudio", width: 64, height: 64, frameRate: { numerator: 30, denominator: 1 }, durationFrames: 6, seed: 7,
      audio: { version: 1, mode: "native", volumeDb: -6 },
    }, toolchainDirectory, context, signal: AbortSignal.timeout(30000), enqueue: task => task() })).source;
    audioService = createProgrammaticAudioService({ resourceStore: context, executable, connectionFile: "",
      decoder: { ffmpeg, ffprobe } });
    server = createServer(async (request, response) => {
      if (request.url === "/api/pcm") { response.writeHead(200, { "content-type": "application/octet-stream" }).end(exportPcm); return; }
      if (request.url === "/api/editor-source") { response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(editorSource)); return; }
      if (request.url === "/api/programmatic/audio") { await audioService!.handle(request, response); return; }
      if (request.url === "/api/programmatic/frame") {
        const controller = new AbortController(), abort = () => controller.abort(); response.once("close", abort);
        try {
          const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const frameRequest = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ProgrammaticFrameRequest;
          const png = await renderHtmlPng({ request: frameRequest, resourceStore: context, executable,
            nativeVideoDecoder: { ffmpeg, ffprobe }, signal: controller.signal });
          response.writeHead(200, { "content-type": "image/png" }).end(png);
        } catch (error) { if (!response.destroyed) response.writeHead(422, { "content-type": "application/json" }).end(JSON.stringify({ error: String(error) })); }
        finally { response.removeListener("close", abort); }
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("No native PCM fixture address");
    console.log(JSON.stringify({ endpoint: `http://127.0.0.1:${address.port}` }));
    await new Promise<void>(resolve => { process.stdin.once("data", () => resolve()); process.stdin.once("end", resolve); process.stdin.resume(); });
    process.stdin.pause();
  }
} finally {
  await audioService?.dispose();
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
  if (dirname(root) !== parent || !basename(root).startsWith("rocut-remotion-pcm-")) throw Error("Unsafe PCM diagnostic cleanup");
  await rm(root, { recursive: true, force: true });
}
