import { expect, spyOn, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectId } from "@opencut/editor-contracts";
import {
	createOpenCutProjectRecord,
	createOpenCutTransactionDocumentAdapter,
} from "@opencut/editor-classic/transactions";
import type { ProjectStore } from "@opencut/editor-ports";
import { HttpProjectStore } from "../../../vite-example/src/host/http-project-store";
import { createAdoptingStore } from "../editor-plane";
import { FileProjectStore } from "../file-store";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

const id = projectId("http-headers");
const tempParent = tmpdir();

test("HTTP headers consume one legacy metadata response without fetching 222 bodies", async () => {
	const calls: { url: string; init?: RequestInit }[] = [];
	const controller = new AbortController();
	const metadata = Array.from({ length: 222 }, (_, index) => ({
		key: `frame-${index}`,
		metadata: { index },
	}));
	const store = new HttpProjectStore({
		fetchImpl: Object.assign(
			async (url: RequestInfo | URL, init?: RequestInit) => {
				calls.push({ url: String(url), init });
				return Response.json(metadata);
			},
			{ preconnect: () => {} },
		),
	});
	const legacy = spyOn(store, "listAttachments").mockRejectedValue(
		new Error("must not hydrate"),
	);
	try {
		const headers = await store.listAttachmentHeaders({
			projectId: id,
			signal: controller.signal,
		});
		expect(headers).toHaveLength(222);
		expect(headers[0]).toEqual({ projectId: id, ...metadata[0] });
		expect(headers.every((header) => !("body" in header))).toBe(true);
		expect(calls).toEqual([
			{ url: "api/attachments", init: { signal: controller.signal } },
		]);
		expect(legacy).not.toHaveBeenCalled();
	} finally {
		legacy.mockRestore();
	}
});

test("HTTP full attachment enumeration remains compatible with legacy list wire format", async () => {
	const calls: string[] = [];
	const store = new HttpProjectStore({
		fetchImpl: Object.assign(
			async (url: RequestInfo | URL) => {
				calls.push(String(url));
				if (String(url).endsWith("/attachments"))
					return Response.json([
						{ key: "complete", metadata: { listed: true } },
						{ key: "missing", metadata: {} },
					]);
				if (String(url).endsWith("/missing"))
					return new Response(null, { status: 404 });
				return new Response(new Uint8Array([8, 9]), {
					headers: { "x-opencut-metadata": btoa('{"loaded":true}') },
				});
			},
			{ preconnect: () => {} },
		),
	});
	const headers = await store.listAttachmentHeaders({ projectId: id });
	expect(headers).toHaveLength(2);
	expect(
		await store.loadAttachment({ projectId: id, key: "missing" }),
	).toBeNull();
	calls.length = 0;
	expect(await store.listAttachments({ projectId: id })).toEqual([
		{
			projectId: id,
			key: "complete",
			metadata: { loaded: true },
			body: new Uint8Array([8, 9]).buffer,
		},
	]);
	expect(calls).toEqual([
		"api/attachments",
		"api/attachment/complete",
		"api/attachment/missing",
	]);
});

test("HTTP headers scope cancellation, network and invalid metadata errors to the project", async () => {
	for (const mode of ["aborted", "unavailable", "corrupt"] as const) {
		const controller = new AbortController();
		let calls = 0;
		const store = new HttpProjectStore({
			fetchImpl: Object.assign(
				async () => {
					calls += 1;
					return mode === "unavailable"
						? Response.json({}, { status: 500 })
						: Response.json([{ key: 3 }]);
				},
				{ preconnect: () => {} },
			),
		});
		if (mode === "aborted") controller.abort();
		await expect(
			store.listAttachmentHeaders({ projectId: id, signal: controller.signal }),
		).rejects.toMatchObject({
			code: mode,
			operation: "list-attachments",
			scope: { kind: "project", projectId: id },
		});
		expect(calls).toBe(mode === "aborted" ? 0 : 1);
	}
	const controller = new AbortController();
	const store = new HttpProjectStore({
		fetchImpl: Object.assign(
			async () => {
				controller.abort();
				return Response.json([]);
			},
			{ preconnect: () => {} },
		),
	});
	await expect(
		store.listAttachmentHeaders({ projectId: id, signal: controller.signal }),
	).rejects.toMatchObject({
		code: "aborted",
		operation: "list-attachments",
		scope: { kind: "project", projectId: id },
	});
});

