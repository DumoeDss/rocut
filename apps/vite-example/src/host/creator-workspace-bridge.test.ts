import { afterEach, describe, expect, jest, test } from "bun:test";
import { connectCreatorWorkspaceBridge } from "./creator-workspace-bridge";

function fixture() {
	const handlers = new Set<(event: MessageEvent) => void>();
	const sent: { data: Record<string, unknown>; origin: string }[] = [];
	const parent = {
		postMessage(data: Record<string, unknown>, origin: string) {
			sent.push({ data, origin });
		},
	};
	const target = {
		parent,
		location: { href: "http://127.0.0.1/editor/" },
		fetch: async () => ({
			ok: true,
			json: async () => ({ revision: 1, project: { id: "native" } }),
		}),
		addEventListener(_type: string, handler: (event: MessageEvent) => void) {
			handlers.add(handler);
		},
		removeEventListener(_type: string, handler: (event: MessageEvent) => void) {
			handlers.delete(handler);
		},
	};
	const emit = (
		data: unknown,
		origin = "https://host.example",
		source: unknown = parent,
	) => {
		for (const handler of handlers)
			handler({ data, origin, source } as MessageEvent);
	};
	return { target: target as unknown as Window, parent, sent, emit, handlers };
}

const snapshot = {
	projectId: "project",
	revision: "1",
	assets: [],
	documents: [],
};

const fixedPlacement = {
	type: "asset.place-version" as const,
	assetId: "asset",
	versionId: "version",
	native: {
		projectId: "native",
		sceneId: "scene",
		revision: 1,
		placement: {
			clipId: "clip",
			trackId: "track",
			startTime: 0,
			trimStart: 0,
			trimEnd: 0,
		},
	},
};

async function connectedFixture() {
	const f = fixture();
	const connecting = connectCreatorWorkspaceBridge({ target: f.target });
	f.emit({
		type: "elftia:creator-workspace-response",
		version: 1,
		requestId: f.sent[0].data.requestId,
		ok: true,
		result: snapshot,
	});
	return { ...f, bridge: (await connecting)! };
}

async function flush() {
	for (let index = 0; index < 5; index++) await Promise.resolve();
}

afterEach(() => jest.useRealTimers());

