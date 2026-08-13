import type { ProjectStore } from "@opencut/editor-ports";

import {
	DISPOSAL_ORACLE_CLASSES,
	evaluateDisposalRun,
	type DisposalCycleObservation,
	type DisposalOracleClass,
	type DisposalOracleResult,
} from "./disposal-oracle";

export const C6_DURABLE_REOPEN_SCHEMA = "c6-durable-reopen-v1" as const;
export const C6_DURABLE_REOPEN_BASE_COMMIT =
	"d6ed4166b5ffb13257d1924851f2fa57d73d349f" as const;

export interface DurableReopenProofInput {
	readonly host: "vite" | "next";
	readonly buildMarker: string;
	readonly baseCommit: string;
	readonly pageBase: string;
	readonly browserProjectStore: {
		readonly instanceOfBrowserProjectStore: boolean;
		/** Diagnostic only. Production minifiers may rewrite this value. */
		readonly constructorName: string;
		readonly provenance: "session.host.store";
		readonly schemaVersion: number;
		readonly sameStore: boolean;
	};
	readonly project: {
		readonly projectId: string;
		readonly expectedName: string;
		readonly reopenedName: string | null;
		readonly firstRawDigest: string;
		readonly reopenedRawDigest: string;
		readonly rawEqual: boolean;
		readonly privateSentinelEqual: boolean;
	};
	readonly attachment: {
		readonly key: string;
		readonly expectedDigest: string;
		readonly firstDigest: string;
		readonly reopenedDigest: string;
		readonly metadataEqual: boolean;
		readonly bodyEqual: boolean;
	};
	readonly sessions: {
		readonly first: string;
		readonly second: string;
		readonly distinct: boolean;
		readonly sameHost: boolean;
		readonly sameProjectId: boolean;
		readonly firstRemoved: boolean;
		readonly secondRemoved: boolean;
	};
	readonly firstCycle: DisposalCycleObservation;
	readonly second: {
		readonly residual: Record<DisposalOracleClass, number>;
		readonly liveGpuHandlesAfterDispose: readonly number[];
	};
	readonly final: { readonly activeSessions: number };
	readonly consoleErrors: readonly string[];
	readonly pageErrors: readonly string[];
}

export interface DurableReopenProofResult extends DurableReopenProofInput {
	readonly schema: typeof C6_DURABLE_REOPEN_SCHEMA;
	readonly proof: "durable-reopen";
	readonly firstDisposal: DisposalOracleResult;
	readonly clean: boolean;
	readonly failures: readonly string[];
}

export function captureDurableBrowserStoreAttribution(args: {
	readonly store: ProjectStore;
	readonly isDurableBrowserStore: (store: ProjectStore) => boolean;
}): DurableReopenProofInput["browserProjectStore"] {
	return {
		instanceOfBrowserProjectStore: args.isDurableBrowserStore(args.store),
		constructorName: args.store.constructor.name,
		provenance: "session.host.store",
		schemaVersion: args.store.schemaVersion,
		sameStore: false,
	};
}

export function evaluateDurableReopenProof(
	input: DurableReopenProofInput,
): DurableReopenProofResult {
	const failures: string[] = [];
	const firstDisposal = evaluateDisposalRun({
		cycles: [input.firstCycle],
		minimumCycles: 1,
	});

	if (input.baseCommit !== C6_DURABLE_REOPEN_BASE_COMMIT) {
		failures.push(
			`Unexpected base commit ${input.baseCommit}; expected ${C6_DURABLE_REOPEN_BASE_COMMIT}.`,
		);
	}
	if (input.buildMarker.trim().length === 0) {
		failures.push("The build marker was empty.");
	}
	if (input.pageBase.trim().length === 0) {
		failures.push("The page base was empty.");
	}
	if (!input.browserProjectStore.instanceOfBrowserProjectStore) {
		failures.push(
			"The durable store was not a BrowserProjectStore runtime instance.",
		);
	}
	if (input.browserProjectStore.provenance !== "session.host.store") {
		failures.push("The durable store was not read from session.host.store.");
	}
	if (
		!Number.isInteger(input.browserProjectStore.schemaVersion) ||
		input.browserProjectStore.schemaVersion <= 0
	) {
		failures.push("The BrowserProjectStore schema version was not positive.");
	}
	if (!input.browserProjectStore.sameStore) {
		failures.push("The second Host did not reuse firstSession.host.store.");
	}

	if (input.project.projectId.trim().length === 0) {
		failures.push("The durable project id was empty.");
	}
	if (
		input.project.reopenedName !== input.project.expectedName ||
		input.project.expectedName.trim().length === 0
	) {
		failures.push("The known project edit did not survive reopen.");
	}
	if (
		!input.project.rawEqual ||
		input.project.firstRawDigest.length === 0 ||
		input.project.firstRawDigest !== input.project.reopenedRawDigest
	) {
		failures.push("The raw durable project changed across reopen.");
	}
	if (!input.project.privateSentinelEqual) {
		failures.push(
			"The nested provider-private project sentinel was not preserved.",
		);
	}

	if (input.attachment.key.trim().length === 0) {
		failures.push("The durable attachment key was empty.");
	}
	if (
		input.attachment.expectedDigest.length === 0 ||
		input.attachment.firstDigest !== input.attachment.expectedDigest ||
		input.attachment.reopenedDigest !== input.attachment.expectedDigest
	) {
		failures.push("The attachment body digest changed across reopen.");
	}
	if (!input.attachment.metadataEqual) {
		failures.push("The exact attachment metadata did not survive reopen.");
	}
	if (!input.attachment.bodyEqual) {
		failures.push("The exact attachment body did not survive reopen.");
	}

	if (
		input.sessions.first.trim().length === 0 ||
		input.sessions.second.trim().length === 0 ||
		!input.sessions.distinct ||
		input.sessions.first === input.sessions.second
	) {
		failures.push("The reopen did not use two distinct public sessions.");
	}
	if (!input.sessions.sameHost) {
		failures.push(
			"The reopen session did not reuse the exact first session Host.",
		);
	}
	if (!input.sessions.sameProjectId) {
		failures.push("The reopen session did not retain the Host project id.");
	}
	if (!input.sessions.firstRemoved) {
		failures.push("The first session remained active after disposal.");
	}
	if (!input.sessions.secondRemoved) {
		failures.push("The reopened session remained active after disposal.");
	}
	if (!firstDisposal.clean) {
		failures.push(
			...firstDisposal.failures.map((failure) => `first disposal: ${failure}`),
		);
	}
	for (const resourceClass of DISPOSAL_ORACLE_CLASSES) {
		const residual = input.second.residual[resourceClass];
		if (residual !== 0) {
			failures.push(
				`second disposal ${resourceClass} residual was ${residual}, expected 0.`,
			);
		}
	}
	if (input.second.liveGpuHandlesAfterDispose.length !== 0) {
		failures.push(
			"The reopened session retained live GPU handles after disposal.",
		);
	}
	if (input.final.activeSessions !== 0) {
		failures.push(
			`Final active session count was ${input.final.activeSessions}, expected 0.`,
		);
	}
	if (input.consoleErrors.length !== 0) {
		failures.push(`Captured ${input.consoleErrors.length} console error(s).`);
	}
	if (input.pageErrors.length !== 0) {
		failures.push(`Captured ${input.pageErrors.length} page error(s).`);
	}

	return {
		...input,
		schema: C6_DURABLE_REOPEN_SCHEMA,
		proof: "durable-reopen",
		firstDisposal,
		clean: failures.length === 0,
		failures,
	};
}
