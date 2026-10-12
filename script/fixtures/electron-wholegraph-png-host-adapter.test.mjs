import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { executeIsolatedHostTarget } from "./electron-wholegraph-png-host-target.cjs";
import { runHostWholegraph } from "./electron-wholegraph-png-host-adapter.cjs";
import { crc32, decode, compare } from "./electron-wholegraph-png-host-oracle.cjs";
import { verifyCapabilityPayload, limitedImports } from "./electron-wholegraph-png-host-capability.cjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
test("capability policy pins actual ABI and changes exactly one new-instance import", () => {
  const core = fs.readFileSync(path.join(directory, "../../rust/wasm/pkg/opencut_wasm_bg.wasm"));
  const glueBytes = fs.readFileSync(path.join(directory, "../../rust/wasm/pkg/opencut_wasm_bg.js"));
  const verified = verifyCapabilityPayload(core, glueBytes);
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(core));
  const glue = Object.fromEntries(imports.map(x => [x.name, function (arg0) { return arg0; }]));
  const original = glue[verified.getter], policy = { ...verified, getterCalls: 0 };
  const table = limitedImports(imports, glue, policy);
  for (const item of imports) if (item.name !== verified.getter) assert.equal(table[item.module][item.name], glue[item.name]);
  const navigator = Object.freeze({ gpu: { real: true } });
  assert.equal(table[verified.module][verified.getter](navigator), undefined);
  assert.equal(policy.getterCalls, 1); assert.equal(glue[verified.getter], original); assert.equal(navigator.gpu.real, true);
  for (const bad of [[], [...imports, imports.find(x => x.name === verified.getter)], imports.map(x => x.name === verified.getter ? { ...x, name: "__wbg_gpu_wrong" } : x), imports.map(x => x.name === verified.getter ? { ...x, kind: "global" } : x)]) assert.throws(() => limitedImports(bad, glue, policy));
  assert.throws(() => limitedImports(imports, { ...glue, [verified.getter]: () => undefined }, policy));
  const corruptCore = Buffer.from(core); corruptCore[20] ^= 1;
  assert.throws(() => verifyCapabilityPayload(corruptCore, glueBytes), /core ABI pin/);
  assert.throws(() => verifyCapabilityPayload(core, Buffer.concat([glueBytes, Buffer.from(" ")])), /glue ABI pin/);
});
test("host adapter oracle functions are verbatim original selected runner functions", () => {
  const old = fs.readFileSync(path.join(directory, "electron-wholegraph-png-run.mjs"), "utf8").replaceAll("\r\n", "\n");
  const adapted = fs.readFileSync(path.join(directory, "electron-wholegraph-png-host-oracle.cjs"), "utf8").replaceAll("\r\n", "\n");
  assert.equal(adapted.slice(adapted.indexOf("function crc32"), adapted.indexOf("\nmodule.exports")).trim(), old.slice(old.indexOf("function crc32"), old.indexOf("\ntry {", old.indexOf("function crc32"))).trim());
});

function chunk(name, data) {
  const kind = Buffer.from(name), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([kind, data])));
  return Buffer.concat([length, kind, data, crc]);
}
function makePng({ width = 32, filter = 0, left = [0,0,255,64], right = [204,0,51,159] } = {}) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(24, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = Buffer.alloc(24 * (width * 4 + 1));
  for (let y = 0; y < 24; y++) { rows[y * (width * 4 + 1)] = filter; for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) rows[y * (width * 4 + 1) + 1 + x * 4 + c] = (x < 16 ? left : right)[c]; }
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("sRGB", Buffer.from([0])), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
test("unchanged transparent/low-alpha oracle rejects dimension filter CRC and over-budget deltas", () => {
  const rgba = decode(makePng());
  assert.deepEqual(compare(rgba, [0,0,255,64], [204,0,51,159]), { maximum: 0, mean: 0, gateMaximum: 1, gateMean: .35, accepted: true });
  assert.equal(compare(rgba, [0,0,255,64], [202,0,51,159]).accepted, false);
  assert.equal(compare(rgba, [0,0,255,255], [204,0,51,255]).accepted, false);
  assert.throws(() => decode(makePng({ width: 31 })));
  assert.throws(() => decode(makePng({ filter: 1 })));
  const corrupt = makePng(); corrupt[30] ^= 1; assert.throws(() => decode(corrupt));
});

