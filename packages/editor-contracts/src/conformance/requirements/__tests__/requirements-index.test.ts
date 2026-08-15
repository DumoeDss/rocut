import { describe, expect, test } from "bun:test";

import type { ProjectRecord } from "@opencut/editor-ports";
import { createInMemoryProjectStoreFixture } from "@opencut/editor-ports/in-memory";

import type { Project, Revision, TransactionBatch } from "../../..";
import {
	createInMemoryTransactionStore,
	mediaTime,
	projectId,
	revisionOf,
} from "../../..";
import {
	createTransactionNativeDocumentAdapter,
	createTransactionNativeProjectSeed,
	openTransactionEngine,
} from "../../../engine";
import type { TransactionEngine } from "../../../engine";
import { bindNativeCommittedTransactionStateCapture } from "../../../engine/engine";
import { createDraftEditingManager } from "../../../draft/manager";
import { createInMemoryDraftResourceRetentionPolicy } from "../../../draft/retention";
import type {
	DraftEditingConformanceFactory,
	DraftEditingConformanceFactoryOptions,
} from "../../../draft/conformance";
import { runDraftEditingConformance } from "../../../draft/conformance";
import type {
	TransactionEngineConformanceFactory,
	TransactionEngineConformanceFactoryOptions,
} from "../../../engine/conformance";
import { runTransactionEngineConformance } from "../../../engine/conformance";
import { createDurableVectorTargetFactory } from "../../../vectors/drivers/durable";
import { createInMemoryVectorTargetFactory } from "../../../vectors/drivers/in-memory";
import { runTransactionVectors } from "../../../vectors/runner";
import {
	PUBLISHED_CONTRACT_SURFACE,
	readPublishedCorpusText,
} from "../../../vectors/corpus";
import { loadTransactionVectorCorpus } from "../../../vectors/loader";
import { runTransactionConformance } from "../../index";
import {
	DRAFT_EDITING_CONFORMANCE_REQUIREMENTS,
	TRANSACTION_CONFORMANCE_REQUIREMENTS,
	TRANSACTION_ENGINE_CONFORMANCE_REQUIREMENTS,
	TRANSACTION_VECTOR_REQUIREMENTS,
	formatConformanceFailures,
	requirementOf,
	vectorRequirementOf,
} from "..";

/**
 * The requirement-index drift guard (S05 P3, spec scenario "The index cannot
 * drift from the suites").
 *
 * Runs every suite in this package against its reference implementation — the
 * in-memory transaction store, the ProjectStore-backed engine, the reference
 * Draft manager, and both vector target factories — and refuses any reported
 * case name or vector id that has no index row. A case renamed or added in a
 * suite without a row here turns this test red rather than shipping a reader a
 * name the formatter cannot attribute.
 */

const ENGINE_PROJECT_ID = "engine-project";
const DRAFT_PROJECT_ID = "draft-project";

function engineProject(): Project {
	return {
		id: projectId(ENGINE_PROJECT_ID),
		name: "Engine conformance",
		frameRate: { numerator: 30, denominator: 1 },
		canvasWidth: 1920,
		canvasHeight: 1080,
	};
}

/**
 * The T0 leg of engine conformance runs the unchanged transaction suite, whose
 * samples predate placement policy; this test-only composer makes those
 * samples placement-valid without touching the suite. Mirrors the reference
 * fixture in `engine/__tests__/engine.test.ts`.
 */
async function placementCompatibleContractBatch<
	FeatureName extends string,
