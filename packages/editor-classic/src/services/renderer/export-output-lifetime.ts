import { ExportCancelledError } from "./export-cancellation";

/** Owns public output cleanup without racing a pending first encoder creation. */
export class ExportOutputLifetime {
	private addPending = false;
	private videoInitialized = false;
	private cancellationRequested = false;
	private cleanup: Promise<void> | null = null;

	constructor(private readonly output: { cancel(): Promise<void> }) {}

	/** Mediabunny calls onEncodedSample after initialization, before encode/backpressure. */
	markVideoInitialized(): void {
		this.videoInitialized = true;
		if (this.cancellationRequested) {
			// The real add's drain below will await and propagate this same cleanup.
			// Observe it immediately even if native backpressure has not drained yet.
			void this.cancelOutputOnce().catch(() => undefined);
		}
	}

	async addVideoFrame(add: () => Promise<void>): Promise<void> {
		if (this.cancellationRequested) throw new ExportCancelledError();
		this.addPending = true;
		try {
			await add();
		} catch (error) {
			try {
				await this.finishAdd();
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					"Video frame submission and output cancellation both failed.",
				);
			}
			throw error;
		}
		await this.finishAdd();
	}

	cancel(): Promise<void> {
		this.cancellationRequested = true;
		if (this.addPending && !this.videoInitialized) {
			// Cancelling Mediabunny before its first native query settles can orphan
			// the encoder created by a late reply. Keep cleanup inside the real add,
			// not its abort-raced UI waiter. A permanently pending query still drains
			// indefinitely; these public APIs cannot abort that native operation.
			return Promise.resolve();
		}
		return this.cancelOutputOnce();
	}

	private async finishAdd(): Promise<void> {
		this.addPending = false;
		if (this.cancellationRequested) await this.cancelOutputOnce();
	}

	private cancelOutputOnce(): Promise<void> {
		this.cleanup ??= Promise.resolve().then(() => this.output.cancel());
		return this.cleanup;
	}
}
