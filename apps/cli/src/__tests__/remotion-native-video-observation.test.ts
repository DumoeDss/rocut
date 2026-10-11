import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { REMOTION_NATIVE_VIDEO_PATCH_SOURCE } from "../programmatic/engines/remotion-native-video-patch";
import { REMOTION_NATIVE_VIDEO_OBSERVATION_SOURCE } from "../programmatic/remotion-native-video-observation";

// CPU-only: never install dependencies or start a browser. Reuse the existing
// native commit seam's opt-in private pinned toolchain.
const toolchain = process.env.ROCUT_TEST_REMOTION_COMMIT_TOOLCHAIN;
const patch = runInNewContext(
	REMOTION_NATIVE_VIDEO_PATCH_SOURCE + "\nrocutPatchNativeVideoObservation",
) as (native: string) => string;

function nativeSource() {
	if (!toolchain) throw Error("Missing private pinned CPU toolchain");
	const pinnedRequire = createRequire(join(toolchain, "package.json"));
	expect(pinnedRequire("remotion/package.json").version).toBe("4.0.440");
	return new TextDecoder("utf-8", { fatal: true }).decode(
		readFileSync(join(toolchain, "node_modules/remotion/dist/esm/index.mjs")),
	);
}

function seekRuntime(source: string, fault: string) {
	const commands: unknown[] = [];
	const reads = { currentTime: 0, expectedDisplayTime: 0, mediaTime: 0 };
	let callback: ((now: number, metadata: object) => void) | undefined;
	const element = {
		get currentTime() {
			reads.currentTime++;
			if (fault === "currentTime") throw Error("first currentTime fault");
			return 0;
		},
		addEventListener(kind: string) {
			commands.push(["listen", kind]);
		},
		removeEventListener(kind: string) {
			commands.push(["unlisten", kind]);
		},
		requestVideoFrameCallback(value: typeof callback) {
			commands.push(["rvfc-register"]);
			callback = value;
			return 1;
		},
		cancelVideoFrameCallback(id: number) {
			commands.push(["rvfc-cancel", id]);
		},
	};
	const context = {
		window: {},
		readinessDiagnostic: { frameIndex: 5 },
		document: { querySelectorAll: () => [element] },
		isApproximatelyTheSame: (a: number, b: number) => Math.abs(a - b) < 0.00001,
		seek: ({ time }: { time: number }) => commands.push(["seek", time]),
		setTimeout: () => {
			throw Error("No timer expected for immediate display");
		},
	};
	const start = source.indexOf("var roundTo6Commas = ");
	const end = source.indexOf("// src/video/VideoForRendering.tsx", start);
	const bridge = source.indexOf("function rocutObserveNativeVideo(");
	if (bridge >= 0)
		runInNewContext(REMOTION_NATIVE_VIDEO_OBSERVATION_SOURCE, context);
	expect(start).toBeGreaterThan(0);
	expect(end).toBeGreaterThan(start);
	const seekToTime = runInNewContext(
		(bridge < 0 ? "" : source.slice(bridge, start)) +
			source.slice(start, end) +
			"\nseekToTime",
		context,
	) as (options: object) => unknown;
	let error: string | null = null;
	try {
		seekToTime({ element, desiredTime: 0.25, logLevel: "error", mount: false });
		if (callback)
			callback(100, {
				get expectedDisplayTime() {
					reads.expectedDisplayTime++;
					if (fault === "expectedDisplayTime")
						throw Error("first expectedDisplayTime fault");
					return 99;
				},
				get mediaTime() {
					reads.mediaTime++;
					if (fault === "mediaTime") throw Error("first mediaTime fault");
					return 0.25;
				},
			});
	} catch (caught) {
		error = (caught as Error).message;
	}
	return { commands, reads, error };
}

(toolchain ? test : test.skip)(
	"pinned native observer rejects exact seam drift",
	() => {
		const native = nativeSource();
		expect(patch(native)).not.toBe(native);
		expect(() =>
			patch(native.replace("var roundTo6Commas = ", "var changedRound = ")),
		).toThrow();
		expect(() =>
			patch(
				native.replace(
					"      const displayIn = metadata.expectedDisplayTime - now;",
					"      const displayIn = 0;",
				),
			),
		).toThrow();
		expect(() =>
			patch(native + "\nvar VideoForRendering = duplicate;"),
		).toThrow();
	},
);

for (const fault of ["currentTime", "expectedDisplayTime", "mediaTime"])
	(toolchain ? test : test.skip)(
		`native observer preserves first ${fault} getter fault and original read counts`,
		() => {
			const original = nativeSource();
			const before = seekRuntime(original, fault),
				after = seekRuntime(patch(original), fault);
			expect(after).toEqual(before);
			expect(before.error).toBe(`first ${fault} fault`);
			expect(before.reads[fault as keyof typeof before.reads]).toBe(1);
		},
	);

test("native observer bounds immutable trace and never reads metadata/source getters or emits URLs", () => {
	let forbiddenReads = 0;
	const element = {};
	for (const key of ["src", "currentSrc", "currentTime", "readyState"])
		Object.defineProperty(element, key, {
			get() {
				forbiddenReads++;
				throw Error("Forbidden getter");
			},
		});
	const metadata = {};
	for (const key of ["presentationTime", "presentedFrames"])
		Object.defineProperty(metadata, key, {
			get() {
				forbiddenReads++;
				throw Error("Forbidden getter");
			},
		});
	const context = {
		window: {},
		readinessDiagnostic: { frameIndex: 5 },
		document: { querySelectorAll: () => [element] },
		element,
		metadata,
	};
	runInNewContext(REMOTION_NATIVE_VIDEO_OBSERVATION_SOURCE, context);
	const result = runInNewContext(
		`
		const observe = window.__rocutRemotionNativeVideoObserve;
		for(let i=0;i<140;i++) observe('seek-request',element,{target:i,src:'https://secret.invalid/'},metadata);
		observe('settle-done');
		observe('html-ready-before-message');
		({json:JSON.stringify(readinessDiagnostic.nativeVideo),
		  frozen:Object.isFrozen(readinessDiagnostic.nativeVideo) &&
		    Object.isFrozen(readinessDiagnostic.nativeVideo.events) &&
		    readinessDiagnostic.nativeVideo.events.every(Object.isFrozen)})
	`,
		context,
	) as { json: string; frozen: boolean };
	const trace = JSON.parse(result.json);
	expect(trace.events.length).toBe(128);
	expect(trace.dropped).toBe(14);
	expect(trace.sequence).toBe(142);
	expect(result.frozen).toBe(true);
	expect(forbiddenReads).toBe(0);
	expect(result.json).not.toContain("https://");
	expect(result.json).not.toContain("secret.invalid");
	expect(trace.events.at(-1).kind).toBe("html-ready-before-message");
});
