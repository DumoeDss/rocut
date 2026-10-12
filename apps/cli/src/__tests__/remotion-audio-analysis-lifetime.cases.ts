import { beforeEach, expect, mock, test } from "bun:test";
import type {
	ProgrammaticFrameRequest,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import { createInMemoryProjectStoreFixture } from "@opencut/editor-ports/in-memory";
import type { NativeAudioAnalysisConfig } from "../programmatic/remotion-audio-bootstrap";

// Orchestration doubles only: the real analyzer and produced helper are exercised,
// not authored React execution, native decode, admission or browser/GPU behavior.
const sourceError = Error("original source failure");
const cleanupError = Error("first cleanup failure");
let mode: "success" | "pending" | "failure" = "success";
let failCleanup = false;
let pendingLaunch = false;
let requestCount = 0;
const releases: string[] = [];
const signals: AbortSignal[] = [];
const producedResult = () => ({
	version: 1,
	profile: scan.profile,
	frames: [{ frameIndex: 0, assets: [], produced: [] }],
});
const observe = async (signal: AbortSignal, produced: boolean) => {
	signal.throwIfAborted();
	requestCount++;
	if (mode === "failure") throw sourceError;
	if (mode === "pending")
		await new Promise((_, reject) => {
			signal.addEventListener(
				"abort",
				() => reject(Error("transport cancelled")),
				{ once: true },
			);
		});
	return produced ? producedResult() : [];
};
const release = async (owner: string) => {
	releases.push(owner);
	if (failCleanup) throw cleanupError;
};
mock.module("opencut-wasm", () => ({
	validateProgrammaticResourcesJson: () => "[]",
	resolveProgrammaticFrameJson: () =>
		JSON.stringify({
			frame: {
				index: 0,
				time: 0,
				videoLimits: { maxBytes: 64, maxDimension: 64, maxElements: 1 },
			},
		}),
	programmaticAudioPolicyJson: () =>
		JSON.stringify({
			version: 1,
			mimeTypes: ["video/mp4"],
			maxSources: 4,
			maxSourceBytes: 64,
			maxTotalBytes: 128,
			maxSeconds: 10,
			maxAssetsPerFrame: 4,
			maxObservationBytes: 4096,
		}),
	resolveRemotionAudioFrameJson: () => JSON.stringify({ assets: [] }),
}));
mock.module("../programmatic/html-document", () => ({
	htmlAudioAnalysisExpression: (
		_code: string,
		_frame: unknown,
		_resources: unknown,
		analysis: unknown,
	) => JSON.stringify(analysis),
}));
mock.module("../programmatic/electron-audio-transport", () => ({
	pinElectronAudioConnection: () => ({}),
	analyzeElectronAudio: ({ signal }: { signal: AbortSignal }) =>
		observe(signal, false),
}));
mock.module("../programmatic/electron-native-video-server", () => ({
	createElectronNativeVideoServer: async ({
		signal,
	}: {
		signal: AbortSignal;
	}) => {
		signals.push(signal);
		return {
			callback: {},
			check: async () => {},
			dispose: () => release("native-video"),
		};
	},
}));
mock.module("../programmatic/electron-remotion-produced-server", () => ({
	createElectronRemotionProducedServer: async ({
		signal,
	}: {
		signal: AbortSignal;
	}) => {
		signals.push(signal);
		return {
			callback: {},
			check: async () => {},
			take: () => new Map(),
			dispose: () => release("native-capture"),
		};
	},
}));
mock.module("../programmatic/electron-audio-session", () => ({
	openElectronAudioSession: async ({ signal }: { signal: AbortSignal }) => ({
		evaluate: () => observe(signal, true),
		close: () => release("session"),
	}),
}));
mock.module("../programmatic/remotion-produced-capture-broker", () => ({
	attachRemotionProducedCaptureBroker: async () => ({
		check: async () => {},
		take: () => new Map(),
		dispose: () => release("capture"),
	}),
}));
mock.module("../programmatic/offthread-broker", () => ({
	attachOffthreadBroker: async () => ({
		check: async () => {},
		dispose: () => release("video"),
	}),
}));
mock.module("../programmatic/chromium-process", () => ({
	launchFrameBrowser: async (_executable: string, signal: AbortSignal) => {
		signals.push(signal);
		if (pendingLaunch)
			await new Promise((_, reject) => {
				signal.addEventListener(
					"abort",
					() => reject(Error("launch cancelled")),
					{ once: true },
				);
			});
		let closed = false;
		return {
			close: () => {
				closed = true;
				return release("browser");
			},
			async send(method: string, params: Record<string, unknown> = {}) {
				if (closed) throw Error("browser closed");
				signal.throwIfAborted();
				if (method === "Target.createTarget") return { targetId: "target" };
				if (method === "Target.attachToTarget") return { sessionId: "session" };
				if (method === "Target.closeTarget") {
					await release("target");
					return {};
				}
				if (method === "Runtime.evaluate") {
					const analysis = JSON.parse(String(params.expression));
					return {
						result: {
							value: await observe(signal, !!analysis.remotionProduced),
						},
					};
				}
				return {};
			},
		};
	},
}));
const { withRemotionAudioAnalyzer } =
	await import("../programmatic/remotion-audio-analysis");
const input = {
	id: "index.tsx",
	kind: "source" as const,
	mimeType: "application/octet-stream",
	byteLength: 1,
	sha256: "a".repeat(64),
	attachmentKey: "programmatic-source-sha256-" + "a".repeat(64),
};
const source: ProgrammaticSource = {
	version: 1,
	runtime: "html-document",
	code: "data:video/mp4;base64,AQ==",
	width: 64,
	height: 64,
	frameRate: { numerator: 25, denominator: 1 },
	durationFrames: 1,
	seed: 7,
	build: {
		version: 1,
		engine: "remotion",
		engineVersion: "4.0.440",
		compositionId: "fixture",
		entryFile: "index.tsx",
		inputs: [input],
		toolchainLock: { ...input, id: "_rocut/toolchain-lock.json" },
	},
};
const request: ProgrammaticFrameRequest = {
	source,
	clipStart: 0,
	clipDuration: 4800,
	trimStart: 0,
	timelineTime: 0,
};
const scan: NonNullable<NativeAudioAnalysisConfig["remotionProduced"]> = {
	profile: "remotion-4.0.440-native-produced-frames-v1",
	canonicalStartFrame: 0,
	canonicalEndFrameExclusive: 1,
	nativeSampleRate: 48000,
	frames: [
		{
			index: 0,
			time: 0,
			videoLimits: { maxBytes: 64, maxDimension: 64, maxElements: 1 },
		},
	],
};
const options = (
	backend: "electron" | "browser",
	signal = new AbortController().signal,
) => ({
	...(backend === "electron"
		? { connectionFile: "fixture" }
		: { executable: "fixture" }),
	request,
	signal,
	decoder: {} as NonNullable<
		Parameters<typeof withRemotionAudioAnalyzer>[0]["decoder"]
	>,
	resourceStore: {
		store: createInMemoryProjectStoreFixture().store,
		projectId: "fixture",
	},
});
type Analyzer = Parameters<Parameters<typeof withRemotionAudioAnalyzer>[1]>[0];
const run = (analyzer: Analyzer, produced: boolean): Promise<unknown> =>
	produced ? analyzer.producedFrames(scan) : analyzer.frame(request);
beforeEach(() => {
	mode = "success";
	failCleanup = false;
	pendingLaunch = false;
	requestCount = 0;
	releases.length = signals.length = 0;
});

test("browser startup cancellation preserves the caller reason", async () => {
	pendingLaunch = true;
	const controller = new AbortController(),
		reason = Error("startup caller cancellation");
	const pending = withRemotionAudioAnalyzer(
		options("browser", controller.signal),
		async () => {},
	);
	while (signals.length === 0) await Promise.resolve();
	controller.abort(reason);
	await expect(pending).rejects.toBe(reason);
});
for (const backend of ["electron", "browser"] as const)
	for (const produced of [false, true]) {
		const label = `${backend} ${produced ? "producedFrames" : "frame"}`;
		test(`${label}: escaped analyzer cannot allocate requests`, async () => {
			let escaped: Analyzer | undefined;
			await withRemotionAudioAnalyzer(options(backend), async (analyzer) => {
				escaped = analyzer;
			});
			await expect(run(escaped!, produced)).rejects.toThrow("analyzer closed");
			expect(requestCount).toBe(0);
		});
		test(`${label}: unawaited work is cancelled and owners drained`, async () => {
			mode = "pending";
			let pending: Promise<unknown> | undefined;
			await withRemotionAudioAnalyzer(options(backend), async (analyzer) => {
				pending = run(analyzer, produced);
				void pending.catch(() => {});
				while (requestCount === 0) await Promise.resolve();
			});
			await expect(pending!).rejects.toThrow("analyzer closed");
			expect(requestCount).toBe(1);
			expect(signals.every((signal) => signal.aborted)).toBe(true);
			expect(releases).toContain(
				backend === "browser" ? "browser" : "native-video",
			);
			if (produced)
				expect(releases).toContain(
					backend === "browser" ? "capture" : "native-capture",
				);
		});
		test(`${label}: caller abort keeps exact reason despite cleanup failures`, async () => {
			mode = "pending";
			failCleanup = true;
			const controller = new AbortController(),
				reason = Error("exact caller reason");
			await expect(
				withRemotionAudioAnalyzer(
					options(backend, controller.signal),
					async (analyzer) => {
						const pending = run(analyzer, produced);
						while (requestCount === 0) await Promise.resolve();
						controller.abort(reason);
						return pending;
					},
				),
			).rejects.toBe(reason);
		});
		test(`${label}: source failure survives cleanup and every owner releases`, async () => {
			mode = "failure";
			failCleanup = true;
			await expect(
				withRemotionAudioAnalyzer(options(backend), (analyzer) =>
					run(analyzer, produced),
				),
			).rejects.toBe(sourceError);
			const expected =
				backend === "electron"
					? produced
						? ["session", "native-video", "native-capture"]
						: ["native-video"]
					: produced
						? ["capture", "video", "browser"]
						: ["target", "browser"];
			expect(releases).toEqual(expected);
		});
		test(`${label}: successful observation still reports cleanup failure`, async () => {
			failCleanup = true;
			await expect(
				withRemotionAudioAnalyzer(options(backend), (analyzer) =>
					run(analyzer, produced),
				),
			).rejects.toBe(cleanupError);
		});
	}

for (const backend of ["electron", "browser"] as const) {
	test(`${backend}: callback failure drains pending continuous realm and survives cleanup`, async () => {
		mode = "pending";
		failCleanup = true;
		const callbackError = Error("consumer failed");
		await expect(
			withRemotionAudioAnalyzer(options(backend), async (analyzer) => {
				void analyzer.producedFrames(scan).catch(() => {});
				while (requestCount === 0) await Promise.resolve();
				await expect(analyzer.frame(request)).rejects.toThrow("serially");
				throw callbackError;
			}),
		).rejects.toBe(callbackError);
		expect(releases).toContain(backend === "electron" ? "session" : "browser");
		expect(releases).toContain(
			backend === "electron" ? "native-capture" : "capture",
		);
	});
}
