import { describe, expect, test } from "bun:test";
import type { Project, ProjectPatch, Revision, TransactionBatch } from "../..";
import {
	assetId,
	clipId,
	markerId,
	mediaTime,
	projectId,
	revisionOf,
	trackId,
	TransactionError,
} from "../..";
import type {
	TransactionEngine,
	TransactionEngineOptionalFeatures,
	TransactionPlacementPolicy,
} from "../../engine";
import {
	createTransactionNativeDocumentAdapter,
	createTransactionNativeProjectSeed,
	evaluateTransactionBatch,
	openTransactionEngine,
} from "../../engine";
import * as engineImplementation from "../../engine/engine";
import { bindNativeCommittedTransactionStateCapture } from "../../engine/engine";
import * as projectionImplementation from "../../engine/projection";
import { createInMemoryProjectStoreFixture } from "@opencut/editor-ports/in-memory";
import { ProjectStoreError } from "@opencut/editor-ports";
import type {
	DraftEditingConformanceFactory,
	DraftEditingConformanceFactoryOptions,
	DraftEditingConformanceFixture,
} from "../conformance";
import { runDraftEditingConformance } from "../conformance";
import { createDraftEditingManager } from "../manager";
import {
	hasSameDraftContent,
	planDraftCompensatingOperations,
} from "../inverse";
import { createInMemoryDraftResourceRetentionPolicy } from "../retention";
import type { InMemoryDraftResourceRetentionPolicy } from "../retention";
import type {
	DraftEditingManager,
	DraftCommittedStateCapture,
	DraftResourceRetentionPolicy,
} from "../types";

const PROJECT_ID = "draft-project";
type FactoryFeature = "provider-draft-placement";
const OPTIONAL_FEATURES = { "provider-draft-placement": true } as const;

function project(): Project {
	return {
		id: projectId(PROJECT_ID),
		name: "Draft tests",
		frameRate: { numerator: 30, denominator: 1 },
		canvasWidth: 1920,
		canvasHeight: 1080,
	};
}

type Mutation =
	| "none"
	| "premature-stage"
	| "accept-immediate"
	| "bypass-retention";

interface DraftTestFixture<
	FeatureName extends string = string,
> extends DraftEditingConformanceFixture<FeatureName> {
	readonly committedState: DraftCommittedStateCapture;
	readonly retention: InMemoryDraftResourceRetentionPolicy;
}

type DraftTestFactory<FeatureName extends string = string> = (
	options?: DraftEditingConformanceFactoryOptions<FeatureName>,
) => Promise<DraftTestFixture<FeatureName>>;

