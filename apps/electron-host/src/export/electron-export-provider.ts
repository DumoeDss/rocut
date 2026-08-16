/**
 * sdk-export-capability — the frozen `ExportProvider` implemented over the
 * export-job surface (design D6): the composition root's `exporter` final
 * override.
 *
 * The frozen contract is a promise-shaped one-shot (`export(): Promise<
 * ExportOutcome>`); the desktop reality is an addressable job manager in the
 * main process. This adapter is the whole translation layer between them, and
 * every translation is a decision recorded in the mapping table below — the
 * frozen shape has no vocabulary for progress (F2), cancellation (F3), or
 * recovery (F5), so those either map onto the nearest frozen state or stay on
 * the job surface where the panel owns them.
 *
 * ## Outcome mapping (the table this adapter implements)
 *
 * | job reality                          | frozen outcome                          |
 * |--------------------------------------|-----------------------------------------|
 * | capability probe: no binary / bridge | `unsupported`, reason names ffmpeg-     |
 * |                                      | missing (spec: "No binary means         |
 * |                                      | unsupported, not failure")              |
 * | settled `completed` + `readJobOutput | `completed` with those bytes (F4's      |
 * | Bytes`                               | whole-file cost is the frozen shape's)  |
 * | settled `failed`                     | `failed` with the job's reason          |
 * | settled `cancelled`                  | `failed` with reason `"cancelled"` —    |
 * |                                      | the frozen outcome has no cancelled     |
 * |                                      | variant; silence or `completed` would   |
 * |                                      | both be lies                            |
 * | phase `interrupted` mid-await        | the promise stays PENDING — recovery    |
 * |                                      | (resume) is a job-surface concern the   |
 * |                                      | frozen shape cannot express; if a       |
 * |                                      | resumed run later settles, the promise  |
 * |                                      | settles with that outcome               |
 * | app killed mid-await                 | never settles (the promise died with    |
 * |                                      | the process); after restart the job is  |
 * |                                      | `interrupted` and discoverable via      |
 * |                                      | `listJobs` — the panel's recovery path  |
 *
 * `canExport` is synchronous in the frozen contract while the probe is one
 * IPC round trip; the adapter therefore answers from a cache warmed at
 * construction and refreshed by every `probe()`/`export()` call, defaulting
 * to the SAFE `false` until the first probe lands. The composition root
 * constructs this provider at app boot, long before a user can reach an
 * export affordance, so the unknown window is boot-time only — and a missing
 * binary stays `false` forever, which is the truthful answer.
 *
 * "A loadable project" (the spec's other canExport precondition) is answered
 * by the outcome, not the probe: project loadability is not synchronously
 * knowable from the renderer (the store is async IPC), and the job surface
 * already fails a non-loadable project with a named reason at start. The
 * donor's own button gates on "a project is open" at the UI layer; the panel
 * does the same.
 */
import type {
	ExportOutcome,
	ExportProvider,
	ExportRequest,
} from "@opencut/editor-ports";
import type {
	ExportJobSnapshot,
} from "@opencut/editor-ports/export-jobs";
import type { ExportCapability, RendererExportBridge } from "./renderer-export-bridge";

/** The unsupported reason, naming the missing binary the spec's scenario demands. */
export const FFMPEG_UNSUPPORTED_REASON =
	"ffmpeg-missing: no FFmpeg binary was discovered — set OPENCUT_FFMPEG_PATH, place ffmpeg(.exe) under <app>/bin, or put it on PATH";

/** The frozen outcome's stand-in for a job the user cancelled (see mapping table). */
export const CANCELLED_AS_FAILED_REASON = "cancelled";

export class ElectronExportProvider implements ExportProvider {
	private readonly bridge: RendererExportBridge;
	private capability: ExportCapability | null = null;
	private probing: Promise<ExportCapability> | null = null;

	constructor(args: { bridge: RendererExportBridge }) {
		this.bridge = args.bridge;
		// Warm the synchronous cache so `canExport` stops answering the
		// conservative default as early as possible.
		void this.probe();
	}

	/**
	 * The capability probe, cached for the synchronous `canExport` below.
	 * Concurrent calls share one round trip; each completed probe refreshes
	 * the cache. Public because a Host (or harness) may legitimately want to
	 * re-ask after, say, installing a binary.
	 */
	probe(): Promise<ExportCapability> {
		this.probing ??= this.bridge.canExport().then(
			(capability) => {
				this.capability = capability;
				this.probing = null;
				return capability;
			},
			(error) => {
				// A rejected probe (IPC down mid-call) is an absent capability,
				// not a crash: the frozen contract declares absence, it does not
				// throw it.
				this.capability = {
					canExport: false,
					reason: error instanceof Error ? error.message : String(error),
				};
				this.probing = null;
				return this.capability;
			},
		);
		return this.probing;
	}

