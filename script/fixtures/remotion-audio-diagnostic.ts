import { strict as assert } from "node:assert";
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { analyzeRemotionAudioFrame } from "../../apps/cli/src/programmatic/remotion-audio-analysis";
import { renderHtmlPng } from "../../apps/cli/src/programmatic/html-rasterizer";
import { nativeVideoFixture } from "./native-video-fixture.mjs";
import { execFileSync } from "node:child_process";

const toolchainDirectory = process.argv[2];
if (!toolchainDirectory) throw Error("Expected an explicitly configured isolated Remotion toolchain");
const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, "rocut-remotion-audio-"));
const require = createRequire(new URL("../../apps/vite-example/package.json", import.meta.url));
const { chromium } = await import(pathToFileURL(require.resolve("@playwright/test")).href);
const sourceDirectory = join(root, "author");
const storeOptions = { root: join(root, "target"), schemaVersion: 1 };
let context = { store: new FileProjectStore(storeOptions), projectId: "audio-probe" };
// Known two-second PCM files, not model downloads, recorded voices, or user media.
function wave(frequency: number) {
  const rate = 48000, frames = 2 * rate, body = Buffer.alloc(44 + frames * 2);
  body.write("RIFF", 0); body.writeUInt32LE(body.length - 8, 4); body.write("WAVEfmt ", 8);
  body.writeUInt32LE(16, 16); body.writeUInt16LE(1, 20); body.writeUInt16LE(1, 22);
  body.writeUInt32LE(rate, 24); body.writeUInt32LE(rate * 2, 28); body.writeUInt16LE(2, 32);
  body.writeUInt16LE(16, 34); body.write("data", 36); body.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) body.writeInt16LE(Math.round(4000 * Math.sin(i * frequency * Math.PI * 2 / rate)), 44 + i * 2);
  return body;
}
try {
  await mkdir(join(sourceDirectory, "public"), { recursive: true });
  await copyFile(fileURLToPath(new URL("./remotion/audio.tsx", import.meta.url)), join(sourceDirectory, "index.tsx"));
  await writeFile(join(sourceDirectory, "tone.wav"), wave(440));
  await writeFile(join(sourceDirectory, "public/other.wav"), wave(880));
  await writeFile(join(sourceDirectory, "frames.webm"), await nativeVideoFixture());
  const spec = { version: 1, engine: "remotion", sourceDirectory, entryFile: "index.tsx",
    files: ["index.tsx", "tone.wav", "public/other.wav", "frames.webm"], compositionId: "AudioProbe",
    width: 64, height: 64, frameRate: { numerator: 30, denominator: 1 }, durationFrames: 60, seed: 7 };
  const compile = async (mode: string) => (await compileProgrammaticProject({
    action: "compile", input: { ...spec, inputProps: { mode } }, toolchainDirectory, context,
    signal: AbortSignal.timeout(30000), enqueue: task => task(),
  })).source;
  const source = await compile("mix");
  const request = (input = source, index = 23) => ({ source: input, clipStart: 0, clipDuration: 240000, trimStart: 0, timelineTime: index * 4000 });
  const analyze = (input = source, index = 23, signal = AbortSignal.timeout(15000)) => analyzeRemotionAudioFrame({
    executable: chromium.executablePath(), request: request(input, index), resourceStore: context, signal,
  });
  const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  let baseline: unknown;
  for (const index of [23, 5, 6, 24, 25, 4, 0, 8, 15, 16, 23]) {
    const result = await analyze(source, index);
    const nested = result.assets.filter(asset => asset.playbackRate === 2);
    assert.equal(nested.length, index >= 5 && index < 25 ? 1 : 0);
    if (nested.length) { close(nested[0].sourceTime, (6 + (index - 5) * 2) / 30); close(nested[0].volume, 0.1 + (index - 5) / 100); }
    const loops = result.assets.filter(asset => asset.playbackRate === 1).sort((a, b) => a.volume - b.volume);
    assert.equal(loops.length, 2); // muted and zero-volume native components never register
    for (const loop of loops) close(loop.sourceTime, (12 + index % 8) / 30);
    close(loops[0].volume, 0.2 + (index % 8) / 1000);
    close(loops[1].volume, 0.3 + index / 1000);
    // The declared bundle also contains the inactive corrupt-media test branch.
    // Admission is byte-scoped; only native active components decode metadata.
    assert.equal(result.sources.length, 4);
    assert.equal(result.sources.filter(item => item.body.length === 192044).length, 2);
    if (index === 23) { if (baseline) assert.deepEqual(result.assets, baseline); else baseline = result.assets; }
    console.log(`Native audio frame ${index}: ${result.assets.length} assets, source times and volume verified`);
  }
  for (const mode of ["offthread", "video"]) {
    const compiled = await compile(mode), result = await analyze(compiled);
    assert.equal(result.assets.length, 1);
    assert.equal(result.assets[0].type, "video"); close(result.assets[0].sourceTime, 1.4);
    close(result.assets[0].volume, 0.4); close(result.assets[0].toneFrequency, 1.25);
    assert.equal(result.assets[0].audioStreamIndex, 1);
    console.log(`${mode}: native audio registration verified without a picture decoder`);
    const ffmpeg = process.env.ROCUT_TEST_FFMPEG, ffprobe = process.env.ROCUT_TEST_FFPROBE;
    if (!ffmpeg || !ffprobe) throw Error("Picture/audio regression requires the isolated native decoder paths");
    const picture = await renderHtmlPng({ executable: chromium.executablePath(), resourceStore: context,
      nativeVideoDecoder: { ffmpeg, ffprobe }, signal: AbortSignal.timeout(15000),
      request: request({ ...compiled, audio: { version: 1, mode: "native" } }) });
    const rgb = execFileSync(ffmpeg, ["-v", "error", "-f", "image2pipe", "-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
      { input: picture, windowsHide: true, timeout: 15000, maxBuffer: 128 * 1024 });
    let marker = 0;
    for (let bit = 0; bit < 6; bit++) { const value = rgb[(8 * 64 + bit * 8 + 4) * 3];
      assert.ok(value < 25 || value > 230, `Undecoded video bit ${bit}: ${value}`); if (value > 230) marker |= 1 << bit; }
    assert.equal(marker, 42, `${mode} picture was skipped or sampled at the wrong audio-handled frame`);
    console.log(`${mode}: declared soundtrack keeps genuine source-frame 42 picture rendering`);
  }
  for (const [mode, message] of [["corrupt", "decode failed"], ["remote", "not admitted"],
    ["raw", "Unregistered"], ["artifact", "artifacts"]]) {
    const bad = await compile(mode);
    await assert.rejects(analyze(bad), error => String(error).includes(message));
  }
  const runaway = await compile("runaway");
  await assert.rejects(analyze(runaway, 23, AbortSignal.timeout(1500)), /cancelled|abort/i);
  await assert.rejects(renderHtmlPng({ executable: chromium.executablePath(), request: request(),
    resourceStore: context, signal: AbortSignal.timeout(15000) }), /asset adapter|Rocut tracks/);
  await rename(sourceDirectory, join(root, "author-moved"));
  context = { store: new FileProjectStore(storeOptions), projectId: "audio-probe" };
  const rebuilt = await compileProgrammaticProject({ action: "rebuild", input: JSON.parse(JSON.stringify(source)),
    toolchainDirectory, context, signal: AbortSignal.timeout(30000), enqueue: task => task() });
  assert.equal(rebuilt.reusedDocument, true);
  assert.deepEqual((await analyze(rebuilt.source)).assets, baseline);
  console.log("Native audio admission/error/cancellation/recovery/archive checks passed; normal picture export still rejects embedded audio");
} finally {
  if (dirname(root) !== parent || !basename(root).startsWith("rocut-remotion-audio-")) throw Error("Unsafe native audio probe cleanup");
  await rm(root, { recursive: true, force: true });
}
