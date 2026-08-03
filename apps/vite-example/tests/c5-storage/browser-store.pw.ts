import { expect, test } from "@playwright/test";

test("Phase 3 ordinary sidecar pairs pass raw and shared browser gates", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") pageErrors.push(message.text());
	});
	await page.goto("/c5-storage.html");
	await expect(page.locator("#status")).not.toHaveText("running");
	const result = await page.evaluate(() => window.__c5StorageResult);
	expect(result?.error).toBeUndefined();
	expect(result?.report?.passed).toBe(true);
	expect(result?.report?.byPort.store.failed).toBe(0);
	expect(result?.report?.byPort.store.skipped).toBe(0);
	expect(result?.residual).toMatchObject({
		projectPairCommitIsAtomic: true,
		projectRemovalPairCommitIsAtomic: true,
		projectsClearPairCommitIsAtomic: true,
		allClearPairCommitIsAtomic: true,
		attachmentPairCommitIsAtomic: true,
		exactCurrentPublicRows: true,
		authorityStateIsPrivate: true,
		legacyRowsReadWithoutRewrite: true,
		legacyRowsConvertOnNormalSave: true,
		providerOwnedEnvelopeFieldsSurvive: true,
		replaceCleanupIntentSurvivesReopen: true,
		deleteCleanupIntentSurvivesReopen: true,
		staleCleanupCannotEraseLaterSave: true,
		reopenPreservesCurrentBody: true,
		malformedAuthoritySkipsOrphanDeletion: true,
		postOpenProjectSaveAborted: true,
		postOpenProjectRemovalAborted: true,
		postOpenProjectsClearAborted: true,
		postOpenAllClearAborted: true,
		postOpenAttachmentSaveAborted: true,
		postOpenAttachmentRemovalAborted: true,
		authorityOnlyAttachmentListRejects: true,
		authorityOnlyAttachmentLoadRejects: true,
		partialDeletionCleanupShrinksIntent: true,
		partialDeletionCleanupRetryConverges: true,
	});
	expect(result?.inventory).toEqual({
		before: { databases: [], directories: [] },
		after: { databases: [], directories: [] },
	});
	expect(pageErrors).toEqual([]);
});

test("Phase 4 orphan reconciliation validates the complete live set before deletion", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") pageErrors.push(message.text());
	});
	await page.goto("/c5-storage.html");
	await expect(page.locator("#status")).not.toHaveText("running");
	const result = await page.evaluate(() => window.__c5StorageResult);
	expect(result?.error).toBeUndefined();
	expect(result?.residual).toMatchObject({
		orphanLiveSetPreservesAllGenerations: true,
		orphanUnreferencedCandidatesDeletedAfterValidation: true,
		orphanUnknownLegacyFilePreserved: true,
		orphanLiveRetiredIntentShrinksOnReopen: true,
		orphanDeletionRetiredIntentShrinksOnReopen: true,
		orphanRetiredIntentRetryConverges: true,
		orphanMalformedPairsFailClosedPerDatabase: true,
		orphanCorruptDiagnosticIsMechanismNeutral: true,
		orphanIndependentDatabaseStillCleans: true,
		orphanLegacyOnlyDatabaseCompatible: true,
		staleCleanupCannotEraseLaterSave: true,
		deleteCleanupIntentSurvivesReopen: true,
	});
	expect(
		Object.values(result?.residual ?? {}).filter(
			(value) => typeof value === "boolean",
		),
	).toHaveLength(42);
	expect(result?.inventory).toEqual({
		before: { databases: [], directories: [] },
		after: { databases: [], directories: [] },
	});
	expect(pageErrors).toEqual([]);
});