describe("optional creator workspace transport", () => {
	test("rejects a fully assembled but malformed document DTO before connecting", async () => {
		const f = fixture();
		const connecting = connectCreatorWorkspaceBridge({ target: f.target });
		const body = JSON.stringify({
			...snapshot,
			documents: [{ id: "doc", content: "", contentState: "unloaded" }],
		});
		f.emit({
			type: "elftia:creator-workspace-response",
			version: 1,
			requestId: f.sent[0].data.requestId,
			ok: true,
			result: {
				transport: "workspace-pages-v1",
				token: "token",
				projectId: "project",
				revision: "1",
				pageCount: 1,
				totalBytes: new TextEncoder().encode(body).byteLength,
				index: 0,
				chunk: body,
			},
		});
		expect(await connecting).toBeNull();
		expect(f.handlers.size).toBe(0);
	});
	test("negotiates paged snapshots atomically and refreshes invalidations with known revision", async () => {
		const f = fixture();
		const body = JSON.stringify({
			...snapshot,
			scopeRevision: "1:0",
			documents: [
				{
					id: "doc",
					title: "Plan",
					group: "plan",
					content: "",
					contentState: "unloaded",
					revision: "2:hash",
				},
			],
		});
		const parts = [body.slice(0, 30), body.slice(30)];
		const page = (index: number) => ({
			transport: "workspace-pages-v1",
			token: "token",
			projectId: "project",
			revision: "1",
			pageCount: 2,
			totalBytes: new TextEncoder().encode(body).byteLength,
			index,
			chunk: parts[index],
		});
		const respond = (index: number, result: unknown) =>
			f.emit({
				type: "elftia:creator-workspace-response",
				version: 1,
				requestId: f.sent[index].data.requestId,
				ok: true,
				result,
			});
		const connecting = connectCreatorWorkspaceBridge({ target: f.target });
		expect(f.sent[0].data.transport).toEqual({ version: 1 });
		respond(0, page(0));
		await flush();
		expect(f.sent[1].data.command).toEqual({
			type: "workspace.page",
			token: "token",
			index: 1,
		});
		respond(1, page(1));
		const bridge = (await connecting)!;
		const initial = await bridge.getSnapshot();
		expect(initial.documents[0].contentState).toBe("unloaded");
		const published: unknown[] = [];
		bridge.subscribe((value) => published.push(value));
		f.emit({ type: "elftia:creator-workspace-invalidated", version: 1 });
		expect(f.sent[2].data.transport).toEqual({
			version: 1,
			knownRevision: "1:0",
		});
		respond(2, {
			transport: "workspace-unchanged-v1",
			scopeRevision: "1:0",
			projectId: "project",
			revision: "1",
		});
		for (let index = 0; index < 20; index++) await Promise.resolve();
		expect(published).toEqual([initial]);
		const reading = bridge.readDocument!({
			document: initial.documents[0],
			snapshot: initial,
		});
		expect(f.sent[3].data.command).toMatchObject({
			type: "document.read",
			projectId: "project",
			projectRevision: "1",
			revision: "2:hash",
		});
		const documentBody = JSON.stringify({
			documentId: "doc",
			revision: "2:hash",
			content: "Fixed body",
		});
		respond(3, {
			...page(0),
			pageCount: 1,
			chunk: documentBody,
			totalBytes: new TextEncoder().encode(documentBody).byteLength,
		});
		await expect(reading).resolves.toMatchObject({
			content: "Fixed body",
			contentState: undefined,
		});
		bridge.dispose();
	});
	test("only fixed native placement waits beyond the ordinary 120 second deadline", async () => {
		jest.useFakeTimers();
		const f = await connectedFixture();
		const operation = f.bridge.execute(fixedPlacement);
		await flush();
		jest.advanceTimersByTime(120001);
		expect(f.sent).toHaveLength(2);
		f.emit({
			type: "elftia:creator-workspace-response",
			version: 1,
			requestId: f.sent[1].data.requestId,
			ok: true,
			result: {},
		});
		await expect(operation).resolves.toEqual({});
		f.bridge.dispose();
	});

	for (const command of [
		{ type: "context.mention" as const, assetId: "asset" },
		{
			type: "asset.place-version" as const,
			assetId: "asset",
			versionId: "version",
		},
		{
			...fixedPlacement,
			native: {
				...fixedPlacement.native,
				placement: { ...fixedPlacement.native.placement, startTime: -1 },
			},
		},
		{ ...fixedPlacement, expectedSha256: "invalid" },
	])
		test(`keeps ordinary or malformed ${JSON.stringify(command)} at 120 seconds`, async () => {
			jest.useFakeTimers();
			const f = await connectedFixture();
			const operation = f.bridge.execute(command);
			void operation.catch(() => {});
			await flush();
			jest.advanceTimersByTime(120001);
			await expect(operation).rejects.toThrow("timed out");
			expect(f.sent).toHaveLength(2);
			f.bridge.dispose();
		});

	test("native placement stops at 550 seconds without replay and ignores its late result", async () => {
		jest.useFakeTimers();
		const f = await connectedFixture();
		const operation = f.bridge.execute(fixedPlacement);
		void operation.catch(() => {});
		await flush();
		jest.advanceTimersByTime(550001);
		await expect(operation).rejects.toThrow("timed out");
		f.emit({
			type: "elftia:creator-workspace-response",
			version: 1,
			requestId: f.sent[1].data.requestId,
			ok: true,
			result: {},
		});
		jest.advanceTimersByTime(550001);
		expect(f.sent).toHaveLength(2);
		f.bridge.dispose();
	});

	test("disposing native placement rejects immediately despite its longer deadline", async () => {
		jest.useFakeTimers();
		const f = await connectedFixture();
		const operation = f.bridge.execute(fixedPlacement);
		void operation.catch(() => {});
		await flush();
		f.bridge.dispose();
		await expect(operation).rejects.toThrow("disconnected");
		expect(f.handlers.size).toBe(0);
		jest.advanceTimersByTime(550001);
		expect(f.sent).toHaveLength(2);
	});
	test("connects when a cold initial snapshot arrives after 3.7 seconds", async () => {
		jest.useFakeTimers();
		const f = fixture();
		const connecting = connectCreatorWorkspaceBridge({ target: f.target });
		jest.advanceTimersByTime(3700);
		expect(f.handlers.size).toBe(1);
		f.emit({
			type: "elftia:creator-workspace-response",
			version: 1,
			requestId: f.sent[0].data.requestId,
			ok: true,
			result: snapshot,
		});
		const bridge = await connecting;
		expect(bridge).not.toBeNull();
		expect(await bridge!.getSnapshot()).toEqual(snapshot);
		bridge!.dispose();
	});

	test("bounds discovery to 35 seconds and ignores a late successful snapshot", async () => {
		jest.useFakeTimers();
		const f = fixture();
		const connecting = connectCreatorWorkspaceBridge({ target: f.target });
		jest.advanceTimersByTime(34999);
		expect(f.handlers.size).toBe(1);
		jest.advanceTimersByTime(2);
		expect(await connecting).toBeNull();
		expect(f.handlers.size).toBe(0);
		f.emit({
			type: "elftia:creator-workspace-response",
			version: 1,
			requestId: f.sent[0].data.requestId,
			ok: true,
			result: snapshot,
		});
		expect(f.handlers.size).toBe(0);
		expect(f.sent).toHaveLength(1);
	});

	test("dispose immediately rejects pending execute and never replays it", async () => {
		jest.useFakeTimers();
		const f = fixture();
		const connecting = connectCreatorWorkspaceBridge({ target: f.target });
		f.emit({
			type: "elftia:creator-workspace-response",
			version: 1,
			requestId: f.sent[0].data.requestId,
			ok: true,
			result: snapshot,
		});
		const bridge = (await connecting)!;
		const operation = bridge.execute({
			type: "context.mention",
			assetId: "asset",
		});
		void operation.catch(() => {});
		bridge.dispose();
		expect(f.handlers.size).toBe(0);
		await expect(operation).rejects.toThrow("disconnected");
		f.emit({
			type: "elftia:creator-workspace-response",
			version: 1,
			requestId: f.sent[1].data.requestId,
			ok: true,
			result: {},
		});
		jest.advanceTimersByTime(120001);
		expect(f.sent).toHaveLength(2);
		await expect(
			bridge.execute({ type: "context.mention", assetId: "asset" }),
		).rejects.toThrow("disconnected");
		expect(f.sent).toHaveLength(2);
	});
	test("forwards complete fixed references and rejects malformed optional references", async () => {
		const f = fixture();
		const connecting = connectCreatorWorkspaceBridge({
			target: f.target,
			timeoutMs: 100,
		});
		const pin = {
			projectId: "native",
			sceneId: "scene",
			clipId: "clip",
			assetId: "missing",
			versionId: "v1",
			sha256: "a".repeat(64),
		};
		const current = { ...snapshot, clipReferences: [pin] };
		f.emit({
			type: "elftia:creator-workspace-response",
			version: 1,
			requestId: f.sent[0].data.requestId,
			ok: true,
			result: current,
		});
		const bridge = await connecting;
		expect(await bridge?.getSnapshot()).toEqual(current);
		const updates: unknown[] = [];
		bridge?.subscribe((next) => updates.push(next));
		for (const clipReferences of [
			null,
			{},
			[null],
			[{ ...pin, projectId: "" }],
			[{ ...pin, sha256: undefined }],
		]) {
			f.emit({
				type: "elftia:creator-workspace-changed",
				version: 1,
				snapshot: { ...snapshot, clipReferences },
			});
		}
		expect(updates).toEqual([]);
		f.emit({
			type: "elftia:creator-workspace-changed",
			version: 1,
			snapshot: current,
		});
		expect(updates).toEqual([current]);
		bridge?.dispose();
	});
	test("ignores other windows and locks the successful handshake origin", async () => {
		const f = fixture();
		const connecting = connectCreatorWorkspaceBridge({
			target: f.target,
			timeoutMs: 100,
		});
		const requestId = f.sent[0].data.requestId;
		const response = {
			type: "elftia:creator-workspace-response",
			version: 1,
			requestId,
			ok: true,
			result: snapshot,
		};
		f.emit(response, "https://evil.example", {});
		expect(f.handlers.size).toBe(1);
		f.emit(response);
		const bridge = await connecting;
		expect(await bridge?.getSnapshot()).toEqual(snapshot);
		const updates: unknown[] = [];
		bridge?.subscribe((next) => updates.push(next));
		f.emit(
			{ type: "elftia:creator-workspace-changed", version: 1, snapshot },
			"https://evil.example",
		);
		expect(updates).toEqual([]);
		f.emit({ type: "elftia:creator-workspace-changed", version: 1, snapshot });
		expect(updates).toEqual([snapshot]);
		const next = bridge!.getSnapshot();
		expect(f.sent[1].origin).toBe("https://host.example");
		f.emit({ ...response, requestId: f.sent[1].data.requestId });
		expect(await next).toEqual(snapshot);
		bridge?.dispose();
		expect(f.handlers.size).toBe(0);
	});

	test("an older host falls back and releases its listener", async () => {
		const f = fixture();
		expect(
			await connectCreatorWorkspaceBridge({ target: f.target, timeoutMs: 1 }),
		).toBeNull();
		expect(f.handlers.size).toBe(0);
	});

	test("aborting discovery releases the pending request", async () => {
		const f = fixture();
		const controller = new AbortController();
		const connecting = connectCreatorWorkspaceBridge({
			target: f.target,
			signal: controller.signal,
		});
		controller.abort();
		expect(await connecting).toBeNull();
		expect(f.handlers.size).toBe(0);
	});
});
