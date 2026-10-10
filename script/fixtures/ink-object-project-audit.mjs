import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	pngPixels,
	pixelComparison,
	visibility,
} from "./liquid-object-capture-probe-pixels.mjs";
const root = "C:/tmps/ink-object-project-UxDlvp";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const original = await readFile(join(root, "evidence.json"));
const evidence = JSON.parse(original),
	frame = evidence.frame;
assert.equal(evidence.ok, false);
assert.equal(
	evidence.failure.message,
	"All four owned browser processes must close",
);
assert(
	frame.ok &&
		frame.hostClosed &&
		frame.projectGraphRevisionAttachmentsUnchanged,
);
assert.equal(evidence.processes.length, 5);
assert.equal(evidence.processes.filter((x) => x.profile).length, 4);
assert(evidence.processes.every((x) => x.closed));
assert.equal(evidence.sockets.length, 4);
assert(evidence.sockets.every((x) => x.closed));
assert.equal(evidence.consoleErrors.length, 0);
assert.equal(evidence.exceptions.length, 0);
for (const item of evidence.processes.filter((x) => x.profile))
	await assert.rejects(access(item.profile), { code: "ENOENT" });
const captures = [];
for (const item of [...frame.frames, frame.derivedRequest.capture]) {
	const png = await readFile(item.path);
	assert.equal(sha(png), item.sha256);
	assert.equal(png.length, item.bytes);
	const image = pngPixels(png);
	assert.equal(image.width, 192);
	assert.equal(image.height, 128);
	assert(visibility(image).changedPixels > 200);
	captures.push(png);
}
assert(captures.every((x) => x.equals(captures[0])));
const beforeReceipt = await readFile(evidence.originalReceipt.path);
assert.equal(sha(beforeReceipt), evidence.originalReceipt.sha256);
assert.equal(
	sha(await readFile(join(evidence.original, "project/project.json"))),
	frame.projectSha256,
);
for (const item of frame.resources.archiveVerified)
	assert.equal(sha(await readFile(item.path)), item.sha256);
assert(
	evidence.wasmPackageUnchanged &&
		evidence.toolchainUnchanged &&
		evidence.finalInputValidation.ok,
);
for (const item of evidence.inputs.files)
	assert.equal(sha(await readFile(item.path)), item.sha256);
const audit = {
	ok: true,
	root,
	originalFailureRetained: {
		path: join(root, "evidence.json"),
		sha256: sha(original),
		reason: "Harness miscount included esbuild among four Chromium captures",
	},
	frameReceipt: {
		path: join(root, "frame-evidence.json"),
		sha256: sha(await readFile(join(root, "frame-evidence.json"))),
	},
	actualBrowsers: 4,
	otherOwnedChildren: 1,
	allChildrenClosed: true,
	allSocketsClosed: true,
	allProfilesRemoved: true,
	hostClosed: true,
	originalProjectAndAttachmentsUnchanged: true,
	originalStaticThreeFramesExact: true,
	reverseSeekExact: true,
	derivedRequest: {
		status: 200,
		pixelComparison: pixelComparison({
			a: pngPixels(captures[1]),
			b: pngPixels(captures[3]),
		}),
		explanation:
			"build.inputProps is metadata; archived compiled HTML bakes original zero rotationSpeed. No original or derived motion claimed.",
	},
	checksReadOnly: true,
	gpuRerun: false,
	exportExecuted: false,
	limitations: [
		"Original driver observer was not separately snapshotted; actual bundled Host input closure and dynamic WASM/toolchain pinned",
		"Visible object with embedded map/normal and HDR loaded by production archive path; no isolated map/normal/HDR pixel attribution matrix",
	],
};
await writeFile(
	join(root, "audit-evidence.json"),
	JSON.stringify(audit, null, 2),
	{ flag: "wx" },
);
console.log(
	JSON.stringify({
		ok: true,
		root,
		receiptSha256: sha(await readFile(join(root, "audit-evidence.json"))),
	}),
);
