import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import { verifyHyperframesEditorExport } from "./fixtures/hyperframes-audio-editor-verify.mjs";
import { resolveProbeBrowserExecutable, resolveRequiredProbeWasmBinding } from "./fixtures/browser-probe-identity.mjs";
import { assertHtmlProbeWasmIdentity, resolveHtmlProbeArtifactDirectory, snapshotHtmlProbeSources, saveHtmlProbeEvidence } from "./html-probe-wasm-binding.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG, ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (!process.argv[2] || !isolated || !isAbsolute(isolated) || !ffmpeg || !ffprobe)
  throw Error("Provide isolated toolchain, ROCUT_TEST_WASM_DIRECTORY, ROCUT_TEST_FFMPEG and ROCUT_TEST_FFPROBE");
const binding = resolveRequiredProbeWasmBinding({ directory: isolated, expectedWasmSha256: process.env.ROCUT_PROBE_WASM_SHA256 });
const executablePath = resolveProbeBrowserExecutable({ configured: process.env.ROCUT_PROBE_BROWSER_PATH, fallback: chromium.executablePath() });
const artifactDirectory = resolveHtmlProbeArtifactDirectory(process.env.ROCUT_PROBE_ARTIFACTS);
const sourceInputs = snapshotHtmlProbeSources(root, ["script/probe-hyperframes-audio-editor.mjs", "script/native-audio-export-build.mjs", "script/html-probe-wasm-binding.mjs", "script/fixtures/browser-probe-identity.mjs", "script/fixtures/local-wasm-preload.mjs", "script/fixtures/hyperframes-audio-editor-host.ts", "script/fixtures/hyperframes-audio-editor-browser.ts", "script/fixtures/hyperframes-audio-editor-browser.html", "script/fixtures/hyperframes-audio-editor-verify.mjs"]);
const temporary = await mkdtemp(join(tmpdir(), "rocut-hf-audio-editor-export-"));
const host = spawn("bun", ["--preload", "./script/fixtures/local-wasm-preload.mjs",
  "script/fixtures/hyperframes-audio-editor-host.ts", process.argv[2]], {
  cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary },
});
const exited = new Promise(resolve => host.once("close", resolve));
let browser, server, hostReady = false, hostWasmIdentity;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(Error("HF editor fixture startup timeout")), 90000);
    const fail = error => { clearTimeout(timer); reject(error); };
    host.once("error", fail); host.once("exit", code => fail(Error(`HF editor fixture exited ${code}`)));
    host.stderr.on("data", data => process.stderr.write(data));
    host.stdout.on("data", data => {
      process.stdout.write(data); output += String(data);
      let end;
      while ((end = output.indexOf("\n")) >= 0) {
        const line = output.slice(0, end); output = output.slice(end + 1);
        let value;
        try { value = JSON.parse(line); } catch { continue; }
        if (value.wasmIdentity) hostWasmIdentity = value.wasmIdentity;
        if (value.endpoint) {
          try { assertHtmlProbeWasmIdentity(binding, hostWasmIdentity); }
          catch (error) { fail(error); return; }
          clearTimeout(timer); resolve(value.endpoint);
        }
      }
    });
  });
  hostReady = true;
  const output = join(temporary, "web");
  await buildNativeAudioExportProbe(root, isolated, output, "hyperframes-audio-editor-browser");
  server = await createServer({ root: output, configFile: false, cacheDir: join(temporary, "vite-cache"), logLevel: "error",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: "127.0.0.1", hmr: false, port: 0, proxy: { "/api": { target: endpoint } } },
  });
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath, args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text().slice(0, 1000)); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/hyperframes-audio-editor-browser.html`, { waitUntil: "commit", timeout: 90000 });
  await page.waitForFunction(() => globalThis.__hyperframesAudioEditorExport, undefined, { timeout: 180000 })
    .catch(error => { throw Error(JSON.stringify({ error: String(error), errors })); });
  const result = await page.evaluate(() => globalThis.__hyperframesAudioEditorExport);
  const browserWasmIdentity = await page.evaluate(() => globalThis.__htmlProbeWasmIdentity);
  assertHtmlProbeWasmIdentity(binding, browserWasmIdentity);
  assertHtmlProbeWasmIdentity(binding, hostWasmIdentity);
  if (result.error || errors.length) throw Error(JSON.stringify({ result, errors }));
  assert.equal(result.nativeAudioRequests, 2);
  const counts = await (await fetch(`${endpoint}/api/counts`)).json();
  assert.equal(counts.audioRequests, 2); assert.equal(counts.pictureRequests, 7);
  const [loopPcm, videoPcm] = await Promise.all(["loop", "video"].map(async name => Buffer.from(await (await fetch(`${endpoint}/api/oracle/${name}`)).arrayBuffer())));
  const file = join(temporary, "hyperframes-editor.webm");
  await writeFile(file, Buffer.from(result.bytes));
  const verified = verifyHyperframesEditorExport({ file, ffmpeg, ffprobe, loopPcm, videoPcm, mixedPcm: Buffer.from(result.pcm) });
  const evidence = { passed: true, exportedBytes: result.bytes.length, videoFrames: 9, audio: "stereo Opus 48000",
    ...verified, editorLoopMixMaxError: result.exactWorst, editorVideoMixRmsError: result.videoRmsError, counts,
    scope: "archived native HyperFrames loop + audible VP9 -> production HTTP audio/frame -> runtime/collector/editor placement/trim/gain/ordinary mix -> buildScene/ProgrammaticNode/SceneExporter; independent FFmpeg AV decode; not installed/Electron",
    wasmIdentity: browserWasmIdentity, hostWasmIdentity, browserExecutable: executablePath };
  if (artifactDirectory) await saveHtmlProbeEvidence({ directory: artifactDirectory, result: evidence, binding,
    browser: browser.version(), frameBackend: "private-chromium", root, sourceInputs });
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  console.error(error?.stack ?? String(error)); process.exitCode = 1;
} finally {
  await browser?.close(); await server?.close();
  if (host.exitCode === null && !host.killed) { if (hostReady) host.stdin.end("stop\n"); else host.kill(); }
  await exited;
  const leaked = (await readdir(temporary)).filter(name => name.startsWith("rocut-"));
  if (leaked.length) throw Error(`HF editor probe leaked ${leaked.join(", ")}`);
  if (dirname(temporary) !== resolve(tmpdir()) || !basename(temporary).startsWith("rocut-hf-audio-editor-export-")) throw Error("Unsafe HF editor probe cleanup");
  await rm(temporary, { recursive: true, force: true });
}
