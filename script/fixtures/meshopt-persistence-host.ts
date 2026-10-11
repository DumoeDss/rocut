import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunningHost } from "../../apps/cli/src/host";

const [root, configPath] = process.argv.slice(2);
const sourceRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const config = JSON.parse(
	new TextDecoder("utf-8", { fatal: true }).decode(await readFile(configPath)),
);
const digest = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const { startHost } = await import("../../apps/cli/src/host");
const { TargetRegistry } = await import("../../apps/cli/src/target-registry");
const options = {
	projectRoot: join(root, "project"),
	staticDir: config.editorDist,
	port: 0,
	registry: new TargetRegistry(join(root, "registry")),
	engineToolchainDirectory: config.toolchainDirectory,
	htmlBrowserExecutable: "",
	htmlFrameConnectionFile: "",
};
let host: RunningHost | undefined;
const request = async (route: string, body?: unknown) => {
	assert(host);
	const response = await fetch(new URL("api/" + route, host.editorUrl), {
		signal: AbortSignal.timeout(60000),
		...(body === undefined
			? {}
			: {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				}),
	});
	const value = await response.json();
	assert.equal(response.status, 200, JSON.stringify(value));
	return value;
};
const save = (name: string, value: unknown) =>
	writeFile(
		join(root, name),
		Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + "\n",
		{ flag: "wx" },
	);
const close = async () => {
	if (host) {
		await host.close();
		host = undefined;
	}
};
const snapshot = async () => {
	const byId = (a: { id: string }, b: { id: string }) =>
		a.id.localeCompare(b.id);
	return {
		project: (await request("context")).project,
		clips: (await request("clips")).sort(byId),
		tracks: (await request("tracks")).sort(byId),
	};
};
const lifecycle = { hostClosed: false, reopened: false, error: undefined as string | undefined };
try {
	host = await startHost(options);
	// Import the real Meshopt GLB and environment fixtures through the Host API.
	const author = join(root, "author");
	await mkdir(author, { recursive: true });
	const spec = JSON.parse(await readFile(config.compileSpec, "utf8"));
	const resources = [];
	for (const item of spec.imports) {
		const { resource } = await request("programmatic/resources/import", {
			id: item.id,
			kind: item.kind,
			filePath: item.filePath,
			mimeType: item.mimeType,
		});
		resources.push(resource);
	}
	// Compile the real three scene (Meshopt decode happens at render time, but the
	// compiled document embeds the build identity we persist).
	const compiled = await request("programmatic/build/compile", {
		...spec.spec,
		resources,
	});
	const source = compiled.source;
	assert.equal(source.build?.engine, "three");
	const context = await request("context");
	const applied = await request("apply", {
		expectedRevision: context.revision,
		operations: [
			{
				kind: "update-project",
				projectId: context.project.id,
				patch: {
					name: "Meshopt persistence acceptance",
					canvasWidth: spec.spec.width,
					canvasHeight: spec.spec.height,
					frameRate: spec.spec.frameRate,
				},
			},
			{
				kind: "create-track",
				track: {
					id: "meshopt-shots",
					name: "Meshopt",
					kind: "graphic",
					hidden: false,
				},
			},
			{
				kind: "create-clip",
				clip: {
					id: "meshopt-static",
					trackId: "meshopt-shots",
					startTime: 0,
					duration: 120000,
					trimStart: 0,
					trimEnd: 0,
					editing: {
						type: "graphic",
						name: "Meshopt scene",
						definitionId: "programmatic",
						params: {},
						programmatic: source,
						effects: [],
						animations: {},
					},
				},
			},
		],
	});
	assert.equal(applied.accepted, true);
	const prepared = await snapshot();
	const bytes = await readFile(join(root, "project", "project.json"));
	await save("prepared-snapshot.json", prepared);
	await save("project-seed.json", bytes);
	// Persistence round trip: close, reopen, verify byte identity.
	await close();
	host = await startHost(options);
	assert.deepEqual(await snapshot(), prepared);
	assert.deepEqual(
		await readFile(join(root, "project", "project.json")),
		bytes,
	);
	lifecycle.reopened = true;
	// The imported Meshopt GLB resource survives the reopen.
	const glbResource = resources.find((r: { id: string }) =>
		r.id.endsWith("meshopt.glb"),
	);
	assert(glbResource);
	const loaded = await fetch(new URL("api/programmatic/resources/load", host.editorUrl), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(glbResource),
	});
	assert.equal(loaded.status, 200);
	const glbBytes = new Uint8Array(await loaded.arrayBuffer());
	assert.equal(digest(glbBytes), glbResource.sha256);
	await save("meshopt-persistence.json", {
		ok: true,
		projectReopenedByteIdentical: true,
		resourceSurvivedReopen: true,
		glbSha256: glbResource.sha256,
		clipCount: prepared.clips.length,
		engine: source.build?.engine,
		toolchainLock: source.build?.toolchainLock?.resource?.sha256 ?? null,
		documentBytes: source.documentId ? null : null,
	});
	console.log(JSON.stringify({ ok: true, editorUrl: host.editorUrl }));
} catch (error) {
	lifecycle.error = error instanceof Error ? error.message : String(error);
	throw error;
} finally {
	try {
		await close();
		lifecycle.hostClosed = true;
	} finally {
		await save("host-lifecycle.json", lifecycle);
	}
}
