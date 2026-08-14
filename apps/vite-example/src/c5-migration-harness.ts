import { runBrowserProjectStoreMigrationProbes } from "@opencut/editor-classic/storage/conformance";

declare global {
	interface Window {
		__c5MigrationResult?: {
			ok: boolean;
			migration?: Awaited<
				ReturnType<typeof runBrowserProjectStoreMigrationProbes>
			>;
			error?: string;
		};
	}
}

const status = document.querySelector<HTMLElement>("#status");

try {
	const migration = await runBrowserProjectStoreMigrationProbes();
	const ok =
		migration.currentVersionNoOp &&
		migration.legacySuccess &&
		migration.legacySavedSoundsClear &&
		migration.sourcePreservedOnFailure &&
		migration.retrySucceeded &&
		migration.wrappersCoalesced &&
		migration.missingOptInRefused &&
		migration.postCommitCleanupDiagnosed &&
		migration.postCommitCleanupRetried &&
		migration.legacyPrivateFieldsReopened &&
		migration.cleanupJournalRetriedByNextSession &&
		migration.cleanupJournalRetriedAfterReload &&
		migration.cleanupWarningWasMechanismNeutral &&
		migration.oldEnvelopeMigrated &&
		migration.disposableExternalTargetRefused &&
		migration.noUndefinedNames &&
		migration.afterDatabases.length === 0;
	window.__c5MigrationResult = { ok, migration };
	if (status) status.textContent = ok ? "passed" : "failed";
} catch (error) {
	window.__c5MigrationResult = {
		ok: false,
		error: error instanceof Error ? error.message : String(error),
	};
	if (status) status.textContent = "failed";
}
