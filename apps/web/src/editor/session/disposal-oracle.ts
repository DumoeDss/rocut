import type { DisposalReport, SessionResourceClass } from "./resources";

export const DISPOSAL_ORACLE_SCHEMA = "c6-session-disposal-v1" as const;
export const DISPOSAL_ORACLE_CLASSES = [
	"timer",
	"worker",
	"audioContext",
	"objectUrl",
	"gpuResource",
] as const satisfies readonly SessionResourceClass[];

export type DisposalOracleClass = (typeof DISPOSAL_ORACLE_CLASSES)[number];

export interface DisposalPlatformObservation {
	readonly residual: number;
	readonly terminal: boolean;
	readonly detail?: string;
}

export interface DisposalRenderActivityObservation {
	readonly publications: number;
	readonly generation: number | null;
	readonly resourceId: string | null;
}

export interface DisposalCycleObservation {
	readonly cycle: number;
	readonly beforeDispose: Record<DisposalOracleClass, { created: number }>;
	readonly report: Pick<DisposalReport, DisposalOracleClass> & {
		/** Present for runtime-backed GPU probes; synthetic controls may omit it. */
		readonly gpuReconciliation?: DisposalReport["gpuReconciliation"];
	};
	readonly platform: Record<DisposalOracleClass, DisposalPlatformObservation>;
	/** Independent Host/global ledgers, separate from SessionResources.inspect(). */
	readonly independentPlatform?: Record<
		DisposalOracleClass,
		DisposalPlatformObservation
	>;
	readonly lifecycle?: {
		readonly projectIdBefore: string;
		readonly projectIdAfter: string;
		readonly rootMountedDuringSuspend: boolean;
		readonly rootMountedAfterResume: boolean;
		readonly sameEditor: boolean;
		readonly postResumeOperation: boolean;
	};
	/** Direct platform probes, independent of registry counters. */
	readonly platformProof?: {
		readonly timerCallbacksBeforeDispose: number;
		readonly timerCallbacksAfterDispose: number;
		readonly timerTerminal: boolean;
		readonly workerMessagesBeforeDispose: number | null;
		readonly workerMessagesAfterDispose: number | null;
		readonly workerErrorsBeforeDispose: number | null;
		readonly workerErrorsAfterDispose: number | null;
		readonly workerTerminal: boolean | null;
		readonly audioStateBeforeDispose: "running" | "suspended" | "closed";
		readonly audioStateAfterDispose: "running" | "suspended" | "closed";
		readonly audioTerminal: boolean;
		readonly objectUrlFetchedBeforeDispose: boolean;
		readonly objectUrlFetchAfterDispose: boolean;
		readonly objectUrlTerminal: boolean;
		readonly gpuTerminal: boolean;
		/** Activity admission proof captured during the retained suspended dwell. */
		readonly suspendedDwell?: {
			readonly timerCallbacksBefore: number;
			readonly timerCallbacksAfter: number;
			readonly workerMessagesBefore: number | null;
			readonly workerMessagesAfter: number | null;
			readonly workerErrorsBefore: number | null;
			readonly workerErrorsAfter: number | null;
			readonly savePublicationsBefore: number;
			readonly savePublicationsAfter: number;
			readonly renderPublicationsBefore: number;
			readonly renderPublicationsAfter: number;
			readonly timerResourcesCreatedBefore: number;
			readonly timerResourcesCreatedAfter: number;
			readonly rendererBeforeSuspend: DisposalRenderActivityObservation;
			readonly rendererDwellAfter: DisposalRenderActivityObservation;
			readonly rendererAfterResume: DisposalRenderActivityObservation;
			readonly acquisitionRefused: boolean;
			readonly postResumeActivity: boolean;
		};
	};
	/** Runtime evidence retained for C0b/C3 compositor ownership audits. */
	readonly runtime?: {
		readonly selectedBackend: string | null;
		readonly concurrentCompositorInstances: number;
		readonly compositorHandle: number | null;
		readonly liveHandlesBeforeDispose: readonly number[];
		readonly liveHandlesAfterDispose: readonly number[];
		readonly disposeError: string | null;
	};
}

