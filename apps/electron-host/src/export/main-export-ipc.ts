/**
 * sdk-export-capability — the main-process half of the export bridge (design
 * D3/D4), mirroring `../store/main-store-ipc.ts` in every discipline:
 *
 * Compiled to `dist-main/main-export-ipc.cjs` by the package build (`bun
 * build`, node target — this module imports no Electron, only the pure-Node
 * `ExportJobManager`, so the bundle stays pure) and required by
 * `electron/main.cjs`, which owns the Electron objects and passes its
 * `ipcMain` in structurally.
 *
 * It installs the fourteen `opencut-export:<operation>` channels over one
 * `ExportJobManager` — the same manager class `bun test` exercises against
 * real FFmpeg, which is the whole point: the unit evidence and the production
 * path share one implementation. (Fourteen since Group C: `canExport` joins
 * the thirteen Group B froze, answering from the SAME boot-time discovery
 * verdict the manager encodes, so the probe can never disagree with the
 * jobs.)
 *
 * Channel discipline (the renderer-holds-no-paths guarantee): every handler's
 * arguments are identifiers and structured-clone values — job ids, requests,
 * frame batches, a WAV buffer. No channel accepts or returns a filesystem
 * path; the manager derives every path inside its root, and a completed
 * output crosses as the opaque `file:<name>` descriptor only. The drift test
 * `__tests__/export-bridge-surface.test.ts` fails if the preload's operation
 * list diverges from the contract's.
 *
 * The one asymmetry with the store bridge is the `frame` channel: frame
 * batches are high-volume, so they travel `ipcMain.on` (fire-and-forget)
 * rather than `invoke`, and main answers each batch with a `frameAck` event
 * to the sender — the acknowledged backpressure the spec demands (the
 * producer keeps at most one batch in flight).
 */
import {
	EXPORT_IPC_CHANNEL_PREFIX,
	EXPORT_IPC_OPERATIONS,
	EXPORT_FRAME_ACK_CHANNEL,
	projectContentDigest,
	projectTimelineDigest,
	type BeginExportWireArgs,
	type BeginExportWireResult,
	type CanExportWireResult,
	type ExportIpcOperation,
	type FrameBatchMessage,
	type JobEventMessage,
	type ResumeWireResult,
	type StartJobWireArgs,
} from "./export-ipc-contract";
import { ExportJobManager, resolveFfmpegPath } from "./job-manager";

export {
	EXPORT_IPC_OPERATIONS,
	EXPORT_IPC_CHANNEL_PREFIX,
	projectContentDigest,
	projectTimelineDigest,
	resolveFfmpegPath,
};
export type { ExportIpcOperation };

/**
 * The slice of Electron's `ipcMain` this module needs, structurally. Listener
 * contracts include Electron's leading event parameter — forgetting it passes
 * the `IpcMainEvent` where the first payload argument belongs, a failure only
 * a production-path run can catch (the bun suites never traverse IPC). The
 * `frame` listener additionally needs the sender to answer acks on.
 */
export interface ExportIpcMain {
	handle<A extends unknown[]>(
		channel: string,
		listener: (event: unknown, ...args: A) => unknown,
	): void;
	on<A extends unknown[]>(
		channel: string,
		listener: (event: ExportIpcEvent, ...args: A) => void,
	): void;
}

/** The slice of an `IpcMainEvent` the frame ack path touches. */
export interface ExportIpcEvent {
	readonly sender: { send(channel: string, ...args: unknown[]): void };
}

/**
 * The store-meta lookup backing the output name + stale-timeline guard. May
 * be asynchronous — the production source is the store bridge's
 * `loadRecord`, a Promise — and may answer null (unknown project: the job
 * proceeds with the default name and no guard).
 */
export type ExportProjectMetaSource = (
	args: { projectId: string },
) =>
	| { name: string; contentDigest: string }
	| null
	| Promise<{ name: string; contentDigest: string } | null>;

/** What the installer forwards to the windows main owns. */
export type ExportBridgeEvent =
	| { readonly channel: "jobEvent"; readonly payload: JobEventMessage }
	| { readonly channel: "jobsChanged" };

