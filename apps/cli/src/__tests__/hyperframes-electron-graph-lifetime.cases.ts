import { beforeEach, expect, mock, test } from "bun:test";
import type {
	ProgrammaticFrameRequest,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import { createInMemoryProjectStoreFixture } from "@opencut/editor-ports/in-memory";
import type { ProgrammaticResourceStore } from "../programmatic/resources";

// Isolated orchestration test: Rust and semantic Electron sessions are doubles.
// No browser, authored script execution, native DSP or admission is claimed.
const mapped = (time: number) => ({
	index: Math.floor(time * 25),
	time,
	sourceTime: time * 120000,
	timelineTime: time * 120000,
});
const mappings: unknown[] = [];
mock.module("opencut-wasm", () => ({
	validateProgrammaticResourcesJson: () => "[]",
	programmaticAudioPolicyJson: () =>
		JSON.stringify({
			mimeTypes: ["audio/wav"],
			maxSources: 4,
			maxSourceBytes: 64,
			maxTotalBytes: 128,
		}),
	resolveProgrammaticFrameJson: (text: string) => {
		const value = JSON.parse(text);
		return JSON.stringify({ frame: mapped(value.timelineTime / 120000) });
	},
	resolveHyperframesAudioFrameJson: () => JSON.stringify({ assets: [] }),
	resolveHyperframesAudioSeekJson: (text: string) => {
		const value = JSON.parse(text);
		mappings.push(value);
		if (value.nativeHistoryScan)
			return JSON.stringify({
				nativeHistoryScan: {
					profile: "hyperframes-native-sync-all-author-writes-v1",
					canonicalStart: 0,
					canonicalEnd: 0.12,
					times: [0, 0.04, 0.08],
					frames: [mapped(0), mapped(0.04), mapped(0.08)],
				},
			});
		if (value.seek.time < 0 || !value.seek.instanceIds.includes("instance"))
			return JSON.stringify({ error: "Rejected native seek" });
		return JSON.stringify({ frame: mapped(value.seek.time) });
	},
}));
mock.module("../programmatic/html-document", () => ({
	htmlAudioAnalysisExpression: (
		code: string,
		frame: unknown,
		resources: unknown,
		analysis: unknown,
	) => JSON.stringify({ code, frame, resources, analysis }),
}));
let opened = 0,
	closed = 0,
	mode: "success" | "pending" | "failure" = "success",
	closeFailure = false;
const originalFailure = Error("original source evaluation failed");
const expressions: {
	frame: { time: number };
	analysis: {
		hyperframesGraph: boolean;
		hyperframesNativeHistory?: {
			scan: { frames: unknown[] };
			observationTimes: number[];
		};
	};
}[] = [];
const sessions: AbortSignal[] = [];
const rawSignals: AbortSignal[] = [];
let rawReleased = 0;
mock.module("../programmatic/electron-audio-transport", () => ({
	pinElectronAudioConnection: () => ({}),
	analyzeElectronAudio: async ({ signal }: { signal: AbortSignal }) => {
		signal.throwIfAborted();
		rawSignals.push(signal);
		try {
			if (mode === "failure") throw originalFailure;
			if (mode === "pending")
				await new Promise((_, reject) =>
					signal.addEventListener(
						"abort",
						() => reject(Error("transport cancelled")),
						{ once: true },
					),
				);
			return [];
		} finally {
			rawReleased++;
		}
	},
}));
mock.module("../programmatic/electron-audio-session", () => ({
	pinElectronAudioSessionConnection: () => ({
		endpoint: "private fixture",
		token: "not a real credential",
	}),
	openElectronAudioSession: async ({
		signal,
		profile,
	}: {
		signal: AbortSignal;
		profile: string;
	}) => {
		signal.throwIfAborted();
		expect(profile).toBe("source");
		opened++;
		sessions.push(signal);
		return {
			epoch: "fixture",
			browser: {},
			async evaluate(expression: string, { timeoutMs }: { timeoutMs: number }) {
				expect(timeoutMs).toBeGreaterThan(0);
				expect(timeoutMs).toBeLessThanOrEqual(1800000);
				const value = JSON.parse(expression);
				expressions.push(value);
				if (mode === "failure") throw originalFailure;
				if (mode === "pending")
					return new Promise((_, reject) =>
						signal.addEventListener(
							"abort",
							() => reject(Error("transport cancelled")),
							{ once: true },
						),
					);
				return value.analysis.hyperframesNativeHistory
					? {
							observations:
								value.analysis.hyperframesNativeHistory.observationTimes.map(
									(time: number) => ({ time }),
								),
							fallbackHistories: [{ writes: "fixture" }],
						}
					: { time: value.frame.time };
			},
			async close() {
				closed++;
				if (closeFailure) throw Error("cleanup transport failed");
			},
		};
	},
}));
mock.module("../programmatic/chromium-process", () => ({
	launchFrameBrowser: () => {
		throw Error("Electron must not launch Chromium");
	},
}));
const { withHyperframesAudioGraphAnalyzer, withHyperframesAudioAnalyzer } =
	await import("../programmatic/hyperframes-audio-analysis");
const input = {
	id: "index.html",
	kind: "source" as const,
	mimeType: "application/octet-stream",
	byteLength: 1,
	sha256: "a".repeat(64),
	attachmentKey: "programmatic-source-sha256-" + "a".repeat(64),
};
const source: ProgrammaticSource = {
	version: 1,
	runtime: "html-document",
	code: "<!doctype html>",
	width: 64,
	height: 64,
	frameRate: { numerator: 25, denominator: 1 },
	durationFrames: 3,
	seed: 7,
	build: {
		version: 1,
		engine: "hyperframes",
		engineVersion: "0.8.139",
		entryFile: "index.html",
		inputs: [input],
		toolchainLock: { ...input, id: "_rocut/toolchain-lock.json" },
	},
};
const request: ProgrammaticFrameRequest = {
	source,
	clipStart: 0,
	clipDuration: 14400,
	trimStart: 0,
	timelineTime: 0,
};
const resourceStore: ProgrammaticResourceStore = {
	store: createInMemoryProjectStoreFixture().store,
	projectId: "fixture",
};
const options = (signal = new AbortController().signal) => ({
	connectionFile: "fixture",
	request,
	resourceStore,
	signal,
});
const graph = { version: 1 },
	seek = { time: 0.102, instanceIds: ["instance"] };
beforeEach(() => {
	opened = closed = 0;
	mode = "success";
	closeFailure = false;
	expressions.length = sessions.length = mappings.length = 0;
	rawSignals.length = 0;
	rawReleased = 0;
});

test("escaped public Electron frame-only analyzers cannot issue native requests", async () => {
	let escaped:
		| Parameters<Parameters<typeof withHyperframesAudioAnalyzer>[1]>[0]
		| undefined;
	await withHyperframesAudioAnalyzer(options(), async (analyzer) => {
		escaped = analyzer;
	});
	await expect(escaped!.frame(request)).rejects.toThrow("analyzer closed");
	expect(rawSignals).toHaveLength(0);
});

test("frame-only callback return cancels and drains an unawaited native request", async () => {
	mode = "pending";
	let pending: Promise<unknown> | undefined;
	await withHyperframesAudioAnalyzer(options(), async (analyzer) => {
		pending = analyzer.frame(request);
		void pending.catch(() => {});
	});
	await expect(pending!).rejects.toThrow("analyzer closed");
	expect(rawSignals).toHaveLength(1);
	expect(rawSignals[0].aborted).toBe(true);
	expect(rawReleased).toBe(1);
});

test("frame-only caller cancellation and source failure retain exact reasons", async () => {
	mode = "failure";
	await expect(
		withHyperframesAudioAnalyzer(options(), (analyzer) =>
			analyzer.frame(request),
		),
	).rejects.toBe(originalFailure);
	mode = "pending";
	const controller = new AbortController(),
		reason = Error("exact raw caller cancellation");
	await withHyperframesAudioAnalyzer(
		options(controller.signal),
		async (analyzer) => {
			const pending = analyzer.frame(request);
			controller.abort(reason);
			await expect(pending).rejects.toBe(reason);
		},
	);
	expect(rawReleased).toBe(2);
});

test("public Electron graph history and fractional seek use Rust frames and fresh source realms", async () => {
	await withHyperframesAudioGraphAnalyzer(options(), async (analyzer) => {
		expect(await analyzer.seek(graph, seek)).toEqual({
			time: 0.102,
			snapshot: { time: 0.102 },
		});
		expect(await analyzer.history(graph, [{ ...seek, time: 0.04 }])).toEqual({
			observations: [{ time: 0.04 }],
			fallbackHistories: [{ writes: "fixture" }],
		});
		expect(expressions[0].frame.time).toBe(0.102);
		expect(
			expressions[1].analysis.hyperframesNativeHistory!.scan.frames,
		).toEqual([mapped(0), mapped(0.04), mapped(0.08)]);
		expect(expressions.every((value) => value.analysis.hyperframesGraph)).toBe(
			true,
		);
		expect(mappings).toContainEqual(expect.objectContaining({ seek }));
	});
	expect(opened).toBe(2);
	expect(closed).toBe(2);
});

test("escaped Electron graph analyzers cannot allocate after callback ownership ends", async () => {
	let escaped:
		| Parameters<Parameters<typeof withHyperframesAudioGraphAnalyzer>[1]>[0]
		| undefined;
	await withHyperframesAudioGraphAnalyzer(options(), async (analyzer) => {
		escaped = analyzer;
	});
	await expect(escaped!.seek(graph, seek)).rejects.toThrow("analyzer closed");
	expect(opened).toBe(0);
});

test("callback return drains an unawaited in-flight source session", async () => {
	mode = "pending";
	let pending: Promise<unknown> | undefined;
	await withHyperframesAudioGraphAnalyzer(options(), async (analyzer) => {
		pending = analyzer.seek(graph, seek);
		await Promise.resolve();
	});
	await expect(pending!).rejects.toThrow("analyzer closed");
	expect(opened).toBe(1);
	expect(closed).toBe(1);
	expect(sessions[0].aborted).toBe(true);
});

test("original source error is not replaced by close failure", async () => {
	mode = "failure";
	closeFailure = true;
	await expect(
		withHyperframesAudioGraphAnalyzer(options(), (analyzer) =>
			analyzer.seek(graph, seek),
		),
	).rejects.toBe(originalFailure);
	expect(closed).toBe(1);
});

test("a close failure after a successful observation is still an ordinary failure", async () => {
	closeFailure = true;
	await expect(
		withHyperframesAudioGraphAnalyzer(options(), (analyzer) =>
			analyzer.seek(graph, seek),
		),
	).rejects.toThrow("cleanup transport failed");
	expect(opened).toBe(1);
	expect(closed).toBe(1);
});

test("in-flight abort preserves caller reason and releases source session", async () => {
	mode = "pending";
	closeFailure = true;
	const controller = new AbortController(),
		reason = Error("exact caller cancellation");
	await withHyperframesAudioGraphAnalyzer(
		options(controller.signal),
		async (analyzer) => {
			const pending = analyzer.seek(graph, seek);
			await Promise.resolve();
			controller.abort(reason);
			await expect(pending).rejects.toBe(reason);
		},
	);
	expect(closed).toBe(1);
});

test("mixed graph operations remain serial and bad Rust seeks allocate no session", async () => {
	mode = "pending";
	const controller = new AbortController();
	await withHyperframesAudioGraphAnalyzer(
		options(controller.signal),
		async (analyzer) => {
			await expect(analyzer.seek(graph, { ...seek, time: -1 })).rejects.toThrow(
				"Rejected native seek",
			);
			expect(opened).toBe(0);
			const pending = analyzer.seek(graph, seek);
			await Promise.resolve();
			await expect(analyzer.frame(request)).rejects.toThrow("serially");
			controller.abort();
			await expect(pending).rejects.toBeDefined();
		},
	);
	expect(opened).toBe(1);
	expect(closed).toBe(1);
});
