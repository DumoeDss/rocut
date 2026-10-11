type ExportObserverTarget = {
	on(event: "progress", listener: (progress: number) => void): unknown;
	on(event: "complete", listener: (bytes: ArrayBuffer) => void): unknown;
	on(event: "error", listener: (error: Error) => void): unknown;
	on(event: "cancelled", listener: () => void): unknown;
};

type PhaseDetails = Record<string, string | number | boolean | null>;

/** Synchronous observation only: no polling, awaits, codec calls or GPU changes. */
export function createHtmlProbePhaseReporter() {
	const startedAt: unknown = Reflect.get(globalThis, "__htmlProbeStartedAt");
	let sequence = 0;
	return (name: string, details: PhaseDetails = {}) => {
		const now = Date.now();
		const observation = {
			sequence: ++sequence,
			probeElapsedMs: typeof startedAt === "number" ? now - startedAt : null,
			...details,
		};
		Reflect.set(globalThis, "__htmlProbePhase", name);
		console.log(`HTML probe: phase ${name} ${JSON.stringify(observation)}`);
	};
}

/** Complete precedes SceneExporter's awaited retirement; it is not promise settlement. */
export function observeHtmlProbeExporter({
	exporter,
	phase,
	prefix,
}: {
	exporter: ExportObserverTarget;
	phase: ReturnType<typeof createHtmlProbePhaseReporter>;
	prefix: string;
}) {
	let progressEvents = 0;
	exporter.on("progress", (progress) => {
		phase(prefix + "-progress-event", { progress, progressEvents: ++progressEvents });
	});
	exporter.on("complete", (bytes) => {
		phase(prefix + "-complete-event", { encodedBytes: bytes.byteLength, progressEvents });
	});
	exporter.on("error", (error) => {
		// Event payloads may contain authored paths/URLs; retain only their class.
		phase(prefix + "-error-event", { errorName: error.name, progressEvents });
	});
	exporter.on("cancelled", () => {
		phase(prefix + "-cancelled-event", { progressEvents });
	});
}
