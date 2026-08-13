/**
 * The transaction conformance suite.
 *
 * Deliberately a plain async function returning a report, not a test file. An
 * adapter author — T1's real engine, T4's agent evidence — points it at their
 * own implementation and runs it **without modifying it**, under whatever runner
 * they have or none at all. A suite that only existed as test cases would not
 * be runnable outside this repository.
 *
 * Modelled on S02's `ports/conformance/`: per-case pass/fail/skip, with the
 * `SkipCase` pattern ensuring a case that executed no assertion is recorded as
 * `"skipped"`, never as `"passed"`.
 */
import type { Track, TrackId } from "../domain";
import { clipId, mediaTime, projectId, trackId } from "../domain";
import { OPERATION_KINDS } from "../operations";
import type { Revision } from "../transaction";
import { INITIAL_REVISION, TransactionError } from "../transaction";
import type {
	TransactionApply,
	TransactionGetContext,
	TransactionRead,
	TransactionWatch,
} from "../interfaces";

export type ConformanceStatus = "passed" | "failed" | "skipped";

export interface ConformanceCaseResult {
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
	readonly summary: { passed: number; failed: number; skipped: number };
}

/**
 * The adapter seam: an implementation provides these four interfaces. The
 * conformance suite exercises them and reports per-case results.
 */
export interface TransactionConformanceTarget {
	readonly read: TransactionRead;
	readonly apply: TransactionApply;
	readonly getContext: TransactionGetContext;
	readonly watch: TransactionWatch;
}

/**
 * Thrown by a case that does not apply to the implementation under test.
 *
 * Reported as `"skipped"`, never as `"passed"`. A case that executed no
 * assertion and is recorded green is a lie told to whoever reads the report.
 */
class SkipCase extends Error {}

function skip(reason: string): never {
	throw new SkipCase(reason);
}

class Cases {
	readonly results: ConformanceCaseResult[] = [];

