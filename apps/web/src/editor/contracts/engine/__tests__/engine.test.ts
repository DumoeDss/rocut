import { describe, expect, test } from "bun:test";
import type { Project, TransactionBatch } from "../..";
import {
	assetId,
	clipId,
	mediaTime,
	markerId,
	projectId,
	revisionOf,
	trackId,
	TransactionError,
} from "../..";
import type { ProjectRecord } from "@/editor/ports";
import { ProjectStoreError } from "@/editor/ports";
import { createInMemoryProjectStoreFixture } from "@/editor/ports/in-memory";
import type { TransactionDocumentAdapter } from "../adapter";
import type {
	TransactionEngineConformanceFactory,
	TransactionEngineConformanceFactoryOptions,
	TransactionEngineConformanceFixture,
} from "../conformance";
import { runTransactionEngineConformance } from "../conformance";
import { canonicalOperationFingerprint } from "../clone";
import type { TransactionEngine } from "../types";
import {
	createTransactionNativeDocumentAdapter,
	createTransactionNativeProjectSeed,
} from "../native-adapter";
import { openTransactionEngine } from "../engine";

const PROJECT_ID = "engine-project";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function project(): Project {
	return {
		id: projectId(PROJECT_ID),
		name: "Transaction engine",
		frameRate: { numerator: 30, denominator: 1 },
		canvasWidth: 1920,
		canvasHeight: 1080,
	};
}

type FactoryFeature = "provider-ripple-edit";
const FACTORY_OPTIONAL_FEATURES = { "provider-ripple-edit": true } as const;

async function placementCompatibleContractBatch<
	FeatureName extends string,
>(args: {
	readonly engine: TransactionEngine<FeatureName>;
	readonly batch: TransactionBatch;
}): Promise<TransactionBatch> {
	// T0 intentionally knows nothing about placement and creates asset-less
	// media tracks plus overlapping sample clips. Its unchanged interface suite
	// therefore runs through a test-only input composer that makes those samples
	// valid for T1; the real project/frame/lane/collision policy remains enabled.
	const { engine, batch } = args;
	const trackEnds = new Map<string, number>();
	for (const existing of await engine.clips()) {
		trackEnds.set(
			existing.trackId,
			Math.max(
				trackEnds.get(existing.trackId) ?? 0,
				Number(existing.startTime) + Number(existing.duration),
			),
		);
	}
	return {
		...batch,
		operations: batch.operations.map((operation) => {
			if (operation.kind === "create-track") {
				return {
					...operation,
					track: { ...operation.track, kind: "graphic" as const },
				};
			}
			if (operation.kind !== "create-clip") return operation;
			const start = Math.max(
				Number(operation.clip.startTime),
				trackEnds.get(operation.clip.trackId) ?? 0,
			);
			trackEnds.set(
				operation.clip.trackId,
				start + Number(operation.clip.duration),
			);
			return {
				...operation,
				clip: {
					...operation.clip,
					startTime: mediaTime({ ticks: start }),
				},
			};
		}),
	};
}

