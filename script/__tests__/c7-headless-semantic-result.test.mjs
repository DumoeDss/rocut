import { describe, expect, test } from "bun:test";
import {
	validateHeadlessRuntimeSensitivityResult,
	validateHeadlessSemanticResult,
	validateIndependentHeadlessHostReports,
	validateIndependentHeadlessResults,
} from "../check-headless-semantic-result.mjs";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

const GLOBAL_HOOK_PATHS = [
	"globalThis.setTimeout",
	"globalThis.setInterval",
	"globalThis.requestAnimationFrame",
	"globalThis.Worker",
	"globalThis.AudioContext",
	"globalThis.webkitAudioContext",
	"URL.createObjectURL",
	"navigator.gpu.requestAdapter",
	"WebAssembly.instantiate",
	"WebAssembly.instantiateStreaming",
];
const HOST_HOOK_PATHS = [
	"host.runtimeResources.createWorker",
	"host.runtimeResources.createAudioContext",
	"host.runtimeResources.createObjectUrl",
	"host.environment.describeGraphics",
];

function hook(path, status) {
	return {
		path,
		status,
		detail:
			status === "installed"
				? `${path} wrapped`
				: `typeof ${path} is undefined`,
	};
}

function validRuntimeProbe(host, buildMarker, entry, mode = "clean") {
	const browser = host === "vite";
	const sensitivity = mode === "sensitivity";
	const globalCalls = {
		timeouts: sensitivity ? 1 : 0,
		intervals: sensitivity ? 1 : 0,
		animationFrames: sensitivity && browser ? 1 : 0,
		workers: sensitivity && browser ? 1 : 0,
		audioContexts: sensitivity && browser ? 1 : 0,
		audioContextConstructions: sensitivity && browser ? 1 : 0,
		webkitAudioContextConstructions: 0,
		objectUrls: sensitivity ? 1 : 0,
		webGpuAdapterRequests: sensitivity && browser ? 1 : 0,
		wasmInstantiations: sensitivity ? 2 : 0,
		wasmInstantiateCalls: sensitivity ? 1 : 0,
		wasmInstantiateStreamingCalls: sensitivity ? 1 : 0,
	};
	const hostCalls = {
		workers: sensitivity ? 1 : 0,
		audioContexts: sensitivity ? 1 : 0,
		objectUrls: sensitivity ? 1 : 0,
		graphicsQueries: sensitivity ? 1 : 0,
	};
	const globalStatuses = GLOBAL_HOOK_PATHS.map((path) => {
		if (path === "globalThis.webkitAudioContext") return "absent";
		if (
			!browser &&
			[
				"globalThis.requestAnimationFrame",
				"globalThis.Worker",
				"globalThis.AudioContext",
				"navigator.gpu.requestAdapter",
			].includes(path)
		) {
			return "absent";
		}
		return "installed";
	});
	const react = browser
		? {
				strategy: "mutation-observer+react-container-markers",
				domAvailable: true,
				mutationRecords: sensitivity ? 2 : 0,
				rootMarkersBefore: 0,
				rootMarkersAfter: sensitivity ? 1 : 0,
				mountAttempts: sensitivity ? 3 : 0,
			}
		: {
				strategy: "server-no-dom",
				domAvailable: false,
				mutationRecords: 0,
				rootMarkersBefore: 0,
				rootMarkersAfter: 0,
				mountAttempts: 0,
			};
	const ownershipAttempts =
		hostCalls.graphicsQueries +
		globalCalls.webGpuAdapterRequests +
		globalCalls.wasmInstantiations;
	return {
		schemaVersion: 1,
		implementation: "headless-runtime-probe/v1",
		probeId: `c7-runtime-probe:${host}:${buildMarker}:${entry}`,
		host,
		environment: browser ? "browser" : "server",
		buildMarker,
		entry,
		events: [
			{ sequence: 1, kind: "probe-installed" },
			{ sequence: 2, kind: "subject-load-started" },
			{ sequence: 3, kind: "host-bound" },
			{ sequence: 4, kind: "subject-completed" },
			{ sequence: 5, kind: "probe-restored" },
		],
		hostBinding: {
			source: "fixture-explicit-createInMemoryHost",
			expectedProjectId: "c7-headless-project",
			actualProjectId: "c7-headless-project",
			projectMatches: true,
			intendedStoreIdentity: "InMemoryProjectStore",
			actualStoreIdentity: "InMemoryProjectStore",
			sameStoreInstance: true,
			fallbackUsed: false,
		},
		globalCalls,
		hostCalls,
		hookProvenance: {
			global: {
				strategy: "pre-load-callable-proxy/v1",
				hooks: GLOBAL_HOOK_PATHS.map((path, index) =>
					hook(path, globalStatuses[index]),
				),
			},
			host: {
				strategy: "post-bind-host-callable-proxy/v1",
				hooks: HOST_HOOK_PATHS.map((path) => hook(path, "installed")),
			},
			react: {
				strategy: browser
					? "browser-mutation-observer+root-marker-scan/v1"
					: "server-no-dom/v1",
				hooks: [
					hook("document.reactRootMarkers", browser ? "installed" : "absent"),
					hook("globalThis.MutationObserver", browser ? "installed" : "absent"),
				],
			},
			compositorGpu: {
				strategy: "derived-host-webgpu-wasm/v1",
				fields: [
					"hostGraphicsQueries",
					"webGpuAdapterRequests",
					"wasmInstantiations",
					"ownershipAttempts",
				],
			},
		},
		hostResourceState: {
			workers: hostCalls.workers,
			audioContexts: hostCalls.audioContexts,
			objectUrls: hostCalls.objectUrls,
		},
		react,
		compositorGpu: {
			strategy: "host-graphics+webgpu+wasm-construction",
			hostGraphicsQueries: hostCalls.graphicsQueries,
			webGpuAdapterRequests: globalCalls.webGpuAdapterRequests,
			wasmInstantiations: globalCalls.wasmInstantiations,
			ownershipAttempts,
		},
	};
}

