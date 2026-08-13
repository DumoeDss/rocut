import { describe, expect, test } from "bun:test";
import {
	formatConformanceReport,
	runPortConformance,
} from "../conformance";
import {
	createInMemoryPorts,
	createInMemoryProjectStoreFixture,
	InMemoryProjectStore,
	InMemoryRuntimeResourceHost,
} from "../in-memory";
import {
	deriveGraphicsReport,
	UNIMPLEMENTED_RUNTIME_GRAPHICS,
} from "../environment";
import type { RuntimeGraphicsQuery } from "../environment";
import { ProjectStoreError } from "../project-store";
import type { LibraryRecord, ProjectAttachment } from "../project-store";

function disposableMigrationBinding({
	store,
	identity,
	prefix = "c5-disposable-",
}: {
	store: InMemoryProjectStore;
	identity: string;
	prefix?: string;
}) {
	return {
		identity,
		prefix,
		store,
		cleanup: { identity, store, run: async () => {} },
	};
}

describe("port conformance", () => {
	test("the in-memory reference implementation passes every case", async () => {
		const fixture = createInMemoryProjectStoreFixture();
		const report = await runPortConformance({
			ports: createInMemoryPorts({ store: fixture.store }),
			storeFixture: fixture,
			label: "in-memory reference",
		});
		// Printed so the recorded evidence is the suite's own output rather than a
		// paraphrase of it.
		console.log(formatConformanceReport(report));
		const failures = report.results.filter((r) => r.status === "failed");
		expect(failures).toEqual([]);
		expect(report.passed).toBe(true);

		// Skipped cases are reported as skipped and are NOT counted as passing.
		// Those two are the cases a detecting, migration-free reference host
		// genuinely cannot exercise; a suite that called them green would be
		// telling C5 and E1 something untrue.
		const skipped = report.results.filter((r) => r.status === "skipped");
		expect(skipped.map((r) => r.port).sort()).toEqual(["environment", "store"]);
		expect(skipped.every((r) => r.passed === false)).toBe(true);
	});

	test("the migration case runs when opted in, rejects failure, and requires idempotence", async () => {
		// Opt-in because migrate() is destructive against a real store. Three
		// runs: a working state transition, permanent failure, and a migration
		// that incorrectly repeats against an already-current store.
		let migrated = false;
		const working = new InMemoryProjectStore({
			schemaVersion: 2,
			migrate: async (ctx) => {
				if (migrated || ctx.from === ctx.to) {
					return { status: "not-needed" as const };
				}
				migrated = true;
				ctx.report({ completed: 1, total: 1, label: "in-memory fixture" });
				return {
					status: "migrated" as const,
					from: ctx.from,
					to: ctx.to,
					recordsMigrated: 1,
				};
			},
		});
		const good = await runPortConformance({
			ports: createInMemoryPorts({ store: working }),
			storeFixture: {
				store: working,
				disposableMigration: disposableMigrationBinding({
					store: working,
					identity: "c5-disposable-working",
				}),
			},
			label: "working migration",
			exerciseMigration: true,
		});
		const goodCase = good.results.find((r) => r.name.includes("migration"));
		expect(goodCase?.status).toBe("passed");

		const broken = new InMemoryProjectStore({
			schemaVersion: 2,
			migrate: async (ctx) => ({
				status: "failed" as const,
				from: ctx.from,
				to: ctx.to,
				reason: "always broken",
			}),
		});
		const bad = await runPortConformance({
			ports: createInMemoryPorts({ store: broken }),
			storeFixture: {
				store: broken,
				disposableMigration: disposableMigrationBinding({
					store: broken,
					identity: "c5-disposable-broken",
				}),
			},
			label: "permanently failing migration",
			exerciseMigration: true,
		});
		const badCase = bad.results.find((r) => r.name.includes("migration"));
		expect(badCase?.status).toBe("failed");
		expect(bad.passed).toBe(false);

		const nonIdempotent = new InMemoryProjectStore({
			schemaVersion: 2,
			migrate: async (ctx) => {
				ctx.report({ completed: 1, total: 1 });
				return {
					status: "migrated" as const,
					from: ctx.from,
					to: ctx.to,
					recordsMigrated: 0,
				};
			},
		});
		const repeated = await runPortConformance({
			ports: createInMemoryPorts({ store: nonIdempotent }),
			storeFixture: {
				store: nonIdempotent,
				disposableMigration: disposableMigrationBinding({
					store: nonIdempotent,
					identity: "c5-disposable-non-idempotent",
				}),
			},
			label: "non-idempotent migration",
			exerciseMigration: true,
		});
		const repeatedCase = repeated.results.find((r) =>
			r.name.includes("migration"),
		);
		expect(repeatedCase?.status).toBe("failed");
		expect(repeatedCase?.detail).toMatch(/must be not-needed/);
	});

	test("the migration case is skipped, not passed, when it is not opted into", async () => {
		const store = new InMemoryProjectStore({
			schemaVersion: 2,
			migrate: async () => ({ status: "not-needed" as const }),
		});
		const report = await runPortConformance({
			ports: createInMemoryPorts({ store }),
			label: "migration not opted into",
		});
		const migrationCase = report.results.find((r) =>
			r.name.includes("migration"),
		);
		expect(migrationCase?.status).toBe("skipped");
		expect(migrationCase?.detail).toMatch(/destructive/);
	});

	test("migration opt-in rejects an identity outside its disposable prefix", async () => {
		const store = new InMemoryProjectStore({
			migrate: async () => ({ status: "not-needed" as const }),
		});
		const report = await runPortConformance({
			ports: createInMemoryPorts({ store }),
			storeFixture: {
				store,
				disposableMigration: disposableMigrationBinding({
					store,
					identity: "production-profile",
				}),
			},
			exerciseMigration: true,
		});
		const migrationCase = report.results.find((result) =>
			result.name.includes("migration"),
		);
		expect(migrationCase?.status).toBe("failed");
		expect(migrationCase?.detail).toMatch(/outside disposable prefix/);
	});

	test("a forcing no-rasterizer host runs the no-rasterizer case, not past it", async () => {
		// The suite's no-rasterizer case returns early for a *detecting* host,
		// which means the default run above passes it vacuously. This run supplies
		// a host that actually forces, so the case executes its assertions. §3.5
		// needs a constructible no-rasterizer Host, and a case that only ever
		// short-circuits would not establish one.
		const report = await runPortConformance({
			ports: createInMemoryPorts({
				graphics: { mode: "force", rasterizer: "none" },
			}),
			label: "in-memory reference, no-rasterizer host",
		});
		console.log(formatConformanceReport(report));
		expect(report.passed).toBe(true);
		const forced = report.results.find((r) =>
			r.name.includes("forced no-rasterizer"),
		);
		expect(forced?.passed).toBe(true);

		// And the case is not vacuous: a host that forced but whose report claimed
		// a rasterizer would fail it.
		const declaration = createInMemoryPorts({
			graphics: { mode: "force", rasterizer: "none" },
		}).environment.describeGraphics();
		expect(declaration).toEqual({ mode: "force", rasterizer: "none" });
		const derived = deriveGraphicsReport({
			declaration,
			runtime: UNIMPLEMENTED_RUNTIME_GRAPHICS,
		});
		expect(derived.livePreviewLimit).toBe(0);
		expect(derived.rasterizer === "none" && derived.reason).toBeTruthy();
	});

	test("reports pass/fail per port and per case", async () => {
		const report = await runPortConformance({
			ports: createInMemoryPorts(),
			label: "shape",
		});
		expect(report.results.length).toBeGreaterThan(0);
		for (const result of report.results) {
			expect(typeof result.port).toBe("string");
			expect(typeof result.name).toBe("string");
			expect(typeof result.passed).toBe("boolean");
		}
		expect(Object.keys(report.byPort).sort()).toEqual(
			[
				"assetLoader",
				"assets",
				"diagnostics",
				"environment",
				"exporter",
				"ids",
				"runtimeResources",
				"store",
			].sort(),
		);
	});

	test("the suite is not vacuous — a non-conforming store fails it", async () => {
		/**
		 * A store that inspects and normalizes the payload instead of carrying it
		 * opaquely. This is the negative control for the conformance suite itself:
		 * a suite that cannot fail is not evidence.
		 */
		class NormalizingStore extends InMemoryProjectStore {
			override async load(args: { id: string }) {
				const record = await super.load(args);
				if (!record) return null;
				return { ...record, data: { normalized: true } };
			}
		}
		const report = await runPortConformance({
			ports: createInMemoryPorts({ store: new NormalizingStore() }),
			label: "normalizing store (negative control)",
		});
		expect(report.passed).toBe(false);
		expect(
			report.results.some(
				(r) =>
					r.port === "store" && !r.passed && r.name.includes("round-trips"),
			),
		).toBe(true);
	});
});

