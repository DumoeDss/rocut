/**
 * sdk-export-capability — `ElectronExportProvider` under `bun test` (task C1):
 * the frozen-outcome mapping table exercised path by path against a hand
 * surface stub, plus the composition-shape assertion the spec's "final
 * override beside the store override" scenario demands.
 *
 * No Electron anywhere: the stub implements the bridge surface
 * (`ExportJobControlSurface`) over the REAL `ExportJobStore` — the semantic
 * SSOT — so every snapshot and event the adapter sees is a legal one, and the
 * adapter is tested against the same state machine production drives.
 *
 * Documented mapping under test (the adapter's module docblock is the SSOT):
 * - no binary / no bridge          → `unsupported` (reason names ffmpeg-missing)
 * - settled completed + bytes read → `completed` with the stub's exact bytes
 * - settled failed                 → `failed` with the job's reason
 * - settled cancelled              → `failed` with reason `"cancelled"` — the
 *   frozen outcome has NO cancelled variant; silence or completed would both
 *   be lies, so the nearest truthful shape is failed-with-named-reason.
 */
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { ExportRequest } from "@opencut/editor-ports";
import type {
	ExportJobEvent,
	ExportJobRequest,
	ExportJobSnapshot,
} from "@opencut/editor-ports/export-jobs";
import { ExportJobStore } from "@opencut/editor-ports/export-jobs";
import {
	CANCELLED_AS_FAILED_REASON,
	ElectronExportProvider,
	FFMPEG_UNSUPPORTED_REASON,
} from "../electron-export-provider";
import {
	ExportBridgeError,
	RendererExportBridge,
	type ExportJobControlSurface,
} from "../renderer-export-bridge";

/** A surface over the real store, with manual test drivers for transitions. */
class FakeExportSurface implements ExportJobControlSurface {
	readonly jobs = new Map<
		string,
		{ store: ExportJobStore; emitted: number; bytes: ArrayBuffer | null }
	>();
	private readonly handlers = new Set<
		(message: { jobId: string; event: ExportJobEvent }) => void
	>();
	private jobSeq = 0;
	ffmpegAvailable = true;
	/** Settle the job inside startJob — drives the already-settled race. */
	settleDuringStart: "completed" | null = null;

	startJob({ request }: { request: ExportJobRequest }): Promise<{ jobId: string }> {
		this.jobSeq += 1;
		const jobId = `fake-${String(this.jobSeq)}`;
		const store = ExportJobStore.open({ jobId, request });
		this.jobs.set(jobId, { store, emitted: 0, bytes: null });
		this.emitNew(jobId);
		if (this.settleDuringStart === "completed") {
			this.driveCompleted({ jobId, bytes: 64 });
		}
		return Promise.resolve({ jobId });
	}

	listJobs(): Promise<readonly ExportJobSnapshot[]> {
		return Promise.resolve(
			[...this.jobs.values()].map((entry) => entry.store.snapshot()),
		);
	}

	getJob(jobId: string): Promise<ExportJobSnapshot | null> {
		return Promise.resolve(this.jobs.get(jobId)?.store.snapshot() ?? null);
	}

	cancelJob(jobId: string): Promise<ExportJobSnapshot> {
		const entry = this.require(jobId);
		entry.store = entry.store.requestCancel().confirmCancelled();
		this.emitNew(jobId);
		return Promise.resolve(entry.store.snapshot());
	}

	resumeJob(jobId: string): Promise<unknown> {
		const entry = this.require(jobId);
		entry.store = entry.store.resume();
		this.emitNew(jobId);
		return Promise.resolve({ jobId });
	}

	discardJob(jobId: string): Promise<unknown> {
		this.jobs.delete(jobId);
		return Promise.resolve({ discarded: true });
	}

	readJobOutputBytes(jobId: string): Promise<ArrayBuffer> {
		const entry = this.require(jobId);
		if (entry.store.snapshot().phase !== "completed" || entry.bytes === null) {
			return Promise.reject(new Error("only a completed job has bytes"));
		}
		return Promise.resolve(entry.bytes);
	}

	canExport(): Promise<{ ffmpegAvailable: boolean }> {
		return Promise.resolve({ ffmpegAvailable: this.ffmpegAvailable });
	}

	onJobEvent(
		handler: (message: { jobId: string; event: ExportJobEvent }) => void,
	): () => void {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}

	onJobsChanged(): () => void {
		return () => {};
	}

	// -- test drivers ------------------------------------------------------

	private require(jobId: string) {
		const entry = this.jobs.get(jobId);
		if (entry === undefined) throw new Error(`no job ${jobId}`);
		return entry;
	}

