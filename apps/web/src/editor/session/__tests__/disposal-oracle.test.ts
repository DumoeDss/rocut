import { describe, expect, test } from "bun:test";

import {
	DISPOSAL_ORACLE_CLASSES,
	evaluateDisposalRun,
	type DisposalCycleObservation,
} from "../disposal-oracle";

function cycle({
	cycle = 1,
	residual = 0,
	missing,
}: {
	cycle?: number;
	residual?: number;
	missing?: (typeof DISPOSAL_ORACLE_CLASSES)[number];
} = {}): DisposalCycleObservation {
	const beforeDispose = {
		timer: { created: missing === "timer" ? 0 : 1 },
		worker: { created: missing === "worker" ? 0 : 1 },
		audioContext: { created: missing === "audioContext" ? 0 : 1 },
		objectUrl: { created: missing === "objectUrl" ? 0 : 1 },
		gpuResource: { created: missing === "gpuResource" ? 0 : 1 },
	};
	const report = {
		timer: { created: 1, released: residual > 0 ? 0 : 1 },
		worker: { created: 1, released: residual > 0 ? 0 : 1 },
		audioContext: { created: 1, released: residual > 0 ? 0 : 1 },
		objectUrl: { created: 1, released: residual > 0 ? 0 : 1 },
		gpuResource: { created: 1, released: residual > 0 ? 0 : 1 },
	};
	const platform = {
		timer: { residual, terminal: residual === 0 },
		worker: { residual, terminal: residual === 0 },
		audioContext: { residual, terminal: residual === 0 },
		objectUrl: { residual, terminal: residual === 0 },
		gpuResource: { residual, terminal: residual === 0 },
	};
	return { cycle, beforeDispose, report, platform };
}

function withRendererDwell({
	observation,
	afterGeneration = 1,
	afterResourceId = "raf-new",
}: {
	observation: DisposalCycleObservation;
	afterGeneration?: number;
	afterResourceId?: string;
}): DisposalCycleObservation {
	const rendererBeforeSuspend = {
		publications: 1,
		generation: 0,
		resourceId: "raf-old",
	};
	return {
		...observation,
		platformProof: {
			timerCallbacksBeforeDispose: 1,
			timerCallbacksAfterDispose: 1,
			timerTerminal: true,
			workerMessagesBeforeDispose: null,
			workerMessagesAfterDispose: null,
			workerErrorsBeforeDispose: null,
			workerErrorsAfterDispose: null,
			workerTerminal: null,
			audioStateBeforeDispose: "running",
			audioStateAfterDispose: "closed",
			audioTerminal: true,
			objectUrlFetchedBeforeDispose: true,
			objectUrlFetchAfterDispose: false,
			objectUrlTerminal: true,
			gpuTerminal: true,
			suspendedDwell: {
				timerCallbacksBefore: 1,
				timerCallbacksAfter: 1,
				workerMessagesBefore: null,
				workerMessagesAfter: null,
				workerErrorsBefore: null,
				workerErrorsAfter: null,
				savePublicationsBefore: 0,
				savePublicationsAfter: 0,
				renderPublicationsBefore: 1,
				renderPublicationsAfter: 1,
				timerResourcesCreatedBefore: 4,
				timerResourcesCreatedAfter: 4,
				rendererBeforeSuspend,
				rendererDwellAfter: rendererBeforeSuspend,
				rendererAfterResume: {
					publications: 2,
					generation: afterGeneration,
					resourceId: afterResourceId,
				},
				acquisitionRefused: true,
				postResumeActivity: true,
			},
		},
	};
}

describe("C6 disposal oracle", () => {
	test("accepts six clean cycles with all-five CREATED proof", () => {
		const result = evaluateDisposalRun({
			cycles: Array.from({ length: 6 }, (_, index) =>
				cycle({ cycle: index + 1 }),
			),
		});
		expect(result.clean).toBe(true);
		expect(result.failures).toEqual([]);
	});

	for (const missing of DISPOSAL_ORACLE_CLASSES) {
		test(`rejects missing-CREATED ${missing} before accepting zero release`, () => {
			const result = evaluateDisposalRun({
				cycles: Array.from({ length: 6 }, (_, index) =>
					cycle({ cycle: index + 1, missing }),
				),
			});
			expect(result.clean).toBe(false);
			expect(
				result.failures.some((failure) =>
					failure.includes(`${missing} was not CREATED`),
				),
			).toBe(true);
		});
	}

	test("rejects residual leakage and reports monotonic growth", () => {
		const result = evaluateDisposalRun({
			cycles: Array.from({ length: 6 }, (_, index) =>
				cycle({ cycle: index + 1, residual: index + 1 }),
			),
		});
		expect(result.clean).toBe(false);
		expect(result.monotonicGrowth.timer).toBe(true);
		expect(
			result.failures.some((failure) =>
				failure.includes("timer residual series"),
			),
		).toBe(true);
	});

	test("accepts a retained renderer that is silent in dwell and resumes on a fresh RAF generation", () => {
		const cycles = Array.from({ length: 6 }, (_, index) =>
			cycle({ cycle: index + 1 }),
		);
		cycles[0] = withRendererDwell({ observation: cycles[0]! });

		const result = evaluateDisposalRun({ cycles });
		expect(result.clean).toBe(true);
		expect(result.failures).toEqual([]);
	});

	test("rejects a synthetic post-resume claim without a fresh renderer generation and resource", () => {
		const cycles = Array.from({ length: 6 }, (_, index) =>
			cycle({ cycle: index + 1 }),
		);
		cycles[0] = withRendererDwell({
			observation: cycles[0]!,
			afterGeneration: 0,
			afterResourceId: "raf-old",
		});

		const result = evaluateDisposalRun({ cycles });
		expect(result.clean).toBe(false);
		expect(
			result.failures.some((failure) =>
				failure.includes("did not reacquire a fresh generation/resource"),
			),
		).toBe(true);
	});

	test("rejects an independent platform ledger residual and lifecycle identity drift", () => {
		const cycles = Array.from({ length: 6 }, (_, index) =>
			cycle({ cycle: index + 1 }),
		);
		cycles[0] = {
			...cycles[0]!,
			independentPlatform: {
				timer: { residual: 0, terminal: true },
				worker: { residual: 1, terminal: false },
				audioContext: { residual: 0, terminal: true },
				objectUrl: { residual: 0, terminal: true },
				gpuResource: { residual: 0, terminal: true },
			},
			lifecycle: {
				projectIdBefore: "a",
				projectIdAfter: "b",
				rootMountedDuringSuspend: true,
				rootMountedAfterResume: true,
				sameEditor: true,
				postResumeOperation: true,
			},
		};
		const result = evaluateDisposalRun({ cycles });
		expect(result.clean).toBe(false);
		expect(
			result.failures.some((failure) =>
				failure.includes("independent platform residual"),
			),
		).toBe(true);
		expect(
			result.failures.some((failure) =>
				failure.includes("project identity changed"),
			),
		).toBe(true);
	});
});