describe("C5 contract-review regression controls", () => {
	test("an earlier attachment write cannot outlive a later project removal", async () => {
		const { store, control } = createInMemoryProjectStoreFixture();
		const id = "review-project";
		await store.save({
			record: { id, schemaVersion: 1, data: {} },
			summary: {
				id,
				name: id,
				createdAt: "2026-08-01T00:00:00.000Z",
				updatedAt: "2026-08-01T00:00:00.000Z",
			},
		});
		const gate = control.pauseNext({ operation: "save-attachment" });
		const earlier = store.saveAttachment({
			projectId: id,
			key: "late",
			metadata: {},
			body: new Uint8Array([1]).buffer,
		});
		await gate.entered;
		let removalDone = false;
		const later = store.remove({ id }).then(() => {
			removalDone = true;
		});
		try {
			await Promise.resolve();
			expect(removalDone).toBe(false);
		} finally {
			gate.release();
			await Promise.all([earlier, later]);
		}
		expect(await store.load({ id })).toBeNull();
		expect(await store.loadAttachment({ projectId: id, key: "late" })).toBeNull();
	});

	test("hierarchical clear waits for earlier affected writes", async () => {
		const { store, control } = createInMemoryProjectStoreFixture();
		const projectGate = control.pauseNext({ operation: "save-attachment" });
		const attachment = store.saveAttachment({
			projectId: "clear-project",
			key: "media",
			metadata: {},
			body: new Uint8Array([1]).buffer,
		});
		await projectGate.entered;
		let projectsCleared = false;
		const clearProjects = store
			.clear({ scope: { kind: "projects" } })
			.then(() => {
				projectsCleared = true;
			});
		await Promise.resolve();
		expect(projectsCleared).toBe(false);
		projectGate.release();
		await Promise.all([attachment, clearProjects]);
		expect(
			await store.loadAttachment({ projectId: "clear-project", key: "media" }),
		).toBeNull();

		const libraryGate = control.pauseNext({ operation: "save-library-record" });
		const library = store.saveLibraryRecord({
			namespace: "review-library",
			key: "item",
			schemaVersion: 1,
			data: {},
		});
		await libraryGate.entered;
		let namespaceCleared = false;
		const clearNamespace = store
			.clear({ scope: { kind: "library", namespace: "review-library" } })
			.then(() => {
				namespaceCleared = true;
			});
		await Promise.resolve();
		expect(namespaceCleared).toBe(false);
		libraryGate.release();
		await Promise.all([library, clearNamespace]);
		expect(
			await store.loadLibraryRecord({
				namespace: "review-library",
				key: "item",
			}),
		).toBeNull();
	});

	test("collision-shaped attachment identities progress independently", async () => {
		const { store, control } = createInMemoryProjectStoreFixture();
		const gate = control.pauseNext({ operation: "save-attachment" });
		const first = store.saveAttachment({
			projectId: "a:b",
			key: "c",
			metadata: {},
			body: new Uint8Array([1]).buffer,
		});
		await gate.entered;
		let distinctDone = false;
		const distinct = store
			.saveAttachment({
				projectId: "a",
				key: "b:c",
				metadata: {},
				body: new Uint8Array([2]).buffer,
			})
			.then(() => {
				distinctDone = true;
			});
		try {
			await Promise.race([
				distinct,
				new Promise<void>((resolve) => setTimeout(resolve, 50)),
			]);
			expect(distinctDone).toBe(true);
		} finally {
			gate.release();
			await Promise.all([first, distinct]);
		}
	});

	test("complete-browser profile rejects every required skip", async () => {
		const store = new InMemoryProjectStore();
		const profileArgs = {
			ports: createInMemoryPorts({ store }),
			storeFixture: { store },
			storeConformanceProfile: "complete-browser" as const,
		};
		const report = await runPortConformance(profileArgs);
		expect(report.passed).toBe(false);
		expect(
			report.results.some(
				(result) => result.port === "store" && result.status === "skipped",
			),
		).toBe(false);
	});

	test("disposable migration binding rejects a different store and cleanup", async () => {
		const store = new InMemoryProjectStore({
			migrate: async () => ({ status: "not-needed" as const }),
		});
		const otherStore = new InMemoryProjectStore();
		const disposableMigration = {
			identity: "c5-disposable-bound",
			prefix: "c5-disposable-",
			store: otherStore,
			cleanup: {
				identity: "c5-disposable-other",
				store: otherStore,
				run: async () => {},
			},
		};
		const report = await runPortConformance({
			ports: createInMemoryPorts({ store }),
			storeFixture: { store, disposableMigration },
			exerciseMigration: true,
		});
		const migration = report.results.find((result) =>
			result.name.includes("migration"),
		);
		expect(migration?.status).toBe("failed");
		expect(migration?.detail).toMatch(/bound/i);
	});

	test("a migrated outcome without progress is rejected", async () => {
		const store = new InMemoryProjectStore({
			schemaVersion: 2,
			migrate: async (ctx) => {
				if (ctx.from === ctx.to) return { status: "not-needed" as const };
				return {
					status: "migrated" as const,
					from: ctx.from,
					to: ctx.to,
					recordsMigrated: 1,
				};
			},
		});
		const report = await runPortConformance({
			ports: createInMemoryPorts({ store }),
			storeFixture: {
				store,
				disposableMigration: disposableMigrationBinding({
					store,
					identity: "c5-disposable-silent",
				}),
			},
			exerciseMigration: true,
		});
		const migration = report.results.find((result) =>
			result.name.includes("migration"),
		);
		expect(migration?.status).toBe("failed");
		expect(migration?.detail).toMatch(/progress/i);
	});

	test("public store errors retain no raw platform cause", async () => {
		const store = new InMemoryProjectStore();
		let thrown: unknown;
		try {
			await store.saveLibraryRecord({
				namespace: "review",
				key: "uncloneable",
				schemaVersion: 1,
				data: { callback: () => undefined },
			});
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(ProjectStoreError);
		expect(thrown).not.toHaveProperty("cause");
		expect(String(thrown)).not.toMatch(/DataClone|path|database/i);
	});

	test("record and summary identity mismatch fails before commit", async () => {
		const store = new InMemoryProjectStore();
		await expect(
			store.save({
				record: { id: "record", schemaVersion: 1, data: {} },
				summary: {
					id: "summary",
					name: "mismatch",
					createdAt: "2026-08-01T00:00:00.000Z",
					updatedAt: "2026-08-01T00:00:00.000Z",
				},
			}),
		).rejects.toMatchObject({ code: "conflict", operation: "save-project" });
		expect(await store.load({ id: "record" })).toBeNull();
		expect((await store.list()).some((item) => item.id === "summary")).toBe(false);
	});

	test("the shared matrix rejects aliased attachment and library list values", async () => {
		class AliasingListStore extends InMemoryProjectStore {
			private attachmentAliases: ProjectAttachment[] = [];
			private libraryAliases: LibraryRecord[] = [];

			override async listAttachments(args: {
				projectId: string;
				signal?: AbortSignal;
			}) {
				this.attachmentAliases = [
					...(await super.listAttachments(args)),
				];
				return this.attachmentAliases;
			}

			override async loadAttachment(args: {
				projectId: string;
				key: string;
				signal?: AbortSignal;
			}) {
				return (
					this.attachmentAliases.find(
						(item) => item.projectId === args.projectId && item.key === args.key,
					) ?? super.loadAttachment(args)
				);
			}

			override async listLibraryRecords(args: {
				namespace: string;
				signal?: AbortSignal;
			}) {
				this.libraryAliases = [...(await super.listLibraryRecords(args))];
				return this.libraryAliases;
			}

			override async loadLibraryRecord(args: {
				namespace: string;
				key: string;
				signal?: AbortSignal;
			}) {
				return (
					this.libraryAliases.find(
						(item) =>
							item.namespace === args.namespace && item.key === args.key,
					) ?? super.loadLibraryRecord(args)
				);
			}
		}

		const store = new AliasingListStore();
		const report = await runPortConformance({
			ports: createInMemoryPorts({ store }),
		});
		expect(
			report.results.some(
				(result) =>
					result.port === "store" &&
					result.status === "failed" &&
					/list.*alias|alias.*list/i.test(`${result.name} ${result.detail}`),
			),
		).toBe(true);
	});
});

describe("the opaque payload survives what the store does not understand", () => {
	test("provider-private fields round-trip unchanged", async () => {
		const store = new InMemoryProjectStore();
		const data = {
			declared: 1,
			providerPrivate: { vendor: "acme", opts: [1, { deep: null }] },
		};
		await store.save({
			record: { id: "p1", schemaVersion: 1, data },
			summary: {
				id: "p1",
				name: "P1",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		});
		const loaded = await store.load({ id: "p1" });
		expect(loaded?.data).toEqual(data);
	});

	test("a later mutation of the caller's object does not rewrite what was saved", async () => {
		const store = new InMemoryProjectStore();
		const data: { keep: string; mutated?: boolean } = { keep: "yes" };
		await store.save({
			record: { id: "p2", schemaVersion: 1, data },
			summary: {
				id: "p2",
				name: "P2",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		});
		data.mutated = true;
		const loaded = await store.load({ id: "p2" });
		expect(loaded?.data).toEqual({ keep: "yes" });
	});
});

describe("graphics negotiation", () => {
	test("a forced no-rasterizer host yields a zero limit and a stated reason", () => {
		const report = deriveGraphicsReport({
			declaration: { mode: "force", rasterizer: "none" },
			runtime: UNIMPLEMENTED_RUNTIME_GRAPHICS,
		});
		expect(report.rasterizer).toBe("none");
		expect(report.livePreviewLimit).toBe(0);
		expect(report.backend).toBeNull();
		expect(report.rasterizer === "none" && report.reason.length).toBeGreaterThan(
			0,
		);
		expect(report.source).toBe("host-forced");
	});

	test("a forced host is not consulted about the runtime it is running on", () => {
		// The whole point of the force is that it works on hardware that would
		// answer differently — §3.5 needs a constructible no-rasterizer Host
		// without special hardware.
		let consulted = false;
		const runtime: RuntimeGraphicsQuery = {
			selectedBackend: () => {
				consulted = true;
				return "webgpu";
			},
			concurrentCompositorInstances: () => {
				consulted = true;
				return 4;
			},
		};
		deriveGraphicsReport({
			declaration: { mode: "force", rasterizer: "none" },
			runtime,
		});
		expect(consulted).toBe(false);
	});

	test("a DETECTING host on a GPU-less runtime reports no rasterizer", () => {
		// The half M5 was missing. A host that asks for detection, running where no
		// backend can be acquired, must get an honest "none" — not a fabricated
		// "gpu". A report that can only ever say "gpu" is the silent-degradation
		// failure D9's honesty clause exists to prevent, and a no-rasterizer
		// machine is the configuration §3.5 records as never having been tried.
		const report = deriveGraphicsReport({
			declaration: { mode: "detect" },
			runtime: {
				selectedBackend: () => null,
				concurrentCompositorInstances: () => 0,
				unavailableReason: () => "no adapter available",
			},
		});
		expect(report.rasterizer).toBe("none");
		expect(report.backend).toBeNull();
		expect(report.livePreviewLimit).toBe(0);
		expect(report.rasterizer === "none" && report.reason).toBe(
			"no adapter available",
		);
		// Distinguishable from a host-forced none: this one is a measurement.
		expect(report.source).toBe("runtime");
	});

	test("a GPU-less runtime still states a reason when it supplies none", () => {
		const report = deriveGraphicsReport({
			declaration: { mode: "detect" },
			runtime: {
				selectedBackend: () => null,
				concurrentCompositorInstances: () => 0,
			},
		});
		expect(report.rasterizer).toBe("none");
		expect(report.rasterizer === "none" && report.reason.length).toBeGreaterThan(
			0,
		);
	});

	test("a zero preview budget is reported verbatim, not clamped up to one", () => {
		// The sibling of the M5 fabrication, in the more dangerous direction: a
		// runtime with a rasterizer but no drivable compositor instance must not be
		// reported as able to drive one, or a Host trusting the count lays out a
		// surface that cannot render.
		const report = deriveGraphicsReport({
			declaration: { mode: "detect" },
			runtime: {
				selectedBackend: () => "webgl",
				concurrentCompositorInstances: () => 0,
			},
		});
		expect(report.rasterizer).toBe("gpu");
		expect(report.livePreviewLimit).toBe(0);
	});

	test("the unimplemented marker cannot be stamped as a real measurement", () => {
		// The escape hatch that used to exist: a caller passing runtimeSource could
		// label the placeholder "runtime". There is no such parameter now, and the
		// marker travels on the object.
		const report = deriveGraphicsReport({
			declaration: { mode: "detect" },
			runtime: UNIMPLEMENTED_RUNTIME_GRAPHICS,
		});
		expect(report.source).toBe("unimplemented");
	});

	test("the report names the selected backend, as an enumeration", () => {
		const webgl = deriveGraphicsReport({
			declaration: { mode: "detect" },
			runtime: {
				selectedBackend: () => "webgl",
				concurrentCompositorInstances: () => 1,
			},
		});
		expect(webgl.backend).toBe("webgl");
		expect(webgl.livePreviewLimit).toBe(1);

		const webgpu = deriveGraphicsReport({
			declaration: { mode: "detect" },
			runtime: {
				selectedBackend: () => "webgpu",
				concurrentCompositorInstances: () => 2,
			},
		});
		expect(webgpu.backend).toBe("webgpu");
		expect(webgpu.livePreviewLimit).toBe(2);
		// A result that does not record the backend is not evidence about that
		// backend — the two reports above are distinguishable, which is the
		// property §3.6 depends on.
		expect(webgl.backend).not.toBe(webgpu.backend);
	});

	test("the placeholder is visibly unimplemented rather than plausibly wrong", () => {
		const report = deriveGraphicsReport({
			declaration: { mode: "detect" },
			runtime: UNIMPLEMENTED_RUNTIME_GRAPHICS,
		});
		expect(report.source).toBe("unimplemented");
		expect(report.livePreviewLimit).toBe(1);
	});

	test("livePreviewLimit is a count, so a limit above one is expressible", () => {
		const report = deriveGraphicsReport({
			declaration: { mode: "detect" },
			runtime: {
				selectedBackend: () => "webgpu",
				concurrentCompositorInstances: () => 3,
			},
		});
		expect(report.livePreviewLimit).toBe(3);
	});
});

describe("the runtime-resource host constructs what the editor may not", () => {
	test("the editor's requested worker URL is recorded as a request", () => {
		const host = new InMemoryRuntimeResourceHost();
		const handle = host.createWorker({
			request: {
				id: "transcription",
				url: new URL("https://origin-a.invalid/worker.js"),
				type: "module",
			},
		});
		expect(host.requestedWorkerUrls).toEqual([
			"https://origin-a.invalid/worker.js",
		]);
		// The handle carries the logical id, not the location: a Host that served
		// the script from its own origin instead is conforming.
		expect(handle.id).toBe("transcription");
	});
});
