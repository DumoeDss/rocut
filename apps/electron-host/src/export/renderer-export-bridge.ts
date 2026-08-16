/**
 * sdk-export-capability — the interactive window's export bridge client
 * (design D3/D6): a thin typed wrapper over the preload's `window.opencutExport`
 * job-control surface.
 *
 * Scope: ONLY the operations the interactive window owns — the job-control
 * verbs, the capability probe, and the two event subscriptions the panel
 * needs. The producer verbs (`beginExport`/`sendFrame`/`audio`/`finalize`/
 * `failJob`/`jobDone`) belong to the hidden export-renderer window, which
 * holds its own local typing (`src/export-renderer/main.ts`) — typing them
 * here would invite the interactive window to speak producer protocol it must
 * never speak.
 *
 * Not `implements ExportJobProvider`, deliberately. The port's
 * `listJobs`/`getJob`/`canStartJob` are synchronous, and an IPC-backed client
 * cannot answer them synchronously without lying through a cache that events
 * can invalidate mid-render. This client mirrors the provider's method names
 * and argument shapes (`{ jobId }` objects throughout) and returns Promises
 * where the wire forces them; the typed conformance that matters — the FROZEN
 * `ExportProvider` — is claimed by `ElectronExportProvider` over this bridge.
 *
 * Resource discipline: no timers anywhere. Progress arrives by push
 * (`onJobEvent`); list membership by push (`onJobsChanged`). A poll-only
 * consumer may call `listJobs`/`getJob` itself — the provider interface's own
 * allowance. No value that crosses here is a filesystem path (the store
 * bridge's guarantee, inherited): outputs are opaque `file:<name>` descriptors.
 */
import type {
	ExportJobEvent,
	ExportJobRequest,
	ExportJobSnapshot,
} from "@opencut/editor-ports/export-jobs";
import type {
	CanExportWireResult,
	StartJobWireArgs,
} from "./export-ipc-contract";

/**
 * The slice of `window.opencutExport` this window speaks. Method shapes mirror
 * `electron/preload.cjs` verbatim (the drift test pins the operation names);
 * property-with-arrow types keep the surface a data description, not a
 * function declaration family.
 */
export interface ExportJobControlSurface {
	startJob(args: StartJobWireArgs): Promise<{ readonly jobId: string }>;
	listJobs(): Promise<readonly ExportJobSnapshot[]>;
	getJob(jobId: string): Promise<ExportJobSnapshot | null>;
	cancelJob(jobId: string): Promise<ExportJobSnapshot>;
	resumeJob(jobId: string): Promise<unknown>;
	discardJob(jobId: string): Promise<unknown>;
	readJobOutputBytes(jobId: string): Promise<ArrayBuffer>;
	canExport(): Promise<CanExportWireResult>;
	onJobEvent(handler: (message: { jobId: string; event: ExportJobEvent }) => void): () => void;
	onJobsChanged(handler: () => void): () => void;
}

/** The preload exposes exactly this surface via `contextBridge` (one object). */
declare global {
	interface Window {
		readonly opencutExport?: ExportJobControlSurface;
	}
}

/** IPC erases error identity; every rejection crosses as this named shape. */
export class ExportBridgeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ExportBridgeError";
	}
}

/**
 * The bridge's own capability verdict: `false` with the reason when the
 * surface or the binary is absent (the frozen contract's "absence has to be
 * declarable"), `true` only when main's discovery found the binary.
 */
export interface ExportCapability {
	readonly canExport: boolean;
	readonly reason: string | null;
}

const BRIDGE_UNAVAILABLE_REASON =
	"the Electron export preload (window.opencutExport) is not available in this context";

/**
 * Whether a capability verdict's reason is "there is no bridge at all" (this
 * code running outside Electron) rather than "the host cannot export". The
 * panel hides itself on the former; only the latter is user-facing.
 */
export function isBridgeUnavailable(
	capability: ExportCapability,
): boolean {
	return capability.reason === BRIDGE_UNAVAILABLE_REASON;
}

async function settle<T>(operation: string, run: Promise<T>): Promise<T> {
	try {
		return await run;
	} catch (error) {
		throw new ExportBridgeError(
			`Export bridge ${operation} failed over IPC (${error instanceof Error ? error.message : String(error)})`,
		);
	}
}

