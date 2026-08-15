import { runBrowserStoreConformance } from "../../../script/fixtures/c5-browser-store-conformance/browser-store-conformance";
import { runBrowserProjectStoreMigrationProbes } from "@opencut/editor-classic/storage/conformance";
import { runBrowserProjectStoreMigrationRound2Probes } from "@opencut/editor-classic/storage/conformance";
import { runBrowserProjectStoreCascadeProbes } from "@opencut/editor-classic/storage/conformance";
import { runBrowserProjectStoreCascadeRound2Probes } from "@opencut/editor-classic/storage/conformance";
import { runBrowserProjectStoreResidualProbes } from "@opencut/editor-classic/storage/conformance";
import {
	listDatabaseNames,
	listRootEntries,
} from "@opencut/editor-classic/storage";

interface C5DisposableInventory {
	readonly databases: readonly string[];
	readonly directories: readonly string[];
}

declare global {
	interface Window {
		__c5StorageResult?: {
			ok: boolean;
			report?: Awaited<ReturnType<typeof runBrowserStoreConformance>>;
			migration?: Awaited<
				ReturnType<typeof runBrowserProjectStoreMigrationProbes>
			>;
			migrationRound2?: Awaited<
				ReturnType<typeof runBrowserProjectStoreMigrationRound2Probes>
			>;
			cascade?: Awaited<ReturnType<typeof runBrowserProjectStoreCascadeProbes>>;
			cascadeRound2?: Awaited<
				ReturnType<typeof runBrowserProjectStoreCascadeRound2Probes>
			>;
			residual?: Awaited<
				ReturnType<typeof runBrowserProjectStoreResidualProbes>
			>;
			inventory?: {
				before: C5DisposableInventory;
				after: C5DisposableInventory;
			};
			error?: string;
		};
	}
}

const status = document.querySelector<HTMLElement>("#status");

