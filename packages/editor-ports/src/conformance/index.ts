/**
 * The port conformance suite.
 *
 * Deliberately a plain async function returning a report, not a test file. An
 * adapter author — C5's second store, E1's Elftia-shaped host — points it at
 * their own implementation and runs it **without modifying it**, under whatever
 * runner they have or none at all. A suite that only existed as `bun test` cases
 * would not be runnable outside this repository, and the two intended future
 * callers are both outside it.
 *
 * Results are per port and per case, so a partial implementation gets a usable
 * answer rather than one boolean.
 */
import type { EditorHostPorts, PortRole } from "../index";
import { PORT_ROLES } from "../index";
import { deriveGraphicsReport, UNIMPLEMENTED_RUNTIME_GRAPHICS } from "../environment";
import type {
	ProjectStore,
	ProjectStoreErrorCode,
	ProjectStoreInspection,
	ProjectStoreOperation,
} from "../project-store";
import { ProjectStoreError } from "../project-store";

export type ConformanceStatus = "passed" | "failed" | "skipped";

export interface ConformanceCaseResult {
	readonly port: PortRole;
	readonly name: string;
	readonly status: ConformanceStatus;
	/** `true` only for `"passed"`. A skipped case is not a passing case. */
	readonly passed: boolean;
	readonly detail?: string;
}

export interface ConformanceReport {
	readonly label: string;
	readonly passed: boolean;
	readonly results: readonly ConformanceCaseResult[];
	readonly byPort: Readonly<
		Record<PortRole, { passed: number; failed: number; skipped: number }>
	>;
}

export interface ProjectStoreConformanceControl {
	setInspection(inspection: ProjectStoreInspection): void;
	failNext(args: {
		operation: ProjectStoreOperation;
		code: ProjectStoreErrorCode;
	}): void;
	pauseNext(args: { operation: ProjectStoreOperation }): {
		readonly entered: Promise<void>;
		release(): void;
	};
}

/**
 * The single adapter seam for the storage matrix.
 *
 * `control` is test-fixture plumbing, not a ProjectStore extension. A browser
 * adapter can implement it by controlling disposable backing adapters; the
 * editor only ever receives `store`.
 */
export interface ProjectStoreConformanceFixture {
	readonly store: ProjectStore;
	readonly control?: ProjectStoreConformanceControl;
	readonly disposableMigration?: {
		readonly identity: string;
		readonly prefix: string;
		readonly store: ProjectStore;
		readonly cleanup: {
			readonly identity: string;
			readonly store: ProjectStore;
			run(): Promise<void>;
		};
	};
}

export type ProjectStoreConformanceProfile = "portable" | "complete-browser";

interface ConformanceProjectPayload {
	knownish: string;
	providerPrivate: {
		vendorField: number;
		nested: { deep: Array<number | string | { three: boolean }> };
	};
	portable: { when: Date; labels: Map<string, number> };
	unicode: string;
}

interface ConformanceAttachmentMetadata {
	private: { keep: string };
	labels: Map<string, number>;
	callerMutation?: boolean;
}

interface ConformanceLibraryData {
	private: { keep: string };
}

function isObject(value: unknown): value is object {
	return typeof value === "object" && value !== null;
}

function assertProjectPayload(
	value: unknown,
): asserts value is ConformanceProjectPayload {
	assert(
		isObject(value) && "knownish" in value,
		"project payload is not an object",
	);
	assert(typeof value.knownish === "string", "knownish is not a string");
	assert(
		"providerPrivate" in value && isObject(value.providerPrivate),
		"provider-private payload is absent",
	);
	assert(
		"vendorField" in value.providerPrivate &&
			typeof value.providerPrivate.vendorField === "number" &&
			"nested" in value.providerPrivate &&
			isObject(value.providerPrivate.nested) &&
			"deep" in value.providerPrivate.nested &&
			Array.isArray(value.providerPrivate.nested.deep),
		"provider-private nested payload is invalid",
	);
	assert(
		"portable" in value &&
			isObject(value.portable) &&
			"when" in value.portable &&
			value.portable.when instanceof Date &&
			"labels" in value.portable &&
			value.portable.labels instanceof Map,
		"structured-clone payload is invalid",
	);
	assert(
		"unicode" in value && typeof value.unicode === "string",
		"unicode is invalid",
	);
}

function assertAttachmentMetadata(
	value: unknown,
): asserts value is ConformanceAttachmentMetadata {
	assert(
		isObject(value) && "private" in value,
		"attachment metadata is absent",
	);
	assert(
		isObject(value.private) &&
			"keep" in value.private &&
			typeof value.private.keep === "string" &&
			"labels" in value &&
			value.labels instanceof Map,
		"attachment metadata is invalid",
	);
}

function assertLibraryData(
	value: unknown,
): asserts value is ConformanceLibraryData {
	assert(isObject(value) && "private" in value, "library data is absent");
	assert(
		isObject(value.private) &&
			"keep" in value.private &&
			typeof value.private.keep === "string",
		"library data is invalid",
	);
}

/**
 * Thrown by a case that does not apply to the implementation under test.
 *
 * Reported as `"skipped"`, never as `"passed"`. A case that executed no
 * assertion and is recorded green is a lie told to whoever reads the report —
 * and C5's second store and E1 read the report, not this repository's tests.
 */
class SkipCase extends Error {}

function skip(reason: string): never {
	throw new SkipCase(reason);
}

class Cases {
	readonly results: ConformanceCaseResult[] = [];

	constructor(private readonly port: PortRole) {}

