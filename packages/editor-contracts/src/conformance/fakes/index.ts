/**
 * @opencutSurface experimental — adapter-author ProjectStore fixture assembly forced by the copyable scaffold and requirement-index guard
 */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Published vector wire values are converted into branded contract values at this boundary. */
import type {
	ProjectRecord,
	ProjectStore,
	ProjectSummary,
} from "@opencut/editor-ports";
import { ProjectStoreError } from "@opencut/editor-ports";

import type {
	Project,
	Revision,
	TransactionBatch,
	TransactionOperation,
} from "../..";
import { mediaTime, projectId } from "../..";
import type {
	DraftEditingConformanceFactory,
	DraftEditingConformanceFactoryOptions,
} from "../../draft/conformance";
import { createDraftEditingManager } from "../../draft/manager";
import { createInMemoryDraftResourceRetentionPolicy } from "../../draft/retention";
import {
	createTransactionNativeDocumentAdapter,
	createTransactionNativeProjectSeed,
	openTransactionEngine,
} from "../../engine";
import { bindNativeCommittedTransactionStateCapture } from "../../engine/engine";
import type {
	TransactionEngineConformanceFactory,
	TransactionEngineConformanceFactoryOptions,
	TransactionEngineConformancePause,
} from "../../engine/conformance";
import type { TransactionEngine } from "../../engine/types";
import type { VectorTargetFactory, VectorTargetHandle } from "../../vectors/runner";
import type { VectorSeedDocument } from "../../vectors/schema";

const ENGINE_PROJECT_ID = projectId("engine-project");
const DRAFT_PROJECT_ID = projectId("draft-project");
const VECTOR_PROJECT_ID = projectId("contract-fakes-vector-project");
const FIXTURE_NOW = "2026-01-01T00:00:01.000Z";

export interface ProjectStoreConformanceFactories {
	readonly engine: TransactionEngineConformanceFactory;
	readonly draft: DraftEditingConformanceFactory;
	readonly vectors: VectorTargetFactory;
}

interface ObservedStore {
	readonly store: ProjectStore;
	saveCount(): number;
	resetSaveCount(): void;
	failNextSave(): void;
	pauseNextSave(): TransactionEngineConformancePause;
}

interface PendingPause extends TransactionEngineConformancePause {
	enter(): void;
	readonly gate: Promise<void>;
}

function fixtureProject(args: {
	readonly id: ReturnType<typeof projectId>;
	readonly name: string;
}): Project {
	return {
		id: args.id,
		name: args.name,
		frameRate: { numerator: 30, denominator: 1 },
		canvasWidth: 1920,
		canvasHeight: 1080,
	};
}

function setupError(args: { readonly context: string; readonly error: unknown }): Error {
	if (args.error instanceof ProjectStoreError) return args.error;
	const detail =
		args.error instanceof Error ? args.error.message : String(args.error);
	const message = `contract fakes: ${args.context}: ${detail}`;
	return args.error instanceof TypeError ? new TypeError(message) : new Error(message);
}

async function setupStep<Result>(args: {
	readonly context: string;
	readonly run: () => Result | Promise<Result>;
}): Promise<Result> {
	try {
		return await args.run();
	} catch (error) {
		throw setupError({ context: args.context, error });
	}
}

function assertUsableStore(value: unknown): asserts value is ProjectStore {
	if (value === null || typeof value !== "object") {
		throw new TypeError("createStore must resolve to a ProjectStore object");
	}
	const candidate = value as Partial<ProjectStore>;
	if (typeof candidate.schemaVersion !== "number") {
		throw new TypeError("ProjectStore.schemaVersion must be a number");
	}
	for (const method of ["load", "save"] as const) {
		if (typeof candidate[method] !== "function") {
			throw new TypeError(`ProjectStore.${method} must be a function`);
		}
	}
}

function createPause(): PendingPause {
	let enter!: () => void;
	let releaseGate!: () => void;
	let released = false;
	const entered = new Promise<void>((resolve) => {
		enter = resolve;
	});
	const gate = new Promise<void>((resolve) => {
		releaseGate = resolve;
	});
	return {
		entered,
		gate,
		enter,
		release() {
			if (released) return;
			released = true;
			releaseGate();
		},
	};
}

