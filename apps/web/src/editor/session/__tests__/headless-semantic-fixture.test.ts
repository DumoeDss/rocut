import { expect, test } from "bun:test";

test("semantic fixture proves edit, reopen, opaque and attachment fidelity", async () => {
	const { installHeadlessRuntimeProbe } =
		await import("../headless-runtime-probe");
	const runtimeProbe = installHeadlessRuntimeProbe({
		host: "node",
		environment: "node",
		buildMarker: "c7-node-semantic-test",
		entry: "headless-semantic-fixture.test.ts",
	});
	runtimeProbe.markSubjectLoadStarted();
	const { runHeadlessSemanticFixture } =
		await import("../headless-semantic-fixture");
	const result = await runHeadlessSemanticFixture({
		host: "node",
		buildMarker: "c7-node-semantic-test",
		acceptedHead: "test-head",
		acceptedTree: "test-tree",
		entry: "headless-semantic-fixture.test.ts",
		runtimeProbe,
	});

	expect(result).toMatchObject({
		schemaVersion: 1,
		host: "node",
		storeIdentity: "InMemoryProjectStore",
		projectId: "c7-headless-project",
		seededName: "C7 seeded project",
		editedName: "C7 headless edit",
		reopenedName: "C7 headless edit",
		ownersDistinct: true,
		opaquePreserved: true,
		attachmentPreserved: true,
		durableProjectPresent: true,
		durableAttachmentPresent: true,
		firstDisposal: "fulfilled",
		secondDisposal: "fulfilled",
		postDisposeWriteRejected: true,
		postDisposeStoreUntouched: true,
		reactMountAttempts: 0,
		runtimeProbe: {
			implementation: "headless-runtime-probe/v1",
			environment: "node",
		},
		errors: [],
	});
	expect(result.seededProjectDigest).not.toBe(result.reopenedProjectDigest);
	expect(result.seededAttachmentDigest).toBe(result.reopenedAttachmentDigest);
	expect(result.seededOpaqueDigest).toBe(result.reopenedOpaqueDigest);
});
