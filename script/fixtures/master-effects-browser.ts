import { disposeCompositor, disposeGpu, initializeGpu } from "opencut-wasm";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { registerDefaultEffects } from "../../packages/editor-classic/src/effects/definitions";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { buildFrameDescriptor } from "../../packages/editor-classic/src/services/renderer/compositor/frame-descriptor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { resolveExportVideoPlan } from "../../packages/editor-classic/src/services/renderer/export-video-bitrate";
import { cancelPendingRenderFrames } from "../../packages/editor-classic/src/services/renderer/cancel-tree";
import {
	ordered,
	scene,
	temporal,
	ticks,
} from "./master-effects-browser-scene";
import {
	WIDTH,
	HEIGHT,
	FPS,
	FIRST_FRAME,
	FRAME_COUNT,
	baseColor,
	orderedColor,
	temporalColor,
} from "./master-effects-browser-oracle";

const scope = globalThis as typeof globalThis & {
	__masterEffects?: unknown;
	__masterProgress?: unknown;
};
const check = (ok: unknown, message: string) => {
	if (!ok) throw Error(message);
};
const samples = [
	[8, 8],
	[48, 32],
	[76, 52],
] as const;
function pixels(canvas: HTMLCanvasElement) {
	const copy = new OffscreenCanvas(WIDTH, HEIGHT),
		ctx = copy.getContext("2d")!;
	try {
		ctx.drawImage(canvas, 0, 0);
		return ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
	} finally {
		copy.width = copy.height = 1;
	}
}
const rgba = (image: Uint8ClampedArray, x: number, y: number) => [
	...image.slice((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4),
];
const identical = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
	a.every((value, i) => value === b[i]);
async function run() {
	registerDefaultEffects();
	await initializeGpu();
	const compositor = new WasmCompositor({
		trackGpuResource: ({ handle, label }) => ({
			handle,
			label,
			resourceId: `master:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources);
	const params = {
		width: WIDTH,
		height: HEIGHT,
		fps: { numerator: FPS, denominator: 1 },
		compositor,
		videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
	};
	const renderer = new CanvasRenderer(params);
	const checks: unknown[] = [];
	scope.__masterProgress = checks;
	const legacy = scene(),
		clear = scene([]),
		disabled = scene(ordered().map((e) => ({ ...e, enabled: false }))),
		master = scene(ordered()),
		preview = scene(ordered(), true),
		reverse = scene([...ordered()].reverse()),
		timed = scene(temporal()),
		timedPreview = scene(temporal(), true);
	const nodes = [
		legacy,
		clear,
		disabled,
		master,
		preview,
		reverse,
		timed,
		timedPreview,
	];
	const capture = (node: ReturnType<typeof scene>, frame: number) =>
		renderer.renderAndCapture({ node, time: ticks(frame), capture: pixels });
	const expect = (
		name: string,
		actual: Uint8ClampedArray,
		expected: (x: number, y: number) => number[],
	) => {
		const observations = samples.map(([x, y]) => {
			const value = rgba(actual, x, y),
				wanted = [...expected(x, y), 255];
			// Existing compositor native assert_pixel permits <=2 for chained
			// quantized RGBA targets; no threshold is tuned from probe output.
			check(
				value.every((v, i) => Math.abs(v - wanted[i]!) <= 2),
				`${name} ${x},${y}: ${value}; expected ${wanted}`,
			);
			return { x, y, actual: value, expected: wanted };
		});
		checks.push({ name, passed: true, observations });
	};
	try {
		for (const frame of [12, 0, 17, 12]) {
			const baseline = await capture(legacy, frame);
			expect(`legacy-known-mixture-frame-${frame}`, baseline, (x, y) =>
				baseColor(x, y, frame),
			);
			check(
				identical(baseline, await capture(clear, frame)),
				"Cleared master stack changed legacy pixels",
			);
			check(
				identical(baseline, await capture(disabled, frame)),
				"Disabled master stack changed legacy pixels",
			);
			checks.push({
				name: `disabled-and-cleared-byte-identity-frame-${frame}`,
				passed: true,
			});
			const result = await capture(master, frame);
			expect(
				`master-post-complete-picture-once-frame-${frame}`,
				result,
				(x, y) => orderedColor(baseColor(x, y, frame)),
			);
			check(
				identical(result, await capture(preview, frame)),
				"Preview/export master buildScene pixels differ",
			);
			checks.push({
				name: `preview-export-byte-identity-frame-${frame}`,
				passed: true,
			});
		}
		const reversed = await capture(reverse, 12);
		expect("reversed-stack-known-color", reversed, (x, y) =>
			orderedColor(baseColor(x, y, 12), true),
		);
		const normal = await capture(master, 12);
		check(
			!identical(normal, reversed),
			"Order control cannot distinguish reversed effects",
		);
		for (const [x, y] of samples) {
			const once = orderedColor(baseColor(x, y, 12));
			const twice = orderedColor(once);
			check(
				once.some((value, i) => Math.abs(value - twice[i]!) > 8),
				"Once-only oracle is not sensitive to duplicate post",
			);
		}
		checks.push({
			name: "independent-order-and-duplicate-post-negative-controls",
			passed: true,
		});
		const seen = new Map<number, Uint8ClampedArray>();
		for (const frame of [17, 12, 15, 13, 16, 14, 12]) {
			const result = await capture(timed, frame);
			expect(`scene-clock-grain-frame-${frame}`, result, (x, y) =>
				temporalColor(x, y, frame),
			);
			check(
				identical(result, await capture(timedPreview, frame)),
				"Time-dependent preview/export mismatch",
			);
			if (seen.has(frame))
				check(
					identical(result, seen.get(frame)!),
					"Reverse seek changed deterministic master pixels",
				);
			seen.set(frame, result);
			const { frame: descriptor } = await buildFrameDescriptor({
				node: timedPreview,
				renderer,
			});
			const last = descriptor.items.at(-1);
			check(
				last?.type === "sceneEffect" &&
					last.effectPassGroups[0]?.[0]?.uniforms.frame === frame,
				"Master clock must use scene frame, not clip source or range-local frame",
			);
		}
		const sceneExpected = temporalColor(48, 32, FIRST_FRAME);
		for (const wrongClock of [0, FIRST_FRAME - 5 + 7]) {
			const wrong = temporalColor(48, 32, FIRST_FRAME, wrongClock);
			check(
				sceneExpected.some((value, i) => Math.abs(value - wrong[i]!) > 3),
				"Scene-clock oracle cannot reject wrong clock",
			);
		}
		checks.push({
			name: "independent-range-local-and-source-trim-clock-negative-controls",
			passed: true,
		});
		const exportSettings = {
			width: WIDTH,
			height: HEIGHT,
			fps: params.fps,
			format: "webm" as const,
			quality: "very_high" as const,
			shouldIncludeAudio: false,
			...(new URL(location.href).searchParams.get("chroma") === "444"
				? { videoChroma: "444" as const }
				: {}),
		};
		const exportRange = {
			startTime: ticks(FIRST_FRAME),
			endTime: ticks(FIRST_FRAME + FRAME_COUNT),
			duration: ticks(FRAME_COUNT),
		};
		const evidence = {
			passed: true,
			checks,
			width: WIDTH,
			height: HEIGHT,
			firstSceneFrame: FIRST_FRAME,
			frameCount: FRAME_COUNT,
			fps: FPS,
			exportSettings,
			exportRange,
			videoChromaOption:
				exportSettings.videoChroma ??
				"not supplied; record actual encoded pixelFormat separately",
			productionVideoPlan: resolveExportVideoPlan({
				codec: "vp9",
				width: WIDTH,
				height: HEIGHT,
				quality: exportSettings.quality,
				frameRate: params.fps,
				...(exportSettings.videoChroma
					? { videoChroma: exportSettings.videoChroma }
					: {}),
			}),
			gpuFrames: Array.from({ length: FRAME_COUNT }, (_, index) => ({
				sceneFrame: FIRST_FRAME + index,
				rgba: [...seen.get(FIRST_FRAME + index)!],
			})),
			previewPixelTolerance: 2,
			scope:
				"Standalone buildScene -> CanvasRenderer -> SceneExporter; native recipe + Canvas worker + backdrop; no installed Electron claim",
		};
		if (new URL(location.href).searchParams.has("gpuOnly")) {
			return { ...evidence, exportSkipped: true };
		}
		const output = await new SceneExporter({
			...params,
			...exportSettings,
		}).export({
			rootNode: timed,
			range: exportRange,
		});
		check(output, "Master effect SceneExporter produced no video");
		checks.push({
			name: "real-SceneExporter-nonzero-range-completed",
			passed: true,
		});
		return {
			...evidence,
			bytes: [...new Uint8Array(output!)],
		};
	} finally {
		for (const node of nodes) cancelPendingRenderFrames(node);
		compositor.dispose();
		disposeGpu();
	}
}
void run().then(
	(result) => {
		scope.__masterEffects = result;
	},
	(error) => {
		scope.__masterEffects = {
			passed: false,
			error: String(error?.stack ?? error),
			checks: scope.__masterProgress,
		};
	},
);
