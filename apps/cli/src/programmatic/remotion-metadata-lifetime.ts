/** Per-realm bounded lifetime. Promise handlers remain attached after abort so
 * uncooperative calculateMetadata cannot publish late results or leak rejection. */
export function createRemotionMetadataLifetime({
	timeoutMs,
	check,
}: {
	timeoutMs: number;
	check: () => void;
}) {
	const controller = new AbortController();
	let finished = false;
	const abort = (reason: unknown) => {
		if (!controller.signal.aborted) controller.abort(reason);
	};
	const timer = setTimeout(
		() => abort(Error("Remotion metadata/frame readiness timed out")),
		timeoutMs,
	);
	const polling = setInterval(() => {
		if (finished || controller.signal.aborted) return;
		try {
			check();
		} catch (error) {
			abort(error);
		}
	}, 16);
	const assertActive = () => {
		controller.signal.throwIfAborted();
		if (finished) throw Error("Remotion metadata lifetime already finished");
		try {
			check();
		} catch (error) {
			abort(error);
			throw error;
		}
	};
	return {
		signal: controller.signal,
		abort,
		check: assertActive,
		wait<T>(pending: PromiseLike<T> | T): Promise<T> {
			return new Promise<T>((resolve, reject) => {
				let settled = false;
				const finish = (
					result:
						| { failed: true; error: unknown }
						| { failed: false; value: T },
				) => {
					if (settled) return;
					settled = true;
					controller.signal.removeEventListener("abort", cancelled);
					if (result.failed) reject(result.error);
					else resolve(result.value);
				};
				const cancelled = () =>
					finish({ failed: true, error: controller.signal.reason });
				// Always observe pending, even if already cancelled before this call.
				Promise.resolve(pending).then(
					(value) => {
						try {
							assertActive();
							finish({ failed: false, value });
						} catch (error) {
							finish({ failed: true, error });
						}
					},
					(error) => finish({ failed: true, error }),
				);
				controller.signal.addEventListener("abort", cancelled, { once: true });
				try {
					assertActive();
				} catch (error) {
					finish({ failed: true, error });
				}
			});
		},
		finish() {
			if (finished) return;
			finished = true;
			abort(Error("Remotion metadata lifetime already finished"));
			clearTimeout(timer);
			clearInterval(polling);
		},
	};
}
export const REMOTION_METADATA_LIFETIME_SOURCE = `const rocutCreateRemotionMetadataLifetime = (${createRemotionMetadataLifetime.toString()});`;
