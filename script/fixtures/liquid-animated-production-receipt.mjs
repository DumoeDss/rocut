// Read-only verification of the three saved captures. No browser/worker replay.
// Preserve the original failed diagnostic receipt rather than hiding its history.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { pngPixels, pixelComparison, visibility } from "./liquid-object-capture-probe-pixels.mjs";

const root = resolve(process.argv[2] ?? "");
assert.equal(dirname(root).toLowerCase(), resolve("C:/tmps").toLowerCase());
assert.ok(basename(root).startsWith("rocut-liquid-animated-production-"));
const raw = await readFile(join(root, "receipt.json"));
const original = JSON.parse(raw), capture = JSON.parse(await readFile(join(root, "capture-evidence.json"), "utf8"));
assert.equal(capture.ok, true); assert.equal(capture.hostClosed, true); assert.equal(capture.captures.length, 3);
assert.equal(original.inputPinsUnchanged, true); assert.equal(original.allObservedOwnedProcessesClosed, true);
assert.equal(original.consoleErrors.length, 0); assert.equal(original.exceptionEvents.length, 0);
assert.equal(original.gpuInfo.length, 3);
assert.equal(original.processes.filter(item => item.kind === "private-chromium").length, 3);
assert.equal(original.processes.filter(item => item.kind === "native-worker").length, 4);
assert.ok(original.processes.every(item => item.closed));
// This original observer hashed all binding payloads, including open/close.
// Their canonical protocol has one open/evaluate/close per completed frame.
assert.equal(original.phaseRequests.length, 9);
assert.match(original.failure.message, /9 !== 3/);
const images = [];
for (const item of capture.captures) {
  assert.equal(dirname(resolve(item.path)), root);
  const bytes = await readFile(item.path);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256);
  const image = pngPixels(bytes); assert.equal(image.width, 192); assert.equal(image.height, 128);
  assert(visibility(image).changedPixels > 100); images.push(image);
}
const poseChange = pixelComparison({ a: images[0], b: images[1] });
const repeatedSeek = pixelComparison({ a: images[0], b: images[2] });
assert(poseChange.changedPixels > 100); assert.deepEqual(images[0].pixels, images[2].pixels);
assert.deepEqual(poseChange, capture.poseChange); assert.deepEqual(repeatedSeek, capture.repeatedSeek);
const receipt = { ok: true, root, originalReceiptSha256: createHash("sha256").update(raw).digest("hex"),
  originalDiagnosticFailurePreserved: original.failure,
  correction: "Original observer counted all 9 open/evaluate/close bindings, not only 3 evaluation envelopes. Saved real production capture results and cleanup succeeded; corrected future observer classifies operations. No extra GPU captures performed.",
  poseChange, repeatedSeek, capture, gpuInfo: original.gpuInfo, processes: original.processes,
  inputPinsUnchanged: true, allObservedOwnedProcessesClosed: true,
  scope: "post-verification of actual previously captured PNGs and authoritative production cleanup/pins; not new rendering and no fabricated protocol payloads" };
await writeFile(join(root, "acceptance-receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
console.log(JSON.stringify({ root, ok: true, poseChange, repeatedSeek, noExtraGpu: true }));
