import { describe, expect, test } from "bun:test";
import { frameRate, projectId, revisionOf } from "@opencut/editor-contracts";
import type { Project } from "@opencut/editor-contracts";
import {
	createTransactionNativeDocumentAdapter,
	createTransactionNativeProjectSeed,
} from "@opencut/editor-contracts/engine";
import { createInMemoryProjectStoreFixture } from "@opencut/editor-ports/in-memory";
import type { ProjectStore } from "@opencut/editor-ports";
import { createAutomation } from "../automation";

const PROJECT: Project = {
	id: projectId("automation-test-project"),
	name: "Automation composition test",
	frameRate: frameRate({ numerator: 30, denominator: 1 }),
	canvasWidth: 1920,
	canvasHeight: 1080,
};

async function seededStore(): Promise<ProjectStore> {
	const { store } = createInMemoryProjectStoreFixture();
	await store.save(
		createTransactionNativeProjectSeed({
			projectId: PROJECT.id,
			project: PROJECT,
		}),
	);
	return store;
}

function createTrack(id: string) {
	return {
		kind: "create-track" as const,
		track: {
			id: id as never,
			kind: "graphic" as const,
			name: id,
			hidden: false,
		},
	};
}

describe("createAutomation (S06 C2)", () => {
	test("exposes the four transaction faces over the injected store", async () => {
		const automation = await createAutomation({
			store: await seededStore(),
			projectId: PROJECT.id,
			documentAdapter: createTransactionNativeDocumentAdapter(),
		});
		expect((await automation.project())?.name).toBe(PROJECT.name);
		expect(await automation.revision()).toBe(revisionOf(0));
		const result = await automation.apply({ operations: [createTrack("t1")] });
		expect(result.createdIds).toContain("t1");
		expect((await automation.tracks()).length).toBe(1);
		let watched = 0;
		const unsubscribe = automation.watch(() => {
			watched += 1;
		});
		await automation.apply({ operations: [createTrack("t2")] });
		unsubscribe();
		expect(watched).toBe(1);
		expect((await automation.capabilities())["atomic-batch"]).toBe(true);
		expect((await automation.supportedOperations()).length).toBeGreaterThan(0);
	});

	test("drafts orchestrate through the same engine and apply atomically", async () => {
		const automation = await createAutomation({
			store: await seededStore(),
			projectId: PROJECT.id,
		});
		const opened = await automation.openDraft({ approvalMode: "manual" });
		expect(opened.opened).toBe(true);
		if (!opened.opened) throw new Error(opened.error.message);
		const staged = await opened.session.stage({
			operations: [createTrack("d1"), createTrack("d2")],
		});
		expect(staged.accepted).toBe(true);
		const approval = await opened.session.approve();
		expect(approval.applied).toBe(true);
		expect((await automation.tracks()).map((track) => track.name)).toEqual([
			"d1",
			"d2",
		]);
	});

	test("openDraft defaults ids from the injected generator", async () => {
		let counter = 0;
		const automation = await createAutomation({
			store: await seededStore(),
			projectId: PROJECT.id,
			ids: { next: () => `gen-${(counter += 1)}` },
		});
		const first = await automation.openDraft({ approvalMode: "manual" });
		expect(first.opened).toBe(true);
		if (first.opened) expect(first.session.id).toBe("gen-1");
		const second = await automation.openDraft({
			approvalMode: "auto",
			id: "named",
		});
		expect(second.opened).toBe(true);
		if (second.opened) expect(second.session.id).toBe("named");
	});

	test("draft disposal host policy threads through", async () => {
		let now = 5_000;
		const automation = await createAutomation({
			store: await seededStore(),
			projectId: PROJECT.id,
			clock: () => now,
			draft: { ttl: 100, journalCallBound: 1 },
		});
		const opened = await automation.openDraft({ approvalMode: "manual" });
		if (!opened.opened) throw new Error(opened.error.message);
		expect(opened.session.snapshot().expiresAt).toBe(5_100);
		expect(
			(await opened.session.stage({ operations: [createTrack("x")] })).accepted,
		).toBe(true);
		const bounded = await opened.session.stage({
			operations: [createTrack("y")],
		});
		expect(bounded.accepted).toBe(false);
		if (!bounded.accepted) expect(bounded.error.kind).toBe("journal-bound");
		now = 5_200;
		const discarded = await opened.session.discard();
		expect(discarded.rejected).toBe(false);
		expect(opened.session.snapshot().rejectionReason).toBe("expired");
	});

	test("reopen over fresh store bytes proves durability through the layer", async () => {
		const store = await seededStore();
		const first = await createAutomation({ store, projectId: PROJECT.id });
		await first.apply({ operations: [createTrack("persisted")] });
		const reopened = await createAutomation({ store, projectId: PROJECT.id });
		expect((await reopened.tracks()).map((track) => track.name)).toEqual([
			"persisted",
		]);
	});
});
