import { describe, expect, test } from "bun:test";

import {
	C6_DURABLE_REOPEN_BASE_COMMIT,
	evaluateDurableReopenProof,
	type DurableReopenProofInput,
} from "../c6-durable-reopen";
import type { DisposalCycleObservation } from "../disposal-oracle";

function firstCycle(): DisposalCycleObservation {
	const counts = { created: 1, released: 1 };
	const platform = { residual: 0, terminal: true };
	return {
		cycle: 1,
		beforeDispose: {
			timer: { created: 1 },
			worker: { created: 1 },
			audioContext: { created: 1 },
			objectUrl: { created: 1 },
			gpuResource: { created: 1 },
		},
		report: {
			timer: counts,
			worker: counts,
			audioContext: counts,
			objectUrl: counts,
			gpuResource: counts,
		},
		platform: {
			timer: platform,
			worker: platform,
			audioContext: platform,
			objectUrl: platform,
			gpuResource: platform,
		},
	};
}

function proofInput(): DurableReopenProofInput {
	return {
		host: "vite",
		buildMarker: "c6-s52-test-vite",
		baseCommit: C6_DURABLE_REOPEN_BASE_COMMIT,
		pageBase: "http://127.0.0.1:4173/",
		browserProjectStore: {
			instanceOfBrowserProjectStore: true,
			constructorName: "fQe",
			provenance: "session.host.store",
			schemaVersion: 31,
			sameStore: true,
		},
		project: {
			projectId: "durable-project",
			expectedName: "Scenario 52 known edit",
			reopenedName: "Scenario 52 known edit",
			firstRawDigest: "project-digest",
			reopenedRawDigest: "project-digest",
			rawEqual: true,
			privateSentinelEqual: true,
		},
		attachment: {
			key: "scenario-52-attachment",
			expectedDigest: "attachment-digest",
			firstDigest: "attachment-digest",
			reopenedDigest: "attachment-digest",
			metadataEqual: true,
			bodyEqual: true,
		},
		sessions: {
			first: "session-first",
			second: "session-second",
			distinct: true,
			sameHost: true,
			sameProjectId: true,
			firstRemoved: true,
			secondRemoved: true,
		},
		firstCycle: firstCycle(),
		second: {
			residual: {
				timer: 0,
				worker: 0,
				audioContext: 0,
				objectUrl: 0,
				gpuResource: 0,
			},
			liveGpuHandlesAfterDispose: [],
		},
		final: { activeSessions: 0 },
		consoleErrors: [],
		pageErrors: [],
	};
}

describe("C6 scenario 52 durable reopen report", () => {
	test("accepts an attributable public-store reopen with exact durable equality", () => {
		const result = evaluateDurableReopenProof(proofInput());

		expect(result.schema).toBe("c6-durable-reopen-v1");
		expect(result.proof).toBe("durable-reopen");
		expect(result.clean).toBe(true);
		expect(result.failures).toEqual([]);
	});

	test("rejects a second Host that does not reuse the module-stable store", () => {
		const input = proofInput();
		const result = evaluateDurableReopenProof({
			...input,
			browserProjectStore: {
				...input.browserProjectStore,
				sameStore: false,
			},
		});

		expect(result.clean).toBe(false);
		expect(result.failures).toContain(
			"The second Host did not reuse firstSession.host.store.",
		);
	});

	test("rejects a reference store even when every durable value matches", () => {
		const input = proofInput();
		const result = evaluateDurableReopenProof({
			...input,
			browserProjectStore: {
				...input.browserProjectStore,
				instanceOfBrowserProjectStore: false,
				constructorName: "InMemoryProjectStore",
			},
		});

		expect(result.clean).toBe(false);
		expect(result.failures).toContain(
			"The durable store was not a BrowserProjectStore runtime instance.",
		);
	});

	test("rejects a different Host object even when its store identity matches", () => {
		const input = proofInput();
		const result = evaluateDurableReopenProof({
			...input,
			sessions: {
				...input.sessions,
				sameHost: false,
			},
		});

		expect(result.clean).toBe(false);
		expect(result.failures).toContain(
			"The reopen session did not reuse the exact first session Host.",
		);
	});
});