export function installExportIpc(args: {
	ipcMain: ExportIpcMain;
	/** The exports root the manager owns (main creates it before calling). */
	exportsRoot: string;
	/** A resolved FFmpeg path, or null when none was discovered. */
	ffmpegPath: string | null;
	/** Main-side observer: every job event, ack, and list change. */
	onJobEvent?: (event: ExportBridgeEvent) => void;
	/** Main opens (or re-opens) the hidden producer window for a job. */
	openExportRenderer?: (args: { jobId: string }) => void;
	/** Project name + content digest for the output name and the stale guard. */
	getProjectMeta?: ExportProjectMetaSource;
	/** The producer window's belt-and-braces "lifecycle complete" signal. */
	onJobDone?: (args: { jobId: string }) => void;
	log?: (line: string) => void;
}): ExportJobManager {
	const manager = new ExportJobManager({
		root: args.exportsRoot,
		ffmpegPath: args.ffmpegPath,
		log: args.log,
	});
	const { ipcMain } = args;
	const channel = (operation: ExportIpcOperation): string =>
		`${EXPORT_IPC_CHANNEL_PREFIX}${operation}`;

	// Store transitions and list membership changes fan out to every window
	// main owns (the interactive panel and the export window both listen).
	manager.onAnyJob((notification) => {
		if (notification.kind === "listChanged") {
			args.onJobEvent?.({ channel: "jobsChanged" });
			return;
		}
		args.onJobEvent?.({
			channel: "jobEvent",
			payload: { jobId: notification.jobId, event: notification.event },
		});
	});

	ipcMain.handle(
		channel("startJob"),
		async (_event, wire: StartJobWireArgs) => {
			const meta =
				(await args.getProjectMeta?.({ projectId: wire.request.projectId })) ?? null;
			const { jobId } = manager.startJob({
				request: wire.request,
				projectName: wire.projectName ?? meta?.name,
				projectContentDigest: wire.projectContentDigest ?? meta?.contentDigest,
			});
			args.openExportRenderer?.({ jobId });
			return { jobId };
		},
	);

	ipcMain.handle(channel("beginExport"), (_event, wire: BeginExportWireArgs) =>
		manager.beginExport(wire),
	);

	// Frame batches: ipcMain.on, not invoke. Each batch is answered with a
	// frameAck event to the sender — the backpressure acknowledgement. A
	// batch that fails the stream contract fails the job (named reason in the
	// settled event); the ack is then moot, and the window dies on the event.
	ipcMain.on(channel("frame"), (event, message: FrameBatchMessage) => {
		try {
			const ack = manager.acceptFrames({
				jobId: message.jobId,
				startIndex: message.startIndex,
				buffer: message.buffer,
			});
			event.sender.send(EXPORT_FRAME_ACK_CHANNEL, {
				jobId: message.jobId,
				acceptedFrames: ack.acceptedFrames,
				moreWanted: ack.moreWanted,
			});
		} catch (error) {
			args.log?.(
				`frame batch rejected for job ${String(message?.jobId)}: ${String(error)}`,
			);
			// No ack on failure: the job's settled event (emitted by the
			// manager's named failure) tells the producer to stop and main to
			// destroy its window.
		}
	});

	ipcMain.handle(channel("audio"), (_event, wire: { jobId: string; wav: ArrayBuffer }) => {
		manager.acceptAudio({ jobId: wire.jobId, wav: wire.wav });
		return { accepted: true };
	});

	ipcMain.handle(channel("finalize"), (_event, wire: { jobId: string }) =>
		manager.finalize({ jobId: wire.jobId }),
	);

	ipcMain.handle(
		channel("failJob"),
		(_event, wire: { jobId: string; reason: string }) => {
			manager.failJob({ jobId: wire.jobId, reason: wire.reason });
			return { failed: true };
		},
	);

	ipcMain.handle(channel("listJobs"), () => manager.listJobs());

	ipcMain.handle(channel("getJob"), (_event, wire: { jobId: string }) =>
		manager.getJob({ jobId: wire.jobId }),
	);

	ipcMain.handle(channel("cancelJob"), (_event, wire: { jobId: string }) =>
		manager.cancelJob({ jobId: wire.jobId }),
	);

	ipcMain.handle(channel("resumeJob"), (_event, wire: { jobId: string }) => {
		const assignment: ResumeWireResult = manager.resumeJob({ jobId: wire.jobId });
		args.openExportRenderer?.({ jobId: wire.jobId });
		return assignment;
	});

	ipcMain.handle(channel("discardJob"), (_event, wire: { jobId: string }) => {
		manager.discardJob({ jobId: wire.jobId });
		return { discarded: true };
	});

	ipcMain.handle(
		channel("readJobOutputBytes"),
		(_event, wire: { jobId: string }) => manager.readJobOutputBytes({ jobId: wire.jobId }),
	);

	ipcMain.handle(channel("jobDone"), (_event, wire: { jobId: string }) => {
		args.onJobDone?.({ jobId: wire.jobId });
		return { acknowledged: true };
	});

	// The capability probe (Group C): the boot-time discovery verdict this
	// installer already holds — the exact value the manager was constructed
	// with, so `canExport` and the jobs it gates can never disagree.
	ipcMain.handle(channel("canExport"), (): CanExportWireResult => ({
		ffmpegAvailable: args.ffmpegPath !== null,
	}));

	return manager;
}

export type { BeginExportWireResult, BeginExportWireArgs };
