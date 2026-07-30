/**
 * The port conformance suite.
 *
 * Deliberately a plain async function returning a report, not a test file. An
 * adapter author — C5's second store, E1's Elftia-shaped host — points it at
 * their own implementation and runs it **without modifying it**, under whatever
 * runner they have or none at all. A suite that only existed as `bun test` cases
 * would not be runnable outside this repository, and the two intended future
 * callers are both outside it.
 *
 * Results are per port and per case, so a partial implementation gets a usable
 * answer rather than one boolean.
 */
import type { EditorHostPorts, PortRole } from "../index";
import { PORT_ROLES } from "../index";
import { deriveGraphicsReport, UNIMPLEMENTED_RUNTIME_GRAPHICS } from "../environment";

export interface ConformanceCaseResult {
	readonly port: PortRole;
	readonly name: string;
	readonly passed: boolean;
	readonly detail?: string;
}

export interface ConformanceReport {
	readonly label: string;
	readonly passed: boolean;
	readonly results: readonly ConformanceCaseResult[];
	readonly byPort: Readonly<
		Record<PortRole, { passed: number; failed: number }>
	>;
}

class Cases {
	readonly results: ConformanceCaseResult[] = [];

	constructor(private readonly port: PortRole) {}

	async check(name: string, run: () => Promise<void> | void): Promise<void> {
		try {
			await run();
			this.results.push({ port: this.port, name, passed: true });
		} catch (error) {
			this.results.push({
				port: this.port,
				name,
				passed: false,
				detail: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

export async function runPortConformance(args: {
	ports: EditorHostPorts;
	label?: string;
}): Promise<ConformanceReport> {
	const { ports } = args;
	const results: ConformanceCaseResult[] = [];

	results.push(...(await storeCases(ports)));
	results.push(...(await assetCases(ports)));
	results.push(...(await runtimeResourceCases(ports)));
	results.push(...(await exportCases(ports)));
	results.push(...(await diagnosticsCases(ports)));
	results.push(...(await idCases(ports)));
	results.push(...(await environmentCases(ports)));

	const byPort = {} as Record<PortRole, { passed: number; failed: number }>;
	for (const role of PORT_ROLES) byPort[role] = { passed: 0, failed: 0 };
	for (const result of results) {
		if (result.passed) byPort[result.port].passed += 1;
		else byPort[result.port].failed += 1;
	}

	return {
		label: args.label ?? "unnamed implementation",
		passed: results.every((r) => r.passed),
		results,
		byPort,
	};
}

async function storeCases(
	ports: EditorHostPorts,
): Promise<ConformanceCaseResult[]> {
	const cases = new Cases("store");
	const store = ports.store;
	const id = `conformance-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const now = new Date().toISOString();

	/**
	 * The payload carries fields the contract has never heard of, nested and of
	 * mixed types. This is the case that decides whether the port is opaque: a
	 * store that normalizes, validates or reshapes would lose them, and losing
	 * them is a Slice stop condition (provider-private round-trip, Target
	 * State §5.6) rather than a defect to fix later.
	 */
	const payload = {
		knownish: "value",
		providerPrivate: {
			vendorField: 42,
			nested: { deep: [1, "two", { three: true }] },
		},
		unicode: "日本語 — ok",
	};

	await cases.check("declares a schema version", () => {
		assert(
			typeof store.schemaVersion === "number",
			"schemaVersion must be a number",
		);
	});

	await cases.check("save then load round-trips the opaque payload", async () => {
		await store.save({
			record: { id, schemaVersion: store.schemaVersion, data: payload },
			summary: { id, name: "Conformance", createdAt: now, updatedAt: now },
		});
		const loaded = await store.load({ id });
		assert(loaded !== null, "load returned null after save");
		assert(
			JSON.stringify(loaded.data) === JSON.stringify(payload),
			`payload did not round-trip: ${JSON.stringify(loaded.data)}`,
		);
	});

	await cases.check("does not return the caller's object by reference", async () => {
		const loaded = await store.load({ id });
		assert(loaded !== null, "load returned null");
		assert(
			loaded.data !== (payload as unknown),
			"load returned the caller's own object; a later mutation would rewrite history",
		);
	});

	await cases.check("list reports the saved summary", async () => {
		const summaries = await store.list();
		assert(
			summaries.some((s) => s.id === id),
			"saved project is absent from list()",
		);
	});

	await cases.check("list carries no project content", async () => {
		const summaries = await store.list();
		const found = summaries.find((s) => s.id === id);
		assert(found !== undefined, "summary missing");
		assert(
			!("data" in found),
			"summary carries project content; a host should not deserialize every scene to render a list",
		);
	});

	await cases.check("load of an unknown id is null, not a throw", async () => {
		const missing = await store.load({ id: `${id}-absent` });
		assert(missing === null, "expected null for an unknown project");
	});

	await cases.check("remove deletes the record and the summary", async () => {
		await store.remove({ id });
		assert((await store.load({ id })) === null, "record survived remove()");
		const summaries = await store.list();
		assert(
			!summaries.some((s) => s.id === id),
			"summary survived remove()",
		);
	});

	return cases.results;
}

async function assetCases(
	ports: EditorHostPorts,
): Promise<ConformanceCaseResult[]> {
	const resolverCases = new Cases("assets");
	await resolverCases.check("resolves a logical path to a location", () => {
		const resolved = ports.assets.resolve({
			ref: { path: "fonts/font-atlas.json" },
		});
		assert(
			typeof resolved === "string" && resolved.length > 0,
			"resolve() must return a non-empty location",
		);
	});
	await resolverCases.check("does not require a root-absolute result", () => {
		const resolved = ports.assets.resolve({ ref: { path: "a/b.png" } });
		assert(
			typeof resolved === "string",
			"resolve() must return a string for a nested path",
		);
	});

	const loaderCases = new Cases("assetLoader");
	await loaderCases.check("reports a missing asset as an error", async () => {
		let threw = false;
		try {
			await ports.assetLoader.loadBytes({
				ref: { path: `definitely-absent-${Math.random()}` },
			});
		} catch {
			threw = true;
		}
		assert(
			threw,
			"loading an absent asset resolved; a static host answering 200 text/html to an " +
				"absent path is a measured trap and the loader must not pass it through",
		);
	});

	return [...resolverCases.results, ...loaderCases.results];
}

async function runtimeResourceCases(
	ports: EditorHostPorts,
): Promise<ConformanceCaseResult[]> {
	const cases = new Cases("runtimeResources");
	const host = ports.runtimeResources;

	await cases.check("the host constructs the worker and returns a handle", () => {
		const handle = host.createWorker({
			request: {
				id: "conformance-worker",
				url: new URL("https://example.invalid/worker.js"),
				type: "module",
			},
		});
		assert(handle !== null && typeof handle === "object", "no handle returned");
		assert(
			typeof handle.terminate === "function",
			"worker handle must expose terminate()",
		);
		handle.terminate();
	});

	await cases.check("the worker handle delivers messages", async () => {
		const handle = host.createWorker({
			request: {
				id: "conformance-echo",
				url: new URL("https://example.invalid/worker.js"),
				type: "module",
			},
		});
		const received = await new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error("no message within 1000ms"));
			}, 1000);
			handle.onMessage((event) => {
				clearTimeout(timer);
				resolve(event.data);
			});
			handle.postMessage({ message: { ping: 1 } });
		});
		assert(received !== undefined, "message delivered no data");
		handle.terminate();
	});

	await cases.check("a rewritten worker location is conforming", () => {
		// The contract states the supplied URL is a request, not a guarantee. What
		// is asserted here is only that supplying one does not fail — a Host that
		// serves the script from its own origin instead is conforming, so the suite
		// must not require the location to be honoured.
		const handle = host.createWorker({
			request: {
				id: "conformance-rewrite",
				url: new URL("https://elsewhere.invalid/worker.js"),
				type: "classic",
			},
		});
		assert(handle.id === "conformance-rewrite", "logical id was not preserved");
		handle.terminate();
	});

	await cases.check("an audio context is created and closable", async () => {
		const handle = host.createAudioContext({ request: { sampleRate: 44_100 } });
		assert(
			typeof handle.sampleRate === "number",
			"audio handle must report a sample rate",
		);
		await handle.close();
		assert(handle.state === "closed", "audio handle did not report closed");
	});

	await cases.check("an object URL is created and revocable", () => {
		const handle = host.createObjectUrl({
			blob: new Blob([new Uint8Array([1, 2, 3])]),
		});
		assert(
			typeof handle.url === "string" && handle.url.length > 0,
			"object-url handle must carry a url",
		);
		handle.revoke();
	});

	return cases.results;
}

async function exportCases(
	ports: EditorHostPorts,
): Promise<ConformanceCaseResult[]> {
	const cases = new Cases("exporter");
	const request = { projectId: "conformance", format: "mp4" };

	await cases.check("declares whether it can export", () => {
		assert(
			typeof ports.exporter.canExport({ request }) === "boolean",
			"canExport() must return a boolean",
		);
	});

	await cases.check("an unsupported export says so rather than failing", async () => {
		if (ports.exporter.canExport({ request })) return;
		const outcome = await ports.exporter.export({ request });
		assert(
			outcome.status === "unsupported",
			`a host that cannot export must report "unsupported", got "${outcome.status}"`,
		);
		assert(
			outcome.reason.length > 0,
			"an unsupported outcome must state a reason",
		);
	});

	return cases.results;
}

async function diagnosticsCases(
	ports: EditorHostPorts,
): Promise<ConformanceCaseResult[]> {
	const cases = new Cases("diagnostics");

	await cases.check("accepts a log record", () => {
		ports.diagnostics.log({
			record: { level: "info", message: "conformance", context: { a: 1 } },
		});
	});

	await cases.check("accepts a session-scoped event", () => {
		ports.diagnostics.event({
			sessionId: "conformance-session",
			event: { kind: "migration-started", from: 0, to: 1 },
		});
	});

	return cases.results;
}

async function idCases(
	ports: EditorHostPorts,
): Promise<ConformanceCaseResult[]> {
	const cases = new Cases("ids");

	await cases.check("ids are unique within a scope", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 100; i += 1) {
			seen.add(ports.ids.next({ scope: "conformance" }));
		}
		assert(seen.size === 100, `expected 100 distinct ids, got ${seen.size}`);
	});

	await cases.check("scopes are independent", () => {
		const a = ports.ids.next({ scope: "conformance-a" });
		const b = ports.ids.next({ scope: "conformance-b" });
		assert(a !== b, "two scopes produced the same id");
	});

	return cases.results;
}

async function environmentCases(
	ports: EditorHostPorts,
): Promise<ConformanceCaseResult[]> {
	const cases = new Cases("environment");

	await cases.check("declares a graphics mode", () => {
		const declaration = ports.environment.describeGraphics();
		assert(
			declaration.mode === "detect" || declaration.mode === "force",
			`unknown graphics mode: ${JSON.stringify(declaration)}`,
		);
	});

	await cases.check("the host declares but never asserts the report", () => {
		const declaration = ports.environment.describeGraphics();
		assert(
			!("livePreviewLimit" in declaration) && !("backend" in declaration),
			"a graphics declaration must not carry report fields; the runtime produces the report",
		);
	});

	/**
	 * The no-rasterizer case, run against *this* implementation's declaration
	 * only when it forces one — a detecting Host has nothing to force. The
	 * unconditional version of this case lives in the suite's own tests, where a
	 * forcing Host is constructed on purpose.
	 */
	await cases.check("a forced no-rasterizer declaration yields a zero limit", () => {
		const declaration = ports.environment.describeGraphics();
		if (declaration.mode !== "force") return;
		const report = deriveGraphicsReport({
			declaration,
			runtime: UNIMPLEMENTED_RUNTIME_GRAPHICS,
		});
		assert(report.rasterizer === "none", "forced host reported a rasterizer");
		assert(
			report.livePreviewLimit === 0,
			`forced host reported livePreviewLimit ${report.livePreviewLimit}`,
		);
		assert(
			"reason" in report && report.reason.length > 0,
			"a no-rasterizer report must state a reason",
		);
	});

	return cases.results;
}

export function formatConformanceReport(report: ConformanceReport): string {
	const lines: string[] = [
		`conformance: ${report.label} — ${report.passed ? "PASS" : "FAIL"}`,
	];
	for (const role of PORT_ROLES) {
		const tally = report.byPort[role];
		lines.push(
			`  ${tally.failed === 0 ? "PASS" : "FAIL"}  ${role}: ${tally.passed} passed, ${tally.failed} failed`,
		);
	}
	for (const result of report.results) {
		if (result.passed) continue;
		lines.push(`    FAIL  ${result.port} / ${result.name}: ${result.detail ?? ""}`);
	}
	return lines.join("\n");
}
