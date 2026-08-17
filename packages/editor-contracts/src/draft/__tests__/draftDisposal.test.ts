import { describe, expect, test } from "bun:test";
import type { Project } from "../..";
import { projectId } from "../..";
import type { ProjectStore } from "@opencut/editor-ports";
import { ProjectStoreError } from "@opencut/editor-ports";
import { createInMemoryProjectStoreFixture } from "@opencut/editor-ports/in-memory";
import {
	createTransactionNativeDocumentAdapter,
	createTransactionNativeProjectSeed,
	openTransactionEngine,
} from "../../engine";
import { bindNativeCommittedTransactionStateCapture } from "../../engine/committed-capture";
import { createDraftEditingManager } from "../manager";
import {
	immutableDraftErrorEvidence,
	registerDraftEvidenceErrorType,
} from "../immutable";
import { createInMemoryDraftResourceRetentionPolicy } from "../retention";
import type { CreateDraftEditingManagerOptions } from "../types";

const PROJECT_ID = "draft-disposal-project";

function project(): Project {
	return {
		id: projectId(PROJECT_ID),
		name: "Draft disposal tests",
		frameRate: { numerator: 30, denominator: 1 },
		canvasWidth: 1920,
		canvasHeight: 1080,
	};
}

interface DisposalFixture {
	readonly manager: ReturnType<typeof createDraftEditingManager>;
	readonly store: ProjectStore;
}

async function createFixture(
	disposal?: Pick<
		CreateDraftEditingManagerOptions<never>,
		"clock" | "draftTtl" | "journalCallBound" | "journalOperationBound"
	>,
): Promise<DisposalFixture> {
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
	});
	const manager = createDraftEditingManager({
		engine,
		committedState: bindNativeCommittedTransactionStateCapture(engine),
		retentionPolicy: createInMemoryDraftResourceRetentionPolicy({
			retainedAssetIds: [],
		}),
		...disposal,
	});
	return { manager, store };
}

async function openSession(fixture: DisposalFixture, id: string) {
	const opened = await fixture.manager.open({ id, approvalMode: "manual" });
	if (!opened.opened) throw new Error(opened.error.message);
	return opened.session;
}

function stageCall() {
	return {
		operations: [
			{
				kind: "create-track" as const,
				track: {
					id: `track-${Math.random().toString(36).slice(2, 8)}` as never,
					kind: "graphic" as const,
					name: "track",
					hidden: false,
				},
			},
		],
	};
}

