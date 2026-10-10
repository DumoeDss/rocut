import type { LiquidObjectAdmissionChannel } from "./three-liquid-object-transport";

export function terminateLiquidTransport({
	admission,
	prior,
	timeoutMs,
}: {
	admission: LiquidObjectAdmissionChannel;
	prior: Error | undefined;
	timeoutMs: number;
}): Promise<void> {
	const completion = (async () => {
		let terminationError: unknown;
		try {
			await admission.terminate();
		} catch (error) {
			terminationError = error;
		}
		if (prior && terminationError)
			throw new AggregateError(
				[prior, terminationError],
				"Liquid transport failure and termination failed",
			);
		if (terminationError) throw terminationError;
		if (prior) throw prior;
	})();
	return new Promise<void>((resolve, reject) => {
		const deadline = setTimeout(
			() =>
				reject(Error("Liquid termination timeout with unfinished ownership")),
			timeoutMs,
		);
		completion.then(
			() => {
				clearTimeout(deadline);
				resolve();
			},
			(error) => {
				clearTimeout(deadline);
				reject(error);
			},
		);
	});
}