function validResult(host = "vite", mode = "clean") {
	const buildMarker = `c7-${host}-clean`;
	const entry = `${host}/headless-entry.ts`;
	const runtimeProbe = validRuntimeProbe(host, buildMarker, entry, mode);
	return {
		schemaVersion: 1,
		host,
		buildMarker,
		acceptedHead: "a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf",
		acceptedTree: "885d307814260b77397c2c2677b9361fdfc5f5e2",
		entry,
		storeIdentity: "InMemoryProjectStore",
		storeRunIdentity: `${host}:store-run`,
		hostFallback: false,
		projectId: "c7-headless-project",
		firstOwnerId: "session-1",
		secondOwnerId: "session-2",
		ownersDistinct: true,
		seededName: "C7 seeded project",
		editedName: "C7 headless edit",
		reopenedName: "C7 headless edit",
		seededUpdatedAt: "2026-08-05T01:00:00.000Z",
		editedUpdatedAt: "2026-08-05T02:00:00.000Z",
		reopenedUpdatedAt: "2026-08-05T02:00:00.000Z",
		seededProjectDigest: DIGEST_A,
		firstLoadDigest: DIGEST_A,
		savedProjectDigest: DIGEST_B,
		reopenedProjectDigest: DIGEST_B,
		reopenedLoadDigest: DIGEST_B,
		seededOpaqueDigest: DIGEST_A,
		reopenedOpaqueDigest: DIGEST_A,
		opaquePreserved: true,
		attachmentKey: "provider-attachment.bin",
		attachmentSchemaVersion: 7,
		seededAttachmentDigest: DIGEST_A,
		reopenedAttachmentDigest: DIGEST_A,
		seededAttachmentMetadataDigest: DIGEST_B,
		reopenedAttachmentMetadataDigest: DIGEST_B,
		attachmentPreserved: true,
		durableProjectPresent: true,
		durableAttachmentPresent: true,
		firstDisposal: "fulfilled",
		secondDisposal: "fulfilled",
		postDisposeWriteRejected: true,
		postDisposeStoreUntouched: true,
		reactMountAttempts: runtimeProbe.react.mountAttempts,
		navigationAttempts: 0,
		runtimeResourceCounts: {
			timers:
				runtimeProbe.globalCalls.timeouts + runtimeProbe.globalCalls.intervals,
			animationFrames: runtimeProbe.globalCalls.animationFrames,
			workers:
				runtimeProbe.globalCalls.workers + runtimeProbe.hostCalls.workers,
			audioContexts:
				runtimeProbe.globalCalls.audioContexts +
				runtimeProbe.hostCalls.audioContexts,
			objectUrls:
				runtimeProbe.globalCalls.objectUrls + runtimeProbe.hostCalls.objectUrls,
			compositorGpuOwners: runtimeProbe.compositorGpu.ownershipAttempts,
		},
		runtimeProbe,
		errors: [],
	};
}

