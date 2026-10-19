/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The focused manager harness supplies only the EditorCore resources exercised by persistence. */
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { ProjectAttachment, ProjectStore } from "@opencut/editor-ports";
import type { EditorCore } from "../..";
import type { TProject } from "../../../project/types";
import type { MediaTime } from "../../../wasm";

if (process.env.ROCUT_ATTACHMENT_HEADERS_ISOLATED !== "1") {
	test("attachment header manager tests run in an isolated process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: { ...process.env, ROCUT_ATTACHMENT_HEADERS_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	await import("../../../editor/session/__tests__/wasm-test-mock");
	const { InMemoryProjectStore, InMemoryProjectStoreControl } =
		await import("@opencut/editor-ports/in-memory");
	const { SessionPersistenceCoordinator } =
		await import("../../../editor/persistence");
	const { MediaManager } = await import("../media-manager");
	const { ProjectManager } = await import("../project-manager");

	class ObservedStore extends InMemoryProjectStore {
		readonly events: string[] = [];
		missingKey: string | null = null;
		failCopyKey: string | null = null;
		override async listAttachments(
			args: Parameters<ProjectStore["listAttachments"]>[0],
		) {
			this.events.push("list-bodies");
			return super.listAttachments(args);
		}
		override async listAttachmentHeaders(
			args: Parameters<ProjectStore["listAttachments"]>[0],
		) {
			this.events.push("list-headers");
			return super.listAttachmentHeaders(args);
		}
		override async loadAttachment(
			args: Parameters<ProjectStore["loadAttachment"]>[0],
		) {
			this.events.push(`load:${args.key}`);
			return args.key === this.missingKey ? null : super.loadAttachment(args);
		}
		override async saveAttachment(
			args: Parameters<ProjectStore["saveAttachment"]>[0],
		) {
			this.events.push(`save:${args.key}`);
			if (args.projectId !== "source" && args.key === this.failCopyKey) {
				throw new Error("copy write rejected");
			}
			await super.saveAttachment(args);
			this.events.push(`saved:${args.key}`);
		}
	}

	function sourceProject(): TProject {
		const now = new Date("2026-10-08T00:00:00Z");
		return {
			metadata: {
				id: "source",
				name: "Source",
				duration: 0 as MediaTime,
				createdAt: now,
				updatedAt: now,
				thumbnail: "retained-thumbnail",
			},
			scenes: [],
			motionTextSequences: [],
			currentSceneId: "",
			version: 31,
			settings: {
				fps: { numerator: 25, denominator: 1 },
				canvasSize: { width: 160, height: 90 },
				background: { type: "color", color: "#000000" },
			},
		};
	}

	function harness(store: ProjectStore) {
		const persistence = new SessionPersistenceCoordinator(store);
		const failures: string[] = [];
		const editor = {
			persistence,
			resources: {
				createObjectUrl: ({ blob }: { blob: Blob }) => ({
					resourceId: "test-url",
					url: `blob:header-test/${blob.size}`,
					revoke: () => {},
				}),
			},
			reportPersistenceFailure: ({ operation }: { operation: string }) =>
				failures.push(operation),
			drainProjectLiveState: async () => {},
			save: { pause: () => {}, resume: () => {} },
			scenes: { clearScenes: () => {} },
		} as unknown as EditorCore;
		const media = new MediaManager({ editor });
		Object.assign(editor, { media });
		return {
			persistence,
			media,
			project: new ProjectManager(editor),
			failures,
		};
	}

	async function seed({
		store,
		count = 222,
	}: {
		store: InstanceType<typeof InMemoryProjectStore>;
		count?: number;
	}) {
		const persistence = new SessionPersistenceCoordinator(store);
		await persistence.saveProject({ project: sourceProject() });
		for (let index = 0; index < count; index++) {
			await store.saveAttachment({
				projectId: "source",
				key: `frame-${String(index).padStart(3, "0")}`,
				metadata: {
					kind: "programmatic-resource",
					version: 1,
					providerPrivate: new Map([["frame", index]]),
				},
				body: new Uint8Array([index % 256, 255]).buffer,
			});
		}
	}

	async function addMedia(store: InstanceType<typeof InMemoryProjectStore>) {
		await store.saveAttachment({
			projectId: "source",
			key: "song",
			metadata: {
				id: "song",
				name: "song.wav",
				type: "audio",
				mimeType: "audio/wav",
				providerPrivate: new Map([["keep", new Uint8Array([7, 8])]]),
			},
			body: new Uint8Array([1, 2, 3]).buffer,
		});
	}

	test("opening 222 programmatic attachments reads zero bodies; mixed projects load only media", async () => {
		const store = new ObservedStore();
		await seed({ store });
		const { project, media } = harness(store);
		store.events.length = 0;
		await project.loadProject({ id: "source" });
		expect(store.events).toEqual(["list-headers"]);
		expect(media.getAssets()).toEqual([]);
		await addMedia(store);
		store.events.length = 0;
		await project.loadProject({ id: "source" });
		expect(store.events).toEqual(["list-headers", "load:song"]);
		expect(media.getAssets().map(({ id }) => id)).toEqual(["song"]);
		expect([
			...new Uint8Array(await media.getAssets()[0].file.arrayBuffer()),
		]).toEqual([1, 2, 3]);
	});

	test("a media header does not disguise a missing body as a successful load", async () => {
		const store = new ObservedStore();
		await seed({ store, count: 0 });
		await addMedia(store);
		store.missingKey = "song";
		const { project, media, failures } = harness(store);
		await expect(project.loadProject({ id: "source" })).rejects.toThrow(
			"body is missing",
		);
		expect(project.getActiveOrNull()).toBeNull();
		expect(media.getAssets()).toEqual([]);
		expect(failures).toEqual(["load-media-attachments", "load-project"]);
	});

	test("coordinator headers retain opaque metadata without body reads or caller aliases", async () => {
		const store = new ObservedStore();
		await addMedia(store);
		const { persistence } = harness(store);
		store.events.length = 0;
		const headers = await persistence.listAttachmentHeaders!({
			projectId: "source",
		});
		expect(store.events).toEqual(["list-headers"]);
		expect(Object.keys(headers[0]).sort()).toEqual([
			"key",
			"metadata",
			"projectId",
		]);
		const metadata = headers[0].metadata as {
			providerPrivate: Map<string, Uint8Array>;
		};
		metadata.providerPrivate.clear();
		await persistence.saveAttachment({
			projectId: "source",
			key: "song",
			metadata: { name: "changed.wav" },
			body: new Uint8Array([9]).buffer,
		});
		const saved = await store.loadAttachment({
			projectId: "source",
			key: "song",
		});
		expect(saved?.metadata).toMatchObject({
			name: "changed.wav",
			providerPrivate: new Map([["keep", new Uint8Array([7, 8])]]),
		});
		const controller = new AbortController();
		controller.abort();
		await expect(
			persistence.listAttachmentHeaders!({
				projectId: "source",
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ code: "aborted", operation: "list-attachments" });
		persistence.destroy();
		await expect(
			persistence.listAttachmentHeaders!({ projectId: "source" }),
		).rejects.toThrow("destroyed");
	});

	test("duplicate copies opaque bodies in load/save order, joining each write before the next read", async () => {
		const control = new InMemoryProjectStoreControl();
		const store = new ObservedStore({ control });
		await seed({ store, count: 3 });
		const { project } = harness(store);
		await project.loadAllProjects();
		store.events.length = 0;
		const pause = control.pauseNext({ operation: "save-attachment" });
		const copying = project.duplicateProjects({ ids: ["source"] });
		await pause.entered;
		try {
			expect(store.events).toEqual([
				"list-headers",
				"load:frame-000",
				"save:frame-000",
			]);
		} finally {
			pause.release();
		}
		const [id] = await copying;
		expect(store.events).toEqual([
			"list-headers",
			"load:frame-000",
			"save:frame-000",
			"saved:frame-000",
			"load:frame-001",
			"save:frame-001",
			"saved:frame-001",
			"load:frame-002",
			"save:frame-002",
			"saved:frame-002",
		]);
		for (let index = 0; index < 3; index++) {
			const key = `frame-00${index}`;
			const saved = await store.loadAttachment({ projectId: id, key });
			expect(saved).toMatchObject({
				metadata: { providerPrivate: new Map([["frame", index]]) },
			});
			expect([...new Uint8Array(saved!.body)]).toEqual([index, 255]);
		}
	});

	for (const failure of ["missing", "write"] as const) {
		test(`duplicate ${failure} failure rolls back all destinations without late attachment writes`, async () => {
			const store = new ObservedStore();
			await seed({ store, count: 3 });
			const { persistence, project, failures } = harness(store);
			const second = sourceProject();
			second.metadata.id = "second";
			await persistence.saveProject({ project: second });
			if (failure === "missing") store.missingKey = "frame-001";
			else store.failCopyKey = "frame-001";
			await project.loadAllProjects();
			store.events.length = 0;
			const removed: string[] = [];
			const remove = store.remove.bind(store);
			store.remove = async (args) => {
				removed.push(args.id);
				await remove(args);
			};
			await expect(
				project.duplicateProjects({ ids: ["source", "second"] }),
			).rejects.toThrow(
				failure === "missing" ? "body is missing" : "copy write rejected",
			);
			const settledEvents = [...store.events];
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			expect(store.events).toEqual(settledEvents);
			expect(store.events).not.toContain("load:frame-002");
			expect(removed).toHaveLength(2);
			for (const id of removed) {
				expect(await store.listAttachmentHeaders({ projectId: id })).toEqual(
					[],
				);
			}
			expect((await store.list()).map(({ id }) => id).sort()).toEqual([
				"second",
				"source",
			]);
			expect(
				project
					.getSavedProjects()
					.map(({ id }) => id)
					.sort(),
			).toEqual(["second", "source"]);
			expect(failures).toEqual(["duplicate-projects"]);
		});
	}

	test("legacy providers explicitly retain body-list hydration and duplication", async () => {
		const store = new ObservedStore();
		await seed({ store, count: 2 });
		await addMedia(store);
		Object.defineProperty(store, "listAttachmentHeaders", { value: undefined });
		const { persistence, project, media } = harness(store);
		expect(persistence.listAttachmentHeaders).toBeUndefined();
		store.events.length = 0;
		await project.loadProject({ id: "source" });
		expect(store.events).toEqual(["list-bodies"]);
		expect(media.getAssets().map(({ id }) => id)).toEqual(["song"]);
		store.events.length = 0;
		const [id] = await project.duplicateProjects({ ids: ["source"] });
		expect(store.events).toEqual([
			"list-bodies",
			"save:frame-000",
			"saved:frame-000",
			"save:frame-001",
			"saved:frame-001",
			"save:song",
			"saved:song",
		]);
		const attachments: readonly ProjectAttachment[] =
			await store.listAttachments({ projectId: id });
		expect(attachments).toHaveLength(3);
		expect([...new Uint8Array(attachments[2].body)]).toEqual([1, 2, 3]);
	});
}