function composeContractProfile<FeatureName extends string>(
	engine: TransactionEngine<FeatureName>,
): TransactionEngine<FeatureName> {
	return new Proxy(engine, {
		get(target, property) {
			if (property === "apply") {
				return async (batch: TransactionBatch) =>
					target.apply(
						await placementCompatibleContractBatch({ engine: target, batch }),
					);
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

function decorateEngine<FeatureName extends string>(args: {
	readonly engine: TransactionEngine<FeatureName>;
	readonly mutation:
		| "none"
		| "dry-run-mutates"
		| "premature-publication"
		| "false-capability";
}): TransactionEngine<FeatureName> {
	const { engine, mutation } = args;
	if (mutation === "none") return engine;
	if (mutation === "dry-run-mutates") {
		return new Proxy(engine, {
			get(target, property) {
				if (property === "dryRun") {
					return async (batch: TransactionBatch) => ({
						accepted: true as const,
						baseRevision: await target.revision(),
						result: await target.apply(batch),
						replayed: false,
					});
				}
				const value = Reflect.get(target, property, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
	}
	if (mutation === "false-capability") {
		return new Proxy(engine, {
			get(target, property) {
				if (property === "capabilities") {
					return async () => ({
						...(await target.capabilities()),
						"cross-engine-cas": true,
					});
				}
				const value = Reflect.get(target, property, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
	}
	const earlyWatchers = new Set<
		(revision: ReturnType<typeof revisionOf>) => void
	>();
	return new Proxy(engine, {
		get(target, property) {
			if (property === "watch") {
				return (
					callback: (revision: ReturnType<typeof revisionOf>) => void,
				) => {
					earlyWatchers.add(callback);
					return () => earlyWatchers.delete(callback);
				};
			}
			if (property === "apply") {
				return async (batch: TransactionBatch) => {
					const projected = revisionOf(Number(await target.revision()) + 1);
					for (const watcher of earlyWatchers) watcher(projected);
					return target.apply(batch);
				};
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

function createFactory<FeatureName extends string = FactoryFeature>(
	options: {
		readonly loseOpaque?: boolean;
		readonly mutation?:
			| "none"
			| "dry-run-mutates"
			| "premature-publication"
			| "false-capability";
	} = {},
): TransactionEngineConformanceFactory<FeatureName> {
	return async (
		factoryOptions: TransactionEngineConformanceFactoryOptions<FeatureName> = {},
	): Promise<TransactionEngineConformanceFixture<FeatureName>> => {
		const { store, control } = createInMemoryProjectStoreFixture();
		const seed = createTransactionNativeProjectSeed({
			projectId: PROJECT_ID,
			project: project(),
			opaque: factoryOptions.opaque,
		});
		await store.save(seed);
		let saves = 0;
		const originalSave = store.save.bind(store);
		store.save = async (args) => {
			saves += 1;
			return originalSave(args);
		};

		const nativeAdapter = createTransactionNativeDocumentAdapter({
			now: () => "2026-01-01T00:00:01.000Z",
		});
		const adapter: TransactionDocumentAdapter = options.loseOpaque
			? {
					decode: nativeAdapter.decode,
					encode(args) {
						return nativeAdapter.encode({
							...args,
							previousRecord: { ...args.previousRecord, data: {} },
						});
					},
				}
			: nativeAdapter;
		const open = async (): Promise<TransactionEngine<FeatureName>> => {
			const opened = await openTransactionEngine<FeatureName>({
				store,
				projectId: PROJECT_ID,
				documentAdapter: adapter,
				placementPolicies: factoryOptions.placementPolicies,
				optionalFeatures: factoryOptions.optionalFeatures,
			});
			return decorateEngine({
				engine:
					factoryOptions.profile === "contract"
						? composeContractProfile(opened)
						: opened,
				mutation: options.mutation ?? "none",
			});
		};
		const engine = await open();
		return {
			engine,
			reopen: open,
			async readPersistedRecord(): Promise<ProjectRecord> {
				const loaded = await store.load({ id: PROJECT_ID });
				if (!loaded) throw new Error("persisted record disappeared");
				return loaded;
			},
			saveCount: () => saves,
			failNextSave: () =>
				control.failNext({ operation: "save-project", code: "quota-exceeded" }),
			pauseNextSave: () => control.pauseNext({ operation: "save-project" }),
		};
	};
}

function textTrack(id: string) {
	return { id: trackId(id), kind: "text" as const, name: id, hidden: false };
}

function videoTrack(id: string) {
	return { id: trackId(id), kind: "video" as const, name: id, hidden: false };
}

function audioTrack(id: string) {
	return { id: trackId(id), kind: "audio" as const, name: id, hidden: false };
}

function asset(args: {
	readonly id: string;
	readonly kind: "video" | "image" | "audio";
	readonly duration?: number;
}) {
	const { id, kind, duration = 12_000 } = args;
	return {
		id: assetId(id),
		kind,
		name: id,
		duration: mediaTime({ ticks: duration }),
	};
}

function clip(args: {
	readonly id: string;
	readonly track: string;
	readonly start?: number;
	readonly duration?: number;
	readonly trimStart?: number;
	readonly trimEnd?: number;
	readonly asset?: string;
}) {
	return {
		id: clipId(args.id),
		trackId: trackId(args.track),
		startTime: mediaTime({ ticks: args.start ?? 0 }),
		duration: mediaTime({ ticks: args.duration ?? 4_000 }),
		trimStart: mediaTime({ ticks: args.trimStart ?? 0 }),
		trimEnd: mediaTime({ ticks: args.trimEnd ?? 0 }),
		...(args.asset ? { assetId: assetId(args.asset) } : {}),
	};
}

describe("ProjectStore-backed transaction engine", () => {
	test("passes the reusable T0 + T1 conformance matrix", async () => {
		const report = await runTransactionEngineConformance(
			createFactory(),
			FACTORY_OPTIONAL_FEATURES,
		);
		if (!report.passed) {
			throw new Error(
				report.results
					.filter((entry) => entry.status === "failed")
					.map((entry) => `${entry.name}: ${entry.detail}`)
					.join("\n"),
			);
		}
		expect(report.summary.failed).toBe(0);
		// T0 retains its intentional SkipCase demonstration and T1 carries a
		// deliberate zero-assertion control proving vacuous cases cannot pass.
		expect(report.summary.skipped).toBe(2);
		expect(
			report.results.some(
				(entry) =>
					entry.name === "T1: zero-assertion control is skipped" &&
					entry.status === "skipped",
			),
		).toBe(true);
		expect(report.summary.passed).toBeGreaterThan(20);
	});

	test("isolates assertion accounting across concurrent conformance runs", async () => {
		const factory = createFactory();
		const reports = await Promise.all([
			runTransactionEngineConformance(factory, FACTORY_OPTIONAL_FEATURES),
			runTransactionEngineConformance(factory, FACTORY_OPTIONAL_FEATURES),
		]);
		const expectedStatuses = reports[0]?.results.map(({ name, status }) => ({
			name,
			status,
		}));
		const zeroAssertionCases = [
			"T0: a case that executed no assertion is skipped",
			"T1: zero-assertion control is skipped",
		];

		for (const report of reports) {
			expect(report.passed).toBe(true);
			expect(report.summary).toEqual({ passed: 32, failed: 0, skipped: 2 });
			expect(
				report.results.map(({ name, status }) => ({ name, status })),
			).toEqual(expectedStatuses);
			for (const name of zeroAssertionCases) {
				expect(
					report.results.find((entry) => entry.name === name)?.status,
				).toBe("skipped");
			}
		}
	});

	test("runs conformance with an arbitrary literal provider feature", async () => {
		type CustomFeature = "provider-custom-feature";
		const customFactory: TransactionEngineConformanceFactory<CustomFeature> =
			createFactory<CustomFeature>();
		// The original one-argument API remains generic even when no runtime
		// optional-feature witness is supplied.
		const runWithoutFeatureWitness = () =>
			runTransactionEngineConformance(customFactory);
		const reportWithoutFeatureWitness = await runWithoutFeatureWitness();
		const report = await runTransactionEngineConformance(customFactory, {
			"provider-custom-feature": true,
		});

		expect(reportWithoutFeatureWitness.passed).toBe(true);
		expect(
			reportWithoutFeatureWitness.results.find(
				(entry) =>
					entry.name ===
					"T1: base and configured optional capabilities are honest",
			)?.status,
		).toBe("passed");
		expect(report.passed).toBe(true);
		expect(report.summary).toEqual({ passed: 32, failed: 0, skipped: 2 });
		expect(
			report.results.find(
				(entry) =>
					entry.name ===
					"T1: base and configured optional capabilities are honest",
			)?.status,
		).toBe("passed");
	});

	test("canonical replay distinguishes an omitted patch from explicit clearing", async () => {
		const fixture = await createFactory()({ profile: "engine" });
		await fixture.engine.apply({
			operations: [
				{
					kind: "create-track",
					track: {
						...textTrack("canonical-track"),
						kind: "graphic",
					},
				},
				{
					kind: "create-asset",
					asset: asset({ id: "canonical-asset", kind: "image" }),
				},
				{
					kind: "create-clip",
					clip: clip({
						id: "canonical-clip",
						track: "canonical-track",
						asset: "canonical-asset",
					}),
				},
			],
		});
		const omitted = [
			{
				kind: "update-clip" as const,
				clipId: clipId("canonical-clip"),
				patch: {},
			},
		];
		const clearing = [
			{
				kind: "update-clip" as const,
				clipId: clipId("canonical-clip"),
				patch: { assetId: undefined },
			},
		];
		expect(canonicalOperationFingerprint(omitted)).not.toBe(
			canonicalOperationFingerprint(clearing),
		);
		const cyclic = [{ ...omitted[0], patch: {} }];
		const cyclicPatch: Record<string, unknown> = {};
		cyclicPatch.self = cyclicPatch;
		Reflect.set(cyclic[0], "patch", cyclicPatch);
		expect(() => canonicalOperationFingerprint(cyclic)).toThrow(
			"must not contain cycles",
		);
		const nonFinite = [{ ...omitted[0], patch: {} }];
		Reflect.set(nonFinite[0], "patch", { duration: Number.NaN });
		expect(() => canonicalOperationFingerprint(nonFinite)).toThrow(
			"require finite numbers",
		);
		await fixture.engine.apply({
			operations: omitted,
			idempotencyKey: "canonical-clear-key",
		});
		let collision: unknown;
		try {
			await fixture.engine.apply({
				operations: clearing,
				idempotencyKey: "canonical-clear-key",
			});
		} catch (error) {
			collision = error;
		}
		if (!(collision instanceof TransactionError)) throw collision;
		expect(collision.code).toBe("duplicate");
		expect((await fixture.engine.clips())[0]?.assetId).toBe(
			assetId("canonical-asset"),
		);
	});

	test("accepted entity, update, and keyed values survive every reopen", async () => {
		const fixture = await createFactory()({ profile: "engine" });
		await fixture.engine.apply({
			operations: [
				{
					kind: "create-track",
					track: {
						...textTrack("roundtrip-track"),
						kind: "graphic",
					},
				},
				{
					kind: "create-asset",
					asset: {
						id: assetId("dimensioned-asset"),
						kind: "image",
						name: "Dimensioned asset",
						duration: mediaTime({ ticks: 0 }),
						width: 1,
						height: 1,
					},
				},
				{
					kind: "create-asset",
					asset: asset({ id: "linked-asset", kind: "image" }),
				},
				{
					kind: "create-clip",
					clip: clip({
						id: "roundtrip-clip",
						track: "roundtrip-track",
						asset: "linked-asset",
					}),
				},
				{
					kind: "create-marker",
					marker: {
						id: markerId("roundtrip-marker"),
						time: mediaTime({ ticks: 0 }),
						note: "note",
						color: "",
					},
				},
			],
			idempotencyKey: "roundtrip-create-key",
		});
		const reopened = await fixture.reopen();
		await reopened.apply({
			operations: [
				{
					kind: "update-track",
					trackId: trackId("roundtrip-track"),
					patch: { name: "Renamed track" },
				},
				{
					kind: "update-clip",
					clipId: clipId("roundtrip-clip"),
					patch: { assetId: undefined },
				},
				{
					kind: "update-marker",
					markerId: markerId("roundtrip-marker"),
					patch: { note: undefined, color: "" },
				},
			],
			idempotencyKey: "roundtrip-update-key",
		});
		const reopenedAgain = await fixture.reopen();
		expect((await reopenedAgain.tracks())[0]?.name).toBe("Renamed track");
		expect((await reopenedAgain.clips())[0]?.assetId).toBeUndefined();
		expect((await reopenedAgain.assets()).length).toBe(2);
		expect((await reopenedAgain.markers())[0]?.color).toBe("");
		expect(Number(await reopenedAgain.revision())).toBe(2);
	});

	test("non-reopenable entity and idempotency values are rejected before save", async () => {
		const scenarios: Array<{
			readonly name: string;
			readonly batch: TransactionBatch;
		}> = [
			{
				name: "empty track name",
				batch: {
					operations: [
						{
							kind: "create-track",
							track: { ...textTrack("empty-track"), name: "" },
						},
					],
				},
			},
			{
				name: "empty asset name",
				batch: {
					operations: [
						{
							kind: "create-asset",
							asset: {
								...asset({ id: "empty-asset", kind: "image" }),
								name: "",
							},
						},
					],
				},
			},
			{
				name: "zero asset width",
				batch: {
					operations: [
						{
							kind: "create-asset",
							asset: {
								...asset({ id: "zero-width", kind: "image" }),
								width: 0,
							},
						},
					],
				},
			},
			{
				name: "empty idempotency key",
				batch: {
					operations: [{ kind: "create-track", track: textTrack("empty-key") }],
					idempotencyKey: "",
				},
			},
		];
		for (const scenario of scenarios) {
			const fixture = await createFactory()({ profile: "engine" });
			const outcome = await fixture.engine.validate(scenario.batch);
			expect(outcome.valid, scenario.name).toBe(false);
			let failure: unknown;
			try {
				await fixture.engine.apply(scenario.batch);
			} catch (error) {
				failure = error;
			}
			expect(failure, scenario.name).toBeInstanceOf(TransactionError);
			expect(fixture.saveCount(), scenario.name).toBe(0);
			await fixture.reopen();
		}
	});

	test("projectless documents enforce base placement and require a frame rate", async () => {
		const { store } = createInMemoryProjectStoreFixture();
		await store.save(
			createTransactionNativeProjectSeed({ projectId: PROJECT_ID }),
		);
		const engine = await openTransactionEngine({
			store,
			projectId: PROJECT_ID,
			documentAdapter: createTransactionNativeDocumentAdapter(),
		});
		await engine.apply({
			operations: [
				{ kind: "create-track", track: textTrack("projectless-track") },
			],
		});
		const outcome = await engine.validate({
			operations: [
				{
					kind: "create-clip",
					clip: clip({
						id: "projectless-zero",
						track: "projectless-track",
						duration: 0,
					}),
				},
			],
		});
		expect(outcome.valid).toBe(false);
		if (!outcome.valid) {
			expect(
				outcome.issues.some((entry) => entry.code === "non-positive-duration"),
			).toBe(true);
			expect(
				outcome.issues.some((entry) => entry.code === "timebase-misaligned"),
			).toBe(true);
		}
		expect((await engine.clips()).length).toBe(0);
	});

	test("negative targets fail named conformance cases", async () => {
		const targets = [
			{
				factory: createFactory({ loseOpaque: true }),
				name: "T1: opaque provider fields survive adapter round-trip",
			},
			{
				factory: createFactory({ mutation: "premature-publication" }),
				name: "T1: save failure publishes nothing and the queue recovers",
			},
			{
				factory: createFactory({ mutation: "dry-run-mutates" }),
				name: "T1: validation and dry-run are structured and pure",
			},
			{
				factory: createFactory({ mutation: "false-capability" }),
				name: "T1: base and configured optional capabilities are honest",
			},
		];
		for (const target of targets) {
			const report = await runTransactionEngineConformance(
				target.factory,
				FACTORY_OPTIONAL_FEATURES,
			);
			expect(
				report.results.some(
					(entry) => entry.name === target.name && entry.status === "failed",
				),
			).toBe(true);
		}
	});

	test("placement reports every base rule and accepts adjacent intervals", async () => {
		const fixture = await createFactory()({ profile: "engine" });
		await fixture.engine.apply({
			operations: [
				{ kind: "create-track", track: textTrack("text") },
				{ kind: "create-track", track: videoTrack("video") },
				{ kind: "create-track", track: audioTrack("audio") },
				{
					kind: "create-asset",
					asset: asset({ id: "video-asset", kind: "video" }),
				},
				{
					kind: "create-asset",
					asset: asset({ id: "audio-asset", kind: "audio" }),
				},
				{
					kind: "create-clip",
					clip: clip({
						id: "existing",
						track: "text",
						start: 0,
						duration: 4_000,
					}),
				},
			],
		});

		const scenarios: Array<{ batch: TransactionBatch; code: string }> = [
			{
				batch: {
					operations: [
						{
							kind: "create-clip",
							clip: clip({ id: "zero", track: "text", duration: 0 }),
						},
					],
				},
				code: "non-positive-duration",
			},
			{
				batch: {
					operations: [
						{
							kind: "create-marker",
							marker: {
								id: markerId("misaligned"),
								time: mediaTime({ ticks: 1 }),
							},
						},
					],
				},
				code: "timebase-misaligned",
			},
			{
				batch: {
					operations: [
						{
							kind: "create-clip",
							clip: clip({ id: "collision", track: "text", start: 0 }),
						},
					],
				},
				code: "collision",
			},
			{
				batch: {
					operations: [
						{
							kind: "create-clip",
							clip: clip({ id: "lane", track: "video", asset: "audio-asset" }),
						},
					],
				},
				code: "lane-incompatible",
			},
			{
				batch: {
					operations: [
						{
							kind: "create-clip",
							clip: clip({
								id: "bounds",
								track: "video",
								asset: "video-asset",
								duration: 12_000,
								trimEnd: 4_000,
							}),
						},
					],
				},
				code: "source-out-of-bounds",
			},
			{
				batch: {
					operations: [
						{
							kind: "create-clip",
							clip: clip({ id: "missing", track: "absent" }),
						},
					],
				},
				code: "missing-relation",
			},
		];
		for (const scenario of scenarios) {
			const result = await fixture.engine.validate(scenario.batch);
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(
					result.issues.some((entry) => entry.code === scenario.code),
				).toBe(true);
			}
		}

		const adjacent = await fixture.engine.dryRun({
			operations: [
				{
					kind: "create-clip",
					clip: clip({ id: "adjacent", track: "text", start: 4_000 }),
				},
			],
		});
		expect(adjacent.accepted).toBe(true);
	});

	test("dry-run conflicts are pure and do not reserve an idempotency key", async () => {
		const fixture = await createFactory()({ profile: "engine" });
		const stale = await fixture.engine.dryRun({
			operations: [{ kind: "create-track", track: videoTrack("stale") }],
			expectedRevision: revisionOf(1),
			idempotencyKey: "available-after-dry-run",
		});
		expect(stale.accepted).toBe(false);
		if (!stale.accepted) {
			expect(stale.issues[0]?.code).toBe("expected-revision-conflict");
		}
		const applied = await fixture.engine.apply({
			operations: [{ kind: "create-track", track: videoTrack("corrected") }],
			expectedRevision: revisionOf(0),
			idempotencyKey: "available-after-dry-run",
		});
		expect(Number(applied.revision)).toBe(1);
	});

	test("reads are defensive and unsubscribe is idempotent", async () => {
		const fixture = await createFactory()({ profile: "engine" });
		await fixture.engine.apply({
			operations: [{ kind: "create-track", track: videoTrack("clone") }],
		});
		const tracks = await fixture.engine.tracks();
		if (!tracks[0]) throw new Error("clone track was not committed");
		Reflect.set(tracks[0], "name", "mutated");
		expect((await fixture.engine.tracks())[0]?.name).toBe("clone");
		let calls = 0;
		const unsubscribe = fixture.engine.watch(() => {
			calls += 1;
		});
		unsubscribe();
		unsubscribe();
		await fixture.engine.apply({
			operations: [
				{ kind: "create-track", track: videoTrack("after-unsubscribe") },
			],
		});
		expect(calls).toBe(0);
	});

	test("invalid persisted state is sanitized as load-project corruption", async () => {
		const { store } = createInMemoryProjectStoreFixture();
		const seed = createTransactionNativeProjectSeed({
			projectId: PROJECT_ID,
			project: project(),
		});
		const data = seed.record.data;
		if (!isRecord(data) || !isRecord(data.transactionEngine)) {
			throw new Error("native seed did not contain a transaction document");
		}
		const transactionEngine = data.transactionEngine;
		await store.save({
			record: {
				...seed.record,
				data: {
					...data,
					transactionEngine: { ...transactionEngine, revision: -1 },
				},
			},
			summary: seed.summary,
		});
		let failure: unknown;
		try {
			await openTransactionEngine({
				store,
				projectId: PROJECT_ID,
				documentAdapter: createTransactionNativeDocumentAdapter(),
			});
		} catch (error) {
			failure = error;
		}
		if (!(failure instanceof ProjectStoreError)) throw failure;
		expect(failure.code).toBe("corrupt");
		expect(failure.operation).toBe("load-project");
		expect(failure.message).not.toContain("-1");
	});

	test("apply exposes the first placement issue as TransactionError validation", async () => {
		const fixture = await createFactory()({ profile: "engine" });
		await fixture.engine.apply({
			operations: [
				{ kind: "create-track", track: textTrack("apply-placement") },
			],
		});
		let failure: unknown;
		try {
			await fixture.engine.apply({
				operations: [
					{
						kind: "create-clip",
						clip: clip({
							id: "apply-invalid",
							track: "apply-placement",
							duration: 0,
						}),
					},
				],
			});
		} catch (error) {
			failure = error;
		}
		if (!(failure instanceof TransactionError)) throw failure;
		expect(failure.code).toBe("validation");
		expect(failure.operationIndex).toBe(0);
	});
});