function fakeElectron({ failExecution = false, hold = false } = {}) {
  const existing = { id: 1, isDestroyed: () => false };
  const windows = [existing], sessions = [], requests = [], invocations = [];
  const defaultSession = { sentinel: "existing Host untouched" };
  let createdOptions, rejectHeld;
  const electron = {
    session: { defaultSession, fromPartition(partition, options) {
      const own = { partition, options, getStoragePath: () => null,
        webRequest: { onBeforeRequest: cb => requests.push(cb) },
        async closeAllConnections() { invocations.push("connections"); },
        async clearStorageData() { invocations.push("storage"); }, async clearCache() { invocations.push("cache"); },
      }; sessions.push(own); return own;
    } },
    BrowserWindow: class {
      static getAllWindows() { return [...windows]; }
      constructor(options) {
        createdOptions = options; this.id = 2; this.destroyed = false; windows.push(this);
        this.webContents = { id: 22, session: options.webPreferences.session,
          getLastWebPreferences: () => options.webPreferences,
          setWindowOpenHandler: fn => { assert.deepEqual(fn(), { action: "deny" }); }, on() {},
          async executeJavaScript(source) {
            invocations.push("execute"); assert(source.includes("globalThis.run()")); assert(source.includes("Fixture sandbox boundary failed"));
            if (failExecution) throw Error("controlled fixture failure");
            if (hold) return new Promise((_, reject) => { rejectHeld = reject; });
            return { fixtureResult: { backend: "webgl", controls: { nativeCancelDrained: true, actualCanvasRendererWholegraph: true, noDisplayCanvasFallback: true, handleReleasedOnce: true }, cleanup: { gpuDisposed: true } }, backendPolicy: { semantics: "fallback-capability-limited", getterCalls: 1 } };
          },
        };
      }
      async loadURL(url) { invocations.push("load:" + url); }
      isVisible() { return false; }
      isDestroyed() { return this.destroyed; }
      destroy() { this.destroyed = true; windows.splice(windows.indexOf(this), 1); rejectHeld?.(Error("owned renderer destroyed")); invocations.push("destroy"); }
    },
  };
  return { electron, windows, sessions, requests, invocations, defaultSession, get options() { return createdOptions; } };
}
test("no GPU/UI lock refuses before creating any window or session", async () => {
  const fake = fakeElectron();
  await assert.rejects(executeIsolatedHostTarget({ electron: fake.electron, url: "http://127.0.0.1:1/", gpuLeaseConfirmed: false }), /lock/);
  assert.equal(fake.windows.length, 1); assert.equal(fake.sessions.length, 0);
  await assert.rejects(runHostWholegraph({ gpuLeaseConfirmed: false }), /lock/);
});
test("independent memory partition, hidden sandbox, no preload, exact original execution and own cleanup", async () => {
  const fake = fakeElectron();
  const result = await executeIsolatedHostTarget({ electron: fake.electron, url: "http://127.0.0.1:1/", gpuLeaseConfirmed: true });
  assert.equal(result.ok, true); assert.equal(fake.options.show, false);
  assert.equal(fake.options.webPreferences.sandbox, true); assert.equal(fake.options.webPreferences.contextIsolation, true);
  assert.equal(fake.options.webPreferences.nodeIntegration, false); assert.equal(fake.options.webPreferences.preload, undefined);
  assert.equal(fake.options.webPreferences.disableBlinkFeatures, undefined);
  assert.equal(result.backendPolicy.semantics, "fallback-capability-limited");
  assert(fake.sessions[0].partition.startsWith("rocut-wholegraph-selected-")); assert(!fake.sessions[0].partition.startsWith("persist:"));
  assert.equal(fake.sessions[0].options.cache, false); assert.equal(fake.windows.length, 1); assert.equal(fake.defaultSession.sentinel, "existing Host untouched");
  const request = fake.requests[0]; let verdict;
  request({ url: "http://127.0.0.1:1/core.wasm" }, value => { verdict = value; }); assert.equal(verdict.cancel, false);
  request({ url: "https://outside.invalid/private?token=do-not-record" }, value => { verdict = value; }); assert.equal(verdict.cancel, true);
  request({ url: "file:///C:/private" }, value => { verdict = value; }); assert.equal(verdict.cancel, true);
  assert.equal(JSON.stringify(result.externalRequests).includes("token"), false);
  assert.equal(fake.requests.at(-1), null);
  assert.equal(result.cleanup.originalWindowsUnchanged, true); assert.equal(result.cleanup.ownedWindowAbsent, true);
  assert.deepEqual(fake.invocations.slice(-4), ["destroy", "connections", "storage", "cache"]);
});
test("render failure and deadline destroy only owned target and drain its rejected execution", async () => {
  for (const options of [{ failExecution: true }, { hold: true }]) {
    const fake = fakeElectron(options);
    const result = await executeIsolatedHostTarget({ electron: fake.electron, url: "http://127.0.0.1:1/", gpuLeaseConfirmed: true, timeoutMs: 10 });
    assert.equal(result.ok, false); assert(result.failure);
    assert.equal(result.cleanup.ownedWindowDestroyed, true); assert.equal(result.cleanup.executionDrained, true);
    assert.equal(result.cleanup.originalWindowsUnchanged, true); assert.equal(result.cleanup.privateSessionCleared, true);
    assert.equal(fake.windows.length, 1);
  }
});
