import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  integrated = "C:/tmps/rocut-control-integrated-AYnOOY", runtime = join(integrated, "runtime"),
  pkg = "C:/tmps/rocut-control-private-wasm-bftNN0/pkg", toolchain = "C:/tmps/rocut-three-pinned-features-ZvqmB9/toolchain",
  creator = "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized",
  executable = "C:/Program Files/Google/Chrome/Application/chrome.exe",
  root = await mkdtemp("C:/tmps/rocut-liquid-animated-production-");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const pin = async path => { const bytes = await readFile(path); return { path, bytes: bytes.length, sha256: sha(bytes) }; };
const receipt = { ok: false, root, integrated, runtime, pkg, toolchain, executable,
  scope: "existing integrated fb449 sidecars + current production source compile/capture; integrated editor surface pinned but not loaded; no editor UI/export/new WASM/Vite/pack/release" };
const processes = [], consoleErrors = [], exceptionEvents = [], gpuInfo = [], phaseRequests = [];
const originalSpawn = childProcess.spawn;
childProcess.spawn = function (...args) {
  const child = originalSpawn(...args), flags = args[1] ?? [];
  const item = { executable: basename(args[0]), pid: child.pid, kind: flags.includes("--headless=new") ? "private-chromium" : flags.includes("--input-type=module") ? "native-worker" : "compiler", closed: false };
  processes.push(item); child.once("close", (code, signal) => Object.assign(item, { closed: true, code, signal })); return child;
};
syncBuiltinESMExports();
const NativeWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class extends NativeWebSocket {
  constructor(...args) {
    super(...args);
    this.addEventListener("open", () => { this.send(JSON.stringify({ id: 90000001, method: "SystemInfo.getInfo" })); });
    this.addEventListener("message", event => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.id === 90000001) gpuInfo.push(message.result?.gpu ?? { error: message.error });
        if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error")
          consoleErrors.push(message.params.args.map(item => item.value ?? item.description).join(" ").slice(0, 2000));
        if (message.method === "Runtime.exceptionThrown") exceptionEvents.push(message.params.exceptionDetails);
        if (message.method === "Runtime.bindingCalled" && message.params.name === "__rocutLiquidObjectRequest") {
          const envelope = JSON.parse(message.params.payload);
          phaseRequests.push({ operation: envelope.operation ?? "evaluate", bytes: Buffer.byteLength(message.params.payload), sha256: sha(message.params.payload) });
        }
      } catch { /* Diagnostic observer never changes production protocol. */ }
    });
  }
};
let esbuild;
try {
  const temp = join(root, "temp"); await mkdir(temp);
  for (const key of ["TEMP", "TMP", "TMPDIR"]) process.env[key] = temp;
  receipt.packageBefore = await Promise.all(["opencut_wasm_sync.js", "opencut_wasm_bg.js", "opencut_wasm_bg.wasm", "package.json"].map(name => pin(join(pkg, name))));
  assert.equal(receipt.packageBefore[2].sha256, "fb44959548ea4ef46fbea15a2280c7d200bede27bf0bc6e08d6cbbec2337df4c");
  receipt.surfacePin = await pin(join(integrated, "surface", "surface-wasm-package.json"));
  receipt.browserPin = await pin(executable);
  receipt.creatorBefore = await Promise.all(["liquid-animated-object.mjs", "liquid-animated-scene.ts", "liquid-object.mjs", "liquid-object-geometry.mjs", "particle-pose-geometry.mjs", "object-animation.mjs", "object-params-resolver.mjs"].map(name => pin(join(creator, name))));
  receipt.sidecars = [];
  for (const name of ["liquid-object-wasm.mjs", "particle-sampler-wasm.mjs", "liquid-object-worker-entry.mjs", "particle-sampler-worker-entry.mjs", "opencut_wasm_bg.wasm"]) {
    const bytes = await readFile(join(runtime, name));
    if (name.endsWith("worker-entry.mjs")) assert.deepEqual(bytes, await readFile(join(repo, "apps/cli/src/programmatic", name)));
    if (name.endsWith(".wasm")) assert.equal(sha(bytes), receipt.packageBefore[2].sha256);
    await copyFile(join(runtime, name), join(root, name)); receipt.sidecars.push({ name, bytes: bytes.length, sha256: sha(bytes) });
  }
  esbuild = await import(pathToFileURL(join(toolchain, "node_modules/esbuild/lib/main.js")).href);
  const built = await esbuild.build({ entryPoints: [join(repo, "script/fixtures/liquid-animated-production.ts")], bundle: true, write: false,
    platform: "node", format: "esm", metafile: true, logLevel: "silent", define: {
      "import.meta.__ROCUT_PACKED_LIQUID_OBJECT_MODULE_V1__": JSON.stringify("./liquid-object-wasm.mjs"),
      "import.meta.__ROCUT_PACKED_PARTICLE_SAMPLER_MODULE_V1__": JSON.stringify("./particle-sampler-wasm.mjs"),
    }, plugins: [{ name: "same-private-wasm", setup(builder) {
      builder.onResolve({ filter: /^opencut-wasm$/ }, () => ({ path: pathToFileURL(join(pkg, "opencut_wasm_sync.js")).href, external: true }));
    } }] });
  esbuild.stop();
  const bundle = join(root, "production.mjs"); await writeFile(bundle, built.outputFiles[0].contents, { flag: "wx" });
  receipt.bundle = await pin(bundle);
  receipt.sourceBefore = await Promise.all(Object.keys(built.metafile.inputs).map(path => pin(resolve(repo, path))));
  await writeFile(join(root, "preparation.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ root, stage: "three-real-production-liquid-captures" }));
  const fixture = await import(pathToFileURL(bundle).href);
  receipt.capture = await fixture.runLiquidAnimatedProduction({ root, creator, toolchain, executable, observe: () => processes.map(item => ({ ...item })) });
  assert.equal(consoleErrors.length, 0); assert.equal(exceptionEvents.length, 0);
  for (const operation of ["open", "evaluate", "close"])
    assert.equal(phaseRequests.filter(item => item.operation === operation).length, 3, `One ${operation} operation per production frame`);
  assert.equal(gpuInfo.length, 3, "Actual browser GPU diagnostics per private capture");
  receipt.ok = true;
} catch (error) {
  receipt.failure = { message: error.message, stack: error.stack, causes: error.errors?.map(item => ({ message: item.message, stack: item.stack })) };
  process.exitCode = 1;
} finally {
  esbuild?.stop();
  for (let i = 0; i < 50 && processes.some(item => !item.closed); i++) await new Promise(done => setTimeout(done, 20));
  receipt.processes = processes; receipt.consoleErrors = consoleErrors; receipt.exceptionEvents = exceptionEvents;
  receipt.gpuInfo = gpuInfo; receipt.phaseRequests = phaseRequests;
  receipt.packageAfter = await Promise.all((receipt.packageBefore ?? []).map(item => pin(item.path)));
  receipt.creatorAfter = await Promise.all((receipt.creatorBefore ?? []).map(item => pin(item.path)));
  receipt.sourceAfter = await Promise.all((receipt.sourceBefore ?? []).map(item => pin(item.path)));
  receipt.inputPinsUnchanged = JSON.stringify(receipt.packageAfter) === JSON.stringify(receipt.packageBefore) &&
    JSON.stringify(receipt.creatorAfter) === JSON.stringify(receipt.creatorBefore) && JSON.stringify(receipt.sourceAfter) === JSON.stringify(receipt.sourceBefore);
  receipt.allObservedOwnedProcessesClosed = processes.every(item => item.closed);
  if (!receipt.inputPinsUnchanged || !receipt.allObservedOwnedProcessesClosed) { receipt.ok = false; process.exitCode = 1; }
  await writeFile(join(root, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  childProcess.spawn = originalSpawn; syncBuiltinESMExports(); globalThis.WebSocket = NativeWebSocket;
  console.log(JSON.stringify({ root, ok: receipt.ok, failure: receipt.failure?.message, allObservedOwnedProcessesClosed: receipt.allObservedOwnedProcessesClosed }));
}
