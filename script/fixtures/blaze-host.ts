import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunningHost } from "../../apps/cli/src/host";
import { blazeHostClips, blazeHostInvalidCases } from "./blaze-host-cases";
import {
	assertBlazeHostAuthored,
	assertBlazeHostCatalog,
	blazeHostClient,
} from "./blaze-host-checks";
import {
	blazeHostAnimated,
	blazeHostSentinel,
	blazeHostSettings,
	type BlazeHostResource,
} from "./blaze-host-contract";
import {
	assertBlazeHostAbsentChild,
	assertBlazeHostRealPath,
	assertBlazeHostSnapshot,
} from "./blaze-host-paths.mjs";
import {
	blazeHostDigest,
	blazeHostImage,
	loadBlazeHostAuthor,
} from "./blaze-host-source";

const [root, creatorModule, manifestSha256, wasmSha256] = process.argv.slice(2);
const snapshotRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
await assertBlazeHostRealPath(root);
assert.deepEqual(
	await readdir(root),
	[],
	"Host fixture root must be newly created and empty",
);
const provenance = await assertBlazeHostSnapshot({
	snapshot: snapshotRoot,
	manifestSha256,
	wasmUrl: import.meta.resolve("opencut-wasm"),
	wasmSha256,
});
const authorHelper = await loadBlazeHostAuthor(creatorModule);
// Only a verified private snapshot may load Host and its Rust/WASM dependencies.
const { startHost } = await import("../../apps/cli/src/host");
const { TargetRegistry } = await import("../../apps/cli/src/target-registry");
const options = {
	projectRoot: join(root, "project"),
	registry: new TargetRegistry(join(root, "registry")),
	port: 0,
	htmlBrowserExecutable: "",
	htmlFrameConnectionFile: "",
};
let host: RunningHost | undefined;
const client = blazeHostClient({
	editorUrl: () => {
		assert(host, "Private Host is not running");
		return host.editorUrl;
	},
	projectRoot: options.projectRoot,
});
const evidence = {
	ok: false,
	provenance,
	creator: authorHelper.files,
	transport:
		"Real Host HTTP catalog/resource-import/apply and FileProjectStore project.json",
	renderingTested: false,
	disabledPixelsTested: false,
	uiTested: false,
	gpuTested: false,
	sourceSeed: blazeHostSettings.seed,
	animationChannels: Object.keys(blazeHostAnimated),
	authorUnavailable: false,
	resourceChecks: 0,
	positiveControlAccepted: false,
	ports: [] as number[],
	reopens: [] as { label: string; revision: number; projectSha256: string }[],
	rejected: [] as Awaited<ReturnType<typeof client.reject>>[],
	hostClosed: false,
	error: undefined as string | undefined,
};
const writeJson = (name: string, value: unknown) =>
	writeFile(join(root, name), `${JSON.stringify(value, null, 2)}\n`, {
		encoding: "utf8",
		flag: "wx",
	});
