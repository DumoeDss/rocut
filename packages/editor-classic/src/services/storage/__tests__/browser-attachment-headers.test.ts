import { beforeEach, expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.ROCUT_BROWSER_HEADERS_ISOLATED !== "1") {
	test("browser header tests run in an isolated mechanism process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: { ...process.env, ROCUT_BROWSER_HEADERS_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw new Error(
				`${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
	});
} else {
	await import("../../../editor/session/__tests__/wasm-test-mock");
	const mechanisms = await import("../browser-storage-mechanisms");
	const migration = await import("../browser-project-store-migration");
	const ownership = await import("../browser-project-store-media-ownership");
	const {
		createCurrentStoredAttachment,
		createCurrentStoredAttachmentTombstone,
	} = await import("../browser-project-store-records");
	const { BrowserProjectStoreControl } =
		await import("../browser-project-store-control");
	const bodies = new Map<string, ArrayBuffer>();
	let pairs: ReturnType<typeof createCurrentStoredAttachment>[] = [];
	let bodyReads: string[] = [];
	let metadataReads = 0;
	let removed = false;
	mock.module("../browser-storage-mechanisms", () => ({
		...mechanisms,
		idbGetAllProjectPairs: async () => [],
		idbGetAllAttachmentPairs: async () => {
			metadataReads++;
			return structuredClone(pairs);
		},
		idbGetAttachmentPair: async ({ key }: { key: string }) =>
			structuredClone(pairs.find((pair) => pair.authorityRow.id === key)) ?? {
				publicRow: null,
				authorityRow: null,
			},
		opfsRead: async ({ key }: { key: string }) => {
			bodyReads.push(key);
			return bodies.get(key) ?? null;
		},
	}));
	mock.module("../browser-project-store-migration", () => ({
		...migration,
		retryBrowserProjectMigrationRecovery: async () => {},
		retryBrowserProjectMigrationCleanup: async () => {},
	}));
	mock.module("../browser-project-store-media-ownership", () => ({
		...ownership,
		opportunisticallyCertifyMediaOwnership: async () => false,
		registerMediaOwner: async () => {},
	}));
	mock.module("../browser-project-store-cascade-manager", () => ({
		BrowserProjectStoreCascadeManager: class {
			async retryPendingCleanup() {}
			async projectBlocksAttachmentAccess() {
				return removed;
			}
			async commitProjectRemoval() {
				removed = true;
			}
		},
	}));
	const { BrowserProjectStore, resetBrowserProjectStoreRuntimeForTests } =
		await import("../browser-project-store");
	const identity = {
		identity: "header-only-test",
		projectsDatabase: "headers-projects",
		projectsStore: "projects",
		mediaDatabasePrefix: "headers-media-",
		mediaStore: "media",
		libraryDatabase: "headers-library",
		libraryStore: "library",
		mediaDirectoryPrefix: "headers-files-",
	};
	function fixture() {
		const control = new BrowserProjectStoreControl();
		return {
			control,
			store: new BrowserProjectStore({
				storageIdentity: identity,
				migrationPolicy: { kind: "disabled" },
				conformanceControl: control,
			}),
		};
	}
	function attachment(key: string) {
		return createCurrentStoredAttachment({
			projectId: "sequence",
			key,
			metadata: {
				kind: "programmatic-resource",
				providerPrivate: new Map([["keep", key]]),
			},
			bodyKey: `body-${key}`,
			mutationId: `mutation-${key}`,
			bodyDigest: `sha256:${"a".repeat(64)}`,
			byteLength: 2,
		});
	}
	beforeEach(() => {
		resetBrowserProjectStoreRuntimeForTests();
		pairs = [];
		bodyReads = [];
		metadataReads = 0;
		removed = false;
		bodies.clear();
	});

	test("222 live authority headers plus tombstone enumerate with zero body reads, even if bodies are missing", async () => {
		pairs = Array.from({ length: 222 }, (_, index) =>
			attachment(String(index).padStart(3, "0")),
		).reverse();
		pairs.push(
			createCurrentStoredAttachmentTombstone({
				projectId: "sequence",
				key: "deleted",
				mutationId: "delete",
			}),
		);
		const { store } = fixture();
		const headers = await store.listAttachmentHeaders({
			projectId: "sequence",
		});
		expect(headers).toHaveLength(222);
		expect(headers[0]).toEqual({
			projectId: "sequence",
			key: "000",
			metadata: {
				kind: "programmatic-resource",
				providerPrivate: new Map([["keep", "000"]]),
			},
		});
		expect(headers[221].key).toBe("221");
		expect(bodyReads).toEqual([]);
		expect(metadataReads).toBe(1);
		expect(
			headers.some((header) => "body" in header || header.key === "deleted"),
		).toBe(false);
		await expect(
			store.loadAttachment({ projectId: "sequence", key: "000" }),
		).rejects.toMatchObject({ code: "corrupt", operation: "load-attachment" });
		expect(bodyReads).toEqual(["body-000"]);
		await expect(
			store.listAttachments({ projectId: "sequence" }),
		).rejects.toMatchObject({ code: "corrupt", operation: "list-attachments" });
		expect(bodyReads).toEqual(["body-000", "body-221"]);
	});

	test("inconsistent public/authority metadata remains corruption, not a partial header list", async () => {
		const valid = attachment("bad");
		pairs = [{ ...valid, publicRow: { id: "wrong" } }];
		const { store } = fixture();
		await expect(
			store.listAttachmentHeaders({ projectId: "sequence" }),
		).rejects.toMatchObject({ code: "corrupt", operation: "list-attachments" });
		expect(bodyReads).toEqual([]);
	});

	test("header enumeration observes project deletion barriers and aborts after metadata dispatch", async () => {
		pairs = [attachment("a")];
		const { store, control } = fixture();
		const hold = control.pauseNextRead({ operation: "list-attachments" });
		const abort = new AbortController();
		const listing = store.listAttachmentHeaders({
			projectId: "sequence",
			signal: abort.signal,
		});
		await hold.entered;
		let deletionDone = false;
		const deleting = store.remove({ id: "sequence" }).then(() => {
			deletionDone = true;
		});
		await Promise.resolve();
		expect(deletionDone).toBe(false);
		abort.abort();
		hold.release();
		await expect(listing).rejects.toMatchObject({
			code: "aborted",
			operation: "list-attachments",
		});
		await deleting;
		expect(
			await store.listAttachmentHeaders({ projectId: "sequence" }),
		).toEqual([]);
		expect(metadataReads).toBe(1);
		expect(bodyReads).toEqual([]);
	});

	test("already cancelled header reads do not dispatch metadata IO", async () => {
		const { store } = fixture();
		const abort = new AbortController();
		abort.abort();
		await expect(
			store.listAttachmentHeaders({
				projectId: "sequence",
				signal: abort.signal,
			}),
		).rejects.toMatchObject({ code: "aborted", operation: "list-attachments" });
		expect(metadataReads).toBe(0);
		expect(bodyReads).toEqual([]);
	});
}
