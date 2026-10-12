import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import childProcess from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { privateElectronLaunch, standaloneElectronArgs } from "./electron-wholegraph-png-launcher.mjs";
import { privateWholegraphOutputRoot } from "./electron-wholegraph-png-output-root.cjs";

const [requestedRoot, pkg, mode] = process.argv.slice(2);
const root = privateWholegraphOutputRoot(requestedRoot);
assert(path.isAbsolute(pkg), "Explicit normal package path required; no fixed old core");
assert(["--prepare", "--gpu-lease-confirmed", "--standalone-gpu-lease-confirmed"].includes(mode));
assert(!fs.existsSync(root), "Never overwrite an earlier attempt");
fs.mkdirSync(root);
const launchConfig = privateElectronLaunch(root, process.env);
launchConfig.env.ROCUT_WHOLEGRAPH_BOOT_ROOT = root;
for (const directory of Object.values(launchConfig.paths)) fs.mkdirSync(directory);
const fixtures = path.dirname(fileURLToPath(import.meta.url));
const electron = "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia/node_modules/electron/dist/electron.exe";
const electronSha = "0ace564d2033e3576aee5933c3bc3d927dc443fa7c43e58c36931ba8146ce1bc";
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const pin = p => { const bytes = fs.readFileSync(p); return { path: p, bytes: bytes.length, sha256: hash(bytes) }; };
const receipt = { ok: false, scope: "One isolated hidden Electron40.1.0 WebGL wholegraph PNG consumer; no installed application, encoder or plugin interaction", artifacts: {}, errors: [], externalRequests: [], cleanup: [] };
receipt.launchConfiguration = launchConfig.facts;
let application, server;
const persist = () => fs.writeFileSync(root + "/receipt.json", JSON.stringify(receipt, null, 2) + "\n");
// Playwright may reject its secondary startup waiter before its launch promise.
// Retain that failure without allowing Node to discard startup evidence.
const onUnhandledRejection = error => {
  receipt.errors.push("Unhandled startup rejection: " + String(error?.stack ?? error));
  receipt.ok = false;
  persist();
};
process.on("unhandledRejection", onUnhandledRejection);