test("BrowserProjectStore passes the complete shared matrix", async ({
	page,
	browser,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") pageErrors.push(message.text());
	});
	await page.goto("/c5-storage.html");
	await expect(page.locator("#status")).not.toHaveText("running");
	const result = await page.evaluate(() => window.__c5StorageResult);
	expect(result?.error).toBeUndefined();
	expect(result?.report?.passed).toBe(true);
	expect(result?.report?.byPort.store.failed).toBe(0);
	expect(result?.report?.byPort.store.skipped).toBe(0);
	expect(result?.report?.byPort.store.passed).toBeGreaterThanOrEqual(19);
	expect(result?.migration).toMatchObject({
		currentVersionNoOp: true,
		legacySuccess: true,
		legacySavedSoundsClear: true,
		sourcePreservedOnFailure: true,
		retrySucceeded: true,
		wrappersCoalesced: true,
		missingOptInRefused: true,
		postCommitCleanupDiagnosed: true,
		postCommitCleanupRetried: true,
		legacyPrivateFieldsReopened: true,
		cleanupJournalRetriedByNextSession: true,
		cleanupJournalRetriedAfterReload: true,
		cleanupWarningWasMechanismNeutral: true,
		oldEnvelopeMigrated: true,
		disposableExternalTargetRefused: true,
		noUndefinedNames: true,
		afterDatabases: [],
	});
	expect(result?.migrationRound2).toMatchObject({
		sameWrapperLifecycleOrdered: true,
		crossWrapperLifecycleOrdered: true,
		earlierMigrationOrdersLaterMutations: true,
		earlierMutationsOrderLaterMigration: true,
		lifecycleRaceCount: 16,
		lifecycleRaceFailures: 0,
		initializationRetriesSameInstance: true,
		initializationDiagnosticMechanismNeutral: true,
		cleanupIntentRecoversAcrossReload: true,
		committedReadbackRecoversAcrossReload: true,
		stagedProjectLaterSaveWins: true,
		stagedProjectLaterRemoveWins: true,
		originalProjectLaterSaveWins: true,
		originalProjectLaterRemoveWins: true,
		physicalAbsenceRetainsRecovery: true,
		digestMismatchRetainsRecovery: true,
		preRecoveryIntentLaterRemoveMigrates: true,
		malformedPreRecoveryTombstoneRejects: true,
		currentProjectPairNoOpPreserved: true,
		mixedProjectPairDiscoveryAndMigration: true,
		migrationDestinationsUseCurrentPairs: true,
		currentAttachmentIntentSurvivesMigration: true,
		currentAttachmentIntentLossFailsClosed: true,
		currentAttachmentIntentSupersetFailsClosed: true,
		oldRevision2RecoveryWithoutRetiredKeysReadable: true,
		bareAttachmentAbsenceRetainsRecovery: true,
		authenticatedLaterRemoveObservedByRecovery: true,
		totalBareAttachmentAbsenceRetainsRecovery: true,
		topologyStageCleanupAliasesRefuseBeforeMutation: true,
		topologyLegacyCleanupAliasesRefuseBeforeMutation: true,
		topologyHistoricalMigrationJournalFailsClosedWithoutPartialCleanup: true,
		topologyMigrationPlanningPreauthorizesAttachmentDiscovery: true,
	});
	expect(
		Object.values(result?.migrationRound2 ?? {}).filter(
			(value) => typeof value === "boolean",
		),
	).toHaveLength(30);
	expect(result?.cascade).toMatchObject({
		removeCommitRecoverable: true,
		clearCommitRecoverable: true,
		retryAcrossRuntimeReset: true,
		diagnosticPayloadFree: true,
		wrappersSerializeSameKeySave: true,
		wrappersSerializeReplaceRemove: true,
		wrappersSerializeProjectRemove: true,
		wrappersSerializeProjectsClear: true,
		wrappersSerializeAllClear: true,
	});
	expect(result?.cascadeRound2).toMatchObject({
		opaqueCascadeLiteralRoundTrips: true,
		opaqueCascadeLiteralCannotDeleteOtherProject: true,
		forgedMaintenanceCannotCrossDelete: true,
		namespaceClearIsAtomic: true,
		allClearCommitIsRecoverable: true,
		allClearRetriesAcrossReload: true,
		certifiedProjectsClearWithoutEnumeration: true,
		certifiedAllClearWithoutEnumeration: true,
		uncertifiedProjectsClearRejectsAtomically: true,
		uncertifiedAllClearRejectsAtomically: true,
		ownerRegistrationClearRaceIsSerialized: true,
		uncertifiedBindingMismatchRefusesAtomically: true,
		certifiedBindingHistoryCleansExactNamespaces: true,
		revision1NeverImplicitlyRebinds: true,
		bindingScopedOwnersAvoidCrossProduct: true,
		crossBindingRegistrationClearRaceIsSerialized: true,
		version2JournalRetriesAcrossBindingReload: true,
		version3AllJournalRetriesExactLibraryAcrossConfigurationReload: true,
		projectsJournalNeverTouchesLibraryAcrossConfigurationReload: true,
		tamperedLibraryBindingCannotCrossDelete: true,
		legacyVersion2LibraryBooleanFailsClosed: true,
		legacyVersion2LibraryBindingUpgradeConverges: true,
		postLibraryPreJournalCrashRetriesExactTarget: true,
		version3CodecCardinalityTamperRejects: true,
		topologyLibraryReservedPairsRejectAtomically: true,
		topologySharedProjectsDatabaseSafeLibraryStoreWorks: true,
		topologyMediaProjectsDatabaseAccessRejectsWithoutAuthority: true,
		topologyMediaProtectedDatabasesRefuseRemoveAndClearPrecommit: true,
		topologyHistoricalProtectedMediaJournalFailsClosed: true,
		topologyHistoricalPhysicalAliasesFailClosed: true,
		topologyPrecommitRefusalAllowsSafeSameIdReuse: true,
		topologyHistoricalUnsafeJournalKeepsSameIdBlocked: true,
		topologyCollisionFreeCascadeStillConverges: true,
	});
	expect(
		Object.values(result?.cascadeRound2 ?? {}).filter(
			(value) => typeof value === "boolean",
		),
	).toHaveLength(33);
	expect(result?.residual).toMatchObject({
		corruptProjectList: true,
		corruptProjectLoad: true,
		corruptAttachmentList: true,
		corruptAttachmentLoad: true,
		authorityOnlyAttachmentListRejects: true,
		authorityOnlyAttachmentLoadRejects: true,
		corruptLibraryList: true,
		corruptLibraryLoad: true,
		midFlightReadAbortCount: 7,
		midFlightReadsAborted: true,
		postOpenProjectSaveAborted: true,
		postOpenProjectRemovalAborted: true,
		postOpenProjectsClearAborted: true,
		postOpenAllClearAborted: true,
		postOpenAttachmentSaveAborted: true,
		postOpenAttachmentRemovalAborted: true,
		projectPairCommitIsAtomic: true,
		projectRemovalPairCommitIsAtomic: true,
		projectsClearPairCommitIsAtomic: true,
		allClearPairCommitIsAtomic: true,
		attachmentPairCommitIsAtomic: true,
		exactCurrentPublicRows: true,
		authorityStateIsPrivate: true,
		legacyRowsReadWithoutRewrite: true,
		legacyRowsConvertOnNormalSave: true,
		providerOwnedEnvelopeFieldsSurvive: true,
		replaceCleanupIntentSurvivesReopen: true,
		deleteCleanupIntentSurvivesReopen: true,
		partialDeletionCleanupShrinksIntent: true,
		partialDeletionCleanupRetryConverges: true,
		staleCleanupCannotEraseLaterSave: true,
		reopenPreservesCurrentBody: true,
		malformedAuthoritySkipsOrphanDeletion: true,
		orphanLiveSetPreservesAllGenerations: true,
		orphanUnreferencedCandidatesDeletedAfterValidation: true,
		orphanUnknownLegacyFilePreserved: true,
		orphanLiveRetiredIntentShrinksOnReopen: true,
		orphanDeletionRetiredIntentShrinksOnReopen: true,
		orphanRetiredIntentRetryConverges: true,
		orphanMalformedPairsFailClosedPerDatabase: true,
		orphanCorruptDiagnosticIsMechanismNeutral: true,
		orphanIndependentDatabaseStillCleans: true,
		orphanLegacyOnlyDatabaseCompatible: true,
	});
	expect(
		Object.values(result?.residual ?? {}).filter(
			(value) => typeof value === "boolean",
		),
	).toHaveLength(42);
	expect(pageErrors).toEqual([]);
	expect(result?.inventory).toEqual({
		before: { databases: [], directories: [] },
		after: { databases: [], directories: [] },
	});
	expect(result?.ok).toBe(true);
	await expect(page.locator("#status")).toHaveText("passed");

	const cdp = await browser!.newBrowserCDPSession();
	const version = await cdp.send("Browser.getVersion");
	const processes = await cdp.send("SystemInfo.getProcessInfo");
	console.log(
		JSON.stringify({
			browserType: browser?.browserType().name(),
			browserVersion: browser?.version(),
			cdp: version,
			browserProcess: processes.processInfo.find(
				(process) => process.type === "browser",
			),
			label: result?.report?.label,
			store: result?.report?.byPort.store,
			migration: result?.migration,
			migrationRound2: result?.migrationRound2,
			migrationRound2BooleanFieldCount: Object.values(
				result?.migrationRound2 ?? {},
			).filter((value) => typeof value === "boolean").length,
			cascade: result?.cascade,
			cascadeRound2: result?.cascadeRound2,
			cascadeRound2BooleanFieldCount: Object.values(
				result?.cascadeRound2 ?? {},
			).filter((value) => typeof value === "boolean").length,
			residual: result?.residual,
			inventory: result?.inventory,
		}),
	);
});