export interface DisposalOracleResult {
	readonly schema: typeof DISPOSAL_ORACLE_SCHEMA;
	readonly clean: boolean;
	readonly cycles: readonly DisposalCycleObservation[];
	readonly residualSeries: Record<DisposalOracleClass, readonly number[]>;
	readonly monotonicGrowth: Record<DisposalOracleClass, boolean>;
	readonly failures: readonly string[];
}

function emptySeries(): Record<DisposalOracleClass, number[]> {
	return {
		timer: [],
		worker: [],
		audioContext: [],
		objectUrl: [],
		gpuResource: [],
	};
}

function isMonotonic(values: readonly number[]): boolean {
	return (
		values.length > 1 &&
		values.every((value, index) => index === 0 || value >= values[index - 1]!)
	);
}

export function evaluateDisposalRun({
	cycles,
	minimumCycles = 6,
}: {
	cycles: readonly DisposalCycleObservation[];
	minimumCycles?: number;
}): DisposalOracleResult {
	const residualSeries = emptySeries();
	const failures: string[] = [];
	if (cycles.length < minimumCycles) {
		failures.push(
			`Expected at least ${minimumCycles} cycles; received ${cycles.length}.`,
		);
	}

	for (const cycle of cycles) {
		for (const resourceClass of DISPOSAL_ORACLE_CLASSES) {
			const before = cycle.beforeDispose[resourceClass];
			const counts = cycle.report[resourceClass];
			const platform = cycle.platform[resourceClass];
			const independent = cycle.independentPlatform?.[resourceClass];
			const residual = Math.max(
				counts.created - counts.released,
				platform.residual,
				independent?.residual ?? 0,
			);
			residualSeries[resourceClass].push(residual);
			if (before.created <= 0) {
				failures.push(
					`cycle ${cycle.cycle} ${resourceClass} was not CREATED before disposal.`,
				);
				continue;
			}
			if (counts.created !== counts.released) {
				failures.push(
					`cycle ${cycle.cycle} ${resourceClass} count mismatch: ${counts.created} created / ${counts.released} released.`,
				);
			}
			if (!platform.terminal || platform.residual !== 0) {
				failures.push(
					`cycle ${cycle.cycle} ${resourceClass} platform residual ${platform.residual} (${platform.detail ?? "non-terminal"}).`,
				);
			}
			if (
				independent &&
				(!independent.terminal || independent.residual !== 0)
			) {
				failures.push(
					`cycle ${cycle.cycle} ${resourceClass} independent platform residual ${independent.residual} (${independent.detail ?? "non-terminal"}).`,
				);
			}
		}
		if (cycle.lifecycle) {
			if (cycle.lifecycle.projectIdBefore !== cycle.lifecycle.projectIdAfter) {
				failures.push(
					`cycle ${cycle.cycle} project identity changed across suspend/resume.`,
				);
			}
			if (
				!cycle.lifecycle.rootMountedDuringSuspend ||
				!cycle.lifecycle.rootMountedAfterResume ||
				!cycle.lifecycle.sameEditor ||
				!cycle.lifecycle.postResumeOperation
			) {
				failures.push(
					`cycle ${cycle.cycle} suspend/resume lifecycle invariant failed.`,
				);
			}
		}
		const proof = cycle.platformProof;
		if (proof) {
			if (!proof.timerTerminal || proof.timerCallbacksBeforeDispose <= 0) {
				failures.push(
					`cycle ${cycle.cycle} timer callback terminality was not proven (${proof.timerCallbacksBeforeDispose} before / ${proof.timerCallbacksAfterDispose} after).`,
				);
			}
			if (proof.workerMessagesBeforeDispose !== null) {
				if (proof.workerMessagesBeforeDispose <= 0) {
					failures.push(
						`cycle ${cycle.cycle} Worker did not deliver a message before disposal.`,
					);
				}
				if (
					!proof.workerTerminal ||
					proof.workerErrorsAfterDispose !== proof.workerErrorsBeforeDispose ||
					proof.workerMessagesAfterDispose !== proof.workerMessagesBeforeDispose
				) {
					failures.push(
						`cycle ${cycle.cycle} Worker listener/message terminality was not proven.`,
					);
				}
			}
			if (!proof.audioTerminal || proof.audioStateBeforeDispose === "closed") {
				failures.push(
					`cycle ${cycle.cycle} AudioContext state/close terminality was not proven (${proof.audioStateBeforeDispose} -> ${proof.audioStateAfterDispose}).`,
				);
			}
			if (
				!proof.objectUrlFetchedBeforeDispose ||
				proof.objectUrlFetchAfterDispose ||
				!proof.objectUrlTerminal
			) {
				failures.push(
					`cycle ${cycle.cycle} object URL fetch/revoke terminality was not proven.`,
				);
			}
			if (!proof.gpuTerminal) {
				failures.push(
					`cycle ${cycle.cycle} GPU liveHandles() was not empty after disposal.`,
				);
			}
			const dwell = proof.suspendedDwell;
			if (dwell) {
				const workerStable =
					dwell.workerMessagesBefore === dwell.workerMessagesAfter &&
					dwell.workerErrorsBefore === dwell.workerErrorsAfter;
				const rendererStable =
					dwell.rendererBeforeSuspend.publications ===
						dwell.rendererDwellAfter.publications &&
					dwell.rendererBeforeSuspend.generation ===
						dwell.rendererDwellAfter.generation &&
					dwell.rendererBeforeSuspend.resourceId ===
						dwell.rendererDwellAfter.resourceId;
				if (
					dwell.timerCallbacksBefore !== dwell.timerCallbacksAfter ||
					dwell.timerResourcesCreatedBefore !==
						dwell.timerResourcesCreatedAfter ||
					!workerStable ||
					dwell.savePublicationsBefore !== dwell.savePublicationsAfter ||
					dwell.renderPublicationsBefore !== dwell.renderPublicationsAfter ||
					!rendererStable ||
					!dwell.acquisitionRefused
				) {
					failures.push(
						`cycle ${cycle.cycle} suspended dwell admitted timer/Worker/save/render activity.`,
					);
				}
				if (!dwell.postResumeActivity) {
					failures.push(
						`cycle ${cycle.cycle} did not publish activity after the same-session resume.`,
					);
				}
				const rendererResumedFreshly =
					dwell.rendererBeforeSuspend.generation !== null &&
					dwell.rendererAfterResume.generation !== null &&
					dwell.rendererAfterResume.generation >
						dwell.rendererBeforeSuspend.generation &&
					dwell.rendererBeforeSuspend.resourceId !== null &&
					dwell.rendererAfterResume.resourceId !== null &&
					dwell.rendererAfterResume.resourceId !==
						dwell.rendererBeforeSuspend.resourceId &&
					dwell.rendererAfterResume.publications >
						dwell.rendererDwellAfter.publications;
				if (!rendererResumedFreshly) {
					failures.push(
						`cycle ${cycle.cycle} retained renderer did not reacquire a fresh generation/resource and publish after resume.`,
					);
				}
			}
		}
	}

	const monotonicGrowth: Record<DisposalOracleClass, boolean> = {
		timer: false,
		worker: false,
		audioContext: false,
		objectUrl: false,
		gpuResource: false,
	};
	for (const resourceClass of DISPOSAL_ORACLE_CLASSES) {
		monotonicGrowth[resourceClass] = isMonotonic(residualSeries[resourceClass]);
		if (
			monotonicGrowth[resourceClass] &&
			residualSeries[resourceClass].some((value) => value > 0)
		) {
			failures.push(`${resourceClass} residual series grows monotonically.`);
		}
	}

	return {
		schema: DISPOSAL_ORACLE_SCHEMA,
		clean: failures.length === 0,
		cycles,
		residualSeries,
		monotonicGrowth,
		failures,
	};
}

export interface DisposalCycleDriverArgs {
	readonly cycles?: number;
	readonly runCycle: (cycle: number) => Promise<DisposalCycleObservation>;
}

export async function runDisposalCycles({
	cycles = 6,
	runCycle,
}: DisposalCycleDriverArgs): Promise<DisposalOracleResult> {
	const observations: DisposalCycleObservation[] = [];
	for (let cycle = 1; cycle <= cycles; cycle += 1) {
		observations.push(await runCycle(cycle));
	}
	return evaluateDisposalRun({ cycles: observations, minimumCycles: cycles });
}
