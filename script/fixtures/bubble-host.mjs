import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bubbleHostClips, bubbleHostInvalidCases } from "./bubble-host-cases.mjs";
import { assertBubbleHostAuthored, assertBubbleHostCatalog, bubbleHostClient } from "./bubble-host-checks.mjs";
import { bubbleHostAnimated, bubbleHostSentinel, bubbleHostSettings } from "./bubble-host-contract.mjs";
import { assertBubbleHostAbsentChild, assertBubbleHostHarness, assertBubbleHostRealPath,
	assertBubbleHostSource } from "./bubble-host-paths.mjs";
import { bubbleHostDigest, bubbleHostImage, loadBubbleHostAuthor } from "./bubble-host-source.mjs";

const [root, snapshot, creatorModule, manifestSha256, wasmSha256] = process.argv.slice(2);
assert.equal(process.argv.length, 7);
const harness = resolve(fileURLToPath(new URL("../../", import.meta.url)));
await assertBubbleHostHarness(harness);
await assertBubbleHostRealPath(root);
assert.deepEqual(await readdir(root), [], "Host fixture must be newly created and empty");
const provenance = await assertBubbleHostSource({ snapshot, manifestSha256, wasmSha256 });
await assertBubbleHostRealPath(creatorModule);
const helper = await loadBubbleHostAuthor(creatorModule);
// Frozen source and package guards run before loading real Host dependencies.
const { startHost } = await import(pathToFileURL(join(snapshot, "apps/cli/src/host.ts")).href);
const { TargetRegistry } = await import(pathToFileURL(join(snapshot, "apps/cli/src/target-registry.ts")).href);
const options = { projectRoot: join(root, "project"), registry: new TargetRegistry(join(root, "registry")),
	port: 0, htmlBrowserExecutable: "", htmlFrameConnectionFile: "" };
let host;
const client = bubbleHostClient({ editorUrl: () => { assert(host); return host.editorUrl; }, projectRoot: options.projectRoot });
const evidence = { ok: false, provenance, creator: helper.files, hostClosed: false,
	transport: "Real HeadlessHost HTTP and FileProjectStore; actual Creator bubbleImage source, effects and animations",
	renderingTested: false, gpuTested: false, uiTested: false, codecTested: false,
	animationChannels: Object.keys(bubbleHostAnimated), positiveControlAccepted: false,
	resourceChecks: 0, authorUnavailable: false, ports: [], reopens: [], rejected: [], error: undefined };
const writeJson = (name, data) => writeFile(join(root, name), JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
const open = async () => { host = await startHost(options); assert(host.port > 0); evidence.ports.push(host.port); };
const close = async () => { if (host) { await host.close(); host = undefined; } };
try {
	await open();
	await writeJson("catalog.json", assertBubbleHostCatalog(await client.request("editing/catalog")));
	const context = await client.context(); assert.equal(context.revision, 0);
	const author = join(root, "author"), filePath = join(author, "bubble.png");
	await assertBubbleHostAbsentChild(author, root); await mkdir(author);
	const png = bubbleHostImage(); await writeFile(filePath, png, { flag: "wx" });
	const { resource } = await client.request("programmatic/resources/import", {
		id: "bubble.png", filePath, kind: "image", mimeType: "image/png" });
	assert.equal(resource.sha256, bubbleHostDigest(png)); assert.equal(resource.byteLength, png.length);
	assert.equal((await client.context()).revision, 0);
	const authored = { staticShot: helper.author(resource, "static"), animatedShot: helper.author(resource, "animated"),
		sixteenShot: helper.author(resource, "sixteen") };
	const clips = bubbleHostClips(authored), sentinel = clips.find((clip) => clip.id === bubbleHostSentinel);
	await writeJson("creator-output.json", { ...authored, resource });
	await client.accept([{ kind: "update-project", projectId: context.project.id, patch: {
		name: "Bubble private Host persistence acceptance", canvasWidth: bubbleHostSettings.width,
		canvasHeight: bubbleHostSettings.height, frameRate: bubbleHostSettings.frameRate } },
	...[["bubble-shots", false], ["bubble-sentinel", true]].map(([id, hidden]) =>
		({ kind: "create-track", track: { id, hidden, name: id, kind: "graphic" } })),
	...clips.map((clip) => ({ kind: "create-clip", clip }))]);
	assertBubbleHostAuthored({ snapshot: await client.snapshot(), clips });
	const verifyResource = async () => {
		const response = await client.raw("programmatic/resources/load", resource);
		assert.equal(response.status, 200); assert.deepEqual(response.bytes, png); evidence.resourceChecks++;
	};
	const reopen = async (label) => {
		const before = await client.snapshot(), bytes = await client.disk();
		assert.equal(JSON.parse(bytes.toString("utf8")).wrapperVersion, 1);
		await close(); await open();
		assert.deepEqual(await client.snapshot(), before, `${label}: reopened state changed`);
		assert.deepEqual(await client.disk(), bytes, `${label}: reopened project bytes changed`);
		assertBubbleHostAuthored({ snapshot: before, clips });
		await verifyResource();
		evidence.reopens.push({ label, revision: before.revision, projectSha256: bubbleHostDigest(bytes) });
	};
	await verifyResource();
	const unavailable = join(root, "unavailable-author");
	await assertBubbleHostRealPath(author); await assertBubbleHostAbsentChild(unavailable, root);
	await rename(author, unavailable); await assert.rejects(readFile(filePath), { code: "ENOENT" });
	evidence.authorUnavailable = true;
	await reopen("static-animated-disabled-sixteen-author-moved");
	// Positive control changes the target only; the sentinel is never accepted as a mutation.
	const target = clips[0];
	await client.accept([{ kind: "update-clip", clipId: target.id,
		patch: { editing: { ...target.editing, name: "Valid Host mutation control" } } }]);
	let current = await client.snapshot();
	assert.equal(current.clips.find((clip) => clip.id === target.id).editing.name, "Valid Host mutation control");
	assert.deepEqual(current.clips.find((clip) => clip.id === sentinel.id).editing, sentinel.editing);
	await client.accept([{ kind: "update-clip", clipId: target.id, patch: { editing: target.editing } }]);
	evidence.positiveControlAccepted = true;
	const beforeInvalid = await client.snapshot(); await writeJson("before-invalid.json", beforeInvalid);
	const invalidCases = bubbleHostInvalidCases(clips); assert.equal(invalidCases.length, 192);
	for (const invalid of invalidCases) evidence.rejected.push(await client.reject(invalid));
	assert.deepEqual(await client.snapshot(), beforeInvalid);
	await reopen("after-all-atomic-rejections");
	await writeJson("reopened.json", await client.snapshot());
	for (const file of helper.files) assert.equal(bubbleHostDigest(await readFile(file.path)), file.sha256);
	evidence.ok = true;
} catch (error) {
	evidence.error = error instanceof Error ? error.message : String(error); throw error;
} finally {
	try { await close(); evidence.hostClosed = true; }
	finally {
		evidence.httpRequests = client.requestLog;
		await writeJson("evidence.json", evidence);
		console.log(JSON.stringify({ bubbleHostArtifacts: root, ok: evidence.ok,
			hostClosed: evidence.hostClosed, reopens: evidence.reopens.length, rejected: evidence.rejected.length }));
	}
}