test("EditorPlane forwards genuinely optional headers with the underlying this and signal", async () => {
	const store = new FileProjectStore({
		root: "unused-header-forwarding-fixture",
		schemaVersion: 1,
	});
	const record = createOpenCutProjectRecord({
		projectId: id,
		name: "headers",
	}).record;
	const adapter = createOpenCutTransactionDocumentAdapter({
		initialRecord: record,
		initialAssets: [],
	});
	const controller = new AbortController();
	const headers = spyOn(store, "listAttachmentHeaders").mockImplementation(
		async function (this: FileProjectStore, args) {
			expect(this).toBe(store);
			expect(args.signal).toBe(controller.signal);
			return [];
		},
	);
	try {
		const adopting = createAdoptingStore({ store, adapter });
		expect(typeof adopting.listAttachmentHeaders).toBe("function");
		await adopting.listAttachmentHeaders!({
			projectId: id,
			signal: controller.signal,
		});
		expect(headers).toHaveBeenCalledTimes(1);
		const legacy = new Proxy(store, {
			get(target, key, receiver) {
				return key === "listAttachmentHeaders"
					? undefined
					: Reflect.get(target, key, receiver);
			},
		}) as ProjectStore;
		expect(
			"listAttachmentHeaders" in
				createAdoptingStore({ store: legacy, adapter }),
		).toBe(false);
	} finally {
		headers.mockRestore();
	}
});

test("authenticated Host prefers headers and keeps the old-store metadata fallback", async () => {
	const parent = await realpath(tempParent);
	const root = await mkdtemp(path.join(parent, "rocut-http-headers-"));
	const host = await startHost({
		projectRoot: path.join(root, "project"),
		registry: new TargetRegistry(path.join(root, "targets")),
	});
	const originalHeaders = Object.getOwnPropertyDescriptor(
		FileProjectStore.prototype,
		"listAttachmentHeaders",
	)!;
	const legacy = spyOn(FileProjectStore.prototype, "listAttachments");
	try {
		const base = `http://127.0.0.1:${host.port}/${host.token}/api`;
		const store = new HttpProjectStore({ base });
		const ownedId = (await store.list())[0].id;
		await store.saveAttachment({
			projectId: ownedId,
			key: "owned",
			metadata: { keep: true },
			body: new Uint8Array([1]).buffer,
		});
		const denied = await fetch(
			`http://127.0.0.1:${host.port}/wrong/api/attachments`,
		);
		expect(denied.status).toBe(401);
		const wire = await (await fetch(`${base}/attachments`)).json();
		expect(wire).toEqual([{ key: "owned", metadata: { keep: true } }]);
		expect(legacy).not.toHaveBeenCalled();
		Object.defineProperty(FileProjectStore.prototype, "listAttachmentHeaders", {
			...originalHeaders,
			value: undefined,
		});
		expect(await (await fetch(`${base}/attachments`)).json()).toEqual(wire);
		expect(legacy).toHaveBeenCalledTimes(1);
		Object.defineProperty(
			FileProjectStore.prototype,
			"listAttachmentHeaders",
			originalHeaders,
		);
		await store.removeAttachment({ projectId: ownedId, key: "owned" });
		expect(await store.listAttachmentHeaders({ projectId: ownedId })).toEqual(
			[],
		);
	} finally {
		Object.defineProperty(
			FileProjectStore.prototype,
			"listAttachmentHeaders",
			originalHeaders,
		);
		legacy.mockRestore();
		await host.close();
		expect(await realpath(root)).toBe(root);
		expect(path.dirname(root)).toBe(parent);
		await rm(root, { recursive: true, force: true });
	}
});