>(args: {
	readonly engine: TransactionEngine<FeatureName>;
	readonly batch: TransactionBatch;
}): Promise<TransactionBatch> {
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
			const value = Reflect.get(target, property);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

function createEngineFactory(): TransactionEngineConformanceFactory {
	return async (
		factoryOptions: TransactionEngineConformanceFactoryOptions = {},
	) => {
		const { store, control } = createInMemoryProjectStoreFixture();
		const seed = createTransactionNativeProjectSeed({
			projectId: ENGINE_PROJECT_ID,
			project: engineProject(),
			opaque: factoryOptions.opaque,
		});
		await store.save(seed);
		let saves = 0;
		const originalSave = store.save.bind(store);
		store.save = async (args) => {
			saves += 1;
			return originalSave(args);
		};
		const adapter = createTransactionNativeDocumentAdapter({
			now: () => "2026-01-01T00:00:01.000Z",
		});
		const open = async (): Promise<TransactionEngine> => {
			const opened = await openTransactionEngine({
				store,
				projectId: ENGINE_PROJECT_ID,
				documentAdapter: adapter,
				placementPolicies: factoryOptions.placementPolicies,
				optionalFeatures: factoryOptions.optionalFeatures,
			});
			return factoryOptions.profile === "contract"
				? composeContractProfile(opened)
				: opened;
		};
		const engine = await open();
		return {
			engine,
			reopen: open,
			async readPersistedRecord(): Promise<ProjectRecord> {
				const loaded = await store.load({ id: ENGINE_PROJECT_ID });
				if (!loaded) throw new Error("persisted record disappeared");
				return loaded;
			},
			saveCount: () => saves,
			failNextSave: () =>
				control.failNext({ operation: "save-project", code: "quota-exceeded" }),
			pauseNextSave: () =>
				control.pauseNext({ operation: "save-project" }),
		};
	};
}

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
			const value = Reflect.get(target, property);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

function createDraftFactory(): DraftEditingConformanceFactory {
	return async (
		options: DraftEditingConformanceFactoryOptions = {},
	) => {
		const { store } = createInMemoryProjectStoreFixture();
		await store.save(
			createTransactionNativeProjectSeed({
				projectId: DRAFT_PROJECT_ID,
				project: {
					id: projectId(DRAFT_PROJECT_ID),
					name: "Draft index guard",
					frameRate: { numerator: 30, denominator: 1 },
					canvasWidth: 1920,
					canvasHeight: 1080,
				},
			}),
		);
		let saves = 0;
		const originalSave = store.save.bind(store);
		store.save = async (input) => {
			saves += 1;
			return originalSave(input);
		};
		const rawEngine = await openTransactionEngine({
			store,
			projectId: DRAFT_PROJECT_ID,
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
		const manager = createDraftEditingManager({
			engine,
			committedState,
			retentionPolicy: retention,
			placementPolicies: options.placementPolicies,
			snapshotAttempts: options.snapshotAttempts,
		});
		return {
			manager,
			engine,
			retention,
			saveCount: () => saves,
			applyCount: () => applies,
			watchCount: () => watches,
		};
	};
}

/** The shared guard predicate: names with no index row, or `[]` when clean. */
function missingRows(names: readonly string[]): string[] {
	return names.filter((name) => requirementOf(name) === undefined);
}

describe("the transaction-family requirement index", () => {
	test("every case name every suite reports has an index row", async () => {
		const transactionStore = createInMemoryTransactionStore();
		(
			transactionStore as ReturnType<
				typeof createInMemoryTransactionStore
			> & { _setProject(value: Project): void }
		)._setProject({
			id: projectId("in-memory-project"),
			name: "In-memory Project",
			frameRate: { numerator: 30, denominator: 1 },
			canvasWidth: 1920,
			canvasHeight: 1080,
		});
		const transaction = await runTransactionConformance({
			target: {
				read: transactionStore,
				apply: transactionStore,
				getContext: transactionStore,
				watch: transactionStore,
			},
			label: "requirement-index guard (T0)",
		});
		expect(transaction.passed).toBe(true);
		expect(missingRows(transaction.results.map((r) => r.name))).toEqual([]);

		const engine = await runTransactionEngineConformance(
			createEngineFactory(),
			{ "provider-ripple-edit": true },
		);
		expect(engine.passed).toBe(true);
		expect(missingRows(engine.results.map((r) => r.name))).toEqual([]);

		const draft = await runDraftEditingConformance(createDraftFactory(), {
			"provider-draft-placement": true,
		});
		expect(draft.passed).toBe(true);
		expect(missingRows(draft.results.map((r) => r.name))).toEqual([]);

		const { manifestText, files } = readPublishedCorpusText();
		const corpus = loadTransactionVectorCorpus({
			manifestText,
			files,
			contract: PUBLISHED_CONTRACT_SURFACE,
		});
		for (const open of [
			createInMemoryVectorTargetFactory(),
			createDurableVectorTargetFactory(),
		]) {
			const vectors = await runTransactionVectors({ corpus, contract: PUBLISHED_CONTRACT_SURFACE, open });
			expect(vectors.verdict).toBe("passed");
			expect(
				vectors.results
					.map((result) => result.id)
					.filter((id) => vectorRequirementOf(id) === undefined),
			).toEqual([]);
		}
	});

	test("no index row is a name no suite run reports (stale rows)", async () => {
		// The converse of the guard above: a row whose case never appears is a
		// stale spelling left behind by a rename, and the formatter would render
		// it for nothing. Every row must be exercised by at least one run.
		const transactionStore = createInMemoryTransactionStore();
		const transaction = await runTransactionConformance({
			target: {
				read: transactionStore,
				apply: transactionStore,
				getContext: transactionStore,
				watch: transactionStore,
			},
			label: "requirement-index guard (T0, unseeded)",
		});
		const engine = await runTransactionEngineConformance(
			createEngineFactory(),
			{ "provider-ripple-edit": true },
		);
		const draft = await runDraftEditingConformance(createDraftFactory());
		const reported = new Set<string>([
			...transaction.results.map((r) => r.name),
			...engine.results.map((r) => r.name),
			...draft.results.map((r) => r.name),
		]);
		expect(
			Object.keys(TRANSACTION_CONFORMANCE_REQUIREMENTS).filter(
				(name) => !reported.has(name),
			),
		).toEqual([]);
		expect(
			Object.keys(TRANSACTION_ENGINE_CONFORMANCE_REQUIREMENTS).filter(
				(name) => !reported.has(name),
			),
		).toEqual([]);
		expect(
			Object.keys(DRAFT_EDITING_CONFORMANCE_REQUIREMENTS).filter(
				(name) => !reported.has(name),
			),
		).toEqual([]);

		const { manifestText, files } = readPublishedCorpusText();
		const corpus = loadTransactionVectorCorpus({
			manifestText,
			files,
			contract: PUBLISHED_CONTRACT_SURFACE,
		});
		const vectors = await runTransactionVectors({
			corpus,
			contract: PUBLISHED_CONTRACT_SURFACE,
			open: createDurableVectorTargetFactory(),
		});
		const reportedVectorIds = new Set(vectors.results.map((r) => r.id));
		expect(
			Object.keys(TRANSACTION_VECTOR_REQUIREMENTS).filter(
				(id) => !reportedVectorIds.has(id),
			),
		).toEqual([]);
	});

	test("a synthetic renamed case fails the guard (violation-and-revert)", async () => {
		// Prove the guard discriminates: rename one real reported case and
		// require the same predicate to flag it, then confirm the unmodified
		// report stays clean. This is the drift the guard exists to catch — a
		// suite case renamed without its index row moving with it.
		const transactionStore = createInMemoryTransactionStore();
		const report = await runTransactionConformance({
			target: {
				read: transactionStore,
				apply: transactionStore,
				getContext: transactionStore,
				watch: transactionStore,
			},
			label: "requirement-index guard (T0, violation leg)",
		});
		const realName = report.results[0]!.name;
		const renamed = `renamed-by-violation: ${realName}`;
		const withRenamedCase = [
			renamed,
			...report.results.slice(1).map((r) => r.name),
		];
		expect(missingRows(withRenamedCase)).toEqual([renamed]);
		expect(requirementOf(renamed)).toBeUndefined();
		// Revert: the unmodified report is clean.
		expect(
			missingRows(report.results.map((r) => r.name)),
		).toEqual([]);
	});

	test("the formatter renders requirement-first with no stack, on a real failing report", async () => {
		// Task 3.3's formatter proof on real input: a deliberately failing
		// reference target — the in-memory store with a revision that never
		// moves. Rendered through the published formatter, the first failure
		// names the frozen requirement before the case, and the output carries
		// no stack frames.
		const real = createInMemoryTransactionStore();
		const frozenRevision: typeof real = {
			...real,
			revision: async () => revisionOf(0),
		};
		const report = await runTransactionConformance({
			target: {
				read: frozenRevision,
				apply: real,
				getContext: real,
				watch: real,
			},
			label: "stale-revision target",
		});
		expect(report.passed).toBe(false);
		const rendered = formatConformanceFailures(report);
		// eslint-disable-next-line no-console -- the worked example in the entry's docs is this capture.
		console.log(rendered);
		const firstFailure = report.results.find(
			(result) => result.status === "failed",
		);
		expect(firstFailure).toBeDefined();
		const entry = requirementOf(firstFailure!.name);
		expect(entry).toBeDefined();
		const requirementLine = `[${entry!.requirement}]`;
		expect(rendered).toContain(requirementLine);
		expect(rendered.indexOf(requirementLine)).toBeLessThan(
			rendered.indexOf(`case: ${firstFailure!.name}`),
		);
		expect(rendered).not.toMatch(/\n\s*at\s/);
		expect(rendered).not.toMatch(/    at /);
	});
});
