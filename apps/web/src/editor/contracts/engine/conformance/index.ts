import type {
	ConformanceCaseResult,
	ConformanceReport,
	TransactionConformanceTarget,
} from "../../conformance";
import { runTransactionConformance } from "../../conformance";
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
import type {
	TransactionEngine,
	TransactionEngineOptionalFeatures,
	TransactionPlacementPolicy,
} from "../types";

export interface TransactionEngineConformancePause {
	readonly entered: Promise<void>;
	release(): void;
}

export interface TransactionEngineConformanceFixture<
	FeatureName extends string = string,
> {
	readonly engine: TransactionEngine<FeatureName>;
	reopen(): Promise<TransactionEngine<FeatureName>>;
	readPersistedRecord(): Promise<ProjectRecord>;
	saveCount(): number;
	failNextSave(): void;
	pauseNextSave(): TransactionEngineConformancePause;
}

export interface TransactionEngineConformanceFactoryOptions<
	FeatureName extends string = string,
> {
	readonly profile?: "contract" | "engine";
	readonly opaque?: Readonly<Record<string, unknown>>;
	readonly optionalFeatures?: TransactionEngineOptionalFeatures<FeatureName>;
	readonly placementPolicies?: readonly TransactionPlacementPolicy[];
}

export type TransactionEngineConformanceFactory<
	FeatureName extends string = string,
> = (
	options?: TransactionEngineConformanceFactoryOptions<FeatureName>,
) => Promise<TransactionEngineConformanceFixture<FeatureName>>;

type CaseAssert = (condition: unknown, message: string) => asserts condition;

class Cases {
	readonly results: ConformanceCaseResult[] = [];

