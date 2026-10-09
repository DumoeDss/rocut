import { strict as assert } from "node:assert";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG, ffprobe = process.env.ROCUT_TEST_FFPROBE;
const editor = process.argv.includes("--editor");
const fixture = editor ? "native-audio-editor-browser" : "native-audio-export-browser";
if (!process.argv[2] || !isolated || !isAbsolute(isolated) || !ffmpeg || !ffprobe)
  throw Error("Provide isolated toolchain, ROCUT_TEST_WASM_DIRECTORY, ROCUT_TEST_FFMPEG and ROCUT_TEST_FFPROBE");
const temporary = await mkdtemp(join(tmpdir(), "rocut-native-audio-export-"));
const host = spawn("bun", ["--preload", "./script/fixtures/isolated-web-wasm-preload.mjs",
  "script/fixtures/remotion-audio-pcm-diagnostic.ts", process.argv[2], "--fixture-server", ...(editor ? ["--editor-only"] : [])], {
  cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary },
});
const exited = new Promise(resolve => host.once("close", resolve));
let browser, server, hostReady = false;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(Error("Native audio fixture startup timeout")), 240000);
    const fail = error => { clearTimeout(timer); reject(error); };
    host.once("error", fail); host.once("exit", code => fail(Error(`Native audio fixture exited ${code}`)));
    host.stderr.on("data", data => process.stderr.write(data));
    host.stdout.on("data", data => {
      process.stdout.write(data); output += String(data);
      let end;
      while ((end = output.indexOf("\n")) >= 0) {
        const line = output.slice(0, end); output = output.slice(end + 1);
        try { const value = JSON.parse(line); if (value.endpoint) { clearTimeout(timer); resolve(value.endpoint); } } catch {}
      }
    });
  });
  hostReady = true;
  // Both backend and browser use the same genuine isolated WASM, not a stub or
  // a replacement of shared rust/wasm/pkg. Await web-target initialization.
  const output = join(temporary, "web");
  await buildNativeAudioExportProbe(root, isolated, output, fixture);
  server = await createServer({ root: output, configFile: false, cacheDir: join(temporary, "vite-cache"), logLevel: "error",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: "127.0.0.1", hmr: false, port: 0, proxy: { "/api": { target: endpoint } } },
  });
  await server.listen(); browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text().slice(0, 1000)); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/${fixture}.html`, { waitUntil: "commit", timeout: 90000 });
  await page.waitForFunction(() => globalThis.__nativeAudioExport, undefined, { timeout: editor ? 180000 : 30000 })
    .catch(error => { throw Error(JSON.stringify({ error: String(error), errors })); });
  const result = await page.evaluate(() => globalThis.__nativeAudioExport);
  if (result.error || errors.length) throw Error(JSON.stringify({ result, errors }));
  const file = join(temporary, "soundtrack.webm");
  await writeFile(file, Buffer.from(result.bytes));
  if (editor && process.env.ROCUT_AUDIO_KEEP_DIAGNOSTIC === "1") {
    await writeFile(join(isolated, "export-editor-diagnostic.webm"), Buffer.from(result.bytes));
    await writeFile(join(isolated, "export-editor-diagnostic.f32le"), Buffer.from(result.pcm));
  }
  const options = { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 };
  const metadata = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-count_frames", "-show_streams", "-of", "json", file], options));
  assert.equal(metadata.streams.find(s => s.codec_type === "video")?.nb_read_frames, editor ? "6" : "5");
  const track = metadata.streams.find(s => s.codec_type === "audio");
  assert.equal(track?.codec_name, "opus"); assert.equal(track?.channels, 2); assert.equal(track?.sample_rate, "48000");
  const decoded = execFileSync(ffmpeg, ["-v", "error", "-i", file, "-map", "0:a:0", "-f", "f32le", "-ac", "2", "-ar", editor ? "44100" : "48000", "pipe:1"], options);
  const expected = editor ? Buffer.from(result.pcm) : Buffer.from(await (await fetch(`${endpoint}/api/pcm`)).arrayBuffer());
  if (editor) {
    const pixels = execFileSync(ffmpeg, ["-v", "error", "-i", file, "-map", "0:v:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], options);
    const pictureColors = Array.from({ length: 6 }, (_, frame) => [...pixels.subarray((frame * 64 * 64 + 32 * 64 + 32) * 3, (frame * 64 * 64 + 32 * 64 + 32) * 3 + 3)]);
    console.log(JSON.stringify({ pictureColors, videoMetadata: metadata.streams.find(s => s.codec_type === "video") }));
    for (let frame = 0; frame < 6; frame++) {
      const color = frame >= 1 && frame <= 4 ? [frame * 40, 255 - frame * 20, 0] : [0, 0, 0];
      const offset = (frame * 64 * 64 + 32 * 64 + 32) * 3;
      for (let c = 0; c < 3; c++) assert.ok(Math.abs(pixels[offset + c] - color[c]) <= 6,
        `Editor source picture ${frame}/${c}: ${pixels[offset + c]} instead of ${color[c]}`);
    }
  }
  // Opus completes 20ms packets. Never hide onset loss by shifting samples or
  // accepting fewer decoded samples. Admit at most one packet of padding;
  // the editor fixture ends audibly, so its tail may contain bounded ringing.
  assert.ok(decoded.length >= expected.length && decoded.length < expected.length + 8 * 960,
    `Unexpected encoded duration: ${decoded.length / 8}`);
  const channels = [];
  for (let c = 0; c < 2; c++) {
    let error = 0, reference = 0, cross = 0, actual = 0, count = 0, silence = 0;
    for (let i = 0; i < decoded.length / 8; i++) {
      const x = i < expected.length / 8 ? expected.readFloatLE(i * 8 + c * 4) : 0;
      const y = decoded.readFloatLE(i * 8 + c * 4);
      if (!editor && (i < 1000 || i >= 7000)) silence = Math.max(silence, Math.abs(y));
      if (editor ? i < 1750 || i >= 7000 : i < 1856 || i >= 6144 || i % 1600 < 256 || i % 1600 >= 1344) continue;
      error += (x - y) ** 2; reference += x * x; actual += y * y; cross += x * y; count++;
    }
    const rmsError = Math.sqrt(error / count), correlation = cross / Math.sqrt(reference * actual);
    assert.ok(rmsError < 0.02 && correlation > 0.98,
      `Export soundtrack channel ${c}: ${JSON.stringify({ rmsError, correlation })}`);
    if (editor) {
      const sourceSamples = expected.length / 8;
      const sectionRms = [[0, 1470], [1470, 7350], [7350, sourceSamples]].map(([start, end]) => {
        let sum = 0;
        for (let i = start; i < end; i++)
          sum += (expected.readFloatLE(i * 8 + c * 4) - decoded.readFloatLE(i * 8 + c * 4)) ** 2;
        return Math.sqrt(sum / (end - start));
      });
      let earlyTailPeak = 0, lateTailPeak = 0;
      for (let i = sourceSamples; i < decoded.length / 8; i++) {
        const value = Math.abs(decoded.readFloatLE(i * 8 + c * 4));
        if (i < sourceSamples + 32) earlyTailPeak = Math.max(earlyTailPeak, value);
        else lateTailPeak = Math.max(lateTailPeak, value);
      }
      assert.ok(sectionRms.every(value => value < 0.003) && earlyTailPeak < 0.003 && lateTailPeak < 0.001,
        `Export onset/end/tail channel ${c}: ${JSON.stringify({ sectionRms, earlyTailPeak, lateTailPeak })}`);
      channels.push({ rmsError, correlation, sectionRms, earlyTailPeak, lateTailPeak });
    } else {
      assert.ok(silence < 0.001, `Export silence channel ${c}: ${silence}`);
      channels.push({ rmsError, correlation, silence });
    }
  }
  console.log(JSON.stringify({ passed: true, exportedBytes: result.bytes.length, videoFrames: editor ? 6 : 5,
    audio: "stereo Opus 48000", decodedSamples: decoded.length / 8, sourceSamples: expected.length / 8,
    codecPaddingSamples: (decoded.length - expected.length) / 8, channels,
    ...(editor ? { editorMixMaxError: result.worst, nativeAudioRequests: result.nativeAudioRequests, preview: result.preview } : {}),
    scope: editor ? "native Remotion -> HTTP audio runtime -> editor trim/gain/ordinary mix -> buildScene -> SceneExporter; independent AV decode; not installed/Electron"
      : "native Remotion -> PCM -> real Rocut SceneExporter; synthetic picture; not installed-editor integration" }, null, 2));
} catch (error) {
  console.error(error?.stack ?? String(error)); process.exitCode = 1;
} finally {
  await browser?.close(); await server?.close();
  if (host.exitCode === null && !host.killed) {
    if (hostReady) host.stdin.end("stop\n"); else host.kill();
  }
  await exited;
  const leaked = (await readdir(temporary)).filter(name => name.startsWith("rocut-"));
  if (leaked.length) throw Error(`Native audio probe leaked ${leaked.join(", ")}`);
  if (dirname(temporary) !== resolve(tmpdir()) || !basename(temporary).startsWith("rocut-native-audio-export-")) throw Error("Unsafe native audio cleanup");
  await rm(temporary, { recursive: true, force: true });
}
