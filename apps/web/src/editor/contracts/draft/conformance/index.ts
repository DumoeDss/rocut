import type {
	AssetId,
	ConformanceCaseResult,
	ConformanceReport,
	Project,
	Revision,
	TransactionBatch,
	TransactionOperation,
} from "../..";
import {
	assetId,
	clipId,
	mediaTime,
	markerId,
	projectId,
	OPERATION_KINDS,
	revisionOf,
	trackId,
	TransactionError,
} from "../..";
import type {
	TransactionEngine,
	TransactionEngineDocument,
	TransactionEngineOptionalFeatures,
	TransactionPlacementPolicy,
} from "../../engine";
import {
	DRAFT_OPERATION_CLASSIFICATION,
	IMMEDIATE_OPERATION_CLASSIFICATION,
	classifyDraftRuntimeOperation,
} from "../classification";
import type {
	DraftEditingManager,
	DraftEditingSession,
	DraftResourceRetentionPolicy,
} from "../types";

export interface DraftEditingConformanceFixture<
	FeatureName extends string = string,
> {
	readonly manager: DraftEditingManager;
	readonly engine: TransactionEngine<FeatureName>;
	readonly retention: DraftResourceRetentionPolicy;
	saveCount(): number;
	applyCount(): number;
	watchCount(): number;
}

export interface DraftEditingConformanceFactoryOptions<
	FeatureName extends string = string,
> {
	readonly seedOperations?: readonly TransactionOperation[];
	readonly retainedAssetIds?: readonly AssetId[];
	readonly placementPolicies?: readonly TransactionPlacementPolicy[];
	readonly snapshotRevisionSequence?: readonly Revision[];
	readonly snapshotAttempts?: number;
	readonly optionalFeatures?: TransactionEngineOptionalFeatures<FeatureName>;
}

export type DraftEditingConformanceFactory<
	FeatureName extends string = string,
> = (
	options?: DraftEditingConformanceFactoryOptions<FeatureName>,
) => Promise<DraftEditingConformanceFixture<FeatureName>>;

type CaseAssert = (condition: unknown, message: string) => void;

class Cases {
	readonly results: ConformanceCaseResult[] = [];

