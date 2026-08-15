/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Tests inspect deliberately opaque provider payloads. */
import { describe, expect, test } from "bun:test";
import {
	createInMemoryProjectStoreFixture,
	InMemoryProjectStore,
	type InMemoryRuntimeResourceHost,
} from "@opencut/editor-ports/in-memory";
import { createInMemoryHost } from "@opencut/editor-ports/in-memory/host";
import {
	createHeadlessEditorSession,
	type HeadlessEditorSession,
} from "../headless";

test("the isolated headless session contract is importable", async () => {
	const headless = await import("../headless");

	expect(typeof headless.createHeadlessEditorSession).toBe("function");
});

type Raw = Record<string, unknown>;

function rawProject(args: {
	id: string;
	name?: string;
	updatedAt?: string;
}): Raw {
	const createdAt = "2026-08-05T01:00:00.000Z";
	return {
		metadata: {
			id: args.id,
			name: args.name ?? "Seeded project",
			duration: 0,
			createdAt,
			updatedAt: args.updatedAt ?? createdAt,
			providerPrivateMetadata: { nested: ["keep", { value: 7 }] },
		},
		scenes: [
			{
				id: "main-scene",
				name: "Main",
				isMain: true,
				tracks: {
					overlay: [],
					main: {
						id: "main-track",
						name: "Main",
						type: "video",
						muted: false,
						hidden: false,
						elements: [],
					},
					audio: [],
				},
				bookmarks: [],
				createdAt,
				updatedAt: createdAt,
			},
		],
		currentSceneId: "main-scene",
		settings: {
			fps: { numerator: 30, denominator: 1 },
			canvasSize: { width: 1920, height: 1080 },
			background: { type: "color", color: "#000000" },
		},
		version: 31,
		providerPrivateProject: {
			map: new Map([["provider", "retained"]]),
			bytes: new Uint8Array([2, 4, 6, 8]),
		},
	};
}

async function seedProject(args: {
	store: InMemoryProjectStore;
	id: string;
	name?: string;
}): Promise<void> {
	const data = rawProject(args);
	await args.store.save({
		record: { id: args.id, schemaVersion: 31, data },
		summary: {
			id: args.id,
			name: args.name ?? "Seeded project",
			createdAt: "2026-08-05T01:00:00.000Z",
			updatedAt: "2026-08-05T01:00:00.000Z",
		},
	});
}

function surfaceKeys(session: HeadlessEditorSession): string[] {
	return Object.keys(session).sort();
}