function matchesOwnedLaunch(command, args) {
  const main = path.join(fixtures, "electron-wholegraph-png-main.cjs");
  const quoted = value => '"' + value.replace(/"/g, '\\"') + '"';
  // Windows Playwright passes one quoted shell command; do not match an
  // arbitrary process merely containing an Electron executable substring.
  if (command.startsWith(quoted(electron) + " ")) return command.includes(" " + quoted(main) + " ");
  return path.resolve(command).toLowerCase() === path.resolve(electron).toLowerCase() && args?.includes(main);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (~crc) >>> 0;
}
// Native encoder's strict RGBA8/sRGB/filter0 contract, inherited unchanged from graph-runner.
function decode(bytes) {
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  let offset = 8, width, height, srgb = false; const data = [];
  while (offset < bytes.length) {
    const n = bytes.readUInt32BE(offset), kind = bytes.subarray(offset + 4, offset + 8).toString(), body = bytes.subarray(offset + 8, offset + 8 + n);
    assert.equal(crc32(bytes.subarray(offset + 4, offset + 8 + n)), bytes.readUInt32BE(offset + 8 + n));
    if (kind === "IHDR") { width = body.readUInt32BE(0); height = body.readUInt32BE(4); assert.equal(body[8], 8); assert.equal(body[9], 6); }
    if (kind === "sRGB") srgb = body[0] === 0;
    if (kind === "IDAT") data.push(body);
    offset += n + 12;
  }
  assert.equal(offset, bytes.length); assert(srgb); assert.equal(width, 32); assert.equal(height, 24);
  const filtered = zlib.inflateSync(Buffer.concat(data)), rgba = Buffer.alloc(width * height * 4);
  assert.equal(filtered.length, height * (width * 4 + 1));
  for (let y = 0; y < height; y++) { assert.equal(filtered[y * (width * 4 + 1)], 0); filtered.copy(rgba, y * width * 4, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)); }
  return rgba;
}
function compare(rgba, left, right) {
  let maximum = 0, sum = 0;
  for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) for (let c = 0; c < 4; c++) {
    const delta = Math.abs(rgba[(y * 32 + x) * 4 + c] - (x < 16 ? left : right)[c]); maximum = Math.max(maximum, delta); sum += delta;
  }
  return { maximum, mean: sum / rgba.length, gateMaximum: 1, gateMean: .35, accepted: maximum <= 1 && sum / rgba.length <= .35 };
}
try {
  assert.equal(pin(electron).sha256, electronSha, "Only existing Elftia40.1.0 binary allowed");
  receipt.electron = pin(electron);
  receipt.pkg = ["opencut_wasm_bg.wasm", "opencut_wasm_bg.js", "opencut_wasm.d.ts"].map(n => pin(path.join(pkg, n)));
  const esbuildPath = "C:/tmps/three-assets-shared-delivery-20261012/attempt-02/toolchain/node_modules/esbuild/lib/main.js";
  const esbuild = await import(pathToFileURL(esbuildPath).href);
  const built = await esbuild.build({ entryPoints: [path.join(fixtures, "electron-wholegraph-png-browser.ts")], bundle: true, write: false, metafile: true, platform: "browser", format: "esm", external: ["opencut-wasm"], logLevel: "silent" });
  const bundle = Buffer.from(built.outputFiles[0].text), core = fs.readFileSync(path.join(pkg, "opencut_wasm_bg.wasm")), glue = fs.readFileSync(path.join(pkg, "opencut_wasm_bg.js"));
  fs.writeFileSync(root + "/browser.js", bundle);
  receipt.sourcePins = Object.keys(built.metafile.inputs).map(p => pin(path.resolve(p)));
  receipt.fixturePins = ["electron-wholegraph-png-run.mjs", "electron-wholegraph-png-main.cjs", "electron-wholegraph-png-browser.ts", "electron-wholegraph-png-launcher.mjs", "electron-wholegraph-png-output-root.cjs"].map(n => pin(path.join(fixtures, n)));
  receipt.bundle = pin(root + "/browser.js");
  receipt.gates = { transparentGraphLeft: [0, 0, 255, 64], transparentGraphRight: [204, 0, 51, 159], snapshotLeft: [0, 0, 64, 255], snapshotRight: [128, 0, 32, 255], maximum: 1, mean: .35, dimensions: [32, 24], cancellation: "Actual pending native PNG request rejects and drains, same handle next request succeeds" };
  receipt.preparedOnly = mode === "--prepare";
  if (mode === "--prepare") { receipt.ok = true; persist(); console.log(JSON.stringify({ root, prepared: true, coreSha256: receipt.pkg[0].sha256, sourcePins: receipt.sourcePins.length, electronSha256: electronSha })); }
  else {
    const html = '<!doctype html><script type="importmap">{"imports":{"opencut-wasm":"/glue.js"}}</script><script type="module">import * as w from "/glue.js";const m=await WebAssembly.compile(await(await fetch("/core.wasm")).arrayBuffer());const i=await WebAssembly.instantiate(m,Object.fromEntries(WebAssembly.Module.imports(m).map(x=>[x.module,w])));w.__wbg_set_wasm(i.exports);i.exports.__wbindgen_start();globalThis.run=(await import("/browser.js")).runElectronWholegraph;</script>';
    server = createServer((request, response) => {
      const u = new URL(request.url, "http://localhost"), p = u.pathname;
      if (p === "/artifact") {
        const name = u.searchParams.get("name");
        if (!["transparent-graph", "recovered-graph", "snapshot"].includes(name)) { response.writeHead(400).end(); return; }
        const chunks = []; let size = 0;
        request.on("data", b => { size += b.length; if (size > 1024 * 1024) request.destroy(); else chunks.push(b); });
        request.on("end", () => { const bytes = Buffer.concat(chunks), output = root + "/" + name + ".png"; fs.writeFileSync(output, bytes, { flag: "wx" }); receipt.artifacts[name] = pin(output); response.end("retained"); }); return;
      }
      const bytes = p === "/" ? Buffer.from(html) : p === "/glue.js" ? glue : p === "/core.wasm" ? core : p === "/browser.js" ? bundle : null;
      if (!bytes) { response.writeHead(404).end(); return; }
      response.writeHead(200, { "content-type": p === "/" ? "text/html" : p.endsWith(".wasm") ? "application/wasm" : "text/javascript" }).end(bytes);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = "http://127.0.0.1:" + server.address().port + "/";
    const require = createRequire("E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/package.json");
    const { _electron } = require("playwright-core"); // Never require the electron package: it may install.
    const ownedArgs = ["--inspect=0", "--remote-debugging-port=0", path.join(fixtures, "electron-wholegraph-png-main.cjs"), url, root];
    const expectedShellCommand = [electron, ...ownedArgs].map(value => '"' + value.replace(/"/g, '\\"') + '"').join(" ");
    // This Playwright version omits windowsHide in its Electron spawn. Keep the
    // adjustment process-local, exact-target-only, and restore it after launch.
    const originalSpawn = childProcess.spawn;
    childProcess.spawn = function (command, args, options) {
      if (matchesOwnedLaunch(command, args)) {
        assert.equal(command, expectedShellCommand, "Only the exact verified Playwright command may bypass cmd.exe");
        assert.equal(options?.shell, true);
        assert.equal(args.length, 0);
        receipt.windowsHide = true;
        const child = originalSpawn.call(this, electron, ownedArgs, { ...options, shell: false, windowsHide: true });
        receipt.launch = { directElectronPid: child.pid ?? null, shell: false, matchedOriginalShellCommand: true, windowsHide: true, stderr: "", stdout: "" };
        persist();
        console.log(JSON.stringify({ root, ownedLaunchPid: child.pid, windowsHide: true }));
        for (const stream of ["stderr", "stdout"]) child[stream]?.on("data", bytes => {
          receipt.launch[stream] = (receipt.launch[stream] + bytes.toString("utf8")).slice(-16384);
          persist();
        });
        child.on("error", error => { receipt.launch.error = String(error); persist(); });
        child.on("exit", (code, signal) => { receipt.launch.exit = { code, signal }; persist(); });
        child.on("close", (code, signal) => { receipt.launch.close = { code, signal }; persist(); });
        return child;
      }
      return originalSpawn.call(this, command, args, options);
    };
    if (mode === "--standalone-gpu-lease-confirmed") {
      childProcess.spawn = originalSpawn;
      const args = standaloneElectronArgs(path.join(fixtures, "electron-wholegraph-png-main.cjs"), url, root);
      const stdoutPath = path.join(root, "electron-stdout.log"), stderrPath = path.join(root, "electron-stderr.log");
      const stdoutFd = fs.openSync(stdoutPath, "wx"), stderrFd = fs.openSync(stderrPath, "wx");
      let child;
      try {
        child = childProcess.spawn(electron, args, { cwd: launchConfig.cwd, env: { ...launchConfig.env, ROCUT_WHOLEGRAPH_BOOT_ROOT: root }, shell: false, windowsHide: true, stdio: ["ignore", stdoutFd, stderrFd] });
      } finally { fs.closeSync(stdoutFd); fs.closeSync(stderrFd); }
      receipt.launch = { mode: "standalone", pid: child.pid, shell: false, windowsHide: true, debugFlags: false, stdio: "owned-file-fds", stdoutPath, stderrPath, stdout: "", stderr: "" };
      const startupDeadline = setTimeout(() => { receipt.launch.deadlineExpired = true; child.kill(); }, 35000);
      let exit;
      try { exit = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); }); }
      finally { clearTimeout(startupDeadline); }
      receipt.launch.exit = exit;
      receipt.launch.stdout = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(stdoutPath)).slice(-16384);
      receipt.launch.stderr = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(stderrPath)).slice(-16384);
      receipt.launch.logPins = [pin(stdoutPath), pin(stderrPath)];
      receipt.cleanup.push({ owner: "owned standalone Electron", pid: child.pid, exited: true });
      const resultPath = path.join(root, "standalone-result.json");
      assert(fs.existsSync(resultPath), "Standalone main result missing before page/render");
      const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
      receipt.host = result.host; receipt.result = result.result; receipt.externalRequests = result.externalRequests; receipt.errors = result.errors;
      assert.equal(exit.code, 0, result.failure ?? "Standalone process failed");
      assert.equal(result.ok, true, result.failure);
      assert.equal(receipt.host.windows.length, 1); assert.equal(receipt.host.windows[0].visible, false);
      assert.equal(receipt.host.windows[0].sandbox, true); assert.equal(receipt.host.windows[0].nodeIntegration, false);
    } else {
    try {
      application = await _electron.launch({ executablePath: electron, args: [path.join(fixtures, "electron-wholegraph-png-main.cjs"), url, root], cwd: launchConfig.cwd, env: launchConfig.env, timeout: 30000 });
    } finally { childProcess.spawn = originalSpawn; }
    assert.equal(receipt.windowsHide, true, "Explicit hidden owned executable spawn required");
    receipt.ownedElectronPid = application.process().pid; persist(); console.log(JSON.stringify({ root, electronPid: receipt.ownedElectronPid }));
    const page = await application.firstWindow();
    page.on("pageerror", e => receipt.errors.push(String(e)));
    page.on("request", r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(url)) receipt.externalRequests.push(new URL(r.url()).origin); });
    receipt.host = await application.evaluate(({ app, BrowserWindow }) => ({ versions: process.versions, windows: BrowserWindow.getAllWindows().map(w => ({ visible: w.isVisible(), sandbox: w.webContents.getLastWebPreferences().sandbox, nodeIntegration: w.webContents.getLastWebPreferences().nodeIntegration })), profile: app.getPath("userData") }));
    assert.equal(receipt.host.windows.length, 1); assert.equal(receipt.host.windows[0].visible, false);
    await page.waitForFunction(() => typeof globalThis.run === "function", undefined, { timeout: 15000 });
    receipt.result = await page.evaluate(() => globalThis.run());
    }
    const graph = decode(fs.readFileSync(receipt.artifacts["transparent-graph"].path)), recovered = decode(fs.readFileSync(receipt.artifacts["recovered-graph"].path)), snapshot = decode(fs.readFileSync(receipt.artifacts.snapshot.path));
    receipt.graphOracle = compare(graph, receipt.gates.transparentGraphLeft, receipt.gates.transparentGraphRight);
    receipt.snapshotOracle = compare(snapshot, receipt.gates.snapshotLeft, receipt.gates.snapshotRight);
    receipt.sameHandleRecoveryExact = graph.equals(recovered);
    receipt.ok = receipt.graphOracle.accepted && receipt.snapshotOracle.accepted && receipt.sameHandleRecoveryExact && Object.values(receipt.result.controls).every(Boolean) && receipt.result.cleanup.gpuDisposed && !receipt.errors.length && !receipt.externalRequests.length;
    for (const p of [...receipt.pkg, ...receipt.sourcePins, receipt.electron]) assert.equal(pin(p.path).sha256, p.sha256);
  }
} catch (error) { receipt.failure = String(error.stack ?? error); receipt.ok = false; }
finally {
  const early = path.join(root, "early-entry.json"), earlyFailure = path.join(root, "startup-failure.json");
  receipt.earlyEntry = fs.existsSync(early) ? JSON.parse(fs.readFileSync(early, "utf8")) : { reached: false };
  receipt.startupFailure = fs.existsSync(earlyFailure) ? JSON.parse(fs.readFileSync(earlyFailure, "utf8")) : null;
  const marker = path.join(root, "main-entry.json");
  receipt.mainEntry = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, "utf8")) : { reached: false };
  if (application) { try { await application.close(); receipt.cleanup.push({ owner: "owned Electron application", pid: receipt.ownedElectronPid, closed: true }); } catch (error) { receipt.ok = false; receipt.cleanup.push({ owner: "owned Electron application", closed: false, error: String(error) }); } }
  if (server) await new Promise(resolve => server.close(resolve));
  receipt.cleanup.push({ owner: "private HTTP server", started: !!server, closed: true });
  persist(); console.log(JSON.stringify({ root, ok: receipt.ok, preparedOnly: receipt.preparedOnly, failure: receipt.failure, cleanup: receipt.cleanup }));
  if (!receipt.ok) process.exitCode = 1;
}