	canExport(_args: { request: ExportRequest }): boolean {
		// The request carries nothing this host can veto synchronously: format
		// validation is main's at finalize (a named `failed` reason), and
		// project loadability is async by construction (module docblock) — the
		// interface's request parameter is deliberately unanswered.
		return this.capability?.canExport === true;
	}

	async export(args: { request: ExportRequest }): Promise<ExportOutcome> {
		const capability = await this.probe();
		if (!capability.canExport) {
			return {
				status: "unsupported",
				reason:
					capability.reason === "ffmpeg-missing"
						? FFMPEG_UNSUPPORTED_REASON
						: `unsupported: ${capability.reason ?? "unknown"}`,
			};
		}
		const { jobId } = await this.bridge.startJob({
			request: {
				projectId: args.request.projectId,
				format: args.request.format,
			},
		});
		const settled = await this.awaitSettled({ jobId });
		return this.outcomeFor({ snapshot: settled });
	}

	/**
	 * Await one job's settlement WITHOUT a timer (the C6 boundary): the
	 * `jobEvent` push channel is the settle signal, bookended by snapshot
	 * fetches so no transition can slip past the subscription — the queued
	 * phase event is emitted before `startJob`'s reply even crosses, so a
	 * fetch-before-subscribe alone would race.
	 */
	private async awaitSettled(args: { jobId: string }): Promise<ExportJobSnapshot> {
		const { jobId } = args;
		const before = await this.bridge.getJob({ jobId });
		if (before !== null && isSettled(before)) return before;
		return await new Promise<ExportJobSnapshot>((resolve, reject) => {
			let done = false;
			const finish = (run: () => void) => {
				if (done) return;
				done = true;
				subscription.unsubscribe();
				run();
			};
			const subscription = this.bridge.onJobEvent({
				jobId,
				handler: (event) => {
					if (event.type !== "settled") return;
					void this.bridge
						.getJob({ jobId })
						.then((snapshot) => {
							finish(() => {
								if (snapshot === null) {
									reject(
										new Error(
											`export job ${jobId} settled but is no longer addressable`,
										),
									);
								} else {
									resolve(snapshot);
								}
							});
						})
						.catch((error: unknown) => {
							finish(() => {
								reject(
									error instanceof Error
										? error
										: new Error(String(error)),
								);
							});
						});
				},
			});
			// Close the subscribe race: a job that settled between the fetch
			// above and the subscription just installed is caught by one more
			// fetch, not by waiting for an event that already fired.
			void this.bridge
				.getJob({ jobId })
				.then((snapshot) => {
					if (snapshot !== null && isSettled(snapshot)) {
						finish(() => resolve(snapshot));
					}
				})
				.catch((error: unknown) => {
					finish(() => {
						reject(error instanceof Error ? error : new Error(String(error)));
					});
				});
		});
	}

	private async outcomeFor(args: {
		snapshot: ExportJobSnapshot;
	}): Promise<ExportOutcome> {
		const { snapshot } = args;
		if (snapshot.phase === "completed") {
			const bytes = await this.bridge.readJobOutputBytes({
				jobId: snapshot.jobId,
			});
			return { status: "completed", bytes };
		}
		if (snapshot.phase === "failed") {
			return {
				status: "failed",
				reason: snapshot.error ?? "export failed without a reason",
			};
		}
		if (snapshot.phase === "cancelled") {
			// The mapping table's one deliberate flattening: the frozen outcome
			// has no cancelled variant, and "failed: cancelled" is the nearest
			// truthful shape (not completed, not unsupported, user-initiated).
			return { status: "failed", reason: CANCELLED_AS_FAILED_REASON };
		}
		// Unreachable from awaitSettled (only settled snapshots resolve it);
		// kept honest rather than cast.
		return {
			status: "failed",
			reason: `export job settled in an unexpected phase "${snapshot.phase}"`,
		};
	}
}

function isSettled(snapshot: ExportJobSnapshot): boolean {
	return (
		snapshot.phase === "completed" ||
		snapshot.phase === "failed" ||
		snapshot.phase === "cancelled"
	);
}