describe("Draft session disposal (D24 item 3)", () => {
	test("discard terminates an editing draft as rejected(discarded)", async () => {
		const fixture = await createFixture();
		const session = await openSession(fixture, "d1");
		const staged = await session.stage(stageCall());
		expect(staged.accepted).toBe(true);
		const outcome = await session.discard();
		expect(outcome.rejected).toBe(true);
		if (outcome.rejected) expect(outcome.reason).toBe("discarded");
		expect(session.snapshot().state).toBe("rejected");
		expect(session.snapshot().rejectionReason).toBe("discarded");
	});

	test("discard from a terminal state fails with invalid-state naming discard", async () => {
		const fixture = await createFixture();
		const session = await openSession(fixture, "d2");
		const rejected = await session.reject();
		expect(rejected.rejected).toBe(true);
		if (rejected.rejected) expect(rejected.reason).toBe("rejected");
		const second = await session.discard();
		expect(second.rejected).toBe(false);
		if (!second.rejected) {
			expect(second.error.kind).toBe("invalid-state");
			expect(second.error.action).toBe("discard");
			expect(second.error.state).toBe("rejected");
		}
	});

	test("a TTL carries expiresAt and expires lazily on the next interaction", async () => {
		let now = 1_000;
		const fixture = await createFixture({
			clock: () => now,
			draftTtl: 500,
		});
		const session = await openSession(fixture, "ttl1");
		expect(session.snapshot().expiresAt).toBe(1_500);
		const staged = await session.stage(stageCall());
		expect(staged.accepted).toBe(true);
		now = 1_600; // past the deadline
		const expired = await session.stage(stageCall());
		expect(expired.accepted).toBe(false);
		if (!expired.accepted) {
			expect(expired.error.kind).toBe("draft-expired");
			if (expired.error.kind === "draft-expired") {
				expect(expired.error.expiresAt).toBe(1_500);
			}
		}
		expect(session.snapshot().state).toBe("rejected");
		expect(session.snapshot().rejectionReason).toBe("expired");
		const approval = await session.approve();
		expect(approval.applied).toBe(false);
		if (!approval.applied && approval.state !== "conflicted") {
			expect(approval.draftError.kind).toBe("invalid-state");
		}
	});

	test("the lazy expiry check itself observes the host clock exactly once per operation", async () => {
		let now = 0;
		const fixture = await createFixture({
			clock: () => now,
			draftTtl: 10,
		});
		const session = await openSession(fixture, "ttl2");
		now = 9; // exactly at now < expiresAt (10): still editing
		const staged = await session.stage(stageCall());
		expect(staged.accepted).toBe(true);
		now = 10; // clock() >= expiresAt: expired
		const after = await session.discard();
		expect(after.rejected).toBe(false);
		if (!after.rejected) {
			expect(after.error.kind).toBe("invalid-state");
			expect(after.error.state).toBe("rejected");
		}
		expect(session.snapshot().rejectionReason).toBe("expired");
	});

	test("without a clock and TTL there is no expiresAt and no expiry", async () => {
		const fixture = await createFixture();
		const session = await openSession(fixture, "ttl3");
		expect(session.snapshot().expiresAt).toBeUndefined();
		const staged = await session.stage(stageCall());
		expect(staged.accepted).toBe(true);
	});

	test("journalCallBound fails the exceeding call whole and leaves the draft intact", async () => {
		const fixture = await createFixture({ journalCallBound: 2 });
		const session = await openSession(fixture, "b1");
		expect((await session.stage(stageCall())).accepted).toBe(true);
		const before = session.snapshot();
		expect((await session.stage(stageCall())).accepted).toBe(true);
		const third = await session.stage(stageCall());
		expect(third.accepted).toBe(false);
		if (!third.accepted) {
			expect(third.error.kind).toBe("journal-bound");
			if (third.error.kind === "journal-bound") {
				expect(third.error.bound).toBe("calls");
				expect(third.error.limit).toBe(2);
			}
		}
		expect(session.snapshot().acceptedCallCount).toBe(2);
		expect(session.snapshot().acceptedOperationCount).toBe(
			before.acceptedOperationCount + 1,
		);
	});

	test("journalOperationBound counts cumulative operations across calls", async () => {
		const fixture = await createFixture({ journalOperationBound: 2 });
		const session = await openSession(fixture, "b2");
		expect((await session.stage(stageCall())).accepted).toBe(true);
		expect((await session.stage(stageCall())).accepted).toBe(true);
		const third = await session.stage(stageCall());
		expect(third.accepted).toBe(false);
		if (!third.accepted) {
			expect(third.error.kind).toBe("journal-bound");
			if (third.error.kind === "journal-bound") {
				expect(third.error.bound).toBe("operations");
				expect(third.error.limit).toBe(2);
			}
		}
		expect(session.snapshot().acceptedOperationCount).toBe(2);
	});
});

describe("Draft evidence error-type whitelist (surgery A)", () => {
	test("ProjectStoreError keeps its prototype across evidence cloning", () => {
		const storeError = new ProjectStoreError({
			code: "read-failed",
			operation: "load",
			scope: { kind: "project", projectId: "p1" },
		});
		const evidence = immutableDraftErrorEvidence(storeError);
		expect(evidence).toBeInstanceOf(ProjectStoreError);
	});

	test("an unregistered custom class is reduced to Error.prototype", () => {
		class AttackerError extends Error {
			constructor() {
				super("boom");
				this.name = "AttackerError";
			}
		}
		const evidence = immutableDraftErrorEvidence(new AttackerError());
		expect(evidence).toBeInstanceOf(Error);
		expect(evidence).not.toBeInstanceOf(AttackerError);
	});

	test("registerDraftEvidenceErrorType vouches for a host class", () => {
		class HostVouchedError extends Error {
			constructor(message: string) {
				super(message);
				this.name = "HostVouchedError";
			}
		}
		registerDraftEvidenceErrorType(HostVouchedError);
		const evidence = immutableDraftErrorEvidence(
			new HostVouchedError("vouched"),
		);
		expect(evidence).toBeInstanceOf(HostVouchedError);
	});
});