	async check(
		...[name, run]: readonly [string, (assert: CaseAssert) => Promise<void>]
	): Promise<void> {
		let assertionCount = 0;
		const assert: CaseAssert = (condition, message) => {
			assertionCount += 1;
			if (!condition) throw new Error(message);
		};
		try {
			await run(assert);
			this.results.push(
				assertionCount === 0
					? {
							name,
							status: "skipped",
							passed: false,
							detail: "case executed no assertion",
						}
					: { name, status: "passed", passed: true },
			);
		} catch (error) {
			this.results.push({
				name,
				status: "failed",
				passed: false,
				detail: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function makeProject(id = "engine-project"): Project {
	return {
		id: projectId(id),
		name: "Engine conformance",
		frameRate: { numerator: 30, denominator: 1 },
		canvasWidth: 1920,
		canvasHeight: 1080,
	};
}

function videoTrack(id: string) {
	return { id: trackId(id), kind: "video" as const, name: id, hidden: false };
}

function textTrack(id: string) {
	return { id: trackId(id), kind: "text" as const, name: id, hidden: false };
}

function videoAsset(args: { readonly id: string; readonly duration?: number }) {
	const { id, duration = 120_000 } = args;
	return {
		id: assetId(id),
		kind: "video" as const,
		name: id,
		duration: mediaTime({ ticks: duration }),
	};
}

function clip(args: {
	readonly id: string;
	readonly trackId: string;
	readonly start?: number;
	readonly duration?: number;
	readonly assetId?: string;
}) {
	return {
		id: clipId(args.id),
		trackId: trackId(args.trackId),
		startTime: mediaTime({ ticks: args.start ?? 0 }),
		duration: mediaTime({ ticks: args.duration ?? 4_000 }),
		trimStart: mediaTime({ ticks: 0 }),
		trimEnd: mediaTime({ ticks: 0 }),
		...(args.assetId ? { assetId: assetId(args.assetId) } : {}),
	};
}

function targetOf(engine: TransactionEngine): TransactionConformanceTarget {
	return { read: engine, apply: engine, getContext: engine, watch: engine };
}

function basicBatch(id: string): TransactionBatch {
	return { operations: [{ kind: "create-track", track: videoTrack(id) }] };
}

/**
 * Run the engine matrix for any provider feature set. Supplying
 * `optionalFeatures` adds runtime checks for those exact literal keys; omitting
 * it preserves the original one-argument, base-capability-only entry point.
 */
export async function runTransactionEngineConformance<
	FeatureName extends string = string,
>(
	factory: TransactionEngineConformanceFactory<FeatureName>,
	optionalFeatures?: TransactionEngineOptionalFeatures<FeatureName>,
): Promise<ConformanceReport> {
	const results: ConformanceCaseResult[] = [];
	const contractFixture = await factory({ profile: "contract" });
	const contractReport = await runTransactionConformance({
		target: targetOf(contractFixture.engine),
		label: "ProjectStore transaction engine (T0)",
	});
	results.push(
		...contractReport.results.map((result) => ({
			...result,
			name: `T0: ${result.name}`,
		})),
	);

	const cases = new Cases();

	await cases.check("T1: zero-assertion control is skipped", () =>
		Promise.resolve(),
	);

	await cases.check(
		"T1: one save atomically publishes one batch",
		async (assert: CaseAssert) => {
			const fixture = await factory({ profile: "engine" });
			const before = fixture.saveCount();
			const watched: number[] = [];
			fixture.engine.watch((revision) => watched.push(Number(revision)));
			const result = await fixture.engine.apply({
				operations: [
					{ kind: "create-track", track: videoTrack("atomic-track") },
					{ kind: "create-asset", asset: videoAsset({ id: "atomic-asset" }) },
					{
						kind: "create-clip",
						clip: clip({
							id: "atomic-clip",
							trackId: "atomic-track",
							assetId: "atomic-asset",
						}),
					},
				],
			});
			assert(
				fixture.saveCount() - before === 1,
				"batch did not perform exactly one save",
			);
			assert(watched.length === 1, "batch did not notify exactly once");
			assert(
				Number(result.revision) === 1,
				"first committed revision was not 1",
			);
			assert(
				(await fixture.engine.clips()).length === 1,
				"committed clip was not published",
			);
		},
	);

	await cases.check(
		"T1: delayed concurrent applies retain invocation order",
		async (assert: CaseAssert) => {
			const fixture = await factory({ profile: "engine" });
			const pause = fixture.pauseNextSave();
			const first = fixture.engine.apply(basicBatch("ordered-first"));
			await pause.entered;
			const second = fixture.engine.apply(basicBatch("ordered-second"));
			await Promise.resolve();
			assert(
				fixture.saveCount() === 1,
				"second apply saved ahead of the delayed first apply",
			);
			pause.release();
			const [firstResult, secondResult] = await Promise.all([first, second]);
			assert(Number(firstResult.revision) === 1, "first revision was not 1");
			assert(Number(secondResult.revision) === 2, "second revision was not 2");
		},
	);

	await cases.check(
		"T1: rejected middle batch does not poison the queue",
		async (assert: CaseAssert) => {
			const fixture = await factory({ profile: "engine" });
			const first = fixture.engine.apply(basicBatch("queue-first"));
			const middle = fixture.engine.apply({
				operations: [
					{ kind: "delete-marker", markerId: markerId("missing-middle") },
				],
			});
			const third = fixture.engine.apply(basicBatch("queue-third"));
			const firstResult = await first;
			let middleError: unknown;
			try {
				await middle;
			} catch (error) {
				middleError = error;
			}
			const thirdResult = await third;
			assert(
				middleError instanceof TransactionError,
				"middle batch was not rejected structurally",
			);
			assert(
				Number(firstResult.revision) === 1 &&
					Number(thirdResult.revision) === 2,
				"queue did not recover in order",
			);
		},
	);

	await cases.check(
		"T1: save failure publishes nothing and the queue recovers",
		async (assert: CaseAssert) => {
			const fixture = await factory({ profile: "engine" });
			const watched: number[] = [];
			fixture.engine.watch((revision) => watched.push(Number(revision)));
			fixture.failNextSave();
			let failure: unknown;
			try {
				await fixture.engine.apply({
					operations: [
						{ kind: "create-track", track: videoTrack("must-not-publish") },
					],
					idempotencyKey: "failed-key",
				});
			} catch (error) {
				failure = error;
			}
			assert(
				failure instanceof ProjectStoreError,
				"save failure changed error ownership",
			);
			assert(
				Number(await fixture.engine.revision()) === 0,
				"failed save published a revision",
			);
			assert(
				(await fixture.engine.tracks()).length === 0,
				"failed save published content",
			);
			assert(watched.length === 0, "failed save notified watchers");
			const recovered = await fixture.engine.apply(
				basicBatch("queue-recovered"),
			);
			assert(
				Number(recovered.revision) === 1,
				"queue did not recover after save failure",
			);
		},
	);

	await cases.check(
		"T1: revision and canonical keyed replay survive reopen",
		async (assert: CaseAssert) => {
			const fixture = await factory({ profile: "engine" });
			const operation = {
				kind: "create-track" as const,
				track: videoTrack("reopen-track"),
			};
			const first = await fixture.engine.apply({
				operations: [operation],
				idempotencyKey: "reopen-key",
			});
			const reopened = await fixture.reopen();
			const saves = fixture.saveCount();
			const watched: number[] = [];
			reopened.watch((revision) => watched.push(Number(revision)));
			const equivalent = {
				track: {
					hidden: false,
					name: "reopen-track",
					kind: "video" as const,
					id: trackId("reopen-track"),
				},
				kind: "create-track" as const,
			};
			const replay = await reopened.apply({
				operations: [equivalent],
				idempotencyKey: "reopen-key",
				expectedRevision: revisionOf(0),
			});
			assert(
				JSON.stringify(replay) === JSON.stringify(first),
				"reopen replay changed the original result",
			);
			assert(fixture.saveCount() === saves, "reopen replay saved again");
			assert(watched.length === 0, "reopen replay notified watchers");
			let collision: unknown;
			try {
				await reopened.apply({
					operations: [
						{ kind: "create-track", track: videoTrack("different-track") },
					],
					idempotencyKey: "reopen-key",
				});
			} catch (error) {
				collision = error;
			}
			assert(
				collision instanceof TransactionError && collision.code === "duplicate",
				"different keyed operation was not rejected as duplicate",
			);
		},
	);

	await cases.check(
		"T1: validation and dry-run are structured and pure",
		async (assert: CaseAssert) => {
			const fixture = await factory({ profile: "engine" });
			const before = fixture.saveCount();
			const watched: number[] = [];
			fixture.engine.watch((revision) => watched.push(Number(revision)));
			const invalid = await fixture.engine.validate({
				operations: [
					{ kind: "delete-track", trackId: trackId("missing-track") },
					{ kind: "delete-marker", markerId: markerId("missing-marker") },
				],
			});
			assert(
				!invalid.valid && invalid.issues.length === 2,
				"validation did not retain multiple attributable issues",
			);
			const batch = basicBatch("dry-track");
			const dry = await fixture.engine.dryRun({
				...batch,
				idempotencyKey: "dry-key",
			});
			assert(dry.accepted, "valid dry-run was rejected");
			assert(fixture.saveCount() === before, "validation or dry-run saved");
			assert(
				Number(await fixture.engine.revision()) === 0,
				"validation or dry-run changed revision",
			);
			assert(watched.length === 0, "validation or dry-run notified watchers");
			const applied = await fixture.engine.apply({
				...batch,
				idempotencyKey: "dry-key",
			});
			assert(
				JSON.stringify(dry.result) === JSON.stringify(applied),
				"dry-run did not predict apply",
			);
		},
	);

	await cases.check(
		"T1: validation waits for an earlier durable commit",
		async (assert: CaseAssert) => {
			const fixture = await factory({ profile: "engine" });
			const pause = fixture.pauseNextSave();
			const applying = fixture.engine.apply(basicBatch("validation-base"));
			await pause.entered;
			const validating = fixture.engine.validate(basicBatch("validation-next"));
			pause.release();
			await applying;
			const outcome = await validating;
			assert(
				Number(outcome.baseRevision) === 1,
				"validation observed a stale queued base revision",
			);
		},
	);

	await cases.check(
		"T1: placement rejects collision and accepts adjacency",
		async (assert: CaseAssert) => {
			const fixture = await factory({ profile: "engine" });
			await fixture.engine.apply({
				operations: [
					{ kind: "create-track", track: textTrack("placement-track") },
					{
						kind: "create-clip",
						clip: clip({
							id: "placement-first",
							trackId: "placement-track",
							start: 0,
							duration: 4_000,
						}),
					},
				],
			});
			const adjacent = await fixture.engine.dryRun({
				operations: [
					{
						kind: "create-clip",
						clip: clip({
							id: "placement-adjacent",
							trackId: "placement-track",
							start: 4_000,
							duration: 4_000,
						}),
					},
				],
			});
			assert(adjacent.accepted, "half-open adjacent interval was rejected");
			const collision = await fixture.engine.validate({
				operations: [
					{
						kind: "create-clip",
						clip: clip({
							id: "placement-overlap",
							trackId: "placement-track",
							start: 0,
							duration: 4_000,
						}),
					},
				],
			});
			assert(
				!collision.valid &&
					collision.issues.some((entry) => entry.code === "collision"),
				"same-track collision was not named",
			);
		},
	);

	await cases.check(
		"T1: provider policy adds issues without waiving base rejection",
		async (assert: CaseAssert) => {
			const providerPolicy: TransactionPlacementPolicy = {
				evaluate: () => [
					{ code: "provider:blocked", message: "provider rejection" },
				],
			};
			const fixture = await factory({
				profile: "engine",
				placementPolicies: [providerPolicy],
			});
			const outcome = await fixture.engine.validate({ operations: [] });
			assert(!outcome.valid, "invalid batch was accepted");
			assert(
				outcome.issues.some((entry) => entry.code === "empty-batch"),
				"base rejection was waived",
			);
			assert(
				outcome.issues.some((entry) => entry.code === "provider:blocked"),
				"provider rejection was not composed",
			);
		},
	);

	await cases.check(
		"T1: provider policy receives a frozen disposable candidate",
		async (assert: CaseAssert) => {
			let sawFrozenCandidate = false;
			const providerPolicy: TransactionPlacementPolicy = {
				evaluate: (context) => {
					const candidateClip = context.document.clips[0];
					sawFrozenCandidate =
						Object.isFrozen(context.document) &&
						(candidateClip === undefined || Object.isFrozen(candidateClip));
					if (candidateClip) {
						Reflect.set(candidateClip, "duration", mediaTime({ ticks: 0 }));
					}
					return [];
				},
			};
			const fixture = await factory({
				profile: "engine",
				placementPolicies: [providerPolicy],
			});
			await fixture.engine.apply({
				operations: [
					{ kind: "create-track", track: textTrack("provider-safe-track") },
					{
						kind: "create-clip",
						clip: clip({
							id: "provider-safe-clip",
							trackId: "provider-safe-track",
						}),
					},
				],
			});
			const committed = await fixture.engine.clips();
			assert(sawFrozenCandidate, "provider candidate was not deeply frozen");
			assert(
				Number(committed[0]?.duration) === 4_000,
				"provider mutation reached the committed candidate",
			);
		},
	);

	await cases.check(
		"T1: opaque provider fields survive adapter round-trip",
		async (assert: CaseAssert) => {
			const fixture = await factory({
				profile: "engine",
				opaque: { unknownSentinel: { retained: true } },
			});
			await fixture.engine.apply(basicBatch("opaque-track"));
			const persisted = await fixture.readPersistedRecord();
			const data = persisted.data;
			assert(
				isRecord(data) &&
					isRecord(data.unknownSentinel) &&
					data.unknownSentinel.retained === true,
				"unknownSentinel was lost during adapter round-trip",
			);
		},
	);

	await cases.check(
		"T1: base and configured optional capabilities are honest",
		async (assert: CaseAssert) => {
			const fixture = await factory({
				profile: "engine",
				optionalFeatures,
			});
			const capabilities = await fixture.engine.capabilities();
			for (const key of [
				"atomic-batch",
				"expected-revision",
				"durable-revision",
				"durable-idempotency",
				"validation",
				"dry-run",
				"placement-policy",
			] as const) {
				assert(capabilities[key] === true, `${key} was not advertised`);
			}
			assert(
				capabilities["cross-engine-cas"] === false,
				"cross-engine-cas was advertised falsely",
			);
			for (const [feature, supported] of Object.entries(
				optionalFeatures ?? {},
			)) {
				assert(
					Reflect.get(capabilities, feature) === supported,
					`${feature} did not retain its configured capability value`,
				);
			}
			assert(
				(await fixture.engine.supportedOperations()).length === 11,
				"supported operation probe changed",
			);
		},
	);

	await cases.check(
		"T1: reserved base capability names are rejected",
		async (assert: CaseAssert) => {
			let rejected = false;
			try {
				const invalidOptions: TransactionEngineConformanceFactoryOptions<FeatureName> =
					{ profile: "engine" };
				// Simulate an untyped runtime caller without weakening the public type.
				Reflect.set(invalidOptions, "optionalFeatures", {
					"cross-engine-cas": true,
				});
				await factory(invalidOptions);
			} catch (error) {
				rejected =
					error instanceof TypeError &&
					error.message.includes("cross-engine-cas");
			}
			assert(rejected, "reserved optional feature collision was accepted");
		},
	);

	results.push(...cases.results);
	const summary = {
		passed: results.filter((result) => result.status === "passed").length,
		failed: results.filter((result) => result.status === "failed").length,
		skipped: results.filter((result) => result.status === "skipped").length,
	};
	return {
		label: `transaction engine conformance (${makeProject().name})`,
		passed: summary.failed === 0,
		results,
		summary,
	};
}
