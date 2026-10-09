import { raceParticleCapture } from "./particle-capture";

export function htmlBrowserException(stage: string, details: unknown): Error {
	const value = details as
		| { text?: unknown; exception?: { description?: unknown; value?: unknown } }
		| undefined;
	const reason =
		[value?.exception?.description, value?.exception?.value, value?.text]
			.find(
				(entry): entry is string =>
					typeof entry === "string" && entry.length > 0,
			)
			?.slice(0, 1200) ?? "Unknown browser exception";
	return new Error(`${stage}: ${reason}`, { cause: new Error(reason) });
}

/** Internal host seam shared by the production rasterizer and lifecycle tests.
 * The expression resolves only after the controlled driver has awaited samples
 * and submitted GPU work. No screenshot becomes a successful result until the
 * independent host brokers also pass their final post-screenshot check. */
export async function captureHtmlBrowserFrame(options: {
	send(
		method: string,
		params?: Record<string, unknown>,
	): Promise<Record<string, unknown>>;
	expression: string;
	executionContextId?: number;
	signal: AbortSignal;
	failures: readonly Promise<never>[];
	check(): Promise<void>;
	beforeEvaluate(): void;
}): Promise<Buffer> {
	const guard = <T>(work: Promise<T>) =>
		raceParticleCapture(work, options.failures);
	const check = async () => {
		options.signal.throwIfAborted();
		await guard(Promise.resolve().then(options.check));
		options.signal.throwIfAborted();
	};
	await check();
	options.beforeEvaluate();
	const result = await guard(
		options.send("Runtime.evaluate", {
			expression: options.expression,
			...(options.executionContextId !== undefined
				? { contextId: options.executionContextId }
				: {}),
			awaitPromise: true,
			returnByValue: true,
		}),
	);
	if (result.exceptionDetails)
		throw htmlBrowserException(
			"HTML frame evaluation failed",
			result.exceptionDetails,
		);
	await check();
	await guard(options.send("Page.getLayoutMetrics"));
	await check();
	const png = await guard(
		options.send("Page.captureScreenshot", {
			format: "png",
			fromSurface: true,
			captureBeyondViewport: false,
		}),
	);
	await check();
	if (typeof png.data !== "string")
		throw Error("HTML frame browser returned no PNG");
	return Buffer.from(png.data, "base64");
}