/**
 * The typed client. The surface is captured LAZILY (first use), unlike the
 * store bridge's fail-at-construction: the frozen `ExportProvider.canExport`
 * must answer `false` — not throw — when composed outside Electron, and the
 * module-level singletons in the composition root construct before any window
 * exists in test environments. A missing surface therefore surfaces as
 * `canExport: false` here and as `unsupported` in the provider, never as an
 * exception from construction.
 */
export class RendererExportBridge {
	private surface: ExportJobControlSurface | null | undefined;

	constructor(surface?: ExportJobControlSurface | null) {
		this.surface = surface;
	}

	private api(): ExportJobControlSurface | null {
		if (this.surface === undefined) {
			this.surface =
				typeof window === "object" ? (window.opencutExport ?? null) : null;
		}
		return this.surface;
	}

	/** Start a job. Main opens the hidden producer window; nothing else needed. */
	startJob(args: {
		request: ExportJobRequest;
	}): Promise<{ readonly jobId: string }> {
		const api = this.api();
		if (api === null) throw new ExportBridgeError(BRIDGE_UNAVAILABLE_REASON);
		return settle("startJob", api.startJob({ request: args.request }));
	}

	listJobs(): Promise<readonly ExportJobSnapshot[]> {
		const api = this.api();
		if (api === null) throw new ExportBridgeError(BRIDGE_UNAVAILABLE_REASON);
		return settle("listJobs", api.listJobs());
	}

	getJob(args: { jobId: string }): Promise<ExportJobSnapshot | null> {
		const api = this.api();
		if (api === null) throw new ExportBridgeError(BRIDGE_UNAVAILABLE_REASON);
		return settle("getJob", api.getJob(args.jobId));
	}

	cancelJob(args: { jobId: string }): Promise<ExportJobSnapshot> {
		const api = this.api();
		if (api === null) throw new ExportBridgeError(BRIDGE_UNAVAILABLE_REASON);
		return settle("cancelJob", api.cancelJob(args.jobId));
	}

	/** Main re-opens the producer window for the job (the resume assignment). */
	resumeJob(args: { jobId: string }): Promise<unknown> {
		const api = this.api();
		if (api === null) throw new ExportBridgeError(BRIDGE_UNAVAILABLE_REASON);
		return settle("resumeJob", api.resumeJob(args.jobId));
	}

	async discardJob(args: { jobId: string }): Promise<void> {
		const api = this.api();
		if (api === null) throw new ExportBridgeError(BRIDGE_UNAVAILABLE_REASON);
		await settle("discardJob", api.discardJob(args.jobId));
	}

	readJobOutputBytes(args: { jobId: string }): Promise<ArrayBuffer> {
		const api = this.api();
		if (api === null) throw new ExportBridgeError(BRIDGE_UNAVAILABLE_REASON);
		return settle("readJobOutputBytes", api.readJobOutputBytes(args.jobId));
	}

	/** The capability probe (the `canExport` op): binary discoverable + bridge up. */
	async canExport(): Promise<ExportCapability> {
		const api = this.api();
		if (api === null) {
			return { canExport: false, reason: BRIDGE_UNAVAILABLE_REASON };
		}
		const verdict = await settle("canExport", api.canExport());
		return verdict.ffmpegAvailable
			? { canExport: true, reason: null }
			: { canExport: false, reason: "ffmpeg-missing" };
	}

	/**
	 * The port-shaped per-job subscription: the panel and the frozen exporter
	 * both await ONE job, and the filter keeps every other window's jobs out.
	 */
	onJobEvent(args: {
		jobId: string;
		handler: (event: ExportJobEvent) => void;
	}): { unsubscribe(): void } {
		const api = this.api();
		if (api === null) return { unsubscribe: () => {} };
		const remove = api.onJobEvent(({ jobId, event }) => {
			if (jobId === args.jobId) args.handler(event);
		});
		return { unsubscribe: remove };
	}

	/** Every job's events, unfiltered — a multi-job consumer's channel. */
	onAnyJobEvent(args: {
		handler: (message: { jobId: string; event: ExportJobEvent }) => void;
	}): { unsubscribe(): void } {
		const api = this.api();
		if (api === null) return { unsubscribe: () => {} };
		const remove = api.onJobEvent(args.handler);
		return { unsubscribe: remove };
	}

	/** List membership changed (a job was added or removed): re-poll `listJobs`. */
	onJobsChanged(args: { handler: () => void }): { unsubscribe(): void } {
		const api = this.api();
		if (api === null) return { unsubscribe: () => {} };
		const remove = api.onJobsChanged(args.handler);
		return { unsubscribe: remove };
	}
}