function observeStore(authorStore: ProjectStore): ObservedStore {
	let saves = 0;
	let failNext = false;
	let pendingPause: PendingPause | undefined;

	const save = async (args: {
		record: ProjectRecord;
		summary: ProjectSummary;
		signal?: AbortSignal;
	}): Promise<void> => {
		saves += 1;
		const pause = pendingPause;
		pendingPause = undefined;
		if (pause) {
			pause.enter();
			await pause.gate;
		}
		if (failNext) {
			failNext = false;
			throw new ProjectStoreError({
				code: "quota-exceeded",
				operation: "save-project",
				scope: { kind: "project", projectId: args.record.id },
				message: "contract fakes: requested next-save failure",
			});
		}
		await authorStore.save(args);
	};

	const store = new Proxy(authorStore, {
		get(target, property) {
			if (property === "save") return save;
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});

	return {
		store,
		saveCount: () => saves,
		resetSaveCount: () => {
			saves = 0;
		},
		failNextSave: () => {
			failNext = true;
		},
		pauseNextSave: () => {
			if (pendingPause) {
				throw new Error("contract fakes: a next-save pause is already pending");
			}
			pendingPause = createPause();
			return pendingPause;
		},
	};
}

async function acquireObservedStore(args: {
	readonly createStore: () => ProjectStore | Promise<ProjectStore>;
	readonly purpose: "engine" | "draft" | "vector";
}): Promise<ObservedStore> {
	const authorStore = await setupStep({
		context: `${args.purpose} createStore`,
		run: async () => {
			const candidate: unknown = await args.createStore();
			assertUsableStore(candidate);
			return candidate;
		},
	});
	return observeStore(authorStore);
}

async function placementCompatibleContractBatch<FeatureName extends string>(args: {
	readonly engine: TransactionEngine<FeatureName>;
	readonly batch: TransactionBatch;
}): Promise<TransactionBatch> {
	const trackEnds = new Map<string, number>();
	for (const existing of await args.engine.clips()) {
		trackEnds.set(
			existing.trackId,
			Math.max(
				trackEnds.get(existing.trackId) ?? 0,
				Number(existing.startTime) + Number(existing.duration),
			),
		);
	}
	return {
		...args.batch,
		operations: args.batch.operations.map((operation) => {
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

function bindDraftEngine<FeatureName extends string>(args: {
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

function vectorSeedOperations(
	document: VectorSeedDocument,
): readonly TransactionOperation[] {
	return [
		...document.tracks.map((track) => ({ kind: "create-track", track })),
		...document.assets.map((asset) => ({ kind: "create-asset", asset })),
		...document.clips.map((clip) => ({ kind: "create-clip", clip })),
		...document.markers.map((marker) => ({ kind: "create-marker", marker })),
	] as unknown as readonly TransactionOperation[];
}

export function createProjectStoreConformanceFactories(args: {
	readonly createStore: () => ProjectStore | Promise<ProjectStore>;
}): ProjectStoreConformanceFactories {
	if (args === null || typeof args !== "object") {
		throw new TypeError("contract fakes: options must be an object");
	}
	if (typeof args.createStore !== "function") {
		throw new TypeError("contract fakes: createStore must be a function");
	}

	const engine: TransactionEngineConformanceFactory = async (
		options: TransactionEngineConformanceFactoryOptions = {},
	) => {
		const observed = await acquireObservedStore({
			createStore: args.createStore,
			purpose: "engine",
		});
		const seed = createTransactionNativeProjectSeed({
			projectId: ENGINE_PROJECT_ID,
			project: fixtureProject({
				id: ENGINE_PROJECT_ID,
				name: "Contract fakes engine",
			}),
			opaque: options.opaque,
		});
		await setupStep({
			context: "engine seed",
			run: () => observed.store.save(seed),
		});
		observed.resetSaveCount();
		const documentAdapter = createTransactionNativeDocumentAdapter({
			now: () => FIXTURE_NOW,
		});
		const open = async (): Promise<TransactionEngine> => {
			const opened = await setupStep({
				context: "engine open",
				run: () =>
					openTransactionEngine({
						store: observed.store,
						projectId: ENGINE_PROJECT_ID,
						documentAdapter,
						placementPolicies: options.placementPolicies,
						optionalFeatures: options.optionalFeatures,
					}),
			});
			return options.profile === "contract"
				? composeContractProfile(opened)
				: opened;
		};
		const opened = await open();
		return {
			engine: opened,
			reopen: open,
			async readPersistedRecord(): Promise<ProjectRecord> {
				const record = await observed.store.load({ id: ENGINE_PROJECT_ID });
				if (record === null) {
					throw new Error(
						"contract fakes: engine persisted record disappeared",
					);
				}
				return record;
			},
			saveCount: observed.saveCount,
			failNextSave: observed.failNextSave,
			pauseNextSave: observed.pauseNextSave,
		};
	};

	const draft: DraftEditingConformanceFactory = async (
		options: DraftEditingConformanceFactoryOptions = {},
	) => {
		const observed = await acquireObservedStore({
			createStore: args.createStore,
			purpose: "draft",
		});
		await setupStep({
			context: "draft seed",
			run: () =>
				observed.store.save(
					createTransactionNativeProjectSeed({
						projectId: DRAFT_PROJECT_ID,
						project: fixtureProject({
							id: DRAFT_PROJECT_ID,
							name: "Contract fakes draft",
						}),
					}),
				),
		});
		observed.resetSaveCount();
		const rawEngine = await setupStep({
			context: "draft engine open",
			run: () =>
				openTransactionEngine({
					store: observed.store,
					projectId: DRAFT_PROJECT_ID,
					documentAdapter: createTransactionNativeDocumentAdapter({
						now: () => FIXTURE_NOW,
					}),
					placementPolicies: options.placementPolicies,
					optionalFeatures: options.optionalFeatures,
				}),
		});
		const committedState =
			bindNativeCommittedTransactionStateCapture(rawEngine);
		if (committedState === undefined) {
			throw new Error(
				"contract fakes: draft engine did not expose committed-state capture",
			);
		}
		if (options.seedOperations && options.seedOperations.length > 0) {
			await setupStep({
				context: "draft seed operations",
				run: () => rawEngine.apply({ operations: options.seedOperations ?? [] }),
			});
			observed.resetSaveCount();
		}
		let applies = 0;
		let watches = 0;
		rawEngine.watch(() => {
			watches += 1;
		});
		const boundEngine = bindDraftEngine({
			engine: rawEngine,
			revisions: options.snapshotRevisionSequence,
			onApply: () => {
				applies += 1;
			},
		});
		const retention = createInMemoryDraftResourceRetentionPolicy({
			retainedAssetIds: options.retainedAssetIds,
		});
		const manager = await setupStep({
			context: "draft manager setup",
			run: () =>
				createDraftEditingManager({
					engine: boundEngine,
					committedState,
					retentionPolicy: retention,
					placementPolicies: options.placementPolicies,
					snapshotAttempts: options.snapshotAttempts,
				}),
		});
		return {
			manager,
			engine: boundEngine,
			retention,
			saveCount: observed.saveCount,
			applyCount: () => applies,
			watchCount: () => watches,
		};
	};

	const openVector = async (vectorArgs: {
		readonly project: unknown;
		readonly document?: VectorSeedDocument;
	}): Promise<VectorTargetHandle> => {
		const observed = await acquireObservedStore({
			createStore: args.createStore,
			purpose: "vector",
		});
		const wireProject = vectorArgs.project as Project;
		const vectorProject = {
			...wireProject,
			id: projectId(String(wireProject.id)),
		};
		await setupStep({
			context: "vector seed",
			run: () =>
				observed.store.save(
					createTransactionNativeProjectSeed({
						projectId: vectorProject.id,
						project: vectorProject,
					}),
				),
		});
		observed.resetSaveCount();
		const vectorEngine = await setupStep({
			context: "vector engine open",
			run: () =>
				openTransactionEngine({
					store: observed.store,
					projectId: vectorProject.id,
					documentAdapter: createTransactionNativeDocumentAdapter({
						now: () => FIXTURE_NOW,
					}),
				}),
		});
		if (vectorArgs.document) {
			const operations = vectorSeedOperations(vectorArgs.document);
			if (operations.length > 0) {
				await setupStep({
					context: "vector seed operations",
					run: () => vectorEngine.apply({ operations }),
				});
			}
		}
		return { target: vectorEngine };
	};

	return {
		engine,
		draft,
		vectors: {
			name: "project-store-conformance-fakes",
			openSeeded: ({ document }) =>
				openVector({ project: document.project, document }),
			openRelative: () =>
				openVector({
					project: fixtureProject({
						id: VECTOR_PROJECT_ID,
						name: "Contract fakes vector",
					}),
				}),
		},
	};
}