function validReport(host = "vite") {
	const vite = host === "vite";
	return {
		schemaVersion: 1,
		host,
		status: "passed",
		marker: `c7-${host}-clean`,
		acceptedBase: {
			head: "a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf",
			tree: "885d307814260b77397c2c2677b9361fdfc5f5e2",
		},
		entry: `${host}/headless-entry.ts`,
		output: `${host}/output`,
		base: `/c7-${host}`,
		errors: [],
		graph: {
			path: `${host}/graph.json`,
			sha256: vite ? DIGEST_A : DIGEST_B,
			buildId: `${host}:build`,
			moduleCount: 12,
		},
		runtime: { semantic: validResult(host), proofControl: "neutral" },
		processes: {
			server: { pid: vite ? 1001 : 2001, port: vite ? 4101 : 4201 },
			browser: vite ? { pid: 1002, port: 4102 } : { pid: null, port: null },
		},
		cleanup: {
			server: { stopped: true },
			browser: { stopped: true },
			serverPortReleased: true,
			browserPortReleased: true,
			browserProfileRemoved: true,
		},
	};
}

describe("C7 headless semantic result evaluator", () => {
	test("rejects literal runtime claims without pre-load probe provenance", () => {
		const result = validResult();
		delete result.runtimeProbe;
		expect(() =>
			validateHeadlessSemanticResult(result, {
				host: "vite",
				buildMarker: result.buildMarker,
				acceptedHead: result.acceptedHead,
				acceptedTree: result.acceptedTree,
				entry: result.entry,
			}),
		).toThrow(/runtime probe|probe provenance/i);
	});

	test("accepts a complete actual edit and reopen", () => {
		const result = validResult();
		expect(
			validateHeadlessSemanticResult(result, {
				host: "vite",
				buildMarker: "c7-vite-clean",
				acceptedHead: result.acceptedHead,
				acceptedTree: result.acceptedTree,
				entry: result.entry,
			}),
		).toEqual({ host: "vite", projectId: "c7-headless-project" });
	});

	for (const [label, mutate, diagnostic] of [
		[
			"no-edit",
			(value) => (value.editedName = value.seededName),
			"actual edit",
		],
		[
			"no-second-owner",
			(value) => (value.ownersDistinct = false),
			"distinct second owner",
		],
		[
			"wrong-store",
			(value) => (value.storeIdentity = "BrowserProjectStore"),
			"in-memory store",
		],
		[
			"fallback-store",
			(value) => {
				value.hostFallback = true;
				value.runtimeProbe.hostBinding.sameStoreInstance = false;
				value.runtimeProbe.hostBinding.fallbackUsed = true;
			},
			"fallback",
		],
		[
			"fabricated probe order",
			(value) => (value.runtimeProbe.events[1].sequence = 1),
			"install before subject loading",
		],
		[
			"missing RAF observation",
			(value) => delete value.runtimeProbe.globalCalls.animationFrames,
			"animationFrames",
		],
		[
			"missing React strategy",
			(value) => delete value.runtimeProbe.react.strategy,
			"React mount probe strategy",
		],
		["missing-digest", (value) => (value.reopenedProjectDigest = ""), "digest"],
		[
			"post-dispose-write",
			(value) => (value.postDisposeWriteRejected = false),
			"post-dispose write",
		],
		[
			"unhandled-error",
			(value) => value.errors.push("boom"),
			"unhandled errors",
		],
	]) {
		test(`rejects ${label}`, () => {
			const result = structuredClone(validResult());
			mutate(result);
			expect(() =>
				validateHeadlessSemanticResult(result, {
					host: "vite",
					buildMarker: result.buildMarker,
					acceptedHead: result.acceptedHead,
					acceptedTree: result.acceptedTree,
					entry: result.entry,
				}),
			).toThrow(diagnostic);
		});
	}

	for (const field of [
		"timeouts",
		"intervals",
		"animationFrames",
		"workers",
		"audioContexts",
		"audioContextConstructions",
		"webkitAudioContextConstructions",
		"objectUrls",
		"webGpuAdapterRequests",
		"wasmInstantiations",
		"wasmInstantiateCalls",
		"wasmInstantiateStreamingCalls",
	]) {
		test(`rejects a fabricated clean global ${field} value`, () => {
			const result = validResult();
			result.runtimeProbe.globalCalls[field] = 1;
			expect(() =>
				validateHeadlessSemanticResult(result, {
					host: result.host,
					buildMarker: result.buildMarker,
					acceptedHead: result.acceptedHead,
					acceptedTree: result.acceptedTree,
					entry: result.entry,
				}),
			).toThrow(new RegExp(`globalCalls\\.${field}`));
		});
	}

	for (const field of [
		"workers",
		"audioContexts",
		"objectUrls",
		"graphicsQueries",
	]) {
		test(`rejects a fabricated clean Host ${field} value`, () => {
			const result = validResult();
			result.runtimeProbe.hostCalls[field] = 1;
			expect(() =>
				validateHeadlessSemanticResult(result, {
					host: result.host,
					buildMarker: result.buildMarker,
					acceptedHead: result.acceptedHead,
					acceptedTree: result.acceptedTree,
					entry: result.entry,
				}),
			).toThrow(new RegExp(`hostCalls\\.${field}`));
		});
	}

	for (const field of [
		"mutationRecords",
		"rootMarkersBefore",
		"rootMarkersAfter",
		"mountAttempts",
	]) {
		test(`rejects a fabricated clean React ${field} value`, () => {
			const result = validResult();
			result.runtimeProbe.react[field] = 1;
			expect(() =>
				validateHeadlessSemanticResult(result, {
					host: result.host,
					buildMarker: result.buildMarker,
					acceptedHead: result.acceptedHead,
					acceptedTree: result.acceptedTree,
					entry: result.entry,
				}),
			).toThrow(new RegExp(`react\\.${field}`));
		});
	}

	for (const field of [
		"hostGraphicsQueries",
		"webGpuAdapterRequests",
		"wasmInstantiations",
		"ownershipAttempts",
	]) {
		test(`rejects a fabricated clean compositor/GPU ${field} value`, () => {
			const result = validResult();
			result.runtimeProbe.compositorGpu[field] = 1;
			expect(() =>
				validateHeadlessSemanticResult(result, {
					host: result.host,
					buildMarker: result.buildMarker,
					acceptedHead: result.acceptedHead,
					acceptedTree: result.acceptedTree,
					entry: result.entry,
				}),
			).toThrow(new RegExp(`compositorGpu\\.${field}`));
		});
	}

	for (const [label, mutate] of [
		[
			"global strategy",
			(probe) => (probe.hookProvenance.global.strategy = "bad"),
		],
		["global order", (probe) => probe.hookProvenance.global.hooks.reverse()],
		["Host strategy", (probe) => (probe.hookProvenance.host.strategy = "bad")],
		["Host order", (probe) => probe.hookProvenance.host.hooks.reverse()],
		[
			"React strategy",
			(probe) => (probe.hookProvenance.react.strategy = "bad"),
		],
		["React order", (probe) => probe.hookProvenance.react.hooks.reverse()],
		[
			"compositor strategy",
			(probe) => (probe.hookProvenance.compositorGpu.strategy = "bad"),
		],
		[
			"compositor order",
			(probe) => probe.hookProvenance.compositorGpu.fields.reverse(),
		],
	]) {
		test(`rejects bad ${label} provenance`, () => {
			const result = validResult();
			mutate(result.runtimeProbe);
			expect(() =>
				validateHeadlessSemanticResult(result, {
					host: result.host,
					buildMarker: result.buildMarker,
					acceptedHead: result.acceptedHead,
					acceptedTree: result.acceptedTree,
					entry: result.entry,
				}),
			).toThrow(/provenance.*(strategy|field order)/i);
		});
	}

	for (const host of ["vite", "next"]) {
		test(`accepts a genuine ${host} runtime sensitivity control`, () => {
			const result = validResult(host, "sensitivity");
			expect(
				validateHeadlessRuntimeSensitivityResult(result, {
					host,
					buildMarker: result.buildMarker,
					acceptedHead: result.acceptedHead,
					acceptedTree: result.acceptedTree,
					entry: result.entry,
				}),
			).toEqual({ host, projectId: "c7-headless-project" });
		});
	}

	test("rejects an installed sensitivity hook that was not exercised", () => {
		const result = validResult("vite", "sensitivity");
		result.runtimeProbe.globalCalls.intervals = 0;
		result.runtimeResourceCounts.timers = 1;
		expect(() =>
			validateHeadlessRuntimeSensitivityResult(result, {
				host: result.host,
				buildMarker: result.buildMarker,
				acceptedHead: result.acceptedHead,
				acceptedTree: result.acceptedTree,
				entry: result.entry,
			}),
		).toThrow(/globalThis\.setInterval/);
	});

	test("rejects fabricated browser React sensitivity", () => {
		const result = validResult("vite", "sensitivity");
		result.reactMountAttempts = 99;
		expect(() =>
			validateHeadlessRuntimeSensitivityResult(result, {
				host: result.host,
				buildMarker: result.buildMarker,
				acceptedHead: result.acceptedHead,
				acceptedTree: result.acceptedTree,
				entry: result.entry,
			}),
		).toThrow(/React mount summary/i);
	});

	test("rejects a copied Host result", () => {
		const vite = validResult("vite");
		const copied = { ...vite, host: "next" };
		expect(() =>
			validateIndependentHeadlessResults({ vite, next: copied }),
		).toThrow(/copied|independent|runtime probe.*Host|probe identity/i);
	});

	test("accepts independently attributed Vite and Next results", () => {
		const vite = validResult("vite");
		const next = validResult("next");
		expect(validateIndependentHeadlessResults({ vite, next })).toEqual({
			projectId: "c7-headless-project",
			editedName: "C7 headless edit",
		});
	});

	test("accepts independent owned Host reports", () => {
		expect(
			validateIndependentHeadlessHostReports({
				vite: validReport("vite"),
				next: validReport("next"),
			}),
		).toEqual({
			projectId: "c7-headless-project",
			editedName: "C7 headless edit",
			viteGraph: DIGEST_A,
			nextGraph: DIGEST_B,
		});
	});

	test("rejects incomplete owned cleanup", () => {
		const vite = validReport("vite");
		vite.cleanup.serverPortReleased = false;
		expect(() =>
			validateIndependentHeadlessHostReports({
				vite,
				next: validReport("next"),
			}),
		).toThrow(/cleanup/i);
	});

	test("rejects copied graph evidence", () => {
		const vite = validReport("vite");
		const next = validReport("next");
		next.graph = structuredClone(vite.graph);
		expect(() =>
			validateIndependentHeadlessHostReports({ vite, next }),
		).toThrow(/graph evidence.*copied/i);
	});
});
