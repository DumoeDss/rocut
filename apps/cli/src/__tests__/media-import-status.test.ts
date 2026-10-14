import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AutomationApi } from "@opencut/editor-automation";
import { revisionOf } from "@opencut/editor-contracts";
import type { ProjectId, ProjectStore } from "@opencut/editor-ports";
import { importLocalMedia, inspectLocalMediaImport } from "../media-import";
import { runAgentCli } from "../agent-cli";
import type { ResolvedTarget } from "../target-registry";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function fixture() {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-import-status-"));
	roots.push(root);
	const filePath = path.join(root, "source.png");
	await writeFile(filePath, new Uint8Array([137, 80, 78, 71]));
	const input = {
		filePath,
		expectedRevision: 4,
		idempotencyKey: "original-import",
		image: { mimeType: "image/png", width: 32, height: 18 },
	};
	const result = {
		beforeRevision: revisionOf(4),
		revision: revisionOf(5),
		createdIds: [],
		changedIds: [],
	};
	let committedBatch = "";
	let assets: unknown[] = [];
	let attachment: { metadata: unknown; body: ArrayBuffer } | null = null;
	let applies = 0;
	let saves = 0;
	let reject = false;
	const automation = {
		engine: {
			dryRun: async (batch: unknown) =>
				reject
					? {
							accepted: false,
							baseRevision: 5,
							issues: [{ code: "idempotency-conflict" }],
						}
					: {
							accepted: true,
							baseRevision: 5,
							result,
							replayed: JSON.stringify(batch) === committedBatch,
						},
		},
		assets: async () => assets,
		apply: async (batch: { operations: Array<{ asset: unknown }> }) => {
			applies++;
			committedBatch = JSON.stringify(batch);
			assets = [batch.operations[0].asset];
			return result;
		},
	} as unknown as AutomationApi;
	const store = {
		loadAttachment: async () => attachment,
		saveAttachment: async (value: { metadata: unknown; body: ArrayBuffer }) => {
			saves++;
			attachment = value;
		},
	} as unknown as ProjectStore;
	const transport = {
		input,
		store,
		projectId: "project" as ProjectId,
		automation,
	};
	return {
		transport,
		result,
		import: () => importLocalMedia(transport),
		inspect: () => inspectLocalMediaImport(transport),
		writes: () => ({ applies, saves }),
		reject: () => {
			reject = true;
		},
		loseAttachment: () => {
			attachment = null;
		},
		changeAttachment: () => {
			attachment!.body = new Uint8Array([1]).buffer;
		},
		changeAsset: () => {
			assets = [{ ...(assets[0] as object), name: "edited" }];
		},
	};
}

test("an unobserved original transaction stays unknown and writes nothing", async () => {
	const f = await fixture();
	expect(await f.inspect()).toEqual({
		status: "unknown",
		reason: "original-transaction-unverified",
	});
	expect(f.writes()).toEqual({ applies: 0, saves: 0 });
});

test("an exact replay returns its original result without applying or saving again", async () => {
	const f = await fixture();
	const imported = await f.import();
	expect(await f.inspect()).toEqual({
		status: "committed",
		projectId: "project",
		asset: imported.asset,
		sourceSha256: imported.sourceSha256,
		metadataSource: "caller",
		idempotencyKey: "original-import",
		beforeRevision: 4,
		result: f.result,
	});
	expect(f.writes()).toEqual({ applies: 1, saves: 1 });
});

test("identical media under another operation key does not prove the original transaction", async () => {
	const f = await fixture();
	await f.import();
	f.transport.input.idempotencyKey = "other-import";
	expect((await f.inspect()).status).toBe("unknown");
	expect(f.writes()).toEqual({ applies: 1, saves: 1 });
});

for (const damage of [
	"reject",
	"loseAttachment",
	"changeAttachment",
	"changeAsset",
] as const) {
	test(`recovery refuses ${damage} without repairing or importing`, async () => {
		const f = await fixture();
		await f.import();
		f[damage]();
		expect((await f.inspect()).status).toBe("unknown");
		expect(f.writes()).toEqual({ applies: 1, saves: 1 });
	});
}

test("CLI sends the unchanged original spec to the dedicated status route", async () => {
	const f = await fixture();
	const specPath = path.join(
		path.dirname(f.transport.input.filePath),
		"original.json",
	);
	await writeFile(specPath, JSON.stringify(f.transport.input), "utf8");
	let received: unknown;
	let method: string | undefined;
	let route: string | undefined;
	const server = createServer(async (req, res) => {
		method = req.method;
		route = req.url;
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(Buffer.from(chunk));
		received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ status: "unknown", reason: "fixture" }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as { port: number }).port;
	const originalWrite = process.stdout.write;
	let output = "";
	try {
		process.stdout.write = ((chunk: string | Uint8Array) => {
			output += Buffer.from(chunk).toString();
			return true;
		}) as typeof process.stdout.write;
		await runAgentCli({
			command: "media",
			positional: ["import-status", specPath],
			resolved: {
				secret: { id: "test", port, token: "fixture" },
			} as ResolvedTarget,
		});
	} finally {
		process.stdout.write = originalWrite;
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
	expect(method).toBe("POST");
	expect(route).toBe("/fixture/api/media/import-status");
	expect(received).toEqual(f.transport.input);
	expect(JSON.parse(output)).toEqual({ status: "unknown", reason: "fixture" });
	expect(f.writes()).toEqual({ applies: 0, saves: 0 });
});
