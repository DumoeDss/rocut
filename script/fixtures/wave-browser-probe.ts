import { disposeGpu, initializeGpu } from "opencut-wasm";
import { registerDefaultEffects } from "../../packages/editor-classic/src/effects";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import {
	assert,
	effect,
	hash,
	spatialParams,
	spatialPixels,
	spatialScene,
} from "./spatial-probe-scene";
import {
	checkWaveAlpha,
	checkWaveBudgetAndInterference,
	waveParams,
	waveSchedule,
} from "./wave-browser-checks";
import {
	checkWaveCoordinateOracle,
	type WaveCapture,
} from "./wave-probe-oracle";
import { exportWave } from "./wave-export-probe";

export async function runWaveProbe() {
	registerDefaultEffects();
	await initializeGpu();
	const params = spatialParams(),
		renderer = new CanvasRenderer(params);
	let captures = 0;
	const capture: WaveCapture = (node, local) => {
		captures++;
		return renderer.renderAndCapture({
			node,
			time: local + 12000,
			capture: spatialPixels,
		});
	};
	const sheet = document.createElement("canvas");
	sheet.width = 1280;
	sheet.height = 1080;
	const ctx = sheet.getContext("2d")!;
	const stamp = (pixels: Uint8ClampedArray, index: number) =>
		ctx.putImageData(
			new ImageData(new Uint8ClampedArray(pixels), 640, 360),
			(index % 2) * 640,
			Math.floor(index / 2) * 360,
		);
	document.body.append(sheet);
	try {
		const baseline = await capture(spatialScene([]), 60000),
			baseHash = await hash(baseline);
		stamp(baseline, 0);
		const ripple = effect("ripple", waveParams),
			node = spatialScene([ripple]);
		const early = await capture(node, 32000),
			peak = await capture(node, 60000),
			late = await capture(node, 80000);
		const earlyHash = await hash(early),
			peakHash = await hash(peak),
			lateHash = await hash(late);
		assert(
			new Set([baseHash, earlyHash, peakHash, lateHash]).size === 4,
			"Ripple schedule is static or neutral",
		);
		stamp(early, 1);
		stamp(peak, 2);
		stamp(late, 3);
		for (const [time, expected] of [
			[80000, lateHash],
			[32000, earlyHash],
			[60000, peakHash],
			[32000, earlyHash],
		] as const)
			assert(
				(await hash(await capture(node, time))) === expected,
				`Wave reverse/repeat seek at ${time}`,
			);
		for (const time of [0, 104000, 112000])
			assert(
				(await hash(await capture(node, time))) === baseHash,
				`Wave before/start/end identity at ${time}`,
			);
		const delayed = effect("ripple", {
			...waveParams,
			...waveSchedule([{ time: 24000, x: 0.5, y: 0.5, amplitude: 1 }]),
		});
		assert(
			(await hash(await capture(spatialScene([delayed]), 12000))) === baseHash,
			"Pre-event render changed pixels",
		);
		for (const extra of [{ preview: true }, { trim: 0 }, { restored: true }])
			assert(
				(await hash(await capture(spatialScene([ripple], extra), 60000))) ===
					peakHash,
				`Wave preview/trim/JSON parity: ${JSON.stringify(extra)}`,
			);
		assert(
			(await hash(
				await capture(
					spatialScene([effect("ripple", { ...waveParams, amount: 0 })]),
					60000,
				),
			)) === baseHash,
			"Wave zero amount identity",
		);
		const force = effect("force-field", {
			...waveParams,
			ringOpacity: 0.7,
			glow: 0.5,
			colorR: 0.1,
			colorG: 0.8,
			colorB: 1,
		});
		const forceNode = spatialScene([force]),
			forcePixels = await capture(forceNode, 60000);
		assert(
			(await hash(forcePixels)) !== peakHash,
			"Force Field ring/glow did not change pixels",
		);
		stamp(forcePixels, 4);
		const forceHash = await hash(forcePixels);
		for (const time of [0, 104000, 112000])
			assert(
				(await hash(await capture(forceNode, time))) === baseHash,
				`Force Field idle identity at ${time}`,
			);
		for (const extra of [{ preview: true }, { trim: 0 }, { restored: true }])
			assert(
				(await hash(await capture(spatialScene([force], extra), 60000))) ===
					forceHash,
				`Force Field preview/trim/JSON parity: ${JSON.stringify(extra)}`,
			);
		assert(
			(await hash(await capture(forceNode, 60000))) === forceHash,
			"Force Field reverse seek",
		);
		const ringOff = effect("force-field", {
			...force.params,
			ringOpacity: 0,
			glow: 0,
		});
		assert(
			(await hash(await capture(spatialScene([ringOff]), 60000))) === peakHash,
			"Force Field optical sampling differs from Ripple",
		);
		const ringOnly = effect("force-field", {
			...force.params,
			refraction: 0,
			ringOpacity: 1,
			glow: 0,
		});
		const ringPixels = await capture(spatialScene([ringOnly]), 60000);
		assert(
			(await hash(ringPixels)) !== baseHash,
			"Force Field ring opacity did not add coverage",
		);
		stamp(ringPixels, 5);
		const noRing = effect("force-field", {
			...ringOnly.params,
			ringOpacity: 0,
		});
		assert(
			(await hash(await capture(spatialScene([noRing]), 60000))) === baseHash,
			"Force Field disabled optics/ring is not neutral",
		);
		const glowOnly = effect("force-field", { ...noRing.params, glow: 1 });
		const glowHash = await hash(await capture(spatialScene([glowOnly]), 60000));
		assert(
			glowHash !== baseHash && glowHash !== (await hash(ringPixels)),
			"Force Field glow is not independently editable",
		);
		const alpha = await checkWaveAlpha(capture, peak);
		const interference = await checkWaveBudgetAndInterference(
			capture,
			baseline,
		);
		const coordinateOracle = await checkWaveCoordinateOracle(capture);
		Reflect.set(globalThis, "__stylizedSheet", sheet.toDataURL("image/png"));
		const video = await exportWave(params, forceNode, capture, baseline);
		return {
			ok: true,
			captures,
			peakHash,
			alpha,
			interference,
			coordinateOracle,
			video,
			checks: [
				"independent fixed-time coordinate refraction oracle",
				"finite spatial support",
				"16-event budget and last-slot rendering",
				"invalid/incomplete schedules reject in browser ABI",
				"multi-event superposition and cancellation before sampling",
				"pre-event/start/after-lifetime identity",
				"repeat/reverse seeks",
				"zero strength",
				"Force Field ring/glow and source refraction",
				"straight-alpha background parity",
				"preview parity",
				"trim-independent timing",
				"JSON roundtrip",
				"six-frame production WebM encode/decode with unchanged quality gates",
			],
		};
	} finally {
		params.compositor.dispose();
		disposeGpu();
	}
}