	async check(
		name: string,
		run: (assert: CaseAssert) => Promise<void> | void,
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

function project(): Project {
	return {
		id: projectId("draft-project"),
		name: "Draft conformance",
		frameRate: { numerator: 30, denominator: 1 },
		canvasWidth: 1920,
		canvasHeight: 1080,
	};
}

function graphicTrack(id: string) {
	return { id: trackId(id), kind: "graphic" as const, name: id, hidden: false };
}

function imageAsset(id: string) {
	return {
		id: assetId(id),
		kind: "image" as const,
		name: id,
		duration: mediaTime({ ticks: 120_000 }),
	};
}

function clip(args: {
	readonly id: string;
	readonly track: string;
	readonly asset?: string;
	readonly start?: number;
}) {
	return {
		id: clipId(args.id),
		trackId: trackId(args.track),
		startTime: mediaTime({ ticks: args.start ?? 0 }),
		duration: mediaTime({ ticks: 4_000 }),
		trimStart: mediaTime({ ticks: 0 }),
		trimEnd: mediaTime({ ticks: 0 }),
		...(args.asset === undefined ? {} : { assetId: assetId(args.asset) }),
	};
}

async function open(
	manager: DraftEditingManager,
	id: string,
	approvalMode: "manual" | "auto" = "manual",
): Promise<DraftEditingSession> {
	const outcome = await manager.open({ id, approvalMode });
	if (!outcome.opened)
		throw new Error(`${outcome.error.kind}: ${outcome.error.message}`);
	return outcome.session;
}

async function readContent(engine: TransactionEngine): Promise<unknown> {
	return {
		project: await engine.project(),
		tracks: await engine.tracks(),
		clips: await engine.clips(),
		assets: await engine.assets(),
		markers: await engine.markers(),
	};
}

function hasSameOwnStructure(
	left: unknown,
	right: unknown,
	seen = new WeakMap<object, object>(),
): boolean {
	if (Object.is(left, right)) return true;
	if (
		left === null ||
		right === null ||
		typeof left !== "object" ||
		typeof right !== "object"
	) {
		return false;
	}
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	const paired = seen.get(left);
	if (paired !== undefined) return paired === right;
	seen.set(left, right);
	const leftKeys = Reflect.ownKeys(left);
	const rightKeys = Reflect.ownKeys(right);
	if (leftKeys.length !== rightKeys.length) return false;
	for (const key of leftKeys) {
		if (!Object.hasOwn(right, key)) return false;
		if (
			!hasSameOwnStructure(
				Reflect.get(left, key),
				Reflect.get(right, key),
				seen,
			)
		) {
			return false;
		}
	}
	return true;
}

function summary(results: readonly ConformanceCaseResult[]) {
	return {
		passed: results.filter((result) => result.status === "passed").length,
		failed: results.filter((result) => result.status === "failed").length,
		skipped: results.filter((result) => result.status === "skipped").length,
	};
}

export async function runDraftEditingConformance<
	FeatureName extends string = string,
>(
	factory: DraftEditingConformanceFactory<FeatureName>,
	optionalFeatures?: TransactionEngineOptionalFeatures<FeatureName>,
): Promise<ConformanceReport> {
	const cases = new Cases();

	await cases.check("T2: zero-assertion control is skipped", () => undefined);

	await cases.check(
		"T2: opening captures an immutable consistent snapshot",
		async (assert) => {
			const fixture = await factory({ optionalFeatures });
			const draft = await open(fixture.manager, "snapshot");
			const snapshot = draft.snapshot();
			assert(
				Number(snapshot.baseRevision) === 0,
				"base revision was not captured",
			);
			assert(Object.isFrozen(snapshot), "snapshot was not frozen");
			Reflect.set(snapshot.working, "tracks", [graphicTrack("forged")]);
			assert(
				draft.snapshot().working.tracks.length === 0,
				"returned snapshot mutated private state",
			);
			assert(fixture.saveCount() === 0, "opening saved durable state");
		},
	);

	await cases.check(
		"T2: torn snapshots retry and exhaustion is structured",
		async (assert) => {
			const retry = await factory({
				optionalFeatures,
				snapshotRevisionSequence: [
					revisionOf(0),
					revisionOf(1),
					revisionOf(1),
					revisionOf(1),
				],
			});
			const retried = await retry.manager.open({
				id: "retry",
				approvalMode: "manual",
			});
			assert(retried.opened, "a later clean sandwich did not open");
			const busy = await factory({
				optionalFeatures,
				snapshotRevisionSequence: [
					revisionOf(0),
					revisionOf(1),
					revisionOf(1),
					revisionOf(2),
					revisionOf(2),
					revisionOf(3),
				],
				snapshotAttempts: 3,
			});
			const exhausted = await busy.manager.open({
				id: "busy",
				approvalMode: "manual",
			});
			assert(
				!exhausted.opened && exhausted.error.kind === "snapshot-busy",
				"exhaustion was not snapshot-busy",
			);
			assert(busy.saveCount() === 0, "torn opening mutated durable state");
		},
	);

	await cases.check(
		"T2: Draft ids are stable, non-empty, and unique",
		async (assert) => {
			const fixture = await factory({ optionalFeatures });
			const empty = await fixture.manager.open({
				id: " ",
				approvalMode: "manual",
			});
			assert(
				!empty.opened && empty.error.kind === "invalid-draft-id",
				"empty id was accepted",
			);
			const first = await fixture.manager.open({
				id: "unique",
				approvalMode: "manual",
			});
			const second = await fixture.manager.open({
				id: "unique",
				approvalMode: "manual",
			});
			assert(first.opened, "first unique id did not open");
			assert(
				!second.opened && second.error.kind === "duplicate-draft-id",
				"duplicate id was accepted",
			);
		},
	);

	await cases.check(
		"T2: sibling Drafts isolate working state and durable effects",
		async (assert) => {
			const fixture = await factory({ optionalFeatures });
			const first = await open(fixture.manager, "sibling-a");
			const second = await open(fixture.manager, "sibling-b");
			await first.stage({
				operations: [{ kind: "create-track", track: graphicTrack("only-a") }],
			});
			await second.stage({
				operations: [{ kind: "create-track", track: graphicTrack("only-b") }],
			});
			assert(
				first.snapshot().working.tracks[0]?.id === trackId("only-a"),
				"first Draft saw sibling state",
			);
			assert(
				second.snapshot().working.tracks[0]?.id === trackId("only-b"),
				"second Draft saw sibling state",
			);
			assert(
				(await fixture.engine.tracks()).length === 0,
				"editing published durable content",
			);
			assert(
				fixture.saveCount() === 0 && fixture.watchCount() === 0,
				"editing caused save or watch",
			);
		},
	);

	await cases.check(
		"T2: dependent calls accumulate and failed calls restore their savepoint",
		async (assert) => {
			const fixture = await factory({ optionalFeatures });
			const draft = await open(fixture.manager, "savepoints");
			const first = await draft.stage({
				operations: [
					{ kind: "create-track", track: graphicTrack("base-track") },
				],
			});
			assert(first.accepted, "first dependent call failed");
			const before = draft.snapshot().working;
			const failed = await draft.stage({
				operations: [
					{
						kind: "create-marker",
						marker: {
							id: markerId("rolled-back"),
							time: mediaTime({ ticks: 0 }),
						},
					},
					{ kind: "delete-clip", clipId: clipId("missing") },
				],
			});
			assert(
				!failed.accepted && failed.error.kind === "evaluation-rejected",
				"middle failure was not structured",
			);
			assert(
				hasSameOwnStructure(draft.snapshot().working, before),
				"failed call changed working state",
			);
			assert(
				draft.review().counts.operations === 1,
				"failed call entered the journal",
			);
			const dependent = await draft.stage({
				operations: [
					{
						kind: "create-clip",
						clip: clip({ id: "dependent", track: "base-track" }),
					},
				],
			});
			assert(dependent.accepted, "later dependent call did not recover");
		},
	);

	await cases.check(
		"T2: provider policy rejection and throw leave the queue usable",
		async (assert) => {
			const rejectingPolicy: TransactionPlacementPolicy = {
				evaluate: () => [
					{ code: "provider:draft-blocked", message: "provider rejected" },
				],
			};
			const rejectedFixture = await factory({
				optionalFeatures,
				placementPolicies: [rejectingPolicy],
			});
			const rejectedDraft = await open(
				rejectedFixture.manager,
				"policy-rejected",
			);
			const rejected = await rejectedDraft.stage({
				operations: [{ kind: "create-track", track: graphicTrack("blocked") }],
			});
			assert(
				!rejected.accepted &&
					rejected.error.kind === "evaluation-rejected" &&
					rejected.error.issues.some(
						(issue) => issue.code === "provider:draft-blocked",
					),
				"provider rejection was not preserved",
			);

			let throws = true;
			const policy: TransactionPlacementPolicy = {
				evaluate() {
					if (throws) {
						throws = false;
						throw new Error("provider exploded");
					}
					return [];
				},
			};
			const fixture = await factory({
				optionalFeatures,
				placementPolicies: [policy],
			});
			const draft = await open(fixture.manager, "policy-recovery");
			const failed = await draft.stage({
				operations: [{ kind: "create-track", track: graphicTrack("first") }],
			});
			assert(
				!failed.accepted && failed.error.kind === "evaluation-failed",
				"thrown policy was not structured",
			);
			const recovered = await draft.stage({
				operations: [{ kind: "create-track", track: graphicTrack("second") }],
			});
			assert(recovered.accepted, "queue did not recover after thrown policy");
			assert(
				fixture.saveCount() === 0,
				"policy evaluation saved durable state",
			);
		},
	);

	await cases.check(
		"T2: reviews are structured, ordered, and journal-derived",
		async (assert) => {
			const fixture = await factory({ optionalFeatures });
			const draft = await open(fixture.manager, "review");
			await draft.stage({
				operations: [
					{ kind: "create-track", track: graphicTrack("review-track") },
					{
						kind: "create-marker",
						marker: {
							id: markerId("review-marker"),
							time: mediaTime({ ticks: 0 }),
						},
					},
				],
			});
			await draft.stage({
				operations: [
					{
						kind: "update-track",
						trackId: trackId("review-track"),
						patch: { name: "renamed" },
					},
				],
			});
			const review = draft.review();
			assert(
				review.counts.calls === 2 && review.counts.operations === 3,
				"review counts were wrong",
			);
			assert(
				review.entries
					.map(
						(entry) =>
							`${entry.callIndex}:${entry.operationIndex}:${entry.kind}`,
					)
					.join(",") === "0:0:create-track,0:1:create-marker,1:0:update-track",
				"review order drifted",
			);
			assert(Object.isFrozen(review.entries), "review entries were mutable");
		},
	);

	await cases.check(
		"T2: manual approve and reject enforce terminal states",
		async (assert) => {
			const fixture = await factory({ optionalFeatures });
			const approved = await open(fixture.manager, "manual-approved");
			await approved.stage({
				operations: [
					{ kind: "create-track", track: graphicTrack("committed") },
				],
			});
			const application = await approved.approve();
			assert(
				application.applied && approved.snapshot().state === "applied",
				"manual Draft did not apply",
			);
			const after = await approved.stage({
				operations: [{ kind: "create-track", track: graphicTrack("late") }],
			});
			assert(
				!after.accepted && after.error.kind === "invalid-state",
				"terminal Draft accepted staging",
			);
			const lateReject = await approved.reject();
			assert(
				!lateReject.rejected && lateReject.error.kind === "invalid-state",
				"terminal applied Draft accepted rejection",
			);
			const rejected = await open(fixture.manager, "manual-rejected");
			await rejected.stage({
				operations: [
					{ kind: "create-track", track: graphicTrack("discarded") },
				],
			});
			const rejection = await rejected.reject();
			assert(
				rejection.rejected && rejected.snapshot().state === "rejected",
				"manual rejection was not terminal",
			);
			assert(
				!(await fixture.engine.tracks()).some(
					(track) => track.id === trackId("discarded"),
				),
				"rejection changed durable content",
			);
		},
	);

	await cases.check(
		"T2: auto mode applies once and never changes mode",
		async (assert) => {
			const fixture = await factory({ optionalFeatures });
			const draft = await open(fixture.manager, "auto", "auto");
			const staged = await draft.stage({
				operations: [
					{ kind: "create-track", track: graphicTrack("auto-track") },
				],
			});
			assert(
				staged.accepted && staged.application?.applied === true,
				"auto call did not use approval path",
			);
			assert(
				draft.snapshot().approvalMode === "auto" &&
					draft.snapshot().state === "applied",
				"auto mode/state changed",
			);
			const explicit = await draft.approve();
			assert(
				!explicit.applied &&
					"draftError" in explicit &&
					explicit.draftError.kind === "mode-incompatible",
				"explicit auto approval was allowed",
			);
			assert(fixture.applyCount() === 1, "auto Draft applied more than once");

			const conflictFixture = await factory({ optionalFeatures });
			const winner = await open(conflictFixture.manager, "auto-winner", "auto");
			const loser = await open(conflictFixture.manager, "auto-loser", "auto");
			const won = await winner.stage({
				operations: [
					{ kind: "create-track", track: graphicTrack("auto-winner-track") },
				],
			});
			const lost = await loser.stage({
				operations: [
					{ kind: "create-track", track: graphicTrack("auto-loser-track") },
				],
			});
			assert(
				won.accepted && won.application?.applied === true,
				"auto winner failed",
			);
			assert(
				lost.accepted &&
					lost.application?.applied === false &&
					"engineError" in lost.application &&
					lost.application.engineError instanceof TransactionError,
				"auto conflict did not use the normal expected-revision path",
			);
			assert(
				loser.snapshot().state === "conflicted" &&
					loser.snapshot().approvalMode === "auto",
				"auto conflict changed mode or reopened the Draft",
			);
		},
	);

	await cases.check(
		"T2: same-Draft invocation order and terminal queue observation are stable",
		async (assert) => {
			const fixture = await factory({ optionalFeatures });
			const draft = await open(fixture.manager, "queued-auto", "auto");
			const first = draft.stage({
				operations: [
					{ kind: "create-track", track: graphicTrack("queued-first") },
				],
			});
			const second = draft.stage({
				operations: [
					{ kind: "create-track", track: graphicTrack("queued-second") },
				],
			});
			const [firstOutcome, secondOutcome] = await Promise.all([first, second]);
			assert(firstOutcome.accepted, "first queued call failed");
			assert(
				!secondOutcome.accepted && secondOutcome.error.kind === "invalid-state",
				"later queued call missed terminal transition",
			);
		},
	);

	await cases.check(
		"T2: empty and mode-incompatible approval are structured and non-terminal",
		async (assert) => {
			const fixture = await factory({ optionalFeatures });
			const draft = await open(fixture.manager, "empty-manual");
			const empty = await draft.approve();
			assert(
				!empty.applied &&
					"draftError" in empty &&
					empty.draftError.kind === "empty-draft",
				"empty approval was not rejected",
			);
			assert(
				draft.snapshot().state === "editing",
				"empty approval became terminal",
			);
			const auto = await open(fixture.manager, "empty-auto", "auto");
			const incompatible = await auto.approve();
			assert(
				!incompatible.applied &&
					"draftError" in incompatible &&
					incompatible.draftError.kind === "mode-incompatible",
				"auto approval mismatch was not named",
			);
		},
	);

	await cases.check(
		"T2: approval is one flattened apply with a stable receipt",
		async (assert) => {
			const fixture = await factory({ optionalFeatures });
			const draft = await open(fixture.manager, "flattened");
			await draft.stage({
				operations: [
					{ kind: "create-track", track: graphicTrack("flat-track") },
				],
			});
			await draft.stage({
				operations: [
					{
						kind: "create-marker",
						marker: {
							id: markerId("flat-marker"),
							time: mediaTime({ ticks: 0 }),
						},
					},
				],
			});
			const outcome = await draft.approve();
			assert(outcome.applied, "flattened Draft did not apply");
			if (!outcome.applied) return;
			assert(
				outcome.receipt.forwardBatch.operations.length === 2,
				"journal was not flattened",
			);
			assert(
				outcome.receipt.forwardBatch.expectedRevision === revisionOf(0),
				"durable base revision was not used",
			);
			const applyKey = outcome.receipt.forwardBatch.idempotencyKey;
			assert(
				typeof applyKey === "string" &&
					applyKey.startsWith(
						"draft:0066006c0061007400740065006e00650064:base:0:incarnation:",
					) &&
					applyKey.endsWith(":apply"),
				"apply key did not identify the Draft base/incarnation",
			);
			assert(
				outcome.receipt.undoPlan.batch.idempotencyKey ===
					applyKey?.replace(/:apply$/, ":undo"),
				"undo key did not share the Draft incarnation namespace",
			);
			assert(
				fixture.applyCount() === 1 &&
					fixture.saveCount() === 1 &&
					fixture.watchCount() === 1,
				"approval was not one apply/save/watch",
			);
			assert(
				Object.isFrozen(outcome.receipt.undoPlan.batch.operations),
				"receipt was not immutable",
			);
			const observedAgain = await draft.approve();
			assert(
				observedAgain.applied &&
					hasSameOwnStructure(observedAgain.receipt, outcome.receipt),
				"applied receipt was not stably re-observed",
			);
			assert(fixture.applyCount() === 1, "receipt observation applied again");
		},
	);

	await cases.check(
		"T2: one sibling wins and a stale sibling conflicts without rebase",
		async (assert) => {
			const fixture = await factory({ optionalFeatures });
			const first = await open(fixture.manager, "winner");
			const second = await open(fixture.manager, "loser");
			await first.stage({
				operations: [
					{ kind: "create-track", track: graphicTrack("winner-track") },
				],
			});
			await second.stage({
				operations: [
					{ kind: "create-track", track: graphicTrack("loser-track") },
				],
			});
			assert((await first.approve()).applied, "first sibling did not apply");
			const stale = await second.approve();
			assert(
				!stale.applied &&
					"engineError" in stale &&
					stale.engineError instanceof TransactionError,
				"stale sibling did not retain T1 error ownership",
			);
			if (
				!stale.applied &&
				"engineError" in stale &&
				stale.engineError instanceof TransactionError
			) {
				assert(
					stale.engineError.code === "conflict" &&
						Number(stale.engineError.expectedRevision) === 0 &&
						Number(stale.engineError.actualRevision) === 1,
					"conflict revisions were missing",
				);
				assert(
					Object.isFrozen(stale.engineError) &&
						!Reflect.set(stale.engineError, "actualRevision", revisionOf(99)) &&
						Number(stale.engineError.actualRevision) === 1,
					"transaction error revision evidence remained mutable",
				);
			}
			assert(
				second.snapshot().state === "conflicted",
				"stale sibling was not terminal",
			);
			assert(
				!(await fixture.engine.tracks()).some(
					(track) => track.id === trackId("loser-track"),
				),
				"stale sibling changed content",
			);
		},
	);

	await cases.check(
		"T2: compensating transaction restores content and later work makes it stale",
		async (assert) => {
			const fixture = await factory({ optionalFeatures });
			const before = await readContent(fixture.engine);
			const draft = await open(fixture.manager, "undo-clean");
			await draft.stage({
				operations: [
					{ kind: "create-track", track: graphicTrack("undo-track") },
				],
			});
			const application = await draft.approve();
			assert(application.applied, "Draft did not apply before undo");
			if (!application.applied) return;
			await fixture.engine.apply(application.receipt.undoPlan.batch);
			assert(
				hasSameOwnStructure(await readContent(fixture.engine), before),
				"one undo did not restore base content",
			);

			const staleDraft = await open(fixture.manager, "undo-stale");
			await staleDraft.stage({
				operations: [
					{ kind: "create-track", track: graphicTrack("stale-target") },
				],
			});
			const staleApplication = await staleDraft.approve();
			assert(staleApplication.applied, "stale-undo setup did not apply");
			if (!staleApplication.applied) return;
			await fixture.engine.apply({
				operations: [
					{
						kind: "create-marker",
						marker: {
							id: markerId("intervening"),
							time: mediaTime({ ticks: 0 }),
						},
					},
				],
			});
			let error: unknown;
			try {
				await fixture.engine.apply(staleApplication.receipt.undoPlan.batch);
			} catch (caught) {
				error = caught;
			}
			assert(
				error instanceof TransactionError && error.code === "conflict",
				"stale undo overwrote later work",
			);
		},
	);

	await cases.check(
		"T2: compensation stays inside the affected policy surface and is preflighted",
		async (assert) => {
			let armed = false;
			const observedKinds: string[][] = [];
			const undoPolicyDocuments: TransactionEngineDocument[] = [];
			const restrictivePolicy: TransactionPlacementPolicy = {
				evaluate({ batch, document }) {
					if (!armed) return [];
					const kinds = batch.operations.map((operation) => operation.kind);
					observedKinds.push(kinds);
					if (batch.idempotencyKey?.endsWith(":undo")) {
						undoPolicyDocuments.push(document);
						if (
							!document.idempotency.some(
								(entry) => entry.key === "policy-prior-keyed-entry",
							) ||
							!document.idempotency.some((entry) =>
								entry.key.endsWith(":apply"),
							)
						) {
							return [
								{
									code: "provider:missing-forward-commit",
									message:
										"undo requires the complete committed idempotency ledger",
								},
							];
						}
					}
					return kinds.some((kind) => kind !== "update-marker")
						? [
								{
									code: "provider:unrelated-compensation",
									message: "unrelated create/delete operations are forbidden",
								},
							]
						: [];
				},
			};
			const fixture = await factory({
				optionalFeatures,
				seedOperations: [
					{ kind: "create-track", track: graphicTrack("policy-existing") },
					{
						kind: "create-marker",
						marker: {
							id: markerId("policy-marker"),
							time: mediaTime({ ticks: 0 }),
							note: "base",
						},
					},
				],
				placementPolicies: [restrictivePolicy],
			});
			await fixture.engine.apply({
				operations: [
					{
						kind: "create-marker",
						marker: {
							id: markerId("policy-prior-keyed-marker"),
							time: mediaTime({ ticks: 0 }),
						},
					},
				],
				idempotencyKey: "policy-prior-keyed-entry",
			});
			armed = true;
			const draft = await open(fixture.manager, "policy-closed-undo");
			const staged = await draft.stage({
				operations: [
					{
						kind: "update-marker",
						markerId: markerId("policy-marker"),
						patch: { note: "forward" },
					},
				],
			});
			assert(staged.accepted, "policy-safe forward edit was not staged");
			const application = await draft.approve();
			assert(application.applied, "policy-safe forward edit did not apply");
			if (!application.applied) return;
			assert(
				application.receipt.undoPlan.batch.operations.length === 1 &&
					application.receipt.undoPlan.batch.operations[0]?.kind ===
						"update-marker",
				"local marker edit expanded into unrelated compensation operations",
			);
			await fixture.engine.apply(application.receipt.undoPlan.batch);
			assert(
				(await fixture.engine.markers())[0]?.note === "base",
				"policy-safe inverse did not restore the marker",
			);
			assert(
				undoPolicyDocuments.length === 2 &&
					hasSameOwnStructure(undoPolicyDocuments[0], undoPolicyDocuments[1]),
				"compensation preflight and actual undo saw different committed documents",
			);
			const applyKey = application.receipt.forwardBatch.idempotencyKey;
			assert(
				typeof applyKey === "string" &&
					undoPolicyDocuments.every(
						(document) =>
							document.idempotency.length === 2 &&
							document.idempotency[0]?.key === "policy-prior-keyed-entry" &&
							document.idempotency[1]?.key === applyKey &&
							document.idempotency[1]?.result.revision ===
								application.receipt.forwardResult.revision,
					),
				"undo policy did not see the complete prior and forward idempotency state",
			);
			assert(
				observedKinds.length === 4 &&
					observedKinds.every(
						(kinds) => kinds.length === 1 && kinds[0] === "update-marker",
					),
				"provider observed an unrelated operation in stage/preflight/apply/undo",
			);

			const inverseRejectingPolicy: TransactionPlacementPolicy = {
				evaluate({ batch }) {
					const rejectsInverse = batch.operations.some(
						(operation) =>
							operation.kind === "update-marker" &&
							operation.patch.note === "base",
					);
					return rejectsInverse
						? [
								{
									code: "provider:inverse-forbidden",
									message: "inverse marker value is forbidden",
								},
							]
						: [];
				},
			};
			const rejectedFixture = await factory({
				optionalFeatures,
				seedOperations: [
					{
						kind: "create-marker",
						marker: {
							id: markerId("preflight-marker"),
							time: mediaTime({ ticks: 0 }),
							note: "base",
						},
					},
				],
				placementPolicies: [inverseRejectingPolicy],
			});
			const rejectingDraft = await open(
				rejectedFixture.manager,
				"policy-rejected-undo",
			);
			await rejectingDraft.stage({
				operations: [
					{
						kind: "update-marker",
						markerId: markerId("preflight-marker"),
						patch: { note: "forward" },
					},
				],
			});
			const rejected = await rejectingDraft.approve();
			assert(
				!rejected.applied &&
					"draftError" in rejected &&
					rejected.draftError.kind === "compensation-rejected",
				"a provider-rejected inverse was not blocked before forward apply",
			);
			assert(
				rejectedFixture.applyCount() === 0,
				"provider-rejected inverse reached durable forward apply",
			);
			assert(
				rejectedFixture.saveCount() === 0 &&
					rejectedFixture.watchCount() === 0 &&
					Number(await rejectedFixture.engine.revision()) === 1 &&
					(await rejectedFixture.engine.markers())[0]?.note === "base",
				"provider-rejected inverse changed durable forward state",
			);
		},
	);

	await cases.check(
		"T2: Project patches review, roll back, apply once, compensate, and reject stale or invalid timebases",
		async (assert) => {
			const seed: TransactionOperation[] = [
				{ kind: "create-track", track: graphicTrack("project-track") },
				{
					kind: "create-clip",
					clip: clip({ id: "project-clip", track: "project-track" }),
				},
			];
			const fixture = await factory({ optionalFeatures, seedOperations: seed });
			const before = await readContent(fixture.engine);
			const draft = await open(fixture.manager, "project-draft");
			const named = await draft.stage({
				operations: [
					{
						kind: "update-project",
						projectId: projectId("draft-project"),
						patch: { name: "Draft Project renamed" },
					},
				],
			});
			assert(named.accepted, "valid Project patch was not Draft-safe");
			const beforeRejectedCall = draft.snapshot();
			const beforeRejectedReview = draft.review();
			const rejectedCall = await draft.stage({
				operations: [
					{
						kind: "update-project",
						projectId: projectId("draft-project"),
						patch: { canvasWidth: 640 },
					},
					{ kind: "delete-clip", clipId: clipId("missing-project-call") },
				],
			});
			assert(
				!rejectedCall.accepted &&
					rejectedCall.error.kind === "evaluation-rejected",
				"mixed Project/entity failure was not rejected",
			);
			assert(
				hasSameOwnStructure(draft.snapshot(), beforeRejectedCall) &&
					hasSameOwnStructure(draft.review(), beforeRejectedReview),
				"mixed Project/entity failure changed the savepoint or journal",
			);
			const repaired = await draft.stage({
				operations: [
					{
						kind: "update-project",
						projectId: projectId("draft-project"),
						patch: { frameRate: { numerator: 24, denominator: 1 } },
					},
					{
						kind: "update-clip",
						clipId: clipId("project-clip"),
						patch: { duration: mediaTime({ ticks: 5_000 }) },
					},
				],
			});
			assert(
				repaired.accepted,
				"same-call Project timebase repair was rejected",
			);
			const review = draft.review();
			assert(
				review.counts.byKind["update-project"] === 2 &&
					review.counts.byKind["update-clip"] === 1 &&
					review.entries
						.map(
							(entry) => `${entry.kind}:${entry.affectedEntityIds.join("+")}`,
						)
						.join(",") ===
						"update-project:draft-project,update-project:draft-project,update-clip:project-clip",
				"Project review counts or stable affected-id order were wrong",
			);
			const application = await draft.approve();
			assert(application.applied, "mixed Project+clip Draft did not apply");
			if (!application.applied) return;
			assert(
				fixture.applyCount() === 1 &&
					fixture.saveCount() === 1 &&
					fixture.watchCount() === 1,
				"mixed Project+clip Draft was not one parent apply/save/watch",
			);
			const inverse = application.receipt.undoPlan.batch.operations;
			assert(
				inverse.length === 2 &&
					inverse[0]?.kind === "update-project" &&
					Object.keys(inverse[0].patch).sort().join(",") === "frameRate,name" &&
					inverse[1]?.kind === "update-clip",
				"Project compensation was not minimal or composition-stable",
			);
			await fixture.engine.apply(application.receipt.undoPlan.batch);
			assert(
				hasSameOwnStructure(await readContent(fixture.engine), before),
				"Project compensation did not restore the exact base",
			);

			const invalidFixture = await factory({
				optionalFeatures,
				seedOperations: seed,
			});
			const invalidDraft = await open(
				invalidFixture.manager,
				"invalid-project-timebase",
			);
			const invalidBefore = invalidDraft.snapshot();
			const invalidTimebase = await invalidDraft.stage({
				operations: [
					{
						kind: "update-project",
						projectId: projectId("draft-project"),
						patch: { frameRate: { numerator: 24, denominator: 1 } },
					},
				],
			});
			assert(
				!invalidTimebase.accepted &&
					invalidTimebase.error.kind === "evaluation-rejected" &&
					invalidTimebase.error.issues.some(
						(entry) => entry.code === "timebase-misaligned",
					),
				"Draft accepted an unrepaired final Project timebase",
			);
			assert(
				hasSameOwnStructure(invalidDraft.snapshot(), invalidBefore) &&
					invalidFixture.saveCount() === 0,
				"invalid Project timebase changed Draft or durable state",
			);

			const staleFixture = await factory({ optionalFeatures });
			const staleDraft = await open(staleFixture.manager, "stale-project");
			await staleDraft.stage({
				operations: [
					{
						kind: "update-project",
						projectId: projectId("draft-project"),
						patch: { canvasHeight: 720 },
					},
				],
			});
			await staleFixture.engine.apply({
				operations: [
					{
						kind: "update-project",
						projectId: projectId("draft-project"),
						patch: { name: "intervening Project work" },
					},
				],
			});
			const stale = await staleDraft.approve();
			assert(
				!stale.applied &&
					"engineError" in stale &&
					stale.engineError instanceof TransactionError &&
					stale.engineError.code === "conflict",
				"stale Project Draft rebased or overwrote later work",
			);
			assert(
				(await staleFixture.engine.project())?.canvasHeight === 1080,
				"stale Project Draft published its canvas patch",
			);
		},
	);

	await cases.check(
		"T2: every operation kind has an inverse and track cascades restore",
		async (assert) => {
			const seed: TransactionOperation[] = [
				{ kind: "create-track", track: graphicTrack("existing-track") },
				{ kind: "create-asset", asset: imageAsset("existing-asset") },
				{
					kind: "create-clip",
					clip: clip({
						id: "existing-clip",
						track: "existing-track",
						asset: "existing-asset",
					}),
				},
				{
					kind: "create-marker",
					marker: {
						id: markerId("existing-marker"),
						time: mediaTime({ ticks: 0 }),
						note: "old",
					},
				},
			];
			const fixture = await factory({
				optionalFeatures,
				seedOperations: seed,
				retainedAssetIds: [assetId("created-asset")],
			});
			const before = await readContent(fixture.engine);
			const draft = await open(fixture.manager, "all-inverses");
			await draft.stage({
				operations: [
					{
						kind: "update-project",
						projectId: projectId("draft-project"),
						patch: { canvasWidth: 1280 },
					},
					{
						kind: "update-track",
						trackId: trackId("existing-track"),
						patch: { name: "updated" },
					},
					{
						kind: "update-clip",
						clipId: clipId("existing-clip"),
						patch: { duration: mediaTime({ ticks: 8_000 }) },
					},
					{
						kind: "update-marker",
						markerId: markerId("existing-marker"),
						patch: { note: "updated" },
					},
				],
			});
			await draft.stage({
				operations: [
					{ kind: "delete-clip", clipId: clipId("existing-clip") },
					{ kind: "delete-asset", assetId: assetId("existing-asset") },
					{ kind: "delete-marker", markerId: markerId("existing-marker") },
					{ kind: "delete-track", trackId: trackId("existing-track") },
				],
			});
			await draft.stage({
				operations: [
					{ kind: "create-track", track: graphicTrack("created-track") },
					{ kind: "create-asset", asset: imageAsset("created-asset") },
					{
						kind: "create-clip",
						clip: clip({
							id: "created-clip",
							track: "created-track",
							asset: "created-asset",
						}),
					},
					{
						kind: "create-marker",
						marker: {
							id: markerId("created-marker"),
							time: mediaTime({ ticks: 0 }),
						},
					},
				],
			});
			const application = await draft.approve();
			assert(application.applied, "all-inverse Draft did not apply");
			if (!application.applied) return;
			assert(
				new Set(application.receipt.review.entries.map((entry) => entry.kind))
					.size === OPERATION_KINDS.length,
				"not every operation kind entered the journal",
			);
			await fixture.engine.apply(application.receipt.undoPlan.batch);
			assert(
				hasSameOwnStructure(await readContent(fixture.engine), before),
				"all-operation undo did not restore content",
			);

			const cascadeFixture = await factory({
				optionalFeatures,
				seedOperations: [
					{ kind: "create-track", track: graphicTrack("cascade-track") },
					{
						kind: "create-clip",
						clip: clip({ id: "cascade-clip", track: "cascade-track" }),
					},
				],
			});
			const cascade = await open(cascadeFixture.manager, "cascade");
			await cascade.stage({
				operations: [
					{ kind: "delete-track", trackId: trackId("cascade-track") },
				],
			});
			const deleted = await cascade.approve();
			assert(deleted.applied, "cascade delete did not apply");
			if (deleted.applied)
				await cascadeFixture.engine.apply(deleted.receipt.undoPlan.batch);
			assert(
				(await cascadeFixture.engine.tracks()).length === 1 &&
					(await cascadeFixture.engine.clips()).length === 1,
				"cascade undo did not restore track before clip",
			);
		},
	);

	await cases.check(
		"T2: undo restores complete ordering and absent optional properties exactly",
		async (assert) => {
			const middleTrack = {
				...graphicTrack("optional-middle-track"),
				providerPrivate: { sentinel: "keep-track-evidence" },
			};
			const middleClip = {
				...clip({
					id: "optional-middle-clip",
					track: "optional-middle-track",
				}),
				providerPrivate: { sentinel: "keep-clip-evidence" },
			};
			const middleMarker = {
				id: markerId("optional-middle-marker"),
				time: mediaTime({ ticks: 4_000 }),
				providerPrivate: { sentinel: "keep-marker-evidence" },
			};
			const fixture = await factory({
				optionalFeatures,
				seedOperations: [
					{
						kind: "create-track",
						track: graphicTrack("optional-first-track"),
					},
					{ kind: "create-track", track: middleTrack },
					{
						kind: "create-track",
						track: graphicTrack("optional-last-track"),
					},
					{ kind: "create-asset", asset: imageAsset("optional-asset") },
					{
						kind: "create-clip",
						clip: clip({
							id: "optional-first-clip",
							track: "optional-first-track",
						}),
					},
					{ kind: "create-clip", clip: middleClip },
					{
						kind: "create-clip",
						clip: clip({
							id: "optional-last-clip",
							track: "optional-last-track",
						}),
					},
					{
						kind: "create-marker",
						marker: {
							id: markerId("optional-first-marker"),
							time: mediaTime({ ticks: 0 }),
						},
					},
					{ kind: "create-marker", marker: middleMarker },
					{
						kind: "create-marker",
						marker: {
							id: markerId("optional-last-marker"),
							time: mediaTime({ ticks: 8_000 }),
						},
					},
				],
				retainedAssetIds: [assetId("optional-asset")],
			});
			const before = await readContent(fixture.engine);
			const draft = await open(fixture.manager, "optional-absence");
			await draft.stage({
				operations: [
					{
						kind: "delete-track",
						trackId: trackId("optional-middle-track"),
					},
					{ kind: "create-track", track: middleTrack },
					{ kind: "create-clip", clip: middleClip },
					{
						kind: "delete-marker",
						markerId: markerId("optional-middle-marker"),
					},
					{ kind: "create-marker", marker: middleMarker },
					{
						kind: "update-clip",
						clipId: clipId("optional-first-clip"),
						patch: { assetId: assetId("optional-asset") },
					},
					{
						kind: "update-marker",
						markerId: markerId("optional-first-marker"),
						patch: { note: "temporary", color: "#ffffff" },
					},
				],
			});
			const application = await draft.approve();
			assert(application.applied, "optional-property Draft did not apply");
			if (!application.applied) return;
			assert(
				application.receipt.undoPlan.batch.operations.length === 14 &&
					application.receipt.undoPlan.batch.operations.every(
						(operation) =>
							operation.kind !== "create-asset" &&
							operation.kind !== "delete-asset",
					),
				"ordered repair did not stay within its minimal affected suffixes",
			);
			await fixture.engine.apply(application.receipt.undoPlan.batch);
			const restored = await readContent(fixture.engine);
			assert(
				hasSameOwnStructure(restored, before),
				"undo did not restore optional-property presence exactly",
			);
			const restoredContent = restored as {
				readonly tracks: readonly { readonly id: string }[];
				readonly clips: readonly object[];
				readonly markers: readonly object[];
			};
			assert(
				!Object.hasOwn(restoredContent.clips[0] ?? {}, "assetId") &&
					!Object.hasOwn(restoredContent.markers[0] ?? {}, "note") &&
					!Object.hasOwn(restoredContent.markers[0] ?? {}, "color"),
				"undo recreated absent optionals as own undefined properties",
			);
			assert(
				restoredContent.tracks.map((track) => track.id).join(",") ===
					"optional-first-track,optional-middle-track,optional-last-track" &&
					restoredContent.clips
						.map((entry) => Reflect.get(entry, "id"))
						.join(",") ===
						"optional-first-clip,optional-middle-clip,optional-last-clip" &&
					restoredContent.markers
						.map((entry) => Reflect.get(entry, "id"))
						.join(",") ===
						"optional-first-marker,optional-middle-marker,optional-last-marker",
				"undo did not restore observable track/clip/marker ordering",
			);
		},
	);

	await cases.check(
		"T2: retention preflight blocks referenced assets before apply",
		async (assert) => {
			const fixture = await factory({ optionalFeatures });
			const draft = await open(fixture.manager, "retention");
			await draft.stage({
				operations: [
					{ kind: "create-track", track: graphicTrack("retention-track") },
					{ kind: "create-asset", asset: imageAsset("missing-retained") },
					{
						kind: "create-clip",
						clip: clip({
							id: "retention-clip",
							track: "retention-track",
							asset: "missing-retained",
						}),
					},
				],
			});
			const outcome = await draft.approve();
			assert(
				!outcome.applied &&
					"draftError" in outcome &&
					outcome.draftError.kind === "retention-failed",
				"missing retention did not block approval",
			);
			assert(
				fixture.applyCount() === 0 && fixture.saveCount() === 0,
				"retention failure reached parent apply",
			);
			assert(
				draft.snapshot().state === "conflicted",
				"retention failure was not terminal",
			);
		},
	);

	await cases.check(
		"T2: classification is exhaustive and immediate input is rejected before mutation",
		async (assert) => {
			assert(
				JSON.stringify(Object.keys(DRAFT_OPERATION_CLASSIFICATION)) ===
					JSON.stringify(OPERATION_KINDS),
				"Draft-safe register is incomplete",
			);
			assert(
				Object.values(DRAFT_OPERATION_CLASSIFICATION).every(
					(value) => value === "draft-safe",
				),
				"Draft-safe register contains another handling",
			);
			assert(
				Object.values(IMMEDIATE_OPERATION_CLASSIFICATION).every(
					(value) => value === "immediate",
				),
				"immediate register is invalid",
			);
			assert(
				classifyDraftRuntimeOperation({
					kind: "delete-asset",
					assetId: "local",
				}).handling === "draft-safe",
				"project asset deletion was not Draft-safe",
			);
			assert(
				classifyDraftRuntimeOperation({ kind: "external-resource-deletion" })
					.handling === "immediate",
				"external deletion was not immediate",
			);
			const fixture = await factory({ optionalFeatures });
			const draft = await open(fixture.manager, "forged-immediate");
			const before = draft.snapshot();
			const outcome = await draft.stage({
				operations: [{ kind: "source-package-removal" }],
			} as never);
			assert(
				!outcome.accepted &&
					outcome.error.kind === "immediate-operation-required",
				"forged immediate input crossed the Draft boundary",
			);
			assert(
				hasSameOwnStructure(draft.snapshot(), before) &&
					fixture.saveCount() === 0,
				"immediate rejection mutated state",
			);
			assert(
				!("invoke" in fixture.manager) && !("invoke" in draft),
				"generic invoke escape hatch exists",
			);
		},
	);

	await cases.check(
		"T2: optional engine feature literals remain observable",
		async (assert) => {
			const fixture = await factory({ optionalFeatures });
			const capabilities = await fixture.engine.capabilities();
			const capabilityRecord: Readonly<Record<string, boolean>> = capabilities;
			const optionalRecord = optionalFeatures as
				| Readonly<Record<string, boolean>>
				| undefined;
			for (const key of Object.keys(optionalFeatures ?? {})) {
				assert(
					capabilityRecord[key] === optionalRecord?.[key],
					`optional feature ${key} widened or changed`,
				);
			}
			assert(
				capabilities["cross-engine-cas"] === false,
				"shared-engine invariant became dishonest",
			);
		},
	);

	const results = cases.results;
	const counts = summary(results);
	return {
		label: "Draft editing sessions (T2)",
		passed: counts.failed === 0,
		results,
		summary: counts,
	};
}