function bindEngine<FeatureName extends string>(args: {
	readonly engine: TransactionEngine<FeatureName>;
	readonly revisions?: readonly Revision[];
	readonly onApply: () => void;
}): TransactionEngine<FeatureName> {
	const revisions = [...(args.revisions ?? [])];
	return new Proxy(args.engine, {
		get(target, property) {
			if (property === "revision" && revisions.length > 0) {
				return async () => revisions.shift() ?? target.revision();
			}
			if (property === "apply") {
				return async (batch: TransactionBatch) => {
					args.onApply();
					return target.apply(batch);
				};
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

function delegateEngine<FeatureName extends string>(
	engine: TransactionEngine<FeatureName>,
): TransactionEngine<FeatureName> {
	return {
		tracks: () => engine.tracks(),
		clips: (filter) => engine.clips(filter),
		assets: () => engine.assets(),
		markers: () => engine.markers(),
		project: () => engine.project(),
		revision: () => engine.revision(),
		apply: (batch) => engine.apply(batch),
		watch: (callback) => engine.watch(callback),
		validate: (batch) => engine.validate(batch),
		dryRun: (batch) => engine.dryRun(batch),
		capabilities: () => engine.capabilities(),
		supportedOperations: () => engine.supportedOperations(),
	};
}

function decorateManager(args: {
	readonly manager: DraftEditingManager;
	readonly engine: TransactionEngine;
	readonly mutation: Mutation;
}): DraftEditingManager {
	if (args.mutation === "none" || args.mutation === "bypass-retention") {
		return args.manager;
	}
	return {
		async open(input) {
			const opened = await args.manager.open(input);
			if (!opened.opened) return opened;
			const session = opened.session;
			return {
				opened: true,
				session: new Proxy(session, {
					get(target, property) {
						if (property === "stage") {
							return async (call: {
								readonly operations: readonly unknown[];
							}) => {
								if (
									args.mutation === "accept-immediate" &&
									call.operations.some(
										(operation) =>
											Reflect.get(operation as object, "kind") ===
											"source-package-removal",
									)
								) {
									return {
										accepted: true,
										snapshot: target.snapshot(),
										review: target.review(),
									};
								}
								if (args.mutation === "premature-stage") {
									await args.engine.apply({
										operations: call.operations,
									} as TransactionBatch);
								}
								return target.stage(call as never);
							};
						}
						const value = Reflect.get(target, property, target);
						return typeof value === "function" ? value.bind(target) : value;
					},
				}),
			};
		},
	};
}

function createFactory<FeatureName extends string = FactoryFeature>(
	mutation: Mutation = "none",
): DraftTestFactory<FeatureName> {
	return async (
		options: DraftEditingConformanceFactoryOptions<FeatureName> = {},
	): Promise<DraftTestFixture<FeatureName>> => {
		const { store } = createInMemoryProjectStoreFixture();
		await store.save(
			createTransactionNativeProjectSeed({
				projectId: PROJECT_ID,
				project: project(),
			}),
		);
		let saves = 0;
		const originalSave = store.save.bind(store);
		store.save = async (input) => {
			saves += 1;
			return originalSave(input);
		};
		const rawEngine = await openTransactionEngine<FeatureName>({
			store,
			projectId: PROJECT_ID,
			documentAdapter: createTransactionNativeDocumentAdapter(),
			placementPolicies: options.placementPolicies,
			optionalFeatures: options.optionalFeatures,
		});
		const committedState =
			bindNativeCommittedTransactionStateCapture(rawEngine);
		if (committedState === undefined) {
			throw new Error("Native engine did not register committed-state capture");
		}
		if (options.seedOperations && options.seedOperations.length > 0) {
			await rawEngine.apply({ operations: options.seedOperations });
			saves = 0;
		}
		let applies = 0;
		let watches = 0;
		rawEngine.watch(() => {
			watches += 1;
		});
		const engine = bindEngine({
			engine: rawEngine,
			revisions: options.snapshotRevisionSequence,
			onApply: () => {
				applies += 1;
			},
		});
		const retention = createInMemoryDraftResourceRetentionPolicy({
			retainedAssetIds: options.retainedAssetIds,
		});
		const bypassRetention: DraftResourceRetentionPolicy = {
			async preflight({ referencedAssetIds }) {
				return {
					retained: true,
					evidence: {
						candidateAssetIds: referencedAssetIds,
						retainedAssets: referencedAssetIds.map((assetId) => ({
							assetId,
							projectOwned: true,
						})),
						missingAssetIds: [],
					},
				};
			},
		};
		const manager = createDraftEditingManager({
			engine,
			committedState,
			retentionPolicy:
				mutation === "bypass-retention" ? bypassRetention : retention,
			placementPolicies: options.placementPolicies,
			snapshotAttempts: options.snapshotAttempts,
		});
		return {
			manager: decorateManager({ manager, engine, mutation }),
			engine,
			committedState,
			retention,
			saveCount: () => saves,
			applyCount: () => applies,
			watchCount: () => watches,
		};
	};
}

describe("Draft editing sessions", () => {
	test("passes the reusable T2 conformance matrix", async () => {
		const report = await runDraftEditingConformance(
			createFactory(),
			OPTIONAL_FEATURES,
		);
		if (!report.passed) {
			throw new Error(
				report.results
					.filter((result) => result.status === "failed")
					.map((result) => `${result.name}: ${result.detail}`)
					.join("\n"),
			);
		}
		expect(report.summary).toEqual({ passed: 21, failed: 0, skipped: 1 });
	});

	test("keeps repeated and concurrent conformance accounting run-local", async () => {
		const factory = createFactory();
		const reports = await Promise.all([
			runDraftEditingConformance(factory, OPTIONAL_FEATURES),
			runDraftEditingConformance(factory, OPTIONAL_FEATURES),
		]);
		for (const report of reports) {
			expect(report.passed).toBe(true);
			expect(report.summary).toEqual({ passed: 21, failed: 0, skipped: 1 });
			expect(
				report.results.find(
					(result) => result.name === "T2: zero-assertion control is skipped",
				)?.status,
			).toBe("skipped");
		}
		expect(
			reports[0]?.results.map(({ name, status }) => ({ name, status })),
		).toEqual(
			reports[1]?.results.map(({ name, status }) => ({ name, status })),
		);
	});

	test("preserves an arbitrary literal optional engine feature", async () => {
		type CustomFeature = "provider-custom-draft";
		const features = {
			"provider-custom-draft": true,
		} as const satisfies TransactionEngineOptionalFeatures<CustomFeature>;
		const report = await runDraftEditingConformance(
			createFactory<CustomFeature>(),
			features,
		);
		expect(report.passed).toBe(true);
		expect(
			report.results.find(
				(result) =>
					result.name ===
					"T2: optional engine feature literals remain observable",
			)?.status,
		).toBe("passed");
	});

	test("accepts a provider retention policy at the public conformance boundary", async () => {
		const providerRetention: DraftResourceRetentionPolicy = {
			async preflight({ referencedAssetIds }) {
				return {
					retained: true,
					evidence: {
						candidateAssetIds: referencedAssetIds,
						retainedAssets: referencedAssetIds.map((retainedId) => ({
							assetId: retainedId,
							projectOwned: true,
						})),
						missingAssetIds: [],
					},
				};
			},
		};
		const baseFactory = createFactory();
		const providerFactory: DraftEditingConformanceFactory<
			FactoryFeature
		> = async (options) => {
			const fixture = await baseFactory(options);
			return { ...fixture, retention: providerRetention };
		};
		const report = await runDraftEditingConformance(
			providerFactory,
			OPTIONAL_FEATURES,
		);
		expect(report.passed).toBe(true);
		expect(report.summary).toEqual({ passed: 21, failed: 0, skipped: 1 });
	});

	test("names deliberate protocol violations instead of passing vacuously", async () => {
		const targets: Array<{
			readonly mutation: Mutation;
			readonly failedCase: string;
		}> = [
			{
				mutation: "premature-stage",
				failedCase:
					"T2: sibling Drafts isolate working state and durable effects",
			},
			{
				mutation: "accept-immediate",
				failedCase:
					"T2: classification is exhaustive and immediate input is rejected before mutation",
			},
			{
				mutation: "bypass-retention",
				failedCase:
					"T2: retention preflight blocks referenced assets before apply",
			},
		];
		for (const target of targets) {
			const report = await runDraftEditingConformance(
				createFactory(target.mutation),
				OPTIONAL_FEATURES,
			);
			expect(report.passed, target.mutation).toBe(false);
			expect(
				report.results.some(
					(result) =>
						result.name === target.failedCase && result.status === "failed",
				),
			).toBe(true);
		}
	});

	test("maps retention adapter failure and rejects still-referenced project asset deletion", async () => {
		const factory = createFactory();
		const fixture = await factory({
			retainedAssetIds: [assetId("retained")],
		});
		const opened = await fixture.manager.open({
			id: "retention-failure",
			approvalMode: "manual",
		});
		if (!opened.opened) throw new Error(opened.error.message);
		await opened.session.stage({
			operations: [
				{
					kind: "create-track",
					track: {
						id: "track" as never,
						kind: "graphic",
						name: "track",
						hidden: false,
					},
				},
				{
					kind: "create-asset",
					asset: { id: assetId("retained"), kind: "image", name: "retained" },
				},
				{
					kind: "create-clip",
					clip: {
						id: "clip" as never,
						trackId: "track" as never,
						startTime: mediaTime({ ticks: 0 }),
						duration: mediaTime({ ticks: 4_000 }),
						trimStart: mediaTime({ ticks: 0 }),
						trimEnd: mediaTime({ ticks: 0 }),
						assetId: assetId("retained"),
					},
				},
			],
		});
		const before = opened.session.snapshot();
		const referencedDelete = await opened.session.stage({
			operations: [{ kind: "delete-asset", assetId: assetId("retained") }],
		});
		expect(referencedDelete.accepted).toBe(false);
		if (!referencedDelete.accepted) {
			expect(referencedDelete.error.kind).toBe("evaluation-rejected");
		}
		expect(opened.session.snapshot()).toStrictEqual(before);
		fixture.retention.failNext("retention offline");
		const approval = await opened.session.approve();
		expect(approval.applied).toBe(false);
		if (!approval.applied && "draftError" in approval) {
			expect(approval.draftError.kind).toBe("retention-failed");
			expect(approval.draftError.message).toBe("retention offline");
		}
		expect(fixture.applyCount()).toBe(0);
	});

	test("preserves parent store-error ownership and publishes nothing on apply failure", async () => {
		const { store, control } = createInMemoryProjectStoreFixture();
		await store.save(
			createTransactionNativeProjectSeed({
				projectId: PROJECT_ID,
				project: project(),
			}),
		);
		const engine = await openTransactionEngine({
			store,
			projectId: PROJECT_ID,
			documentAdapter: createTransactionNativeDocumentAdapter(),
		});
		const manager = createDraftEditingManager({
			engine,
			retentionPolicy: createInMemoryDraftResourceRetentionPolicy(),
		});
		const opened = await manager.open({
			id: "store-failure",
			approvalMode: "manual",
		});
		if (!opened.opened) throw new Error(opened.error.message);
		await opened.session.stage({
			operations: [
				{
					kind: "create-track",
					track: {
						id: "store-failure-track" as never,
						kind: "graphic",
						name: "store failure",
						hidden: false,
					},
				},
			],
		});
		control.failNext({
			operation: "save-project",
			code: "quota-exceeded",
		});
		const outcome = await opened.session.approve();
		expect(outcome.applied).toBe(false);
		if (!outcome.applied && "engineError" in outcome) {
			expect(outcome.engineError).toBeInstanceOf(ProjectStoreError);
			const engineError = outcome.engineError as ProjectStoreError;
			expect(engineError.code).toBe("quota-exceeded");
			expect(Object.isFrozen(engineError)).toBe(true);
			expect(Object.isFrozen(engineError.scope)).toBe(true);
			expect(Reflect.set(engineError, "code", "corrupt")).toBe(false);
			expect(engineError.code).toBe("quota-exceeded");
			if (engineError.scope.kind === "project") {
				const originalProjectId = engineError.scope.projectId;
				expect(
					Reflect.set(engineError.scope, "projectId", projectId("mutated")),
				).toBe(false);
				expect(engineError.scope.projectId).toBe(originalProjectId);
			}
		}
		expect(opened.session.snapshot().state).toBe("conflicted");
		expect(Number(await engine.revision())).toBe(0);
		expect((await engine.tracks()).length).toBe(0);
	});

	test("fails closed when a public engine wrapper omits or loses committed-state capture", async () => {
		const { store } = createInMemoryProjectStoreFixture();
		await store.save(
			createTransactionNativeProjectSeed({
				projectId: PROJECT_ID,
				project: project(),
			}),
		);
		const nativeEngine = await openTransactionEngine({
			store,
			projectId: PROJECT_ID,
			documentAdapter: createTransactionNativeDocumentAdapter(),
		});
		const nativeCapture =
			bindNativeCommittedTransactionStateCapture(nativeEngine);
		if (nativeCapture === undefined) throw new Error("Missing native capture");
		const wrapper = delegateEngine(nativeEngine);
		expect(
			Reflect.ownKeys(nativeEngine).some((key) => typeof key === "symbol"),
		).toBe(false);

		const missingManager = createDraftEditingManager({
			engine: wrapper,
			retentionPolicy: createInMemoryDraftResourceRetentionPolicy(),
		});
		const missing = await missingManager.open({
			id: "wrapper-missing-capability",
			approvalMode: "manual",
		});
		expect(missing.opened).toBe(false);
		if (!missing.opened) {
			expect(missing.error).toMatchObject({
				kind: "committed-state-unavailable",
				reason: "missing-capability",
			});
		}

		let captureFails = false;
		const manager = createDraftEditingManager({
			engine: wrapper,
			committedState: {
				capture() {
					if (captureFails) throw new Error("capture offline");
					return nativeCapture.capture();
				},
			},
			retentionPolicy: createInMemoryDraftResourceRetentionPolicy(),
		});
		const opened = await manager.open({
			id: "wrapper-capture-fails-before-apply",
			approvalMode: "manual",
		});
		if (!opened.opened) throw new Error(opened.error.message);
		await opened.session.stage({
			operations: [
				{
					kind: "create-marker",
					marker: {
						id: markerId("capture-failure-marker"),
						time: mediaTime({ ticks: 0 }),
					},
				},
			],
		});
		captureFails = true;
		const approval = await opened.session.approve();
		expect(approval.applied).toBe(false);
		if (!approval.applied && "draftError" in approval) {
			expect(approval.draftError).toMatchObject({
				kind: "committed-state-unavailable",
				reason: "capture-failed",
			});
		}
		expect(Number(await nativeEngine.revision())).toBe(0);
		expect(await nativeEngine.markers()).toHaveLength(0);
	});

	test("uses an explicit wrapper capture for prior-ledger preflight and actual undo equivalence", async () => {
		type PolicyObservation = {
			readonly revision: number;
			readonly entries: readonly {
				readonly key: string;
				readonly fingerprint: string;
				readonly resultRevision: number;
			}[];
		};
		const observations: PolicyObservation[] = [];
		const placementPolicy: TransactionPlacementPolicy = {
			evaluate({ document, batch }) {
				if (!batch.idempotencyKey?.endsWith(":undo")) return [];
				observations.push({
					revision: Number(document.revision),
					entries: document.idempotency.map((entry) => ({
						key: entry.key,
						fingerprint: entry.fingerprint,
						resultRevision: Number(entry.result.revision),
					})),
				});
				const hasPrior = document.idempotency.some(
					(entry) => entry.key === "wrapper-prior-entry",
				);
				const hasForward = document.idempotency.some((entry) =>
					entry.key.endsWith(":apply"),
				);
				return hasPrior && hasForward
					? []
					: [
							{
								code: "provider:missing-committed-ledger" as const,
								message: "Undo requires prior and forward entries",
							},
						];
			},
		};
		const { store } = createInMemoryProjectStoreFixture();
		await store.save(
			createTransactionNativeProjectSeed({
				projectId: PROJECT_ID,
				project: project(),
			}),
		);
		const nativeEngine = await openTransactionEngine({
			store,
			projectId: PROJECT_ID,
			documentAdapter: createTransactionNativeDocumentAdapter(),
			placementPolicies: [placementPolicy],
		});
		await nativeEngine.apply({
			operations: [
				{
					kind: "create-marker",
					marker: {
						id: markerId("wrapper-ledger-marker"),
						time: mediaTime({ ticks: 0 }),
						note: "base",
					},
				},
			],
			idempotencyKey: "wrapper-prior-entry",
		});
		const committedState =
			bindNativeCommittedTransactionStateCapture(nativeEngine);
		if (committedState === undefined) throw new Error("Missing native capture");
		const wrapper = delegateEngine(nativeEngine);
		const manager = createDraftEditingManager({
			engine: wrapper,
			committedState,
			retentionPolicy: createInMemoryDraftResourceRetentionPolicy(),
			placementPolicies: [placementPolicy],
		});
		const opened = await manager.open({
			id: "wrapper-prior-ledger",
			approvalMode: "manual",
		});
		if (!opened.opened) throw new Error(opened.error.message);
		await opened.session.stage({
			operations: [
				{
					kind: "update-marker",
					markerId: markerId("wrapper-ledger-marker"),
					patch: { note: "forward" },
				},
			],
		});
		const application = await opened.session.approve();
		expect(application.applied).toBe(true);
		if (!application.applied) return;
		await wrapper.apply(application.receipt.undoPlan.batch);
		expect(observations).toHaveLength(2);
		expect(observations[0]).toEqual(observations[1]);
		const applyKey = application.receipt.forwardBatch.idempotencyKey;
		if (applyKey === undefined) throw new Error("Draft apply key was missing");
		expect(observations[0]?.entries.map((entry) => entry.key)).toEqual([
			"wrapper-prior-entry",
			applyKey,
		]);
		expect((await nativeEngine.markers())[0]?.note).toBe("base");
	});

	test("keeps native capture construction-owned and immune to writer or port substitution", async () => {
		for (const module of [engineImplementation, projectionImplementation]) {
			expect(
				Object.keys(module).filter((name) =>
					/register.*committed.*state.*capture/i.test(name),
				),
			).toEqual([]);
			expect(
				Object.hasOwn(module, "registerCommittedTransactionStateCapture"),
			).toBe(false);
		}
		expect(Object.keys(engineImplementation).sort()).toEqual([
			"bindNativeCommittedTransactionStateCapture",
			"openTransactionEngine",
		]);
		expect(Object.keys(projectionImplementation)).toEqual([
			"projectCommittedTransactionDocument",
		]);

		type PolicyObservation = {
			readonly revision: number;
			readonly keys: readonly string[];
		};
		const observations: PolicyObservation[] = [];
		const placementPolicy: TransactionPlacementPolicy = {
			evaluate({ document, batch }) {
				if (!batch.idempotencyKey?.endsWith(":undo")) return [];
				observations.push({
					revision: Number(document.revision),
					keys: document.idempotency.map((entry) => entry.key),
				});
				return document.idempotency.some(
					(entry) => entry.key === "native-unforgeable-prior",
				)
					? []
					: [
							{
								code: "provider:missing-native-ledger" as const,
								message: "Undo requires the real native prior ledger",
							},
						];
			},
		};
		const { store } = createInMemoryProjectStoreFixture();
		await store.save(
			createTransactionNativeProjectSeed({
				projectId: PROJECT_ID,
				project: project(),
			}),
		);
		const engine = await openTransactionEngine({
			store,
			projectId: PROJECT_ID,
			documentAdapter: createTransactionNativeDocumentAdapter(),
			placementPolicies: [placementPolicy],
		});
		await engine.apply({
			operations: [
				{
					kind: "create-marker",
					marker: {
						id: markerId("native-unforgeable-marker"),
						time: mediaTime({ ticks: 0 }),
						note: "base",
					},
				},
			],
			idempotencyKey: "native-unforgeable-prior",
		});
		const nativeCapture = bindNativeCommittedTransactionStateCapture(engine);
		if (nativeCapture === undefined) throw new Error("Missing native capture");
		expect(Object.isFrozen(nativeCapture)).toBe(true);
		expect(
			Reflect.set(nativeCapture, "capture", async () => {
				throw new Error("substituted");
			}),
		).toBe(false);

		const forgedDocument = {
			...(await nativeCapture.capture()),
			idempotency: [],
		};
		let forgedCalls = 0;
		const forgedPort: DraftCommittedStateCapture = {
			capture() {
				forgedCalls += 1;
				return forgedDocument;
			},
		};
		const manager = createDraftEditingManager({
			engine,
			committedState: forgedPort,
			retentionPolicy: createInMemoryDraftResourceRetentionPolicy(),
			placementPolicies: [placementPolicy],
		});
		const opened = await manager.open({
			id: "native-port-substitution",
			approvalMode: "manual",
		});
		if (!opened.opened) throw new Error(opened.error.message);
		await opened.session.stage({
			operations: [
				{
					kind: "update-marker",
					markerId: markerId("native-unforgeable-marker"),
					patch: { note: "forward" },
				},
			],
		});
		const application = await opened.session.approve();
		expect(application.applied).toBe(true);
		expect(forgedCalls).toBe(0);
		if (!application.applied) return;
		await engine.apply(application.receipt.undoPlan.batch);
		expect(observations).toHaveLength(2);
		expect(observations[0]).toEqual(observations[1]);
		expect(observations[0]?.keys[0]).toBe("native-unforgeable-prior");
		expect((await engine.markers())[0]?.note).toBe("base");

		const wrapper = delegateEngine(engine);
		expect(bindNativeCommittedTransactionStateCapture(wrapper)).toBeUndefined();
		const explicitPort = {
			capture: () => nativeCapture.capture(),
		};
		const wrapperManager = createDraftEditingManager({
			engine: wrapper,
			committedState: explicitPort,
			retentionPolicy: createInMemoryDraftResourceRetentionPolicy(),
		});
		expect(
			Reflect.set(explicitPort, "capture", () => {
				throw new Error("late wrapper port replacement");
			}),
		).toBe(true);
		const wrapperOpened = await wrapperManager.open({
			id: "wrapper-port-bound-once",
			approvalMode: "manual",
		});
		expect(wrapperOpened.opened).toBe(true);
	});

	test("uses distinct base/incarnation keys when a public Draft id is reused", async () => {
		const { store } = createInMemoryProjectStoreFixture();
		await store.save(
			createTransactionNativeProjectSeed({
				projectId: PROJECT_ID,
				project: project(),
			}),
		);
		let saves = 0;
		const originalSave = store.save.bind(store);
		store.save = async (input) => {
			saves += 1;
			return originalSave(input);
		};
		const engine = await openTransactionEngine({
			store,
			projectId: PROJECT_ID,
			documentAdapter: createTransactionNativeDocumentAdapter(),
		});
		let watches = 0;
		engine.watch(() => {
			watches += 1;
		});
		const retentionPolicy = createInMemoryDraftResourceRetentionPolicy();
		const firstManager = createDraftEditingManager({ engine, retentionPolicy });
		const sameBaseManager = createDraftEditingManager({
			engine,
			retentionPolicy,
		});
		const firstOpened = await firstManager.open({
			id: "reused-public-id",
			approvalMode: "manual",
		});
		const sameBaseOpened = await sameBaseManager.open({
			id: "reused-public-id",
			approvalMode: "manual",
		});
		if (!firstOpened.opened || !sameBaseOpened.opened) {
			throw new Error("same-base Draft setup failed");
		}
		const operation = {
			kind: "create-marker" as const,
			marker: {
				id: "reused-marker" as never,
				time: mediaTime({ ticks: 0 }),
			},
		};
		await firstOpened.session.stage({ operations: [operation] });
		await sameBaseOpened.session.stage({ operations: [operation] });
		const first = await firstOpened.session.approve();
		expect(first.applied).toBe(true);
		const staleSameBase = await sameBaseOpened.session.approve();
		expect(staleSameBase.applied).toBe(false);
		if (!staleSameBase.applied && "engineError" in staleSameBase) {
			expect(staleSameBase.engineError).toBeInstanceOf(Error);
		}
		expect(Number(await engine.revision())).toBe(1);
		expect(saves).toBe(1);
		expect(watches).toBe(1);

		await engine.apply({
			operations: [{ kind: "delete-marker", markerId: operation.marker.id }],
		});
		expect(Number(await engine.revision())).toBe(2);
		const laterManager = createDraftEditingManager({ engine, retentionPolicy });
		const laterOpened = await laterManager.open({
			id: "reused-public-id",
			approvalMode: "manual",
		});
		if (!laterOpened.opened) throw new Error(laterOpened.error.message);
		await laterOpened.session.stage({ operations: [operation] });
		const later = await laterOpened.session.approve();
		expect(later.applied).toBe(true);
		if (!first.applied || !later.applied) return;
		expect(first.receipt.forwardBatch.idempotencyKey).not.toBe(
			later.receipt.forwardBatch.idempotencyKey,
		);
		expect(first.receipt.undoPlan.batch.idempotencyKey).not.toBe(
			later.receipt.undoPlan.batch.idempotencyKey,
		);
		expect(later.receipt.forwardBatch.idempotencyKey).toContain(":base:2:");
		expect(Number(later.receipt.appliedRevision)).toBe(3);
		expect(
			(await engine.markers()).some(
				(marker) => marker.id === operation.marker.id,
			),
		).toBe(true);
		expect(saves).toBe(3);
		expect(watches).toBe(3);
		const observedAgain = await laterOpened.session.approve();
		expect(observedAgain).toBe(later);
		expect(saves).toBe(3);
	});

	test("encodes arbitrary UTF-16 Draft ids without collisions or thrown opens", async () => {
		const loneSurrogate = "\ud800";
		const pairedSurrogate = "\ud800\udc00";
		const fixture = await createFactory()();
		const lone = await fixture.manager.open({
			id: loneSurrogate,
			approvalMode: "manual",
		});
		const paired = await fixture.manager.open({
			id: pairedSurrogate,
			approvalMode: "manual",
		});
		expect(lone.opened).toBe(true);
		expect(paired.opened).toBe(true);
		if (!lone.opened || !paired.opened) return;
		await lone.session.stage({
			operations: [
				{
					kind: "create-track",
					track: {
						id: "utf16-track" as never,
						kind: "graphic",
						name: "UTF-16",
						hidden: false,
					},
				},
			],
		});
		const applied = await lone.session.approve();
		expect(applied.applied).toBe(true);
		if (applied.applied) {
			expect(applied.receipt.forwardBatch.idempotencyKey).toStartWith(
				"draft:d800:base:0:incarnation:",
			);
		}
		const duplicate = await fixture.manager.open({
			id: loneSurrogate,
			approvalMode: "manual",
		});
		expect(duplicate.opened).toBe(false);
		if (!duplicate.opened) {
			expect(duplicate.error.kind).toBe("duplicate-draft-id");
		}
		expect(String(paired.session.id)).toBe(pairedSurrogate);
	});

	test("does not reserve a Draft id when incarnation key creation fails", async () => {
		const fixture = await createFactory()();
		const originalCrypto = globalThis.crypto;
		let failure: unknown;
		try {
			Object.defineProperty(globalThis, "crypto", {
				configurable: true,
				writable: true,
				value: {
					getRandomValues() {
						throw new Error("random unavailable");
					},
				},
			});
			try {
				await fixture.manager.open({
					id: "retry-after-key-failure",
					approvalMode: "manual",
				});
			} catch (error) {
				failure = error;
			}
		} finally {
			Object.defineProperty(globalThis, "crypto", {
				configurable: true,
				writable: true,
				value: originalCrypto,
			});
		}
		expect(failure).toBeInstanceOf(Error);
		const retried = await fixture.manager.open({
			id: "retry-after-key-failure",
			approvalMode: "manual",
		});
		expect(retried.opened).toBe(true);
	});

	test("keeps a one-field undo constant-sized across 8,000 markers", async () => {
		const markers = Array.from({ length: 8_000 }, (_, index) => ({
			id: markerId(`large-marker-${index.toString().padStart(4, "0")}`),
			time: mediaTime({ ticks: 0 }),
			note: index === 4_000 ? "base" : `marker-${index}`,
		}));
		const seed = createTransactionNativeProjectSeed({
			projectId: PROJECT_ID,
			project: project(),
		});
		const seedData = seed.record.data as {
			readonly transactionEngine: Readonly<Record<string, unknown>>;
		};
		const { store } = createInMemoryProjectStoreFixture();
		await store.save({
			record: {
				...seed.record,
				data: {
					...(seed.record.data as Readonly<Record<string, unknown>>),
					transactionEngine: {
						...seedData.transactionEngine,
						markers,
					},
				},
			},
			summary: seed.summary,
		});
		const engine = await openTransactionEngine({
			store,
			projectId: PROJECT_ID,
			documentAdapter: createTransactionNativeDocumentAdapter(),
		});
		const manager = createDraftEditingManager({
			engine,
			retentionPolicy: createInMemoryDraftResourceRetentionPolicy(),
		});
		const opened = await manager.open({
			id: "large-local-update",
			approvalMode: "manual",
		});
		if (!opened.opened) throw new Error(opened.error.message);
		await opened.session.stage({
			operations: [
				{
					kind: "update-marker",
					markerId: markers[4_000]!.id,
					patch: { note: "forward" },
				},
			],
		});
		const application = await opened.session.approve();
		expect(application.applied).toBe(true);
		if (!application.applied) return;
		expect(application.receipt.undoPlan.batch.operations).toHaveLength(1);
		expect(application.receipt.undoPlan.batch.operations[0]).toEqual({
			kind: "update-marker",
			markerId: markers[4_000]!.id,
			patch: { note: "base" },
		});
		await engine.apply(application.receipt.undoPlan.batch);
		const restored = await engine.markers();
		expect(restored).toHaveLength(8_000);
		expect(restored[0]?.id).toBe(markers[0]?.id);
		expect(restored[4_000]?.note).toBe("base");
		expect(restored[7_999]?.id).toBe(markers[7_999]?.id);
	});

	test("keeps one-to-four-field Project inverses constant-sized, exact, restorable, stale-safe, and preflight-closed", async () => {
		const markers = Array.from({ length: 8_000 }, (_, index) => ({
			id: markerId(`project-large-marker-${index.toString().padStart(4, "0")}`),
			time: mediaTime({ ticks: 0 }),
		}));
		const baseProject = project();
		const base = {
			project: baseProject,
			tracks: [],
			clips: [],
			assets: [],
			markers,
			revision: revisionOf(0),
		};
		const patches: readonly ProjectPatch[] = [
			{ name: "One field" },
			{ name: "Two fields", canvasWidth: 1280 },
			{ name: "Three fields", canvasWidth: 1280, canvasHeight: 720 },
			{
				name: "Four fields",
				frameRate: { numerator: 24, denominator: 1 },
				canvasWidth: 1280,
				canvasHeight: 720,
			},
		];
		for (const patch of patches) {
			const candidate = { ...base, project: { ...baseProject, ...patch } };
			const forward = {
				kind: "update-project" as const,
				projectId: baseProject.id,
				patch,
			};
			const inverse = planDraftCompensatingOperations({
				base,
				candidate,
				operations: [forward],
			});
			expect(inverse).toHaveLength(1);
			expect(inverse[0]?.kind).toBe("update-project");
			if (inverse[0]?.kind !== "update-project") continue;
			expect(Object.keys(inverse[0].patch).sort()).toEqual(
				Object.keys(patch).sort(),
			);
			for (const key of Object.keys(inverse[0].patch)) {
				expect(Reflect.get(inverse[0].patch, key)).toEqual(
					Reflect.get(baseProject, key),
				);
			}
		}
		const sameValueForward = {
			kind: "update-project" as const,
			projectId: baseProject.id,
			patch: { name: baseProject.name },
		};
		expect(
			planDraftCompensatingOperations({
				base,
				candidate: base,
				operations: [sameValueForward],
			}),
		).toEqual([sameValueForward]);

		const fixture = await createFactory()();
		const opened = await fixture.manager.open({
			id: "project-undo-integration",
			approvalMode: "manual",
		});
		if (!opened.opened) throw new Error(opened.error.message);
		const beforeProject = await fixture.engine.project();
		await opened.session.stage({
			operations: [
				{
					kind: "update-project",
					projectId: projectId(PROJECT_ID),
					patch: { name: "Forward Project", canvasWidth: 1280 },
				},
			],
		});
		const applied = await opened.session.approve();
		expect(applied.applied).toBe(true);
		if (!applied.applied) return;
		expect(applied.receipt.undoPlan.batch.operations).toHaveLength(1);
		await fixture.engine.apply(applied.receipt.undoPlan.batch);
		expect(await fixture.engine.project()).toEqual(beforeProject);

		const stale = await fixture.manager.open({
			id: "project-stale-undo",
			approvalMode: "manual",
		});
		if (!stale.opened) throw new Error(stale.error.message);
		await stale.session.stage({
			operations: [
				{
					kind: "update-project",
					projectId: projectId(PROJECT_ID),
					patch: { canvasHeight: 720 },
				},
			],
		});
		const staleApplied = await stale.session.approve();
		expect(staleApplied.applied).toBe(true);
		if (!staleApplied.applied) return;
		await fixture.engine.apply({
			operations: [
				{
					kind: "update-project",
					projectId: projectId(PROJECT_ID),
					patch: { name: "Later Project work" },
				},
			],
		});
		await expect(
			fixture.engine.apply(staleApplied.receipt.undoPlan.batch),
		).rejects.toMatchObject({
			code: "conflict",
		} satisfies Partial<TransactionError>);

		const inverseRejectingPolicy: TransactionPlacementPolicy = {
			evaluate({ batch }) {
				return batch.idempotencyKey?.endsWith(":undo") &&
					batch.operations.some(
						(operation) =>
							operation.kind === "update-project" &&
							operation.patch.name === project().name,
					)
					? [
							{
								code: "provider:project-inverse-rejected" as const,
								message: "Project inverse rejected",
							},
						]
					: [];
			},
		};
		const rejectedFixture = await createFactory()({
			placementPolicies: [inverseRejectingPolicy],
		});
		const rejectedOpen = await rejectedFixture.manager.open({
			id: "project-preflight-rejected",
			approvalMode: "manual",
		});
		if (!rejectedOpen.opened) throw new Error(rejectedOpen.error.message);
		await rejectedOpen.session.stage({
			operations: [
				{
					kind: "update-project",
					projectId: projectId(PROJECT_ID),
					patch: { name: "Rejected forward Project" },
				},
			],
		});
		const rejected = await rejectedOpen.session.approve();
		expect(rejected.applied).toBe(false);
		if (!rejected.applied && "draftError" in rejected) {
			expect(rejected.draftError.kind).toBe("compensation-rejected");
		}
		expect(rejectedFixture.applyCount()).toBe(0);
		expect(rejectedFixture.saveCount()).toBe(0);
		expect((await rejectedFixture.engine.project())?.name).toBe(project().name);
	});

	test("traverses first-seen identical containers before rejecting nested alias collapse", () => {
		const containers = [
			{
				name: "plain-object",
				create: (nested: object) => ({ nested }),
			},
			{
				name: "array",
				create: (nested: object) => [nested],
			},
			{
				name: "map",
				create: (nested: object) => new Map([["nested", nested]]),
			},
			{
				name: "set",
				create: (nested: object) => new Set([nested]),
			},
			{
				name: "date-tag",
				create: (nested: object) => {
					const value = new Date("2026-08-10T00:00:00.000Z");
					Object.defineProperty(value, "nested", {
						enumerable: true,
						value: nested,
					});
					return value;
				},
			},
			{
				name: "regexp-tag",
				create: (nested: object) => {
					const value = /draft/gi;
					Object.defineProperty(value, "nested", {
						enumerable: true,
						value: nested,
					});
					return value;
				},
			},
		] as const;

		for (const container of containers) {
			const nested = { value: "same" };
			const identicalOuter = container.create(nested);
			const document = (later: object) => ({
				project: null,
				tracks: [],
				clips: [],
				assets: [],
				markers: [
					{
						id: markerId(`${container.name}-outer`),
						time: mediaTime({ ticks: 0 }),
						providerPrivate: identicalOuter,
					},
					{
						id: markerId(`${container.name}-later`),
						time: mediaTime({ ticks: 1 }),
						providerPrivate: later,
					},
				],
			});
			const left = document({ value: "same" });
			const right = document(nested);
			expect(
				hasSameDraftContent(left as never, right as never),
				container.name,
			).toBe(false);
			expect(
				hasSameDraftContent(right as never, left as never),
				`${container.name}-reverse`,
			).toBe(false);
		}

		const sharedBuffer = new Uint8Array([1, 2, 3]).buffer;
		const identicalView = new Uint8Array(sharedBuffer);
		const document = (later: ArrayBuffer) => ({
			project: null,
			tracks: [],
			clips: [],
			assets: [],
			markers: [
				{
					id: markerId("typed-array-outer"),
					time: mediaTime({ ticks: 0 }),
					providerPrivate: identicalView,
				},
				{
					id: markerId("typed-array-later"),
					time: mediaTime({ ticks: 4_000 }),
					providerPrivate: later,
				},
			],
		});
		const left = document(new Uint8Array([1, 2, 3]).buffer);
		const right = document(sharedBuffer);
		expect(hasSameDraftContent(left as never, right as never)).toBe(false);
		expect(hasSameDraftContent(right as never, left as never)).toBe(false);
	});

	test("terminates cycles only through an already-recorded matching pair", () => {
		const cycle = () => {
			const value: { label: string; self?: unknown } = { label: "cycle" };
			value.self = value;
			return value;
		};
		const document = (first: object, second: object) => ({
			project: null,
			tracks: [],
			clips: [],
			assets: [],
			markers: [
				{
					id: markerId("cycle-first"),
					time: mediaTime({ ticks: 0 }),
					providerPrivate: first,
				},
				{
					id: markerId("cycle-second"),
					time: mediaTime({ ticks: 1 }),
					providerPrivate: second,
				},
			],
		});
		const leftCycle = cycle();
		const rightCycle = cycle();
		expect(
			hasSameDraftContent(
				document(leftCycle, leftCycle) as never,
				document(rightCycle, rightCycle) as never,
			),
		).toBe(true);
		expect(
			hasSameDraftContent(
				document(leftCycle, cycle()) as never,
				document(rightCycle, rightCycle) as never,
			),
		).toBe(false);
		expect(
			hasSameDraftContent(
				document(rightCycle, rightCycle) as never,
				document(leftCycle, cycle()) as never,
			),
		).toBe(false);
	});

	test("repairs owners hidden below an identical container with a non-circular identity oracle", async () => {
		const nested = { value: "same" };
		const identicalOuter = { nested };
		const baseSecond = { value: "same" };
		const firstId = markerId("nested-repair-first");
		const secondId = markerId("nested-repair-second");
		const base = {
			project: project(),
			tracks: [],
			clips: [],
			assets: [],
			markers: [
				{
					id: firstId,
					time: mediaTime({ ticks: 0 }),
					providerPrivate: identicalOuter,
				},
				{
					id: secondId,
					time: mediaTime({ ticks: 4_000 }),
					providerPrivate: baseSecond,
				},
			],
			revision: revisionOf(0),
		};
		const candidate = {
			...base,
			markers: [
				base.markers[0]!,
				{ ...base.markers[1]!, providerPrivate: nested },
			],
		};
		const forwardOperations = [
			{
				kind: "update-marker" as const,
				markerId: secondId,
				patch: { providerPrivate: nested } as never,
			},
		];
		const inverse = planDraftCompensatingOperations({
			base: base as never,
			candidate: candidate as never,
			operations: forwardOperations,
		});
		expect(inverse).toHaveLength(2);
		const evaluated = await evaluateTransactionBatch({
			document: { ...candidate, idempotency: [] } as never,
			batch: { operations: inverse },
		});
		expect(
			evaluated.accepted,
			evaluated.accepted
				? "accepted"
				: evaluated.issues.map((issue) => issue.message).join("; "),
		).toBe(true);
		if (!evaluated.accepted) return;
		const restoredFirst = Reflect.get(
			evaluated.document.markers[0] as object,
			"providerPrivate",
		) as { readonly nested: object };
		const restoredSecond = Reflect.get(
			evaluated.document.markers[1] as object,
			"providerPrivate",
		) as object;
		expect(restoredFirst.nested).not.toBe(restoredSecond);
		expect(restoredFirst.nested).toEqual(restoredSecond);
	});

	test("restores document-wide shared and distinct aliases across every entity collection", async () => {
		for (const topology of [
			{ name: "document-distinct-to-shared", baseShared: false },
			{ name: "document-shared-to-distinct", baseShared: true },
		] as const) {
			const privateValues = (shared: boolean) => {
				const first = { value: "provider-private" };
				return Array.from({ length: 8 }, () =>
					shared ? first : { value: "provider-private" },
				);
			};
			const baseValues = privateValues(topology.baseShared);
			const candidateValues = privateValues(!topology.baseShared);
			const tracks = [0, 1].map((index) => ({
				id: trackId(`${topology.name}-track-${index}`),
				kind: "graphic" as const,
				name: `track-${index}`,
				hidden: false,
				providerPrivate: baseValues[index],
			}));
			const clips = [0, 1].map((index) => ({
				id: clipId(`${topology.name}-clip-${index}`),
				trackId: tracks[index]!.id,
				startTime: mediaTime({ ticks: 0 }),
				duration: mediaTime({ ticks: 4_000 }),
				trimStart: mediaTime({ ticks: 0 }),
				trimEnd: mediaTime({ ticks: 0 }),
				providerPrivate: baseValues[index + 2],
			}));
			const assets = [0, 1].map((index) => ({
				id: assetId(`${topology.name}-asset-${index}`),
				kind: "image" as const,
				name: `asset-${index}`,
				providerPrivate: baseValues[index + 4],
			}));
			const markers = [0, 1].map((index) => ({
				id: markerId(`${topology.name}-marker-${index}`),
				time: mediaTime({ ticks: 0 }),
				providerPrivate: baseValues[index + 6],
			}));
			const seed = createTransactionNativeProjectSeed({
				projectId: PROJECT_ID,
				project: project(),
			});
			const seedDocument = (
				seed.record.data as {
					readonly transactionEngine: Readonly<Record<string, unknown>>;
				}
			).transactionEngine;
			const { store } = createInMemoryProjectStoreFixture();
			await store.save({
				record: {
					...seed.record,
					data: {
						...(seed.record.data as Readonly<Record<string, unknown>>),
						transactionEngine: {
							...seedDocument,
							tracks,
							clips,
							assets,
							markers,
						},
					},
				},
				summary: seed.summary,
			});
			const engine = await openTransactionEngine({
				store,
				projectId: PROJECT_ID,
				documentAdapter: createTransactionNativeDocumentAdapter(),
			});
			const committedState = bindNativeCommittedTransactionStateCapture(engine);
			if (committedState === undefined)
				throw new Error("Missing native capture");
			const manager = createDraftEditingManager({
				engine,
				retentionPolicy: createInMemoryDraftResourceRetentionPolicy(),
			});
			const opened = await manager.open({
				id: topology.name,
				approvalMode: "manual",
			});
			if (!opened.opened) throw new Error(opened.error.message);
			const staged = await opened.session.stage({
				operations: [
					...tracks.map((track, index) => ({
						kind: "update-track" as const,
						trackId: track.id,
						patch: { providerPrivate: candidateValues[index] } as never,
					})),
					...clips.map((entry, index) => ({
						kind: "update-clip" as const,
						clipId: entry.id,
						patch: {
							providerPrivate: candidateValues[index + 2],
						} as never,
					})),
					...markers.map((marker, index) => ({
						kind: "update-marker" as const,
						markerId: marker.id,
						patch: {
							providerPrivate: candidateValues[index + 6],
						} as never,
					})),
					...assets.map((asset) => ({
						kind: "delete-asset" as const,
						assetId: asset.id,
					})),
					...assets.map((asset, index) => ({
						kind: "create-asset" as const,
						asset: {
							...asset,
							providerPrivate: candidateValues[index + 4],
						},
					})),
				],
			});
			expect(staged.accepted, topology.name).toBe(true);
			const application = await opened.session.approve();
			if (!application.applied) {
				throw new Error(
					`${topology.name}: ${
						"draftError" in application
							? `${application.draftError.kind}: ${application.draftError.message}`
							: "parent engine failure"
					}`,
				);
			}
			expect(application.receipt.undoPlan.batch.operations).toHaveLength(10);
			const readPrivateValues = (
				document: Awaited<ReturnType<DraftCommittedStateCapture["capture"]>>,
			): unknown[] => [
				...(document.tracks as readonly unknown[]).map((entity) =>
					Reflect.get(entity as object, "providerPrivate"),
				),
				...(document.clips as readonly unknown[]).map((entity) =>
					Reflect.get(entity as object, "providerPrivate"),
				),
				...(document.assets as readonly unknown[]).map((entity) =>
					Reflect.get(entity as object, "providerPrivate"),
				),
				...(document.markers as readonly unknown[]).map((entity) =>
					Reflect.get(entity as object, "providerPrivate"),
				),
			];
			const appliedValues = readPrivateValues(await committedState.capture());
			expect(new Set(appliedValues).size, topology.name).toBe(
				topology.baseShared ? 8 : 1,
			);
			await engine.apply(application.receipt.undoPlan.batch);
			const restoredValues = readPrivateValues(await committedState.capture());
			expect(new Set(restoredValues).size, topology.name).toBe(
				topology.baseShared ? 1 : 8,
			);
			for (const value of restoredValues) {
				expect(value, topology.name).toEqual({ value: "provider-private" });
			}
		}
	});

	test("preserves cycles and Map/Set-contained aliases through an unrelated edit and undo", async () => {
		const shared: { value: string; self?: unknown } = { value: "shared" };
		shared.self = shared;
		const firstPrivate = new Map<unknown, unknown>([["shared", shared]]);
		const secondPrivate = new Set<unknown>([shared]);
		const seed = createTransactionNativeProjectSeed({
			projectId: PROJECT_ID,
			project: project(),
		});
		const seedDocument = (
			seed.record.data as {
				readonly transactionEngine: Readonly<Record<string, unknown>>;
			}
		).transactionEngine;
		const { store } = createInMemoryProjectStoreFixture();
		await store.save({
			record: {
				...seed.record,
				data: {
					...(seed.record.data as Readonly<Record<string, unknown>>),
					transactionEngine: {
						...seedDocument,
						markers: [
							{
								id: markerId("map-alias-marker"),
								time: mediaTime({ ticks: 0 }),
								note: "base",
								providerPrivate: firstPrivate,
							},
							{
								id: markerId("set-alias-marker"),
								time: mediaTime({ ticks: 0 }),
								providerPrivate: secondPrivate,
							},
						],
					},
				},
			},
			summary: seed.summary,
		});
		const engine = await openTransactionEngine({
			store,
			projectId: PROJECT_ID,
			documentAdapter: createTransactionNativeDocumentAdapter(),
		});
		const committedState = bindNativeCommittedTransactionStateCapture(engine);
		if (committedState === undefined) throw new Error("Missing native capture");
		const manager = createDraftEditingManager({
			engine,
			retentionPolicy: createInMemoryDraftResourceRetentionPolicy(),
		});
		const opened = await manager.open({
			id: "map-set-cycle-alias",
			approvalMode: "manual",
		});
		if (!opened.opened) throw new Error(opened.error.message);
		await opened.session.stage({
			operations: [
				{
					kind: "update-marker",
					markerId: markerId("map-alias-marker"),
					patch: { note: "forward" },
				},
			],
		});
		const application = await opened.session.approve();
		expect(application.applied).toBe(true);
		if (!application.applied) return;
		expect(application.receipt.undoPlan.batch.operations).toHaveLength(1);
		const assertTopology = async (note: string): Promise<void> => {
			const document = await committedState.capture();
			const map = Reflect.get(document.markers[0] as object, "providerPrivate");
			const set = Reflect.get(document.markers[1] as object, "providerPrivate");
			expect(map).toBeInstanceOf(Map);
			expect(set).toBeInstanceOf(Set);
			const fromMap = (map as Map<unknown, unknown>).get("shared") as {
				readonly self: unknown;
			};
			const fromSet = [...(set as Set<unknown>)][0] as object;
			expect(fromMap as unknown).toBe(fromSet);
			expect(fromMap.self).toBe(fromMap);
			expect(document.markers[0]?.note).toBe(note);
		};
		await assertTopology("forward");
		await engine.apply(application.receipt.undoPlan.batch);
		await assertTopology("base");
	});

	test("restores distinct and shared provider-private alias topology exactly", async () => {
		for (const topology of [
			{ name: "distinct-to-shared", baseShared: false, candidateShared: true },
			{ name: "shared-to-distinct", baseShared: true, candidateShared: false },
		] as const) {
			const privateData = (shared: boolean) => {
				const left = { value: "same" };
				return {
					left,
					right: shared ? left : { value: "same" },
				};
			};
			const basePrivateData = privateData(topology.baseShared);
			const candidatePrivateData = privateData(topology.candidateShared);
			const seed = createTransactionNativeProjectSeed({
				projectId: PROJECT_ID,
				project: project(),
			});
			const seedData = seed.record.data as {
				readonly transactionEngine: Readonly<Record<string, unknown>>;
			};
			const { store } = createInMemoryProjectStoreFixture();
			await store.save({
				record: {
					...seed.record,
					data: {
						...(seed.record.data as Readonly<Record<string, unknown>>),
						transactionEngine: {
							...seedData.transactionEngine,
							markers: [
								{
									id: markerId(`alias-${topology.name}`),
									time: mediaTime({ ticks: 0 }),
									providerPrivate: basePrivateData,
								},
							],
						},
					},
				},
				summary: seed.summary,
			});
			const engine = await openTransactionEngine({
				store,
				projectId: PROJECT_ID,
				documentAdapter: createTransactionNativeDocumentAdapter(),
			});
			const manager = createDraftEditingManager({
				engine,
				retentionPolicy: createInMemoryDraftResourceRetentionPolicy(),
			});
			const opened = await manager.open({
				id: `alias-${topology.name}`,
				approvalMode: "manual",
			});
			if (!opened.opened) throw new Error(opened.error.message);
			const staged = await opened.session.stage({
				operations: [
					{
						kind: "update-marker",
						markerId: markerId(`alias-${topology.name}`),
						patch: { providerPrivate: candidatePrivateData } as never,
					},
				],
			});
			expect(staged.accepted, topology.name).toBe(true);
			const application = await opened.session.approve();
			expect(application.applied, topology.name).toBe(true);
			if (!application.applied) continue;
			const appliedMarker = (await engine.markers())[0] as unknown as {
				readonly providerPrivate: {
					readonly left: { readonly value: string };
					readonly right: { readonly value: string };
				};
			};
			expect(
				appliedMarker.providerPrivate.left ===
					appliedMarker.providerPrivate.right,
				topology.name,
			).toBe(topology.candidateShared);
			await engine.apply(application.receipt.undoPlan.batch);
			const restoredMarker = (await engine.markers())[0] as unknown as {
				readonly providerPrivate: {
					readonly left: { readonly value: string };
					readonly right: { readonly value: string };
				};
			};
			expect(restoredMarker.providerPrivate, topology.name).toStrictEqual({
				left: { value: "same" },
				right: { value: "same" },
			});
			expect(
				restoredMarker.providerPrivate.left ===
					restoredMarker.providerPrivate.right,
				topology.name,
			).toBe(topology.baseShared);
		}
	});

	test("sanitizes adversarial engine error evidence without invoking getters", async () => {
		class AdversarialEngineError extends Error {}
		class NestedEngineError extends Error {}

		let getterReads = 0;
		const live = { value: 1 };
		const nested = new NestedEngineError("nested");
		const seven = BigInt("7");
		const mapEvidence = new Map<unknown, unknown>([["entry", { value: 7 }]]);
		mapEvidence.set("self", mapEvidence);
		const setEvidence = new Set<unknown>(["alpha"]);
		setEvidence.add(setEvidence);
		const dateEvidence = new Date("2026-01-02T03:04:05.000Z");
		const regexpEvidence = /draft/gi;
		regexpEvidence.lastIndex = 3;
		const dateMetadata: { owner?: unknown } = {};
		const regexpMetadata: { owner?: unknown } = {};
		dateMetadata.owner = dateEvidence;
		regexpMetadata.owner = regexpEvidence;
		Object.defineProperty(dateEvidence, "metadata", {
			enumerable: true,
			value: dateMetadata,
		});
		Object.defineProperty(regexpEvidence, "metadata", {
			enumerable: true,
			value: regexpMetadata,
		});
		const evidence: {
			nested: Error;
			bigint: bigint;
			symbol: symbol;
			fn: () => number;
			map: Map<unknown, unknown>;
			set: Set<unknown>;
			date: Date;
			regexp: RegExp;
			self?: unknown;
		} = {
			nested,
			bigint: seven,
			symbol: Symbol("engine-evidence"),
			fn: () => live.value,
			map: mapEvidence,
			set: setEvidence,
			date: dateEvidence,
			regexp: regexpEvidence,
		};
		evidence.self = evidence;
		const thrown = new AdversarialEngineError("adversarial");
		Object.defineProperty(thrown, "live", {
			enumerable: true,
			get() {
				getterReads += 1;
				return live.value;
			},
		});
		Object.defineProperty(thrown, "evidence", {
			enumerable: true,
			value: evidence,
		});

		const fixture = await createFactory()();
		const failingEngine = new Proxy(fixture.engine, {
			get(target, property) {
				if (property === "apply") {
					return async () => {
						throw thrown;
					};
				}
				const value = Reflect.get(target, property, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		const manager = createDraftEditingManager({
			engine: failingEngine,
			committedState: fixture.committedState,
			retentionPolicy: createInMemoryDraftResourceRetentionPolicy(),
		});
		const opened = await manager.open({
			id: "adversarial-error",
			approvalMode: "manual",
		});
		if (!opened.opened) throw new Error(opened.error.message);
		await opened.session.stage({
			operations: [
				{
					kind: "create-track",
					track: {
						id: "adversarial-track" as never,
						kind: "graphic",
						name: "adversarial",
						hidden: false,
					},
				},
			],
		});
		const outcome = await opened.session.approve();
		expect(outcome.applied).toBe(false);
		expect(getterReads).toBe(0);
		if (outcome.applied || !("engineError" in outcome)) return;
		const cloned = outcome.engineError as Error & {
			readonly live?: unknown;
			readonly evidence: typeof evidence;
		};
		expect(cloned).toBeInstanceOf(Error);
		expect(cloned).not.toBeInstanceOf(AdversarialEngineError);
		expect(cloned.message).toBe("adversarial");
		expect(cloned.live).toBeUndefined();
		expect(getterReads).toBe(0);
		expect(Object.isFrozen(cloned)).toBe(true);
		expect(Object.isFrozen(cloned.evidence)).toBe(true);
		expect(Object.isFrozen(cloned.evidence.nested)).toBe(true);
		expect(cloned.evidence.nested).toBeInstanceOf(Error);
		expect(cloned.evidence.nested).not.toBeInstanceOf(NestedEngineError);
		expect(cloned.evidence.self).toBe(cloned.evidence);
		expect(cloned.evidence.bigint).toBe(seven);
		expect(typeof cloned.evidence.symbol).toBe("symbol");
		expect(cloned.evidence.fn).toBe("[unavailable function evidence]" as never);
		const builtinSnapshots = cloned.evidence as unknown as {
			readonly map: {
				readonly evidenceType: "Map";
				readonly entries: readonly (readonly [unknown, unknown])[];
			};
			readonly set: {
				readonly evidenceType: "Set";
				readonly values: readonly unknown[];
			};
			readonly date: {
				readonly evidenceType: "Date";
				readonly timestamp: number;
				readonly properties: {
					readonly metadata: { readonly owner: unknown };
				};
			};
			readonly regexp: {
				readonly evidenceType: "RegExp";
				readonly source: string;
				readonly flags: string;
				readonly lastIndex: number;
				readonly properties: {
					readonly metadata: { readonly owner: unknown };
				};
			};
		};
		expect(builtinSnapshots.map.evidenceType).toBe("Map");
		expect(builtinSnapshots.map.entries[0]).toEqual(["entry", { value: 7 }]);
		expect(builtinSnapshots.map.entries[1]?.[1]).toBe(builtinSnapshots.map);
		expect(Object.isFrozen(builtinSnapshots.map.entries)).toBe(true);
		expect(Object.isFrozen(builtinSnapshots.map.entries[0]?.[1])).toBe(true);
		expect(builtinSnapshots.set.evidenceType).toBe("Set");
		expect(builtinSnapshots.set.values[0]).toBe("alpha");
		expect(builtinSnapshots.set.values[1]).toBe(builtinSnapshots.set);
		expect(builtinSnapshots.date).toMatchObject({
			evidenceType: "Date",
			timestamp: Date.parse("2026-01-02T03:04:05.000Z"),
		});
		expect(builtinSnapshots.date.properties.metadata.owner).toBe(
			builtinSnapshots.date,
		);
		expect(builtinSnapshots.regexp).toMatchObject({
			evidenceType: "RegExp",
			source: "draft",
			flags: "gi",
			lastIndex: 3,
		});
		expect(builtinSnapshots.regexp.properties.metadata.owner).toBe(
			builtinSnapshots.regexp,
		);
		live.value = 2;
		evidence.bigint = BigInt("8");
		mapEvidence.set("late", 9);
		setEvidence.add("late");
		dateEvidence.setUTCFullYear(2030);
		regexpEvidence.lastIndex = 9;
		expect(cloned.live).toBeUndefined();
		expect(cloned.evidence.bigint).toBe(seven);
		expect(builtinSnapshots.map.entries).toHaveLength(2);
		expect(builtinSnapshots.set.values).toHaveLength(2);
		expect(builtinSnapshots.date.timestamp).toBe(
			Date.parse("2026-01-02T03:04:05.000Z"),
		);
		expect(builtinSnapshots.regexp.lastIndex).toBe(3);
		expect(
			Reflect.set(builtinSnapshots.map.entries[0]![1] as object, "value", 8),
		).toBe(false);
		expect(getterReads).toBe(0);
	});

	test("validates snapshot-attempt configuration", () => {
		const engine = {} as TransactionEngine;
		const retentionPolicy = createInMemoryDraftResourceRetentionPolicy();
		expect(() =>
			createDraftEditingManager({
				engine,
				retentionPolicy,
				snapshotAttempts: 0,
			}),
		).toThrow("positive integer");
		expect(Number(revisionOf(0))).toBe(0);
	});
});
