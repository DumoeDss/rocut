const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createServer } = require("node:http");
const { privateWholegraphOutputRoot } = require("./electron-wholegraph-png-output-root.cjs");
const { executeIsolatedHostTarget } = require("./electron-wholegraph-png-host-target.cjs");
const { decode, compare } = require("./electron-wholegraph-png-host-oracle.cjs");
const { verifyCapabilityPayload, limitedImports } = require("./electron-wholegraph-png-host-capability.cjs");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const pin = p => { const bytes = fs.readFileSync(p); return { path: p, bytes: bytes.length, sha256: hash(bytes) }; };

/** Read-only CPU preflight. Reuses an explicit already-built ORIGINAL bundle. */
function verifyPayload({ preparedRoot, pkg, preparedReceiptSha256 }) {
  privateWholegraphOutputRoot(preparedRoot);
  assert(/^[a-f0-9]{64}$/.test(preparedReceiptSha256), "Explicit prepared receipt pin required");
  const receiptPath = path.join(preparedRoot, "receipt.json"), receiptPin = pin(receiptPath);
  assert.equal(receiptPin.sha256, preparedReceiptSha256);
  const prepared = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(receiptPath)));
  assert.equal(prepared.preparedOnly, true, "CPU-prepared original fixture receipt required");
  assert.equal(prepared.ok, true);
  assert.equal(pin(prepared.bundle.path).sha256, prepared.bundle.sha256);
  for (const p of prepared.sourcePins) assert.equal(pin(p.path).sha256, p.sha256, "Prepared original source drift: " + p.path);
  assert(path.isAbsolute(pkg));
  const pkgPins = ["opencut_wasm_bg.wasm", "opencut_wasm_bg.js", "opencut_wasm.d.ts"].map(n => pin(path.join(pkg, n)));
  for (let i = 0; i < pkgPins.length; i++) assert.equal(pkgPins[i].sha256, prepared.pkg[i].sha256);
  assert.equal(pkgPins[0].sha256, "1b6671bdecfe6d6ad488a4bdf4583dc4d06a81229e2ce0aeffd274660c27a9f2");
  const browser = prepared.fixturePins.find(p => path.basename(p.path) === "electron-wholegraph-png-browser.ts");
  assert(browser); assert.equal(pin(browser.path).sha256, browser.sha256, "Original browser fixture drift");
  return { receiptPin, pkgPins, bundlePin: prepared.bundle, sourcePins: prepared.sourcePins, gates: prepared.gates,
    bundle: fs.readFileSync(prepared.bundle.path), core: fs.readFileSync(pkgPins[0].path), glue: fs.readFileSync(pkgPins[1].path) };
}