	async check(name: string, run: () => Promise<void> | void): Promise<void> {
		try {
			await run();
			this.results.push({ port: this.port, name, status: "passed", passed: true });
		} catch (error) {
			if (error instanceof SkipCase) {
				this.results.push({
					port: this.port,
					name,
					status: "skipped",
					passed: false,
					detail: error.message,
				});
				return;
			}
			this.results.push({
				port: this.port,
				name,
				status: "failed",
				passed: false,
				detail: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

export async function runPortConformance(args: {
	ports: EditorHostPorts;
	label?: string;
	storeFixture?: ProjectStoreConformanceFixture;
	storeConformanceProfile?: ProjectStoreConformanceProfile;
	/**
	 * Run the store's real `migrate()`. **Destructive** — point it at a disposable
	 * fixture store, never at one bound to a user's data. Off by default, and the
	 * case reports `skipped` rather than `passed` when it is off.
	 */
	exerciseMigration?: boolean;
}): Promise<ConformanceReport> {
	const { ports } = args;
	const results: ConformanceCaseResult[] = [];

	results.push(
		...(await runProjectStoreConformance({
			fixture: args.storeFixture ?? { store: ports.store },
			exerciseMigration: args.exerciseMigration === true,
			profile: args.storeConformanceProfile ?? "portable",
		})),
	);
	results.push(...(await assetCases(ports)));
	results.push(...(await runtimeResourceCases(ports)));
	results.push(...(await exportCases(ports)));
	results.push(...(await diagnosticsCases(ports)));
	results.push(...(await idCases(ports)));
	results.push(...(await environmentCases(ports)));

	const emptyTally = () => ({ passed: 0, failed: 0, skipped: 0 });
	const byPort: Record<
		PortRole,
		{ passed: number; failed: number; skipped: number }
	> = {
		store: emptyTally(),
		assets: emptyTally(),
		assetLoader: emptyTally(),
		runtimeResources: emptyTally(),
		exporter: emptyTally(),
		diagnostics: emptyTally(),
		ids: emptyTally(),
		environment: emptyTally(),
	};
	for (const result of results) {
		byPort[result.port][result.status] += 1;
	}

	// A role with no cases at all is a FAILURE of the suite, not a pass. Adding a
	// port role and forgetting to write cases for it must go red — the same
	// growth hazard `PORT_ROLE_REGISTER` guards against on the type side.
	const uncovered = PORT_ROLES.filter(
		(role) =>
			byPort[role].passed + byPort[role].failed + byPort[role].skipped === 0,
	);
	for (const role of uncovered) {
		results.push({
			port: role,
			name: "the suite covers this port",
			status: "failed",
			passed: false,
			detail:
				"no conformance case exercises this port role; a green result here would " +
				"assert nothing about it",
		});
		byPort[role].failed += 1;
	}

	return {
		label: args.label ?? "unnamed implementation",
		passed: results.every((r) => r.status !== "failed"),
		results,
		byPort,
	};
}

export async function runProjectStoreConformance(args: {
	fixture: ProjectStoreConformanceFixture;
	exerciseMigration?: boolean;
	profile?: ProjectStoreConformanceProfile;
}): Promise<ConformanceCaseResult[]> {
	const cases = new Cases("store");
	const store = args.fixture.store;
	const control = args.fixture.control;
	const id = `conformance-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const now = new Date().toISOString();

	/**
	 * The payload carries fields the contract has never heard of, nested and of
	 * mixed types. This is the case that decides whether the port is opaque: a
	 * store that normalizes, validates or reshapes would lose them, and losing
	 * them is a Slice stop condition (provider-private round-trip, Target
	 * State §5.6) rather than a defect to fix later.
	 */
	const payload: ConformanceProjectPayload = {
		knownish: "before",
		providerPrivate: {
			vendorField: 42,
			nested: { deep: [1, "two", { three: true }] },
		},
		portable: {
			when: new Date("2026-08-01T00:00:00.000Z"),
			labels: new Map([["private", 7]]),
		},
		unicode: "日本語 — ok",
	};

	await cases.check("declares a schema version", () => {
		assert(
			typeof store.schemaVersion === "number",
			"schemaVersion must be a number",
		);
	});

	await cases.check(
		"a known edit round-trips without losing opaque nested fields",
		async () => {
			await store.save({
				record: { id, schemaVersion: store.schemaVersion, data: payload },
				summary: { id, name: "Conformance", createdAt: now, updatedAt: now },
			});
			const firstLoad = await store.load({ id });
			assert(firstLoad !== null, "load returned null after save");
			assertProjectPayload(firstLoad.data);
			const edited = firstLoad.data;
			edited.knownish = "after";
			await store.save({
				record: { ...firstLoad, data: edited },
				summary: { id, name: "Conformance", createdAt: now, updatedAt: now },
			});
			const loaded = await store.load({ id });
			assert(loaded !== null, "load returned null after save");
			assertProjectPayload(loaded.data);
			assert(
				loaded.data.knownish === "after",
				"the ordinary known edit was not persisted",
			);
			assert(
				JSON.stringify(loaded.data.providerPrivate) ===
					JSON.stringify(payload.providerPrivate),
				`opaque nested fields did not round-trip: ${JSON.stringify(loaded.data)}`,
			);
			assert(
				loaded.data.portable.when instanceof Date &&
					loaded.data.portable.labels instanceof Map &&
					loaded.data.portable.labels.get("private") === 7,
				"opaque data was narrowed to JSON-compatible values",
			);
		},
	);

	await cases.check(
		"project values are defensively cloned in both directions",
		async () => {
			payload.providerPrivate.vendorField = -1;
			payload.portable.labels.set("private", -1);
			const loaded = await store.load({ id });
			assert(loaded !== null, "load returned null");
			assertProjectPayload(loaded.data);
			assert(
				loaded.data !== payload,
				"load returned the caller's own object; a later mutation would rewrite history",
			);
			assert(
				loaded.data.providerPrivate.vendorField === 42,
				"mutating the save input changed durable opaque data",
			);
			assert(
				loaded.data.portable.labels.get("private") === 7,
				"mutating a structured-clone value changed durable opaque data",
			);
			loaded.data.providerPrivate.vendorField = -2;
			loaded.data.portable.labels.set("private", -2);
			const reloaded = await store.load({ id });
			assert(
				reloaded !== null,
				"project disappeared after a load-result mutation",
			);
			assertProjectPayload(reloaded.data);
			assert(
				reloaded.data.providerPrivate.vendorField === 42,
				"mutating a load result changed durable opaque data",
			);
			assert(
				reloaded.data.portable.labels.get("private") === 7,
				"mutating a loaded structured-clone value changed durable data",
			);
		},
	);

	await cases.check("list reports the saved summary", async () => {
		const summaries = await store.list();
		const found = summaries.find((summary) => summary.id === id);
		assert(found !== undefined, "saved project is absent from list()");
		Reflect.set(found, "name", "caller mutation");
		assert(
			(await store.list()).find((summary) => summary.id === id)?.name ===
				"Conformance",
			"mutating a list result changed the stored summary",
		);
	});

	await cases.check("list carries no project content", async () => {
		const summaries = await store.list();
		const found = summaries.find((s) => s.id === id);
		assert(found !== undefined, "summary missing");
		assert(
			!("data" in found),
			"summary carries project content; a host should not deserialize every scene to render a list",
		);
	});

	await cases.check(
		"missing project, attachment, and library values return null",
		async () => {
			assert(
				(await store.load({ id: `${id}-absent` })) === null,
				"expected null for an unknown project",
			);
			assert(
				(await store.loadAttachment({
					projectId: id,
					key: "absent",
				})) === null,
				"expected null for an unknown attachment",
			);
			assert(
				(await store.loadLibraryRecord({
					namespace: `${id}-library`,
					key: "absent",
				})) === null,
				"expected null for an unknown library record",
			);
		},
	);

	await cases.check(
		"record and summary identities match or fail before commit",
		async () => {
			const recordId = `${id}-mismatched-record`;
			const summaryId = `${id}-mismatched-summary`;
			let thrown: unknown;
			try {
				await store.save({
					record: {
						id: recordId,
						schemaVersion: store.schemaVersion,
						data: {},
					},
					summary: {
						id: summaryId,
						name: "mismatched identity",
						createdAt: now,
						updatedAt: now,
					},
				});
			} catch (error) {
				thrown = error;
			}
			assert(
				thrown instanceof ProjectStoreError &&
					(thrown.code === "conflict" || thrown.code === "corrupt"),
				"a mismatched record/summary identity did not return a stable precommit error",
			);
			assert(
				(await store.load({ id: recordId })) === null &&
					!(await store.list()).some((summary) => summary.id === summaryId),
				"a mismatched record/summary identity partially committed",
			);
		},
	);

	await cases.check(
		"attachments save, load, list, replace, and remove exactly",
		async () => {
			const metadata: ConformanceAttachmentMetadata = {
				private: { keep: "attachment" },
				labels: new Map([["private", 3]]),
			};
			const bytes = new Uint8Array([0, 1, 127, 128, 255]);
			await store.saveAttachment({
				projectId: id,
				key: "media",
				metadata,
				body: bytes.buffer,
			});
			metadata.callerMutation = true;
			bytes[0] = 99;
			const loaded = await store.loadAttachment({
				projectId: id,
				key: "media",
			});
			assert(loaded !== null, "attachment was absent after save");
			assertAttachmentMetadata(loaded.metadata);
			const loadedMetadata = loaded.metadata;
			assert(
				loadedMetadata.private.keep === "attachment" &&
					loadedMetadata.callerMutation === undefined &&
					loadedMetadata.labels instanceof Map &&
					loadedMetadata.labels.get("private") === 3,
				"attachment metadata was not defensively structured-cloned",
			);
			assert(
				byteString(loaded.body) === "0,1,127,128,255",
				`attachment bytes changed: ${byteString(loaded.body)}`,
			);
			new Uint8Array(loaded.body)[1] = 88;
			const listed = await store.listAttachments({ projectId: id });
			assert(
				listed.length === 1,
				`expected one listed attachment, got ${listed.length}`,
			);
			assert(
				byteString(listed[0].body) === "0,1,127,128,255",
				"mutating a loaded body changed the listed durable body",
			);
			assertAttachmentMetadata(listed[0].metadata);
			listed[0].metadata.private.keep = "list mutation";
			new Uint8Array(listed[0].body)[0] = 77;
			const afterListMutation = await store.loadAttachment({
				projectId: id,
				key: "media",
			});
			assert(afterListMutation !== null, "attachment disappeared after list mutation");
			assertAttachmentMetadata(afterListMutation.metadata);
			assert(
				afterListMutation.metadata.private.keep === "attachment" &&
					byteString(afterListMutation.body) === "0,1,127,128,255",
				"attachment list returned aliased metadata or body",
			);
			await store.saveAttachment({
				projectId: id,
				key: "media",
				metadata: { replaced: true },
				body: new Uint8Array([7, 8]).buffer,
			});
			const replaced = await store.loadAttachment({
				projectId: id,
				key: "media",
			});
			assert(
				replaced !== null &&
					JSON.stringify(replaced.metadata) ===
						JSON.stringify({ replaced: true }) &&
					byteString(replaced.body) === "7,8",
				"attachment replacement did not commit metadata and bytes together",
			);
			await store.removeAttachment({ projectId: id, key: "media" });
			assert(
				(await store.loadAttachment({ projectId: id, key: "media" })) === null,
				"attachment survived remove",
			);
		},
	);

	await cases.check(
		"attachment scope and project cascade are isolated",
		async () => {
			const projectA = `${id}-a`;
			const projectB = `${id}-b`;
			for (const projectId of [projectA, projectB]) {
				await store.save({
					record: {
						id: projectId,
						schemaVersion: store.schemaVersion,
						data: {},
					},
					summary: {
						id: projectId,
						name: projectId,
						createdAt: now,
						updatedAt: now,
					},
				});
			}
			await store.saveAttachment({
				projectId: projectA,
				key: "shared",
				metadata: { owner: "a" },
				body: new Uint8Array([1]).buffer,
			});
			await store.saveAttachment({
				projectId: projectB,
				key: "shared",
				metadata: { owner: "b" },
				body: new Uint8Array([2]).buffer,
			});
			await store.saveLibraryRecord({
				namespace: `${id}-user`,
				key: "keep",
				schemaVersion: 1,
				data: { durable: true },
			});
			await store.remove({ id: projectA });
			assert(
				(await store.loadAttachment({ projectId: projectA, key: "shared" })) ===
					null,
				"removed project's attachment survived cascade",
			);
			const survivor = await store.loadAttachment({
				projectId: projectB,
				key: "shared",
			});
			assert(
				survivor !== null && byteString(survivor.body) === "2",
				"another project's equal-key attachment was removed",
			);
			assert(
				(await store.load({ id: projectB })) !== null,
				"another project was removed",
			);
			assert(
				(await store.loadLibraryRecord({
					namespace: `${id}-user`,
					key: "keep",
				})) !== null,
				"project removal erased a user-library record",
			);
		},
	);

	await cases.check(
		"libraries save, load, list, replace, remove, and isolate namespaces",
		async () => {
			const namespaceA = `${id}-sounds`;
			const namespaceB = `${id}-presets`;
			const input: { private: { keep: string }; callerMutation?: boolean } = {
				private: { keep: "library" },
			};
			await store.saveLibraryRecord({
				namespace: namespaceA,
				key: "shared",
				schemaVersion: 3,
				data: input,
			});
			await store.saveLibraryRecord({
				namespace: namespaceB,
				key: "shared",
				schemaVersion: 4,
				data: { owner: "b" },
			});
			input.callerMutation = true;
			const loadedA = await store.loadLibraryRecord({
				namespace: namespaceA,
				key: "shared",
			});
			assert(
				loadedA?.schemaVersion === 3 &&
					JSON.stringify(loadedA.data) ===
						JSON.stringify({ private: { keep: "library" } }),
				"library data or schema version did not round-trip defensively",
			);
			assert(loadedA !== null, "library record disappeared after load");
			assertLibraryData(loadedA.data);
			loadedA.data.private.keep = "mutated";
			const listedA = await store.listLibraryRecords({ namespace: namespaceA });
			assert(listedA.length === 1, "library list did not contain one record");
			assertLibraryData(listedA[0].data);
			assert(
				listedA[0].data.private.keep === "library",
				"library list returned aliased or wrong-namespace data",
			);
			listedA[0].data.private.keep = "list mutation";
			const afterListMutation = await store.loadLibraryRecord({
				namespace: namespaceA,
				key: "shared",
			});
			assert(afterListMutation !== null, "library record disappeared after list mutation");
			assertLibraryData(afterListMutation.data);
			assert(
				afterListMutation.data.private.keep === "library",
				"library list returned aliased data",
			);
			await store.saveLibraryRecord({
				namespace: namespaceA,
				key: "shared",
				schemaVersion: 5,
				data: { replaced: true },
			});
			const loadedB = await store.loadLibraryRecord({
				namespace: namespaceB,
				key: "shared",
			});
			assert(
				loadedB?.schemaVersion === 4 &&
					JSON.stringify(loadedB.data) === JSON.stringify({ owner: "b" }),
				"equal key in another namespace was replaced",
			);
			await store.removeLibraryRecord({ namespace: namespaceA, key: "shared" });
			assert(
				(await store.loadLibraryRecord({
					namespace: namespaceA,
					key: "shared",
				})) === null &&
					(await store.loadLibraryRecord({
						namespace: namespaceB,
						key: "shared",
					})) !== null,
				"library removal crossed its namespace",
			);
		},
	);

	await cases.check(
		"capacity zero is distinct from unavailable storage",
		async () => {
			if (!control) skip("adapter fixture does not provide capacity controls");
			control.setInspection({
				availability: "available",
				capacity: { usedBytes: 10, totalBytes: 10, remainingBytes: 0 },
			});
			const zero = await store.inspect();
			assert(
				zero.availability === "available" &&
					zero.capacity?.remainingBytes === 0,
				"a valid zero-byte estimate was collapsed into unavailable",
			);
			control.setInspection({
				availability: "unavailable",
				capacity: null,
				reason: "fixture unavailable",
			});
			const unavailable = await store.inspect();
			assert(
				unavailable.availability === "unavailable" &&
					unavailable.capacity === null,
				"unavailable storage was presented as a capacity estimate",
			);
			control.setInspection({
				availability: "unsupported",
				capacity: null,
				reason: "fixture unsupported",
			});
			const unsupported = await store.inspect();
			assert(
				unsupported.availability === "unsupported" &&
					unsupported.capacity === null,
				"unsupported storage was presented as a capacity estimate",
			);
			control.setInspection({ availability: "available", capacity: null });
		},
	);

	await cases.check(
		"an uncloneable opaque value is a typed corrupt failure",
		async () => {
			let thrown: unknown;
			try {
				await store.saveLibraryRecord({
					namespace: id,
					key: "uncloneable",
					schemaVersion: 1,
					data: { callback: () => undefined },
				});
			} catch (error) {
				thrown = error;
			}
			assert(
				thrown instanceof ProjectStoreError && thrown.code === "corrupt",
				"an uncloneable input escaped the mechanism-neutral error taxonomy",
			);
			assert(
				!("cause" in thrown) &&
					!/(DataClone|database|path)/i.test(`${thrown.name}: ${thrown.message}`),
				"a typed store failure exposed a raw platform cause, name, or path",
			);
			assert(
				(await store.loadLibraryRecord({
					namespace: id,
					key: "uncloneable",
				})) === null,
				"an uncloneable value partially committed",
			);
		},
	);

	await cases.check(
		"typed failures happen before attachment replacement commits",
		async () => {
			if (!control) skip("adapter fixture does not provide failure controls");
			const key = "failure-before-commit";
			await store.saveAttachment({
				projectId: id,
				key,
				metadata: { value: "previous" },
				body: new Uint8Array([4]).buffer,
			});
			for (const code of [
				"quota-exceeded",
				"unavailable",
				"corrupt",
				"conflict",
			] as const) {
				control.failNext({ operation: "save-attachment", code });
				let thrown: unknown;
				try {
					await store.saveAttachment({
						projectId: id,
						key,
						metadata: { value: code },
						body: new Uint8Array([9]).buffer,
					});
				} catch (error) {
					thrown = error;
				}
				assert(
					thrown instanceof ProjectStoreError && thrown.code === code,
					`expected typed ${code} error, got ${String(thrown)}`,
				);
				const previous = await store.loadAttachment({ projectId: id, key });
				assert(
					previous !== null && byteString(previous.body) === "4",
					`${code} exposed a partial replacement`,
				);
			}

			const pause = control.pauseNext({ operation: "save-attachment" });
			const cancellation = new AbortController();
			const replacing = store.saveAttachment({
				projectId: id,
				key,
				metadata: { value: "cancelled" },
				body: new Uint8Array([8]).buffer,
				signal: cancellation.signal,
			});
			await pause.entered;
			cancellation.abort();
			pause.release();
			let cancelled: unknown;
			try {
				await replacing;
			} catch (error) {
				cancelled = error;
			}
			assert(
				cancelled instanceof ProjectStoreError && cancelled.code === "aborted",
				"cancellation before commit did not return the typed aborted failure",
			);
			const afterCancellation = await store.loadAttachment({
				projectId: id,
				key,
			});
			assert(
				afterCancellation !== null &&
					byteString(afterCancellation.body) === "4",
				"cancellation before commit replaced the previous attachment",
			);
		},
	);

	await cases.check("pre-aborted reads and writes do no work", async () => {
		const controller = new AbortController();
		controller.abort();
		for (const run of [
			() => store.load({ id, signal: controller.signal }),
			() =>
				store.saveAttachment({
					projectId: id,
					key: "pre-aborted",
					metadata: {},
					body: new ArrayBuffer(0),
					signal: controller.signal,
				}),
			() =>
				store.saveLibraryRecord({
					namespace: id,
					key: "pre-aborted",
					schemaVersion: 1,
					data: {},
					signal: controller.signal,
				}),
		]) {
			let thrown: unknown;
			try {
				await run();
			} catch (error) {
				thrown = error;
			}
			assert(
				thrown instanceof ProjectStoreError && thrown.code === "aborted",
				"a pre-aborted operation did not reject with the typed aborted code",
			);
		}
		assert(
			(await store.loadAttachment({ projectId: id, key: "pre-aborted" })) ===
				null &&
				(await store.loadLibraryRecord({
					namespace: id,
					key: "pre-aborted",
				})) === null,
			"a pre-aborted write committed a value",
		);
	});

	await cases.check(
		"same-key mutations serialize while distinct keys progress",
		async () => {
			if (!control)
				skip("adapter fixture does not provide scheduling controls");
			const sameGate = control.pauseNext({ operation: "save-attachment" });
			const first = store.saveAttachment({
				projectId: id,
				key: "serial",
				metadata: { order: 1 },
				body: new Uint8Array([1]).buffer,
			});
			await sameGate.entered;
			let secondDone = false;
			const second = store
				.saveAttachment({
					projectId: id,
					key: "serial",
					metadata: { order: 2 },
					body: new Uint8Array([2]).buffer,
				})
				.then(() => {
					secondDone = true;
				});
			await Promise.resolve();
			await Promise.resolve();
			assert(
				!secondDone,
				"a later same-key mutation overtook the paused first mutation",
			);
			sameGate.release();
			await Promise.all([first, second]);
			const serial = await store.loadAttachment({
				projectId: id,
				key: "serial",
			});
			assert(
				serial !== null && byteString(serial.body) === "2",
				"same-key mutations did not commit in invocation order",
			);

			const libraryGate = control.pauseNext({
				operation: "save-library-record",
			});
			const firstLibrary = store.saveLibraryRecord({
				namespace: id,
				key: "serial-library",
				schemaVersion: 1,
				data: { order: 1 },
			});
			await libraryGate.entered;
			let secondLibraryDone = false;
			const secondLibrary = store
				.saveLibraryRecord({
					namespace: id,
					key: "serial-library",
					schemaVersion: 1,
					data: { order: 2 },
				})
				.then(() => {
					secondLibraryDone = true;
				});
			await Promise.resolve();
			assert(
				!secondLibraryDone,
				"a later same-key library mutation overtook the first mutation",
			);
			libraryGate.release();
			await Promise.all([firstLibrary, secondLibrary]);
			const serialLibrary = await store.loadLibraryRecord({
				namespace: id,
				key: "serial-library",
			});
			assert(
				isObject(serialLibrary?.data) &&
					"order" in serialLibrary.data &&
					serialLibrary.data.order === 2,
				"same-key library mutations did not commit in invocation order",
			);

			const distinctGate = control.pauseNext({ operation: "save-attachment" });
			const paused = store.saveAttachment({
				projectId: id,
				key: "distinct-a",
				metadata: {},
				body: new Uint8Array([3]).buffer,
			});
			await distinctGate.entered;
			await store.saveAttachment({
				projectId: id,
				key: "distinct-b",
				metadata: {},
				body: new Uint8Array([4]).buffer,
			});
			assert(
				(await store.loadAttachment({ projectId: id, key: "distinct-b" })) !==
					null,
				"a distinct durable key was blocked by an unrelated mutation",
			);
			distinctGate.release();
			await paused;
		},
	);

	await cases.check(
		"hierarchical mutations preserve invocation order without identity collisions",
		async () => {
			if (!control)
				skip("adapter fixture does not provide scheduling controls");

			const collisionGate = control.pauseNext({
				operation: "save-attachment",
			});
			const collisionFirst = store.saveAttachment({
				projectId: "a:b",
				key: "c",
				metadata: {},
				body: new Uint8Array([1]).buffer,
			});
			await collisionGate.entered;
			await store.saveAttachment({
				projectId: "a",
				key: "b:c",
				metadata: {},
				body: new Uint8Array([2]).buffer,
			});
			assert(
				(await store.loadAttachment({ projectId: "a", key: "b:c" })) !==
					null,
				"collision-shaped logical identities blocked one another",
			);
			collisionGate.release();
			await collisionFirst;

			const removalProject = `${id}-ordered-remove`;
			await store.save({
				record: {
					id: removalProject,
					schemaVersion: store.schemaVersion,
					data: {},
				},
				summary: {
					id: removalProject,
					name: removalProject,
					createdAt: now,
					updatedAt: now,
				},
			});
			const removalGate = control.pauseNext({ operation: "save-attachment" });
			const earlierAttachment = store.saveAttachment({
				projectId: removalProject,
				key: "media",
				metadata: {},
				body: new Uint8Array([3]).buffer,
			});
			await removalGate.entered;
			let removalDone = false;
			const laterRemoval = store.remove({ id: removalProject }).then(() => {
				removalDone = true;
			});
			await Promise.resolve();
			assert(
				!removalDone,
				"project removal overtook an earlier attachment mutation",
			);
			removalGate.release();
			await Promise.all([earlierAttachment, laterRemoval]);
			assert(
				(await store.load({ id: removalProject })) === null &&
					(await store.loadAttachment({
						projectId: removalProject,
						key: "media",
					})) === null,
				"an earlier attachment mutation outlived project removal",
			);

			const projectsClearId = `${id}-ordered-project-clear`;
			const projectGate = control.pauseNext({ operation: "save-project" });
			const attachmentGate = control.pauseNext({
				operation: "save-attachment",
			});
			const earlierProject = store.save({
				record: {
					id: projectsClearId,
					schemaVersion: store.schemaVersion,
					data: {},
				},
				summary: {
					id: projectsClearId,
					name: projectsClearId,
					createdAt: now,
					updatedAt: now,
				},
			});
			const earlierProjectAttachment = store.saveAttachment({
				projectId: projectsClearId,
				key: "media",
				metadata: {},
				body: new Uint8Array([4]).buffer,
			});
			await Promise.all([projectGate.entered, attachmentGate.entered]);
			let projectsClearDone = false;
			const laterProjectsClear = store
				.clear({ scope: { kind: "projects" } })
				.then(() => {
					projectsClearDone = true;
				});
			await Promise.resolve();
			assert(
				!projectsClearDone,
				"project clear overtook earlier project-tree mutations",
			);
			projectGate.release();
			attachmentGate.release();
			await Promise.all([
				earlierProject,
				earlierProjectAttachment,
				laterProjectsClear,
			]);
			assert(
				(await store.load({ id: projectsClearId })) === null &&
					(await store.loadAttachment({
						projectId: projectsClearId,
						key: "media",
					})) === null,
				"project clear left an earlier project-tree mutation behind",
			);

			const namespace = `${id}-ordered-library-clear`;
			const namespaceGate = control.pauseNext({
				operation: "save-library-record",
			});
			const earlierLibrary = store.saveLibraryRecord({
				namespace,
				key: "item",
				schemaVersion: 1,
				data: {},
			});
			await namespaceGate.entered;
			let namespaceClearDone = false;
			const laterNamespaceClear = store
				.clear({ scope: { kind: "library", namespace } })
				.then(() => {
					namespaceClearDone = true;
				});
			await Promise.resolve();
			assert(
				!namespaceClearDone,
				"library namespace clear overtook an earlier record mutation",
			);
			namespaceGate.release();
			await Promise.all([earlierLibrary, laterNamespaceClear]);
			assert(
				(await store.loadLibraryRecord({ namespace, key: "item" })) === null,
				"library namespace clear left an earlier mutation behind",
			);

			const allClearProject = `${id}-ordered-all-clear`;
			const allClearNamespace = `${id}-ordered-all-library`;
			const allProjectGate = control.pauseNext({ operation: "save-project" });
			const allAttachmentGate = control.pauseNext({
				operation: "save-attachment",
			});
			const allLibraryGate = control.pauseNext({
				operation: "save-library-record",
			});
			const allProjectWrite = store.save({
				record: {
					id: allClearProject,
					schemaVersion: store.schemaVersion,
					data: {},
				},
				summary: {
					id: allClearProject,
					name: allClearProject,
					createdAt: now,
					updatedAt: now,
				},
			});
			const allAttachmentWrite = store.saveAttachment({
				projectId: allClearProject,
				key: "media",
				metadata: {},
				body: new Uint8Array([5]).buffer,
			});
			const allLibraryWrite = store.saveLibraryRecord({
				namespace: allClearNamespace,
				key: "item",
				schemaVersion: 1,
				data: {},
			});
			await Promise.all([
				allProjectGate.entered,
				allAttachmentGate.entered,
				allLibraryGate.entered,
			]);
			let allClearDone = false;
			const laterAllClear = store.clear({ scope: { kind: "all" } }).then(() => {
				allClearDone = true;
			});
			await Promise.resolve();
			assert(
				!allClearDone,
				"all clear overtook earlier project, attachment, or library mutations",
			);
			allProjectGate.release();
			allAttachmentGate.release();
			allLibraryGate.release();
			await Promise.all([
				allProjectWrite,
				allAttachmentWrite,
				allLibraryWrite,
				laterAllClear,
			]);
			assert(
				(await store.load({ id: allClearProject })) === null &&
					(await store.loadAttachment({
						projectId: allClearProject,
						key: "media",
					})) === null &&
					(await store.loadLibraryRecord({
						namespace: allClearNamespace,
						key: "item",
					})) === null,
				"all clear left an earlier mutation behind",
			);
		},
	);

	await cases.check(
		"clear scopes preserve their documented boundary",
		async () => {
			const clearProject = `${id}-clear`;
			await store.save({
				record: {
					id: clearProject,
					schemaVersion: store.schemaVersion,
					data: {},
				},
				summary: {
					id: clearProject,
					name: "clear",
					createdAt: now,
					updatedAt: now,
				},
			});
			await store.saveAttachment({
				projectId: clearProject,
				key: "clear",
				metadata: {},
				body: new ArrayBuffer(0),
			});
			await store.saveLibraryRecord({
				namespace: `${id}-clear-library`,
				key: "keep",
				schemaVersion: 1,
				data: {},
			});
			await store.clear({ scope: { kind: "projects" } });
			assert(
				(await store.load({ id: clearProject })) === null &&
					(await store.loadAttachment({
						projectId: clearProject,
						key: "clear",
					})) === null,
				"project clear did not cascade to attachments",
			);
			assert(
				(await store.loadLibraryRecord({
					namespace: `${id}-clear-library`,
					key: "keep",
				})) !== null,
				"project clear erased a library namespace",
			);
			await store.clear({
				scope: { kind: "library", namespace: `${id}-clear-library` },
			});
			assert(
				(await store.loadLibraryRecord({
					namespace: `${id}-clear-library`,
					key: "keep",
				})) === null,
				"library namespace clear left a record behind",
			);
			await store.saveLibraryRecord({
				namespace: `${id}-clear-all`,
				key: "remove",
				schemaVersion: 1,
				data: {},
			});
			await store.clear({ scope: { kind: "all" } });
			assert(
				(await store.loadLibraryRecord({
					namespace: `${id}-clear-all`,
					key: "remove",
				})) === null && (await store.list()).length === 0,
				"all clear left durable records behind",
			);
		},
	);

	/**
	 * Migration is a *store* obligation, and a second store implementation is
	 * required to pass this same suite — so a store could otherwise be fully
	 * "conformant" with a broken or absent `migrate`.
	 *
	 * **Opt-in, because running it is destructive.** `migrate()` performs a real
	 * schema transformation against whatever the store is bound to; invoking it
	 * unconditionally would mean pointing the suite at a browser store and having
	 * it rewrite the user's persisted projects as a side effect of a conformance
	 * run. An adapter author enables it against a disposable fixture store.
	 */
	await cases.check(
		"migration brings the store to its declared version",
		async () => {
			if (!store.migrate)
				skip("this store declares no migration, which is a conforming answer");
			if (!args.exerciseMigration)
				skip(
					"migration is destructive; pass exerciseMigration: true, against a " +
						"disposable fixture store, to run it",
				);
			const disposable = args.fixture.disposableMigration;
			if (!disposable) {
				skip(
					"migration requires a fixture-declared disposable identity and prefix",
				);
			}
			assert(
				disposable.prefix.length > 0,
				"disposable migration prefix is empty",
			);
			assert(
				disposable.identity.startsWith(disposable.prefix) &&
					disposable.identity.length > disposable.prefix.length,
				`migration identity ${disposable.identity} is outside disposable prefix ${disposable.prefix}`,
			);
			assert(
				disposable.store === store &&
					disposable.cleanup.store === store &&
					disposable.cleanup.identity === disposable.identity,
				"disposable migration identity is not bound to the tested store and cleanup",
			);

			const progress: Array<{ completed: number; total: number }> = [];
			const outcome = await store.migrate!({
				from: null,
				to: store.schemaVersion,
				report: (p) =>
					progress.push({ completed: p.completed, total: p.total }),
			});

			// `failed` is NOT conforming here. Accepting it would let a migration that
			// always fails pass the suite, which is worse than having no case at all.
			assert(
				outcome.status !== "failed",
				`migration failed: ${outcome.status === "failed" ? outcome.reason : ""}`,
			);
			assert(
				outcome.status === "migrated" || outcome.status === "not-needed",
				`unknown migration outcome: ${JSON.stringify(outcome)}`,
			);
			if (outcome.status === "migrated") {
				assert(
					outcome.to === store.schemaVersion,
					`migration reported to=${outcome.to} but the store declares ${store.schemaVersion}`,
				);
				assert(
					outcome.recordsMigrated >= 0,
					"recordsMigrated must not be negative",
				);
				assert(progress.length > 0, "a migrated outcome reported no progress");
				assert(
					progress.every(
						(item, index) =>
							item.total > 0 &&
							item.completed >= 0 &&
							item.completed <= item.total &&
							(index === 0 || item.completed >= progress[index - 1].completed),
					),
					"migration progress was invalid or moved backwards",
				);
				const finalProgress = progress[progress.length - 1];
				assert(
					finalProgress.completed === finalProgress.total,
					"migration progress did not report completion",
				);
			}

			// Idempotent: a store already at its declared version does not migrate
			// again. This is what distinguishes a working migration from one that
			// merely returned a plausible value once.
			const second = await store.migrate!({
				from: store.schemaVersion,
				to: store.schemaVersion,
				report: () => {},
			});
			assert(
				second.status === "not-needed",
				`a second migration against an already-current store must be not-needed, got ${second.status}`,
			);
		},
	);

	await cases.check("remove deletes the record and the summary", async () => {
		await store.save({
			record: {
				id,
				schemaVersion: store.schemaVersion,
				data: { remove: true },
			},
			summary: { id, name: "Remove", createdAt: now, updatedAt: now },
		});
		await store.remove({ id });
		assert((await store.load({ id })) === null, "record survived remove()");
		const summaries = await store.list();
		assert(
			!summaries.some((s) => s.id === id),
			"summary survived remove()",
		);
	});

	if (args.profile !== "complete-browser") return cases.results;
	return cases.results.map((result) =>
		result.status === "skipped"
			? {
					...result,
					status: "failed",
					passed: false,
					detail: `required complete-browser case skipped: ${result.detail ?? "no reason"}`,
				}
			: result,
	);
}

function byteString(body: ArrayBuffer): string {
	return [...new Uint8Array(body)].join(",");
}

async function assetCases(
	ports: EditorHostPorts,
): Promise<ConformanceCaseResult[]> {
	const resolverCases = new Cases("assets");
	await resolverCases.check("resolves a logical path to a location", () => {
		const resolved = ports.assets.resolve({
			ref: { path: "fonts/font-atlas.json" },
		});
		assert(
			typeof resolved === "string" && resolved.length > 0,
			"resolve() must return a non-empty location",
		);
	});
	// The name used to promise a root-absoluteness check and the body only
	// asserted `typeof resolved === "string"`. This is the port E0 named as the
	// single blocker for embedding, so the case now makes the check its name
	// claims: a resolver that hard-codes a root-absolute prefix cannot serve a
	// Host mounted under a sub-path, which is the whole point of the role.
	await resolverCases.check("does not hard-code a root-absolute location", () => {
		const resolved = ports.assets.resolve({ ref: { path: "a/b.png" } });
		assert(
			typeof resolved === "string" && resolved.length > 0,
			"resolve() must return a non-empty string for a nested path",
		);
		assert(
			!resolved.startsWith("/"),
			`resolve() returned a root-absolute location (${resolved}); a Host served from a ` +
				"sub-path or a custom scheme cannot satisfy that, which is the assumption this " +
				"port exists to remove",
		);
	});

	const loaderCases = new Cases("assetLoader");
	await loaderCases.check("reports a missing asset as an error", async () => {
		let threw = false;
		try {
			await ports.assetLoader.loadBytes({
				ref: { path: `definitely-absent-${Math.random()}` },
			});
		} catch {
			threw = true;
		}
		assert(
			threw,
			"loading an absent asset resolved; a static host answering 200 text/html to an " +
				"absent path is a measured trap and the loader must not pass it through",
		);
	});

	return [...resolverCases.results, ...loaderCases.results];
}

async function runtimeResourceCases(
	ports: EditorHostPorts,
): Promise<ConformanceCaseResult[]> {
	const cases = new Cases("runtimeResources");
	const host = ports.runtimeResources;

	await cases.check("the host constructs the worker and returns a handle", () => {
		const handle = host.createWorker({
			request: {
				id: "conformance-worker",
				url: new URL("https://example.invalid/worker.js"),
				type: "module",
			},
		});
		assert(handle !== null && typeof handle === "object", "no handle returned");
		assert(
			typeof handle.terminate === "function",
			"worker handle must expose terminate()",
		);
		handle.terminate();
	});

	await cases.check("the worker handle delivers messages", async () => {
		const handle = host.createWorker({
			request: {
				id: "conformance-echo",
				url: new URL("https://example.invalid/worker.js"),
				type: "module",
			},
		});
		const received = await new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error("no message within 1000ms"));
			}, 1000);
			handle.onMessage((event) => {
				clearTimeout(timer);
				resolve(event.data);
			});
			handle.postMessage({ message: { ping: 1 } });
		});
		assert(received !== undefined, "message delivered no data");
		handle.terminate();
	});

	await cases.check("a rewritten worker location is conforming", () => {
		// The contract states the supplied URL is a request, not a guarantee. What
		// is asserted here is only that supplying one does not fail — a Host that
		// serves the script from its own origin instead is conforming, so the suite
		// must not require the location to be honoured.
		const handle = host.createWorker({
			request: {
				id: "conformance-rewrite",
				url: new URL("https://elsewhere.invalid/worker.js"),
				type: "classic",
			},
		});
		assert(handle.id === "conformance-rewrite", "logical id was not preserved");
		handle.terminate();
	});

	await cases.check("an audio context is created and closable", async () => {
		const handle = host.createAudioContext({ request: { sampleRate: 44_100 } });
		assert(
			typeof handle.sampleRate === "number",
			"audio handle must report a sample rate",
		);
		await handle.close();
		assert(handle.state === "closed", "audio handle did not report closed");
	});

	await cases.check("an object URL is created and revocable", () => {
		const handle = host.createObjectUrl({
			blob: new Blob([new Uint8Array([1, 2, 3])]),
		});
		assert(
			typeof handle.url === "string" && handle.url.length > 0,
			"object-url handle must carry a url",
		);
		handle.revoke();
	});

	return cases.results;
}

async function exportCases(
	ports: EditorHostPorts,
): Promise<ConformanceCaseResult[]> {
	const cases = new Cases("exporter");
	const request = { projectId: "conformance", format: "mp4" };

	await cases.check("declares whether it can export", () => {
		assert(
			typeof ports.exporter.canExport({ request }) === "boolean",
			"canExport() must return a boolean",
		);
	});

	await cases.check("an unsupported export says so rather than failing", async () => {
		if (ports.exporter.canExport({ request }))
			skip("this host reports it can export, so the unsupported path is not applicable");
		const outcome = await ports.exporter.export({ request });
		assert(
			outcome.status === "unsupported",
			`a host that cannot export must report "unsupported", got "${outcome.status}"`,
		);
		assert(
			outcome.reason.length > 0,
			"an unsupported outcome must state a reason",
		);
	});

	return cases.results;
}

async function diagnosticsCases(
	ports: EditorHostPorts,
): Promise<ConformanceCaseResult[]> {
	const cases = new Cases("diagnostics");

	await cases.check("accepts a log record", () => {
		ports.diagnostics.log({
			record: { level: "info", message: "conformance", context: { a: 1 } },
		});
	});

	await cases.check("accepts a session-scoped event", () => {
		ports.diagnostics.event({
			sessionId: "conformance-session",
			event: { kind: "migration-started", from: 0, to: 1 },
		});
	});

	return cases.results;
}

async function idCases(
	ports: EditorHostPorts,
): Promise<ConformanceCaseResult[]> {
	const cases = new Cases("ids");

	await cases.check("ids are unique within a scope", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 100; i += 1) {
			seen.add(ports.ids.next({ scope: "conformance" }));
		}
		assert(seen.size === 100, `expected 100 distinct ids, got ${seen.size}`);
	});

	await cases.check("scopes are independent", () => {
		const a = ports.ids.next({ scope: "conformance-a" });
		const b = ports.ids.next({ scope: "conformance-b" });
		assert(a !== b, "two scopes produced the same id");
	});

	return cases.results;
}

async function environmentCases(
	ports: EditorHostPorts,
): Promise<ConformanceCaseResult[]> {
	const cases = new Cases("environment");

	await cases.check("declares a graphics mode", () => {
		const declaration = ports.environment.describeGraphics();
		assert(
			declaration.mode === "detect" || declaration.mode === "force",
			`unknown graphics mode: ${JSON.stringify(declaration)}`,
		);
	});

	await cases.check("the host declares but never asserts the report", () => {
		const declaration = ports.environment.describeGraphics();
		assert(
			!("livePreviewLimit" in declaration) && !("backend" in declaration),
			"a graphics declaration must not carry report fields; the runtime produces the report",
		);
	});

	/**
	 * The no-rasterizer case, run against *this* implementation's declaration
	 * only when it forces one — a detecting Host has nothing to force. The
	 * unconditional version of this case lives in the suite's own tests, where a
	 * forcing Host is constructed on purpose.
	 */
	await cases.check("a forced no-rasterizer declaration yields a zero limit", () => {
		const declaration = ports.environment.describeGraphics();
		if (declaration.mode !== "force")
			skip("this host declares detect mode, so there is no force to check");
		const report = deriveGraphicsReport({
			declaration,
			runtime: UNIMPLEMENTED_RUNTIME_GRAPHICS,
		});
		assert(report.rasterizer === "none", "forced host reported a rasterizer");
		assert(
			report.livePreviewLimit === 0,
			`forced host reported livePreviewLimit ${report.livePreviewLimit}`,
		);
		assert(
			"reason" in report && report.reason.length > 0,
			"a no-rasterizer report must state a reason",
		);
	});

	return cases.results;
}

export function formatConformanceReport(report: ConformanceReport): string {
	const lines: string[] = [
		`conformance: ${report.label} — ${report.passed ? "PASS" : "FAIL"}`,
	];
	for (const role of PORT_ROLES) {
		const tally = report.byPort[role];
		lines.push(
			`  ${tally.failed === 0 ? "PASS" : "FAIL"}  ${role}: ${tally.passed} passed, ` +
				`${tally.failed} failed, ${tally.skipped} skipped`,
		);
	}
	for (const result of report.results) {
		if (result.status === "passed") continue;
		lines.push(
			`    ${result.status === "failed" ? "FAIL" : "SKIP"}  ${result.port} / ${result.name}: ${result.detail ?? ""}`,
		);
	}
	return lines.join("\n");
}