try {
	const beforeInventory = await c5DisposableInventory();
	const report = await runBrowserStoreConformance();
	const migration = await runBrowserProjectStoreMigrationProbes();
	const migrationRound2 = await runBrowserProjectStoreMigrationRound2Probes();
	const cascade = await runBrowserProjectStoreCascadeProbes();
	const cascadeRound2 = await runBrowserProjectStoreCascadeRound2Probes();
	const residual = await runBrowserProjectStoreResidualProbes();
	const migrationPassed =
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
		migration.noUndefinedNames;
	const cascadePassed =
		cascade.removeCommitRecoverable &&
		cascade.clearCommitRecoverable &&
		cascade.retryAcrossRuntimeReset &&
		cascade.diagnosticPayloadFree &&
		cascade.wrappersSerializeSameKeySave &&
		cascade.wrappersSerializeReplaceRemove &&
		cascade.wrappersSerializeProjectRemove &&
		cascade.wrappersSerializeProjectsClear &&
		cascade.wrappersSerializeAllClear;
	const migrationRound2Passed =
		migrationRound2.sameWrapperLifecycleOrdered &&
		migrationRound2.crossWrapperLifecycleOrdered &&
		migrationRound2.earlierMigrationOrdersLaterMutations &&
		migrationRound2.earlierMutationsOrderLaterMigration &&
		migrationRound2.initializationRetriesSameInstance &&
		migrationRound2.initializationDiagnosticMechanismNeutral &&
		migrationRound2.cleanupIntentRecoversAcrossReload &&
		migrationRound2.committedReadbackRecoversAcrossReload &&
		migrationRound2.stagedProjectLaterSaveWins &&
		migrationRound2.stagedProjectLaterRemoveWins &&
		migrationRound2.originalProjectLaterSaveWins &&
		migrationRound2.originalProjectLaterRemoveWins &&
		migrationRound2.physicalAbsenceRetainsRecovery &&
		migrationRound2.digestMismatchRetainsRecovery &&
		migrationRound2.preRecoveryIntentLaterRemoveMigrates &&
		migrationRound2.malformedPreRecoveryTombstoneRejects &&
		migrationRound2.currentProjectPairNoOpPreserved &&
		migrationRound2.mixedProjectPairDiscoveryAndMigration &&
		migrationRound2.migrationDestinationsUseCurrentPairs &&
		migrationRound2.currentAttachmentIntentSurvivesMigration &&
		migrationRound2.currentAttachmentIntentLossFailsClosed &&
		migrationRound2.currentAttachmentIntentSupersetFailsClosed &&
		migrationRound2.oldRevision2RecoveryWithoutRetiredKeysReadable &&
		migrationRound2.bareAttachmentAbsenceRetainsRecovery &&
		migrationRound2.authenticatedLaterRemoveObservedByRecovery &&
		migrationRound2.totalBareAttachmentAbsenceRetainsRecovery &&
		migrationRound2.topologyStageCleanupAliasesRefuseBeforeMutation &&
		migrationRound2.topologyLegacyCleanupAliasesRefuseBeforeMutation &&
		migrationRound2.topologyHistoricalMigrationJournalFailsClosedWithoutPartialCleanup &&
		migrationRound2.topologyMigrationPlanningPreauthorizesAttachmentDiscovery;
	const residualPassed =
		residual.corruptProjectList &&
		residual.corruptProjectLoad &&
		residual.corruptAttachmentList &&
		residual.corruptAttachmentLoad &&
		residual.authorityOnlyAttachmentListRejects &&
		residual.authorityOnlyAttachmentLoadRejects &&
		residual.corruptLibraryList &&
		residual.corruptLibraryLoad &&
		residual.midFlightReadsAborted &&
		residual.postOpenProjectSaveAborted &&
		residual.postOpenProjectRemovalAborted &&
		residual.postOpenProjectsClearAborted &&
		residual.postOpenAllClearAborted &&
		residual.postOpenAttachmentSaveAborted &&
		residual.postOpenAttachmentRemovalAborted &&
		residual.projectPairCommitIsAtomic &&
		residual.projectRemovalPairCommitIsAtomic &&
		residual.projectsClearPairCommitIsAtomic &&
		residual.allClearPairCommitIsAtomic &&
		residual.attachmentPairCommitIsAtomic &&
		residual.exactCurrentPublicRows &&
		residual.authorityStateIsPrivate &&
		residual.legacyRowsReadWithoutRewrite &&
		residual.legacyRowsConvertOnNormalSave &&
		residual.providerOwnedEnvelopeFieldsSurvive &&
		residual.replaceCleanupIntentSurvivesReopen &&
		residual.deleteCleanupIntentSurvivesReopen &&
		residual.partialDeletionCleanupShrinksIntent &&
		residual.partialDeletionCleanupRetryConverges &&
		residual.staleCleanupCannotEraseLaterSave &&
		residual.reopenPreservesCurrentBody &&
		residual.malformedAuthoritySkipsOrphanDeletion &&
		residual.orphanLiveSetPreservesAllGenerations &&
		residual.orphanUnreferencedCandidatesDeletedAfterValidation &&
		residual.orphanUnknownLegacyFilePreserved &&
		residual.orphanLiveRetiredIntentShrinksOnReopen &&
		residual.orphanDeletionRetiredIntentShrinksOnReopen &&
		residual.orphanRetiredIntentRetryConverges &&
		residual.orphanMalformedPairsFailClosedPerDatabase &&
		residual.orphanCorruptDiagnosticIsMechanismNeutral &&
		residual.orphanIndependentDatabaseStillCleans &&
		residual.orphanLegacyOnlyDatabaseCompatible;
	const cascadeRound2Passed =
		cascadeRound2.opaqueCascadeLiteralRoundTrips &&
		cascadeRound2.opaqueCascadeLiteralCannotDeleteOtherProject &&
		cascadeRound2.forgedMaintenanceCannotCrossDelete &&
		cascadeRound2.namespaceClearIsAtomic &&
		cascadeRound2.allClearCommitIsRecoverable &&
		cascadeRound2.allClearRetriesAcrossReload &&
		cascadeRound2.certifiedProjectsClearWithoutEnumeration &&
		cascadeRound2.certifiedAllClearWithoutEnumeration &&
		cascadeRound2.uncertifiedProjectsClearRejectsAtomically &&
		cascadeRound2.uncertifiedAllClearRejectsAtomically &&
		cascadeRound2.ownerRegistrationClearRaceIsSerialized &&
		cascadeRound2.uncertifiedBindingMismatchRefusesAtomically &&
		cascadeRound2.certifiedBindingHistoryCleansExactNamespaces &&
		cascadeRound2.revision1NeverImplicitlyRebinds &&
		cascadeRound2.bindingScopedOwnersAvoidCrossProduct &&
		cascadeRound2.crossBindingRegistrationClearRaceIsSerialized &&
		cascadeRound2.version2JournalRetriesAcrossBindingReload &&
		cascadeRound2.version3AllJournalRetriesExactLibraryAcrossConfigurationReload &&
		cascadeRound2.projectsJournalNeverTouchesLibraryAcrossConfigurationReload &&
		cascadeRound2.tamperedLibraryBindingCannotCrossDelete &&
		cascadeRound2.legacyVersion2LibraryBooleanFailsClosed &&
		cascadeRound2.legacyVersion2LibraryBindingUpgradeConverges &&
		cascadeRound2.postLibraryPreJournalCrashRetriesExactTarget &&
		cascadeRound2.version3CodecCardinalityTamperRejects &&
		cascadeRound2.topologyLibraryReservedPairsRejectAtomically &&
		cascadeRound2.topologySharedProjectsDatabaseSafeLibraryStoreWorks &&
		cascadeRound2.topologyMediaProjectsDatabaseAccessRejectsWithoutAuthority &&
		cascadeRound2.topologyMediaProtectedDatabasesRefuseRemoveAndClearPrecommit &&
		cascadeRound2.topologyHistoricalProtectedMediaJournalFailsClosed &&
		cascadeRound2.topologyHistoricalPhysicalAliasesFailClosed &&
		cascadeRound2.topologyPrecommitRefusalAllowsSafeSameIdReuse &&
		cascadeRound2.topologyHistoricalUnsafeJournalKeepsSameIdBlocked &&
		cascadeRound2.topologyCollisionFreeCascadeStillConverges;
	const afterInventory = await c5DisposableInventory();
	window.__c5StorageResult = {
		ok:
			report.passed &&
			migrationPassed &&
			migrationRound2Passed &&
			cascadePassed &&
			cascadeRound2Passed &&
			residualPassed,
		report,
		migration,
		migrationRound2,
		cascade,
		cascadeRound2,
		residual,
		inventory: { before: beforeInventory, after: afterInventory },
	};
	if (status)
		status.textContent =
			report.passed &&
			migrationPassed &&
			migrationRound2Passed &&
			cascadePassed &&
			residualPassed
				? cascadeRound2Passed
					? "passed"
					: "failed"
				: "failed";
} catch (error) {
	window.__c5StorageResult = {
		ok: false,
		error:
			error instanceof Error ? (error.stack ?? error.message) : String(error),
	};
	if (status) status.textContent = "failed";
}

async function c5DisposableInventory(): Promise<C5DisposableInventory> {
	return {
		databases: (await listDatabaseNames())
			.filter((name) => name.startsWith("c5-"))
			.sort(),
		directories: (await listRootEntries())
			.filter((name) => name.startsWith("c5-"))
			.sort(),
	};
}