/** Invoke only inside the already-running verified Host MAIN inspector context. */
async function runHostWholegraph({ electron, root: requestedRoot, preparedRoot, pkg, preparedReceiptSha256, expectedHostPid, gpuLeaseConfirmed }) {
  assert.equal(gpuLeaseConfirmed, true, "Explicit Root GPU/UI lock required; never infer from idle Host");
  assert.equal(process.pid, expectedHostPid, "Explicit current Host main PID required");
  assert.equal(process.versions.electron, "40.1.0", "Existing real Host Electron40.1.0 main required");
  const executable = pin(process.execPath);
  assert.equal(executable.sha256, "0ace564d2033e3576aee5933c3bc3d927dc443fa7c43e58c36931ba8146ce1bc");
  assert(electron?.BrowserWindow && electron?.session, "Caller supplies built-in Electron APIs; adapter never requires npm electron");
  const root = privateWholegraphOutputRoot(requestedRoot); assert(!fs.existsSync(root), "Never overwrite an attempt");
  const payload = verifyPayload({ preparedRoot, pkg, preparedReceiptSha256 });
  const backendPolicy = verifyCapabilityPayload(payload.core, payload.glue);
  fs.mkdirSync(root);
  const report = { ok: false, scope: "Original selected wholegraph PNG in one isolated real Host Chromium target; not existing editor state", hostPid: process.pid,
    executable, preparedReceipt: payload.receiptPin, bundle: payload.bundlePin, pkg: payload.pkgPins, sourcePins: payload.sourcePins,
    fixturePins: [__filename, path.join(__dirname, "electron-wholegraph-png-host-target.cjs"), path.join(__dirname, "electron-wholegraph-png-host-oracle.cjs"), path.join(__dirname, "electron-wholegraph-png-host-capability.cjs")].map(pin),
    backendPolicy,
    gates: payload.gates, artifacts: {}, cleanup: {} };
  const persist = () => fs.writeFileSync(path.join(root, "receipt.json"), JSON.stringify(report, null, 2) + "\n");
  const html = '<!doctype html><script type="importmap">{"imports":{"opencut-wasm":"/glue.js"}}</script><script type="module">import * as w from "/glue.js";const m=await WebAssembly.compile(await(await fetch("/core.wasm")).arrayBuffer());globalThis.fixtureBackendPolicy=' + JSON.stringify({ ...backendPolicy, getterCalls: 0 }) + ';const table=(' + limitedImports.toString() + ')(WebAssembly.Module.imports(m),w,globalThis.fixtureBackendPolicy);const i=await WebAssembly.instantiate(m,table);w.__wbg_set_wasm(i.exports);i.exports.__wbindgen_start();globalThis.run=(await import("/browser.js")).runElectronWholegraph;</script>';
  const server = createServer((request, response) => {
    const u = new URL(request.url, "http://localhost"), p = u.pathname;
    if (p === "/artifact" && request.method === "POST") {
      const name = u.searchParams.get("name");
      if (!["transparent-graph", "recovered-graph", "snapshot"].includes(name)) return response.writeHead(400).end();
      const chunks = []; let size = 0;
      request.on("data", b => { size += b.length; if (size > 1024 * 1024) request.destroy(); else chunks.push(b); });
      request.on("end", () => {
        try { const output = path.join(root, name + ".png"); fs.writeFileSync(output, Buffer.concat(chunks), { flag: "wx" }); report.artifacts[name] = pin(output); response.end("retained"); }
        catch { response.writeHead(409).end(); }
      }); return;
    }
    const bytes = p === "/" ? Buffer.from(html) : p === "/glue.js" ? payload.glue : p === "/core.wasm" ? payload.core : p === "/browser.js" ? payload.bundle : null;
    if (!bytes) return response.writeHead(404).end();
    response.writeHead(200, { "content-type": p === "/" ? "text/html" : p.endsWith(".wasm") ? "application/wasm" : "text/javascript", "cache-control": "no-store" }).end(bytes);
  });
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const url = "http://127.0.0.1:" + server.address().port + "/";
    report.isolated = await executeIsolatedHostTarget({ electron, url, gpuLeaseConfirmed });
    assert.equal(report.isolated.ok, true, report.isolated.failure ?? "Isolated target controls/cleanup failed");
    const graph = decode(fs.readFileSync(report.artifacts["transparent-graph"].path));
    const recovered = decode(fs.readFileSync(report.artifacts["recovered-graph"].path));
    const snapshot = decode(fs.readFileSync(report.artifacts.snapshot.path));
    report.graphOracle = compare(graph, payload.gates.transparentGraphLeft, payload.gates.transparentGraphRight);
    report.snapshotOracle = compare(snapshot, payload.gates.snapshotLeft, payload.gates.snapshotRight);
    report.sameHandleRecoveryExact = graph.equals(recovered);
    assert.equal(report.graphOracle.accepted, true); assert.equal(report.snapshotOracle.accepted, true); assert.equal(report.sameHandleRecoveryExact, true);
    // Source pin parity includes the unchanged original browser fixture, not just its outputs.
    for (const p of [...payload.pkgPins, ...payload.sourcePins, payload.bundlePin, executable]) assert.equal(pin(p.path).sha256, p.sha256);
    report.ok = true;
  } catch (error) { report.failure = String(error?.stack ?? error).replace(/https?:\/\/\S+/g, "[URL]"); }
  finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    report.cleanup.privateHttpServerClosed = true; report.cleanup.hostProcessLeftRunning = true;
    persist();
  }
  return { ok: report.ok, root, receiptPath: path.join(root, "receipt.json"), receiptSha256: pin(path.join(root, "receipt.json")).sha256, failure: report.failure, cleanup: report.cleanup };
}
module.exports = { verifyPayload, runHostWholegraph };