describe("provider-private headless session", () => {
	test("creates a Host-scoped owner with only load, save and dispose", async () => {
		const host = createInMemoryHost({ projectId: "headless-contract" });
		const session = await createHeadlessEditorSession({ host });

		expect(session.id).toBe("session-1");
		expect(session.projectId).toBe("headless-contract");
		expect(surfaceKeys(session)).toEqual([
			"dispose",
			"id",
			"load",
			"projectId",
			"save",
		]);
		expect("mount" in session).toBe(false);
		expect("transaction" in session).toBe(false);
		expect("revision" in session).toBe(false);
		expect("draft" in session).toBe(false);

		await session.dispose();
	});

	test("loads absence as null without navigation or replacement", async () => {
		const host = createInMemoryHost({ projectId: "missing" });
		let navigated = 0;
		host.navigation.onProjectReplaced = () => {
			navigated += 1;
		};
		host.navigation.onExitProject = () => {
			navigated += 1;
		};
		host.navigation.onGoBack = () => {
			navigated += 1;
		};
		const session = await createHeadlessEditorSession({ host });

		expect(await session.load()).toBeNull();
		expect(navigated).toBe(0);
		await session.dispose();
	});

	test("saves a detached edit and a new owner reopens it with opaque data", async () => {
		const store = new InMemoryProjectStore();
		await seedProject({ store, id: "durable" });
		const first = await createHeadlessEditorSession({
			host: createInMemoryHost({ projectId: "durable", store }),
		});
		const loaded = await first.load();
		if (!loaded) throw new Error("seeded project did not load");
		const firstSnapshot = await store.load({ id: "durable" });

		loaded.metadata.name = "Headlessly edited";
		loaded.metadata.updatedAt = new Date("2026-08-05T02:00:00.000Z");
		expect((firstSnapshot?.data as Raw).metadata).toMatchObject({
			name: "Seeded project",
		});
		await first.save({ project: loaded });
		await first.dispose();

		const second = await createHeadlessEditorSession({
			host: createInMemoryHost({ projectId: "durable", store }),
		});
		const reopened = await second.load();
		expect(reopened?.metadata.name).toBe("Headlessly edited");
		expect(reopened?.metadata.updatedAt).toEqual(
			new Date("2026-08-05T02:00:00.000Z"),
		);
		const durable = (await store.load({ id: "durable" }))?.data as Raw;
		expect(durable.providerPrivateProject).toEqual({
			map: new Map([["provider", "retained"]]),
			bytes: new Uint8Array([2, 4, 6, 8]),
		});
		expect((durable.metadata as Raw).providerPrivateMetadata).toEqual({
			nested: ["keep", { value: 7 }],
		});
		await second.dispose();
		expect(await store.load({ id: "durable" })).not.toBeNull();
	});

	test("rejects a cross-project save before either identity is written", async () => {
		const store = new InMemoryProjectStore();
		await seedProject({ store, id: "owned" });
		const session = await createHeadlessEditorSession({
			host: createInMemoryHost({ projectId: "owned", store }),
		});
		const project = await session.load();
		if (!project) throw new Error("seeded project did not load");
		project.metadata.id = "foreign";
		project.metadata.name = "must not persist";

		await expect(session.save({ project })).rejects.toThrow(/project id/i);
		expect(await store.load({ id: "foreign" })).toBeNull();
		expect((await store.load({ id: "owned" }))?.data).toMatchObject({
			metadata: { name: "Seeded project" },
		});
		await session.dispose();
	});

	test("serializes admitted work, retries save failure, and closes admission", async () => {
		const { store, control } = createInMemoryProjectStoreFixture();
		await seedProject({ store, id: "ordered" });
		const session = await createHeadlessEditorSession({
			host: createInMemoryHost({ projectId: "ordered", store }),
		});
		const project = await session.load();
		if (!project) throw new Error("seeded project did not load");

		control.failNext({ operation: "save-project", code: "unavailable" });
		project.metadata.name = "first attempt";
		await expect(session.save({ project })).rejects.toMatchObject({
			code: "unavailable",
		});
		project.metadata.name = "retry succeeds";
		await session.save({ project });

		const pause = control.pauseNext({ operation: "save-project" });
		project.metadata.name = "admitted before dispose";
		const save = session.save({ project });
		await pause.entered;
		const disposeA = session.dispose();
		const disposeB = session.dispose();
		expect(disposeB).toBe(disposeA);
		let disposed = false;
		void disposeA.then(() => {
			disposed = true;
		});
		await Promise.resolve();
		expect(disposed).toBe(false);
		await expect(session.load()).rejects.toThrow(/disposed/i);
		await expect(session.save({ project })).rejects.toThrow(/disposed/i);
		pause.release();
		await save;
		await disposeA;
		expect((await store.load({ id: "ordered" }))?.data).toMatchObject({
			metadata: { name: "admitted before dispose" },
		});
	});

	test("disposing one owner leaves another owner and shared store usable", async () => {
		const store = new InMemoryProjectStore();
		await seedProject({ store, id: "shared" });
		const first = await createHeadlessEditorSession({
			host: createInMemoryHost({ projectId: "shared", store }),
		});
		const second = await createHeadlessEditorSession({
			host: createInMemoryHost({ projectId: "shared", store }),
		});
		await first.dispose();
		const project = await second.load();
		if (!project) throw new Error("seeded project did not load");
		project.metadata.name = "second owner survives";
		await second.save({ project });
		await second.dispose();
		expect((await store.load({ id: "shared" }))?.data).toMatchObject({
			metadata: { name: "second owner survives" },
		});
	});

	test("acquires no in-memory C6 runtime resource", async () => {
		const host = createInMemoryHost({ projectId: "resource-free" });
		const runtime = host.runtimeResources as InMemoryRuntimeResourceHost;
		const session = await createHeadlessEditorSession({ host });
		expect(await session.load()).toBeNull();
		await session.dispose();

		expect(runtime.workers).toEqual([]);
		expect(runtime.audioContexts).toEqual([]);
		expect(runtime.objectUrls).toEqual([]);
	});
});
