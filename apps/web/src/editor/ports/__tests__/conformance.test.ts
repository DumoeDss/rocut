import { describe, expect, test } from "bun:test";
import {
	formatConformanceReport,
	runPortConformance,
} from "../conformance";
import {
	createInMemoryPorts,
	InMemoryProjectStore,
	InMemoryRuntimeResourceHost,
} from "../in-memory";
import {
	deriveGraphicsReport,
	UNIMPLEMENTED_RUNTIME_GRAPHICS,
} from "../environment";
import type { RuntimeGraphicsQuery } from "../environment";

describe("port conformance", () => {
	test("the in-memory reference implementation passes every case", async () => {
		const report = await runPortConformance({
			ports: createInMemoryPorts(),
			label: "in-memory reference",
		});
		// Printed so the recorded evidence is the suite's own output rather than a
		// paraphrase of it.
		console.log(formatConformanceReport(report));
		const failures = report.results.filter((r) => !r.passed);
		expect(failures).toEqual([]);
		expect(report.passed).toBe(true);
	});

	test("reports pass/fail per port and per case", async () => {
		const report = await runPortConformance({
			ports: createInMemoryPorts(),
			label: "shape",
		});
		expect(report.results.length).toBeGreaterThan(0);
		for (const result of report.results) {
			expect(typeof result.port).toBe("string");
			expect(typeof result.name).toBe("string");
			expect(typeof result.passed).toBe("boolean");
		}
		expect(Object.keys(report.byPort).sort()).toEqual(
			[
				"assetLoader",
				"assets",
				"diagnostics",
				"environment",
				"exporter",
				"ids",
				"runtimeResources",
				"store",
			].sort(),
		);
	});

	test("the suite is not vacuous — a non-conforming store fails it", async () => {
		/**
		 * A store that inspects and normalizes the payload instead of carrying it
		 * opaquely. This is the negative control for the conformance suite itself:
		 * a suite that cannot fail is not evidence.
		 */
		class NormalizingStore extends InMemoryProjectStore {
			override async load(args: { id: string }) {
				const record = await super.load(args);
				if (!record) return null;
				return { ...record, data: { normalized: true } };
			}
		}
		const report = await runPortConformance({
			ports: createInMemoryPorts({ store: new NormalizingStore() }),
			label: "normalizing store (negative control)",
		});
		expect(report.passed).toBe(false);
		expect(
			report.results.some(
				(r) => r.port === "store" && !r.passed && r.name.includes("round-trips"),
			),
		).toBe(true);
	});
});

describe("the opaque payload survives what the store does not understand", () => {
	test("provider-private fields round-trip unchanged", async () => {
		const store = new InMemoryProjectStore();
		const data = {
			declared: 1,
			providerPrivate: { vendor: "acme", opts: [1, { deep: null }] },
		};
		await store.save({
			record: { id: "p1", schemaVersion: 1, data },
			summary: {
				id: "p1",
				name: "P1",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		});
		const loaded = await store.load({ id: "p1" });
		expect(loaded?.data).toEqual(data);
	});

	test("a later mutation of the caller's object does not rewrite what was saved", async () => {
		const store = new InMemoryProjectStore();
		const data: { keep: string; mutated?: boolean } = { keep: "yes" };
		await store.save({
			record: { id: "p2", schemaVersion: 1, data },
			summary: {
				id: "p2",
				name: "P2",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		});
		data.mutated = true;
		const loaded = await store.load({ id: "p2" });
		expect(loaded?.data).toEqual({ keep: "yes" });
	});
});

describe("graphics negotiation", () => {
	test("a forced no-rasterizer host yields a zero limit and a stated reason", () => {
		const report = deriveGraphicsReport({
			declaration: { mode: "force", rasterizer: "none" },
			runtime: UNIMPLEMENTED_RUNTIME_GRAPHICS,
		});
		expect(report.rasterizer).toBe("none");
		expect(report.livePreviewLimit).toBe(0);
		expect(report.backend).toBeNull();
		expect(report.rasterizer === "none" && report.reason.length).toBeGreaterThan(
			0,
		);
		expect(report.source).toBe("host-forced");
	});

	test("a forced host is not consulted about the runtime it is running on", () => {
		// The whole point of the force is that it works on hardware that would
		// answer differently — §3.5 needs a constructible no-rasterizer Host
		// without special hardware.
		let consulted = false;
		const runtime: RuntimeGraphicsQuery = {
			selectedBackend: () => {
				consulted = true;
				return "webgpu";
			},
			concurrentCompositorInstances: () => {
				consulted = true;
				return 4;
			},
		};
		deriveGraphicsReport({
			declaration: { mode: "force", rasterizer: "none" },
			runtime,
		});
		expect(consulted).toBe(false);
	});

	test("the report names the selected backend, as an enumeration", () => {
		const webgl = deriveGraphicsReport({
			declaration: { mode: "detect" },
			runtime: {
				selectedBackend: () => "webgl",
				concurrentCompositorInstances: () => 1,
			},
			runtimeSource: "runtime",
		});
		expect(webgl.backend).toBe("webgl");
		expect(webgl.livePreviewLimit).toBe(1);

		const webgpu = deriveGraphicsReport({
			declaration: { mode: "detect" },
			runtime: {
				selectedBackend: () => "webgpu",
				concurrentCompositorInstances: () => 2,
			},
			runtimeSource: "runtime",
		});
		expect(webgpu.backend).toBe("webgpu");
		expect(webgpu.livePreviewLimit).toBe(2);
		// A result that does not record the backend is not evidence about that
		// backend — the two reports above are distinguishable, which is the
		// property §3.6 depends on.
		expect(webgl.backend).not.toBe(webgpu.backend);
	});

	test("the placeholder is visibly unimplemented rather than plausibly wrong", () => {
		const report = deriveGraphicsReport({
			declaration: { mode: "detect" },
			runtime: UNIMPLEMENTED_RUNTIME_GRAPHICS,
		});
		expect(report.source).toBe("unimplemented");
		expect(report.livePreviewLimit).toBe(1);
	});

	test("livePreviewLimit is a count, so a limit above one is expressible", () => {
		const report = deriveGraphicsReport({
			declaration: { mode: "detect" },
			runtime: {
				selectedBackend: () => "webgpu",
				concurrentCompositorInstances: () => 3,
			},
			runtimeSource: "runtime",
		});
		expect(report.livePreviewLimit).toBe(3);
	});
});

describe("the runtime-resource host constructs what the editor may not", () => {
	test("the editor's requested worker URL is recorded as a request", () => {
		const host = new InMemoryRuntimeResourceHost();
		const handle = host.createWorker({
			request: {
				id: "transcription",
				url: new URL("https://origin-a.invalid/worker.js"),
				type: "module",
			},
		});
		expect(host.requestedWorkerUrls).toEqual([
			"https://origin-a.invalid/worker.js",
		]);
		// The handle carries the logical id, not the location: a Host that served
		// the script from its own origin instead is conforming.
		expect(handle.id).toBe("transcription");
	});
});
