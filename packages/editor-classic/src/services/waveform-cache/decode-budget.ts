/** Browser allocation admission, not a cap on codec-internal scratch memory. */
export const MAX_WAVEFORM_ENCODED_BYTES = 64 * 1024 * 1024;
export const MAX_WAVEFORM_BLOCK_BYTES = 16 * 1024 * 1024;
// Admission includes encoded bytes, SHA input copy, one decoded block and summary overhead.
export const WAVEFORM_JOB_BYTES = 160 * 1024 * 1024;
export const MAX_WAVEFORM_DECODE_BYTES = 2 * WAVEFORM_JOB_BYTES;
export const MAX_WAVEFORM_WAITING = 128;

export function waveformUnsupported(message: string): Error {
	const error = new Error(message);
	error.name = "NotSupportedError";
	return error;
}

type Job = { run(): void; signal: AbortSignal; reject(reason: unknown): void };

export class WaveformDecodeQueue {
	private active = 0;
	private waiting: Job[] = [];

	run<T>({
		signal,
		work,
	}: {
		signal: AbortSignal;
		work(): Promise<T>;
	}): Promise<T> {
		if (signal.aborted) return Promise.reject(signal.reason);
		if (this.waiting.length >= MAX_WAVEFORM_WAITING)
			return Promise.reject(
				waveformUnsupported(
					"Waveform queue is full. Retry when decoding finishes.",
				),
			);
		return new Promise<T>((resolve, reject) => {
			const cancel = () => {
				const index = this.waiting.indexOf(job);
				if (index >= 0) {
					this.waiting.splice(index, 1);
					reject(signal.reason);
				}
			};
			const job: Job = {
				signal,
				reject,
				run: () => {
					signal.removeEventListener("abort", cancel);
					this.active++;
					void work()
						.then(resolve, reject)
						.finally(() => {
							this.active--;
							this.pump();
						});
				},
			};
			signal.addEventListener("abort", cancel, { once: true });
			this.waiting.push(job);
			this.pump();
		});
	}

	private pump(): void {
		while (
			this.active * WAVEFORM_JOB_BYTES < MAX_WAVEFORM_DECODE_BYTES &&
			this.waiting.length
		) {
			const job = this.waiting.shift()!;
			if (job.signal.aborted) job.reject(job.signal.reason);
			else job.run();
		}
	}
}

export const waveformDecodeQueue = new WaveformDecodeQueue();