const open = async () => {
	host = await startHost(options);
	assert(host.port > 0);
	evidence.ports.push(host.port);
};
const close = async () => {
	if (host) {
		await host.close();
		host = undefined;
	}
};
try {
	await open();
	const catalog =
		await client.request<Parameters<typeof assertBlazeHostCatalog>[0]>(
			"editing/catalog",
		);
	await writeJson("catalog.json", assertBlazeHostCatalog(catalog));
	const context = await client.context();
	assert.equal(context.revision, 0);
	const author = join(root, "author"),
		filePath = join(author, "blaze.png");
	await assertBlazeHostAbsentChild(author, root);
	await mkdir(author);
	const png = blazeHostImage();
	await writeFile(filePath, png, { flag: "wx" });
	const { resource } = await client.request<{ resource: BlazeHostResource }>(
		"programmatic/resources/import",
		{
			id: "blaze.png",
			filePath,
			kind: "image",
			mimeType: "image/png",
		},
	);
	assert.equal(resource.sha256, blazeHostDigest(png));
	assert.equal(resource.byteLength, png.length);
	assert.equal((await client.context()).revision, 0);
	const staticShot = authorHelper.author(resource, false),
		animatedShot = authorHelper.author(resource, true);
	const clips = blazeHostClips({ staticShot, animatedShot });
	await writeJson("creator-output.json", {
		staticShot,
		animatedShot,
		resource,
	});
	await client.accept([
		{
			kind: "update-project",
			projectId: context.project.id,
			patch: {
				name: "Blaze private Host persistence acceptance",
				canvasWidth: blazeHostSettings.width,
				canvasHeight: blazeHostSettings.height,
				frameRate: blazeHostSettings.frameRate,
			},
		},
		...[
			["blaze-shots", false],
			["blaze-sentinel", true],
		].map(([id, hidden]) => ({
			kind: "create-track",
			track: { id, hidden, name: id, kind: "graphic" },
		})),
		...clips.map((clip) => ({ kind: "create-clip", clip })),
	]);
	assertBlazeHostAuthored({ snapshot: await client.snapshot(), clips });
	const verifyResource = async () => {
		const response = await client.raw("programmatic/resources/load", resource);
		assert.equal(response.status, 200);
		assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
		evidence.resourceChecks++;
	};
	const reopen = async (label: string) => {
		const before = await client.snapshot(),
			bytes = await client.disk();
		assert.equal(JSON.parse(bytes.toString("utf8")).wrapperVersion, 1);
		await close();
		await open();
		assert.deepEqual(
			await client.snapshot(),
			before,
			`${label}: reopened state changed`,
		);
		assert.deepEqual(
			await client.disk(),
			bytes,
			`${label}: reopened bytes changed`,
		);
		assertBlazeHostAuthored({ snapshot: before, clips });
		await verifyResource();
		evidence.reopens.push({
			label,
			revision: before.revision,
			projectSha256: blazeHostDigest(bytes),
		});
	};
	await verifyResource();
	const unavailable = join(root, "unavailable-author");
	await assertBlazeHostRealPath(author);
	await assertBlazeHostAbsentChild(unavailable, root);
	await rename(author, unavailable);
	await assert.rejects(readFile(filePath), { code: "ENOENT" });
	evidence.authorUnavailable = true;
	await reopen("static-animated-disabled-with-author-moved");
	const sentinel = clips.find((clip) => clip.id === blazeHostSentinel)!;
	await client.accept([
		{
			kind: "update-clip",
			clipId: sentinel.id,
			patch: {
				editing: {
					...sentinel.editing,
					name: "Valid atomic-batch positive control",
				},
			},
		},
	]);
	assert.equal(
		(await client.snapshot()).clips.find((clip) => clip.id === sentinel.id)!
			.editing.name,
		"Valid atomic-batch positive control",
	);
	await client.accept([
		{
			kind: "update-clip",
			clipId: sentinel.id,
			patch: { editing: sentinel.editing },
		},
	]);
	evidence.positiveControlAccepted = true;
	const beforeInvalid = await client.snapshot();
	await writeJson("before-invalid.json", beforeInvalid);
	for (const invalid of blazeHostInvalidCases(clips))
		evidence.rejected.push(await client.reject(invalid));
	assert.deepEqual(await client.snapshot(), beforeInvalid);
	await reopen("after-all-atomic-rejections");
	await writeJson("reopened.json", await client.snapshot());
	for (const file of authorHelper.files)
		assert.equal(blazeHostDigest(await readFile(file.path)), file.sha256);
	evidence.ok = true;
} catch (error) {
	evidence.error = error instanceof Error ? error.message : String(error);
	throw error;
} finally {
	try {
		await close();
		evidence.hostClosed = true;
	} finally {
		await writeJson("evidence.json", evidence);
		console.log(
			JSON.stringify({
				blazeHostArtifacts: root,
				ok: evidence.ok,
				hostClosed: evidence.hostClosed,
				reopens: evidence.reopens.length,
				rejected: evidence.rejected.length,
			}),
		);
	}
}