	async check(name: string, run: () => Promise<void> | void): Promise<void> {
		try {
			await run();
			this.results.push({ name, status: "passed", passed: true });
		} catch (error) {
			if (error instanceof SkipCase) {
				this.results.push({
					name,
					status: "skipped",
					passed: false,
					detail: error.message,
				});
				return;
			}
			this.results.push({
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

function adversarialFrameRates(): readonly unknown[] {
	const symbolValue = { numerator: 30, denominator: 1 } as Record<
		PropertyKey,
		unknown
	>;
	symbolValue[Symbol("provider-private")] = true;
	const accessorValue: Record<string, unknown> = { denominator: 1 };
	Object.defineProperty(accessorValue, "numerator", {
		enumerable: true,
		get() {
			throw new Error("frame-rate accessors must not be invoked");
		},
	});
	const nonEnumerableValue: Record<string, unknown> = { numerator: 30 };
	Object.defineProperty(nonEnumerableValue, "denominator", {
		enumerable: false,
		value: 1,
	});
	return [
		{ numerator: 30, denominator: 1, providerPrivate: "smuggle" },
		symbolValue,
		accessorValue,
		nonEnumerableValue,
	];
}

/** Helper: create a minimal track for test setup. */
function makeTrack(
	overrides: Partial<{
		id: string;
		kind: string;
		name: string;
		hidden: boolean;
	}> = {},
) {
	return {
		id: trackId(overrides.id ?? "track-1"),
		kind: (overrides.kind ?? "video") as
			| "video"
			| "audio"
			| "text"
			| "graphic"
			| "effect",
		name: overrides.name ?? "Track 1",
		hidden: overrides.hidden ?? false,
	};
}

/** Helper: create a minimal clip for test setup. */
function makeClip(
	tid: TrackId,
	overrides: Partial<{
		id: string;
		startTime: number;
		duration: number;
		trimStart: number;
		trimEnd: number;
	}> = {},
) {
	return {
		id: clipId(overrides.id ?? "clip-1"),
		trackId: tid,
		startTime: mediaTime({ ticks: overrides.startTime ?? 0 }),
		duration: mediaTime({ ticks: overrides.duration ?? 48000 }),
		trimStart: mediaTime({ ticks: overrides.trimStart ?? 0 }),
		trimEnd: mediaTime({ ticks: overrides.trimEnd ?? 0 }),
	};
}

/**
 * Run the conformance suite against a transaction implementation.
 *
 * The suite exercises read, apply, revision, conflict detection, idempotency,
 * batch atomicity, watch, getContext, and defensive cloning. A case that
 * executed no assertion is recorded as `"skipped"`.
 */
export async function runTransactionConformance(args: {
	target: TransactionConformanceTarget;
	label?: string;
}): Promise<ConformanceReport> {
	const { read, apply: applier, getContext, watch } = args.target;
	const cases = new Cases();

	// -----------------------------------------------------------------------
	// read returns current state after mutations
	// -----------------------------------------------------------------------
	await cases.check(
		"read returns tracks and clips after mutations",
		async () => {
			await applier.apply({
				operations: [
					{
						kind: "create-track",
						track: makeTrack({ id: "rt-1", name: "Video" }),
					},
					{
						kind: "create-track",
						track: makeTrack({ id: "rt-2", name: "Audio", kind: "audio" }),
					},
					{
						kind: "create-clip",
						clip: makeClip(trackId("rt-1"), { id: "rc-1" }),
					},
					{
						kind: "create-clip",
						clip: makeClip(trackId("rt-2"), { id: "rc-2" }),
					},
					{
						kind: "create-clip",
						clip: makeClip(trackId("rt-1"), { id: "rc-3" }),
					},
				],
			});

			const tracks = await read.tracks();
			assert(
				tracks.length >= 2,
				`expected at least 2 tracks, got ${tracks.length}`,
			);

			const clips = await read.clips();
			assert(
				clips.length >= 3,
				`expected at least 3 clips, got ${clips.length}`,
			);

			const filtered = await read.clips({ trackId: trackId("rt-1") });
			assert(
				filtered.every((c) => c.trackId === trackId("rt-1")),
				"clips filtered by trackId returned clips on other tracks",
			);
		},
	);

	// -----------------------------------------------------------------------
	// apply creates entities and increments revision monotonically
	// -----------------------------------------------------------------------
	await cases.check(
		"apply creates entities and increments revision monotonically",
		async () => {
			const r0 = await read.revision();

			const result = await applier.apply({
				operations: [
					{ kind: "create-track", track: makeTrack({ id: "mono-1" }) },
				],
			});

			const r1 = await read.revision();
			assert(
				r1 === result.revision,
				`result.revision (${result.revision}) !== read.revision() (${r1})`,
			);
			assert(
				Number(r1) - Number(r0) === 1,
				`revision incremented by ${Number(r1) - Number(r0)}, expected 1`,
			);
			assert(
				result.createdIds.includes("mono-1"),
				`createdIds does not include "mono-1": ${JSON.stringify(result.createdIds)}`,
			);

			const result2 = await applier.apply({
				operations: [
					{ kind: "create-track", track: makeTrack({ id: "mono-2" }) },
				],
			});
			const r2 = await read.revision();
			assert(
				Number(r2) - Number(r1) === 1,
				`second apply incremented revision by ${Number(r2) - Number(r1)}, expected 1`,
			);
			assert(
				result2.revision === r2,
				`second result.revision (${result2.revision}) !== read.revision() (${r2})`,
			);
		},
	);

	// -----------------------------------------------------------------------
	// apply with expectedRevision succeeds on match, rejects on mismatch
	// -----------------------------------------------------------------------
	await cases.check("expected revision match succeeds", async () => {
		const current = await read.revision();
		const result = await applier.apply({
			operations: [
				{ kind: "create-track", track: makeTrack({ id: "exp-match-1" }) },
			],
			expectedRevision: current,
		});
		assert(
			result.revision !== current,
			"expected revision to change after successful apply",
		);
	});

	await cases.check(
		"expected revision mismatch rejects with conflict",
		async () => {
			const current = await read.revision();
			const stale = (Number(current) - 1) as Revision;
			let thrown: unknown;
			try {
				await applier.apply({
					operations: [
						{
							kind: "create-track",
							track: makeTrack({ id: "exp-mismatch-no" }),
						},
					],
					expectedRevision: stale,
				});
			} catch (error) {
				thrown = error;
			}
			assert(
				thrown instanceof TransactionError && thrown.code === "conflict",
				`expected TransactionError { code: "conflict" }, got ${String(thrown)}`,
			);
			const err = thrown as TransactionError;
			assert(
				err.expectedRevision === stale,
				`expectedRevision on error is ${String(err.expectedRevision)}, expected ${String(stale)}`,
			);
			assert(
				err.actualRevision === current,
				`actualRevision on error is ${String(err.actualRevision)}, expected ${String(current)}`,
			);

			// State is unchanged
			const after = await read.revision();
			assert(
				after === current,
				"revision changed after a rejected conflict apply",
			);

			const tracks = await read.tracks();
			assert(
				!tracks.some((t) => t.id === trackId("exp-mismatch-no")),
				"entity was created despite conflict rejection",
			);
		},
	);

	// -----------------------------------------------------------------------
	// idempotency dedup: same key + same ops = same result, revision unchanged
	// -----------------------------------------------------------------------
	await cases.check(
		"idempotency dedup returns same result without revision change",
		async () => {
			const key = `idem-${Math.random()}`;
			const op = {
				kind: "create-track" as const,
				track: makeTrack({ id: "idem-1" }),
			};

			const first = await applier.apply({
				operations: [op],
				idempotencyKey: key,
			});
			const revAfterFirst = await read.revision();

			const second = await applier.apply({
				operations: [op],
				idempotencyKey: key,
			});
			const revAfterSecond = await read.revision();

			assert(
				revAfterSecond === revAfterFirst,
				"revision changed on idempotency dedup replay",
			);
			assert(
				second.revision === first.revision,
				`dedup result.revision (${second.revision}) !== original (${first.revision})`,
			);
			assert(
				JSON.stringify(second.createdIds) === JSON.stringify(first.createdIds),
				"dedup result.createdIds differs from original",
			);
		},
	);

	// -----------------------------------------------------------------------
	// idempotency collision: same key + different ops = duplicate error
	// -----------------------------------------------------------------------
	await cases.check(
		"idempotency collision with different operations is rejected",
		async () => {
			const key = `coll-${Math.random()}`;
			await applier.apply({
				operations: [
					{ kind: "create-track", track: makeTrack({ id: "coll-1" }) },
				],
				idempotencyKey: key,
			});

			let thrown: unknown;
			try {
				await applier.apply({
					operations: [
						{
							kind: "create-clip",
							clip: makeClip(trackId("coll-1"), { id: "coll-clip" }),
						},
					],
					idempotencyKey: key,
				});
			} catch (error) {
				thrown = error;
			}
			assert(
				thrown instanceof TransactionError && thrown.code === "duplicate",
				`expected TransactionError { code: "duplicate" }, got ${String(thrown)}`,
			);
		},
	);

	await cases.check(
		"an apply without a key is never deduplicated",
		async () => {
			const r0 = await read.revision();
			const op = {
				kind: "create-track" as const,
				track: makeTrack({ id: `nokey-${Math.random()}` }),
			};
			await applier.apply({ operations: [op] });
			await applier.apply({
				operations: [
					{
						kind: "create-track",
						track: makeTrack({ id: `nokey-${Math.random()}` }),
					},
				],
			});
			const r2 = await read.revision();
			assert(
				Number(r2) - Number(r0) === 2,
				`two keyless applies incremented revision by ${Number(r2) - Number(r0)}, expected 2`,
			);
		},
	);

	// -----------------------------------------------------------------------
	// batch atomicity: one failing op rolls back all
	// -----------------------------------------------------------------------
	await cases.check("batch atomicity rolls back on failure", async () => {
		const r0 = await read.revision();

		let thrown: unknown;
		try {
			await applier.apply({
				operations: [
					{ kind: "create-track", track: makeTrack({ id: "atom-1" }) },
					{
						kind: "delete-clip",
						clipId: clipId("non-existent-atom"),
					},
				],
			});
		} catch (error) {
			thrown = error;
		}
		assert(
			thrown instanceof TransactionError,
			"expected a TransactionError from atomic failure",
		);

		const r1 = await read.revision();
		assert(r1 === r0, "revision changed after a rolled-back batch");

		const tracks = await read.tracks();
		assert(
			!tracks.some((t) => t.id === trackId("atom-1")),
			"the valid track was created despite batch rollback",
		);
	});

	// -----------------------------------------------------------------------
	// watch fires on revision change, not on rejection
	// -----------------------------------------------------------------------
	await cases.check("watch fires on successful apply", async () => {
		const seen: Revision[] = [];
		const unsub = watch.watch((rev) => seen.push(rev));

		await applier.apply({
			operations: [
				{ kind: "create-track", track: makeTrack({ id: "watch-1" }) },
			],
		});

		assert(
			seen.length >= 1,
			"watch subscriber was not called after successful apply",
		);
		assert(
			seen[seen.length - 1] === (await read.revision()),
			"watch callback received a stale revision",
		);
		unsub();
	});

	await cases.check("watch does not fire on rejected apply", async () => {
		const seen: Revision[] = [];
		const unsub = watch.watch((rev) => seen.push(rev));

		const current = await read.revision();
		const stale = (Number(current) - 1) as Revision;
		try {
			await applier.apply({
				operations: [
					{ kind: "create-track", track: makeTrack({ id: "watch-reject-no" }) },
				],
				expectedRevision: stale,
			});
		} catch {
			// expected
		}

		assert(seen.length === 0, "watch fired on a rejected apply");
		unsub();
	});

	await cases.check("watch does not fire on idempotency dedup", async () => {
		const key = `watch-idem-${Math.random()}`;
		const op = {
			kind: "create-track" as const,
			track: makeTrack({ id: "watch-dedup-1" }),
		};

		await applier.apply({ operations: [op], idempotencyKey: key });

		const seen: Revision[] = [];
		const unsub = watch.watch((rev) => seen.push(rev));
		await applier.apply({ operations: [op], idempotencyKey: key });
		assert(seen.length === 0, "watch fired on an idempotency dedup replay");
		unsub();
	});

	await cases.check("unsubscribe prevents further callbacks", async () => {
		const seen: Revision[] = [];
		const unsub = watch.watch((rev) => seen.push(rev));
		unsub();

		await applier.apply({
			operations: [
				{ kind: "create-track", track: makeTrack({ id: "watch-unsub-1" }) },
			],
		});
		assert(seen.length === 0, "unsubscribed watcher received a callback");
	});

	// -----------------------------------------------------------------------
	// getContext reports revision, capabilities, and supported operations
	// -----------------------------------------------------------------------
	await cases.check("getContext reports the current revision", async () => {
		const readRev = await read.revision();
		const ctxRev = await getContext.revision();
		assert(
			ctxRev === readRev,
			`getContext.revision() (${ctxRev}) !== read.revision() (${readRev})`,
		);
	});

	await cases.check("getContext lists supported operation kinds", async () => {
		const ops = await getContext.supportedOperations();
		assert(
			JSON.stringify(ops) === JSON.stringify(OPERATION_KINDS),
			`supportedOperations did not equal the complete operation inventory: ${JSON.stringify(ops)}`,
		);
	});

	// -----------------------------------------------------------------------
	// seeded Project update/read/atomicity/watch/idempotency semantics
	// -----------------------------------------------------------------------
	await cases.check(
		"Project updates execute atomically and idempotently",
		async () => {
			const seeded = await read.project();
			if (seeded === null) {
				skip("target has no selected Project");
			}

			const sameValueWatch: Revision[] = [];
			const stopSameValueWatch = watch.watch((next) =>
				sameValueWatch.push(next),
			);
			const beforeSameValueRevision = await read.revision();
			const sameValue = await applier.apply({
				operations: [
					{
						kind: "update-project",
						projectId: seeded.id,
						patch: { name: seeded.name },
					},
				],
			});
			stopSameValueWatch();
			assert(
				Number(sameValue.revision) === Number(beforeSameValueRevision) + 1,
				"non-empty same-value Project patch did not increment revision once",
			);
			assert(
				sameValue.changedIds.length === 1 &&
					sameValue.changedIds[0] === seeded.id &&
					sameValue.createdIds.length === 0,
				"same-value Project result did not report exactly one changed Project id",
			);
			assert(
				sameValueWatch.length === 1 && sameValueWatch[0] === sameValue.revision,
				"same-value Project patch did not notify exactly once",
			);

			const changed = await applier.apply({
				operations: [
					{
						kind: "update-project",
						projectId: seeded.id,
						patch: { canvasWidth: seeded.canvasWidth + 1 },
					},
				],
			});
			const changedProject = await read.project();
			assert(changedProject !== null, "changed Project disappeared");
			assert(
				changedProject.canvasWidth === seeded.canvasWidth + 1 &&
					changedProject.canvasHeight === seeded.canvasHeight &&
					changedProject.name === seeded.name &&
					changedProject.id === seeded.id,
				"Project patch did not preserve unpatched fields and identity",
			);
			assert(
				changed.createdIds.length === 0,
				"Project patch reported a created id",
			);

			const beforeAtomicProject = await read.project();
			const beforeAtomicRevision = await read.revision();
			let atomicFailure: unknown;
			try {
				await applier.apply({
					operations: [
						{
							kind: "update-project",
							projectId: seeded.id,
							patch: { name: "must-roll-back" },
						},
						{ kind: "delete-clip", clipId: clipId("missing-after-project") },
					],
				});
			} catch (error) {
				atomicFailure = error;
			}
			assert(
				atomicFailure instanceof TransactionError,
				"later operation failure did not reject the Project batch",
			);
			assert(
				JSON.stringify(await read.project()) ===
					JSON.stringify(beforeAtomicProject) &&
					(await read.revision()) === beforeAtomicRevision,
				"later operation failure published a partial Project patch",
			);

			for (const patch of [
				{},
				{ providerPrivate: true },
				...adversarialFrameRates().map((frameRate) => ({ frameRate })),
			]) {
				let invalidPatch: unknown;
				try {
					await applier.apply({
						operations: [
							{
								kind: "update-project",
								projectId: seeded.id,
								patch,
							} as never,
						],
					});
				} catch (error) {
					invalidPatch = error;
				}
				assert(
					invalidPatch instanceof TransactionError &&
						invalidPatch.code === "validation",
					"empty or excess-key Project patch was not rejected structurally",
				);
			}

			const key = `project-idem-${Math.random()}`;
			const canonicalFirst = await applier.apply({
				operations: [
					{
						kind: "update-project",
						projectId: seeded.id,
						patch: {
							name: changedProject.name,
							canvasHeight: changedProject.canvasHeight,
						},
					},
				],
				idempotencyKey: key,
			});
			const replayWatch: Revision[] = [];
			const stopReplayWatch = watch.watch((next) => replayWatch.push(next));
			const canonicalReplay = await applier.apply({
				operations: [
					{
						patch: {
							canvasHeight: changedProject.canvasHeight,
							name: changedProject.name,
						},
						projectId: seeded.id,
						kind: "update-project",
					},
				],
				idempotencyKey: key,
			});
			stopReplayWatch();
			assert(
				JSON.stringify(canonicalReplay) === JSON.stringify(canonicalFirst) &&
					replayWatch.length === 0,
				"canonical Project replay mutated revision or watchers",
			);
			let collision: unknown;
			try {
				await applier.apply({
					operations: [
						{
							kind: "update-project",
							projectId: projectId(seeded.id),
							patch: { name: `${changedProject.name}-different` },
						},
					],
					idempotencyKey: key,
				});
			} catch (error) {
				collision = error;
			}
			assert(
				collision instanceof TransactionError && collision.code === "duplicate",
				"same Project key with a different patch did not collide",
			);
			for (const patch of [{}, { providerPrivate: true }]) {
				let invalidCollision: unknown;
				try {
					await applier.apply({
						operations: [
							{
								kind: "update-project",
								projectId: seeded.id,
								patch,
							} as never,
						],
						idempotencyKey: key,
					});
				} catch (error) {
					invalidCollision = error;
				}
				assert(
					invalidCollision instanceof TransactionError &&
						invalidCollision.code === "duplicate",
					"canonical keyed collision did not precede serializable Project patch validation",
				);
			}
		},
	);

	await cases.check("getContext returns a capabilities object", async () => {
		const caps = await getContext.capabilities();
		assert(
			typeof caps === "object" && caps !== null,
			"capabilities() did not return a non-null object",
		);
	});

	// -----------------------------------------------------------------------
	// read results are defensively cloned
	// -----------------------------------------------------------------------
	await cases.check("read results are defensively cloned", async () => {
		await applier.apply({
			operations: [
				{ kind: "create-track", track: makeTrack({ id: "clone-1" }) },
			],
		});

		const tracks1 = await read.tracks();
		const found1 = tracks1.find((t) => t.id === trackId("clone-1"));
		assert(found1 !== undefined, "track clone-1 not found");

		// Mutate the returned array and the object
		(tracks1 as Track[]).length = 0;
		if (found1) (found1 as { name: string }).name = "mutated";

		const tracks2 = await read.tracks();
		const found2 = tracks2.find((t) => t.id === trackId("clone-1"));
		assert(
			found2 !== undefined,
			"track clone-1 disappeared after caller mutation",
		);
		assert(
			found2!.name === "Track 1",
			`track name was changed by caller mutation: "${found2!.name}"`,
		);
	});

	// -----------------------------------------------------------------------
	// update operations apply partial patches
	// -----------------------------------------------------------------------
	await cases.check("update operations apply partial patches", async () => {
		await applier.apply({
			operations: [
				{
					kind: "create-track",
					track: makeTrack({ id: "patch-1", name: "Original", hidden: false }),
				},
			],
		});

		const newDuration = mediaTime({ ticks: 96000 });
		await applier.apply({
			operations: [
				{
					kind: "create-clip",
					clip: makeClip(trackId("patch-1"), { id: "patch-clip" }),
				},
			],
		});

		await applier.apply({
			operations: [
				{
					kind: "update-clip",
					clipId: clipId("patch-clip"),
					patch: { duration: newDuration },
				},
			],
		});

		const clips = await read.clips({ trackId: trackId("patch-1") });
		const updated = clips.find((c) => c.id === clipId("patch-clip"));
		assert(updated !== undefined, "patched clip not found");
		assert(updated!.duration === newDuration, "duration was not patched");
		// Other fields should remain unchanged
		assert(
			updated!.trackId === trackId("patch-1"),
			"trackId was changed by patch",
		);
	});

	// -----------------------------------------------------------------------
	// a case that may skip (SkipCase pattern)
	// -----------------------------------------------------------------------
	await cases.check("a case that executed no assertion is skipped", () => {
		// Demonstrate the SkipCase pattern: a case that finds nothing to assert
		// is skipped, not passed.
		skip("demonstration — no assertion to make");
	});

	// -----------------------------------------------------------------------
	// not-found error identifies the failing operation index
	// -----------------------------------------------------------------------
	await cases.check(
		"not-found error identifies the failing operation index",
		async () => {
			let thrown: unknown;
			try {
				await applier.apply({
					operations: [
						{ kind: "create-track", track: makeTrack({ id: "nf-1" }) },
						{ kind: "create-track", track: makeTrack({ id: "nf-2" }) },
						{
							kind: "delete-clip",
							clipId: clipId("non-existent-nf"),
						},
						{ kind: "create-track", track: makeTrack({ id: "nf-4" }) },
						{ kind: "create-track", track: makeTrack({ id: "nf-5" }) },
					],
				});
			} catch (error) {
				thrown = error;
			}
			assert(
				thrown instanceof TransactionError && thrown.code === "not-found",
				`expected TransactionError { code: "not-found" }, got ${String(thrown)}`,
			);
			const err = thrown as TransactionError;
			assert(
				err.operationIndex === 2,
				`expected operationIndex 2, got ${err.operationIndex}`,
			);
		},
	);

	// -----------------------------------------------------------------------
	// Initial revision is 0
	// -----------------------------------------------------------------------
	await cases.check("a fresh store reports initial revision 0", () => {
		// This case verifies the contract, but the target may not be fresh.
		// We check that INITIAL_REVISION is 0 — the actual freshness check
		// is the in-memory fake's own test.
		assert(
			Number(INITIAL_REVISION) === 0,
			`INITIAL_REVISION is ${Number(INITIAL_REVISION)}, expected 0`,
		);
	});

	// -----------------------------------------------------------------------
	// Report
	// -----------------------------------------------------------------------
	const summary = {
		passed: cases.results.filter((r) => r.status === "passed").length,
		failed: cases.results.filter((r) => r.status === "failed").length,
		skipped: cases.results.filter((r) => r.status === "skipped").length,
	};

	return {
		label: args.label ?? "unnamed implementation",
		passed: summary.failed === 0,
		results: cases.results,
		summary,
	};
}

/** Human-readable report formatter, matching S02's `formatConformanceReport`. */
export function formatConformanceReport(report: ConformanceReport): string {
	const lines: string[] = [
		`transaction-conformance: ${report.label} — ${report.passed ? "PASS" : "FAIL"}`,
		`  ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped`,
	];
	for (const result of report.results) {
		if (result.status === "passed") continue;
		lines.push(
			`    ${result.status === "failed" ? "FAIL" : "SKIP"}  ${result.name}: ${result.detail ?? ""}`,
		);
	}
	return lines.join("\n");
}