	/** The one job this surface holds (tests start one at a time). */
	onlyJobId(): string {
		const ids = [...this.jobs.keys()];
		if (ids.length !== 1) throw new Error(`expected one job, got ${String(ids.length)}`);
		return ids[0];
	}

	private emitNew(jobId: string): void {
		const entry = this.require(jobId);
		const events = entry.store.events();
		for (; entry.emitted < events.length; entry.emitted += 1) {
			const event = events[entry.emitted];
			for (const handler of this.handlers) handler({ jobId, event });
		}
	}

	private advanceToEncoding(jobId: string, totalFrames: number): void {
		const entry = this.require(jobId);
		entry.store = entry.store.beginRendering({ totalFrames });
		entry.store = entry.store.acceptFrames({ count: totalFrames });
		entry.store = entry.store.beginEncoding();
		entry.store = entry.store.setEncodeProgress({ progress: 0.5 });
		this.emitNew(jobId);
	}

	driveCompleted({ jobId, bytes }: { jobId: string; bytes: number }): void {
		const entry = this.require(jobId);
		if (entry.store.snapshot().phase !== "encoding") {
			this.advanceToEncoding(jobId, 10);
		}
		const buffer = new ArrayBuffer(bytes);
		new Uint8Array(buffer).fill(7);
		entry.bytes = buffer;
		entry.store = entry.store.complete({
			output: { descriptor: `file:fake-${jobId}.mp4`, bytes },
		});
		this.emitNew(jobId);
	}

	driveFailed({ jobId, reason }: { jobId: string; reason: string }): void {
		const entry = this.require(jobId);
		entry.store = entry.store.fail({ reason });
		this.emitNew(jobId);
	}
}

const REQUEST: ExportRequest = { projectId: "project-1", format: "mp4" };

function providerOver(
	surface: FakeExportSurface,
): { provider: ElectronExportProvider; surface: FakeExportSurface } {
	return {
		provider: new ElectronExportProvider({ bridge: new RendererExportBridge(surface) }),
		surface,
	};
}

test("no binary: canExport false and export settles unsupported naming the binary", async () => {
	const surface = new FakeExportSurface();
	// Before construction: the constructor's warm-up probe is already in
	// flight by the time a caller could mutate the fake, and joining it is
	// the provider's concurrency contract — so the verdict must be the
	// surface's from the start.
	surface.ffmpegAvailable = false;
	const { provider } = providerOver(surface);
	await provider.probe();
	expect(provider.canExport({ request: REQUEST })).toBe(false);
	const outcome = await provider.export({ request: REQUEST });
	expect(outcome.status).toBe("unsupported");
	if (outcome.status === "unsupported") {
		expect(outcome.reason).toContain("ffmpeg-missing");
		expect(outcome.reason).toBe(FFMPEG_UNSUPPORTED_REASON);
	}
	// Unsupported must not fabricate a job.
	expect(surface.jobs.size).toBe(0);
});

test("no bridge at all (composed outside Electron): unsupported, not a crash", async () => {
	const provider = new ElectronExportProvider({ bridge: new RendererExportBridge(null) });
	await provider.probe();
	expect(provider.canExport({ request: REQUEST })).toBe(false);
	const outcome = await provider.export({ request: REQUEST });
	expect(outcome.status).toBe("unsupported");
});

test("the synchronous canExport is conservative until the probe lands", async () => {
	const { provider } = providerOver(new FakeExportSurface());
	// Constructed one microtask ago at most: the probe cannot have landed.
	expect(provider.canExport({ request: REQUEST })).toBe(false);
	await provider.probe();
	expect(provider.canExport({ request: REQUEST })).toBe(true);
});

test("completed job: frozen completed outcome carrying the job's exact bytes", async () => {
	const { provider, surface } = providerOver(new FakeExportSurface());
	const outcomePromise = provider.export({ request: REQUEST });
	await Bun.sleep(0); // let startJob cross so the job exists
	surface.driveCompleted({ jobId: surface.onlyJobId(), bytes: 64 });
	const outcome = await outcomePromise;
	expect(outcome.status).toBe("completed");
	if (outcome.status === "completed") {
		expect(outcome.bytes.byteLength).toBe(64);
		expect(new Uint8Array(outcome.bytes)[0]).toBe(7); // the stub's canary byte
	}
});

test("failed job: frozen failed outcome carrying the job's reason", async () => {
	const { provider, surface } = providerOver(new FakeExportSurface());
	const outcomePromise = provider.export({ request: REQUEST });
	await Bun.sleep(0);
	surface.driveFailed({ jobId: surface.onlyJobId(), reason: "render-error: boom" });
	const outcome = await outcomePromise;
	expect(outcome).toEqual({ status: "failed", reason: "render-error: boom" });
});

