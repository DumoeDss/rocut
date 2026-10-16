import type {
	SessionResources,
	TimerHandle,
} from "../../editor/session/resources";

/** Bound only device activation, not legitimate long-running audio preparation. */
export function resumeAudioContext({
	context,
	resources,
	signal,
}: {
	context: Pick<AudioContext, "state" | "resume">;
	resources: Pick<SessionResources, "setTimeout">;
	signal: AbortSignal;
}): Promise<void> {
	signal.throwIfAborted();
	if (context.state === "running") return Promise.resolve();
	return new Promise((resolve, reject) => {
		let settled = false;
		let timer: TimerHandle | null = null;
		const finish = (error?: unknown) => {
			if (settled) return;
			settled = true;
			timer?.cancel();
			signal.removeEventListener("abort", abort);
			if (error !== undefined) reject(error);
			else resolve();
		};
		const abort = () => finish(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
		try {
			timer = resources.setTimeout({
				ms: 10_000,
				handler: () =>
					finish(
						new Error(
							"Audio device activation timed out; playback paused. Retry with the editor focused.",
						),
					),
			});
			if (settled) {
				timer.cancel();
				return;
			}
			// Keep resume in the user's gesture task rather than a deferred microtask.
			void context.resume().then(
				() =>
					finish(
						context.state === "running"
							? undefined
							: new Error("Audio device did not enter the running state."),
					),
				(error: unknown) =>
					finish(error ?? new Error("Audio device activation failed.")),
			);
		} catch (error) {
			finish(error);
		}
	});
}