test("cancelled job: failed-with-reason — the frozen outcome has no cancelled variant", async () => {
	const { provider, surface } = providerOver(new FakeExportSurface());
	const outcomePromise = provider.export({ request: REQUEST });
	await Bun.sleep(0);
	const snapshot = await surface.cancelJob(surface.onlyJobId());
	expect(snapshot.phase).toBe("cancelled");
	const outcome = await outcomePromise;
	expect(outcome).toEqual({
		status: "failed",
		reason: CANCELLED_AS_FAILED_REASON,
	});
});

test("a job that settled before the subscription: caught by the fetch bookends", async () => {
	const surface = new FakeExportSurface();
	surface.settleDuringStart = "completed";
	const { provider } = providerOver(surface);
	// startJob itself settles the job; the adapter's pre-subscription fetch
	// must see it without ever receiving a settled event it can still hear.
	const outcome = await provider.export({ request: REQUEST });
	expect(outcome.status).toBe("completed");
	if (outcome.status === "completed") {
		expect(outcome.bytes.byteLength).toBe(64);
	}
});

test("surface rejections cross as ExportBridgeError", async () => {
	const surface = new FakeExportSurface();
	const bridge = new RendererExportBridge(surface);
	surface.getJob = () => Promise.reject(new Error("ipc blew up"));
	try {
		await bridge.getJob({ jobId: "missing" });
		throw new Error("expected ExportBridgeError");
	} catch (error) {
		expect(error).toBeInstanceOf(ExportBridgeError);
		expect((error as Error).message).toContain("getJob");
	}
});

// -- composition shape (spec: "The role is a final override beside the store") --
//
// The config's module graph statically reaches `@opencut/editor-classic/browser`
// → the real `opencut-wasm` package, whose init throws under `bun test`. This
// follows the repo's established pattern (the header of
// `src/store/__tests__/filesystem-store-conformance.test.ts`): the real
// assertions run in an isolated child process whose first sequential import
// installs `evidence/wasm-test-mock`, so the process-global
// `mock.module("opencut-wasm")` never reaches any other test file.

if (process.env.OPENCUT_EXPORT_COMPOSITION_ISOLATED !== "1") {
	test("composition shape runs in an isolated wasm-mock process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_EXPORT_COMPOSITION_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated composition suite failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	await import("@opencut/editor-classic/evidence/wasm-test-mock");
	// The config's module-level store singleton builds an IpcStoreBridge at
	// import time, which throws outside Electron: the preload globals are
	// stubbed BEFORE the config import — the only import-order contract.
	const compositionSurface = new FakeExportSurface();
	(globalThis as unknown as { window: unknown }).window = {
		opencutStore: {},
		opencutExport: compositionSurface,
	};
	const { createElectronEditorHost } = await import("../../host/electron-host-config");
	const { FilesystemProjectStore } = await import("../../store/filesystem-project-store");
	const { DeterministicIdGenerator, RecordingDiagnostics } = await import(
		"@opencut/editor-ports/in-memory"
	);
	const { BrowserAssetResolver } = await import("@opencut/editor-classic/browser");

	test("createElectronEditorHost's exporter is the adapter; sibling roles untouched", async () => {
		const stubArgs = {
			projectId: "composition-check",
			onProjectIdChange: () => {},
			onExitProject: () => {},
		};
		const host = createElectronEditorHost(stubArgs);
		expect(host.exporter).toBeInstanceOf(ElectronExportProvider);
		expect(host.store).toBeInstanceOf(FilesystemProjectStore);
		expect(host.diagnostics).toBeInstanceOf(RecordingDiagnostics);
		expect(host.ids).toBeInstanceOf(DeterministicIdGenerator);
		expect(host.assets).toBeInstanceOf(BrowserAssetResolver);

		// Process-lifetime singletons: the second host reuses every owned
		// role, exporter included — an export outlives the session that
		// started it.
		const host2 = createElectronEditorHost(stubArgs);
		expect(host2.exporter).toBe(host.exporter);
		expect(host2.store).toBe(host.store);
		expect(host2.diagnostics).toBe(host.diagnostics);
		expect(host2.ids).toBe(host.ids);

		// The adapter over the stubbed surface is genuinely wired: its probe
		// warmed from the fake surface's verdict.
		const exporter = host.exporter;
		if (exporter instanceof ElectronExportProvider) {
			await exporter.probe();
		}
		expect(exporter.canExport({ request: REQUEST })).toBe(true);
	});
}
