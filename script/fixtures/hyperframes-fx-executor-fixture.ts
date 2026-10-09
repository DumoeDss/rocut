import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { HyperframesFxStage } from "../../apps/cli/src/programmatic/hyperframes-fx-types";

/** Test-only geometry oracle. Production stages come from the Rust graph plan,
 * never this fixture. Its isolated WASM is selected explicitly and never built
 * or copied over another session's shared package. */
export async function nativeFxFixture(wasmDirectory: string) {
	const wasm = await import(
		pathToFileURL(join(wasmDirectory, "opencut_wasm.js")).href
	);
	wasm.initSync({
		module: await readFile(join(wasmDirectory, "opencut_wasm_bg.wasm")),
	});
	const require = createRequire(
		new URL("../../apps/vite-example/package.json", import.meta.url),
	);
	const { chromium } = await import(
		pathToFileURL(require.resolve("@playwright/test")).href
	);
	return {
		executable: chromium.executablePath() as string,
		stage(
			nodes: readonly unknown[],
			inputFrames: number,
			nativeFxAutomation: unknown = null,
		): HyperframesFxStage {
			const result = JSON.parse(
				wasm.normalizeHyperframesFxChainJson(
					JSON.stringify({ version: 1, nodes }),
				),
			);
			if (result.error) throw Error(result.error);
			// This fixture automates gain only. Tail-affecting automation requires
			// the executable Rust planner's own resolved-automation budget.
			const expectedOutputFrames =
				inputFrames === 0
					? 0
					: inputFrames + Math.ceil(result.staticTailSeconds * 48000);
			return {
				sampleRate: 48000,
				inputFrames,
				expectedOutputFrames,
				maxOutputBytes: expectedOutputFrames * 8,
				normalizedFxChain: result.chain,
				nativeFxAutomation,
			};
		},
	};
}

export const NATIVE_FX_PCM_CASES: readonly {
	type: string;
	params: Record<string, number | string>;
}[] = [
	{ type: "gain", params: { gain: 12 } },
	{ type: "peaking", params: { frequency: 2300, gain: 12, q: 2 } },
	{ type: "lowshelf", params: { frequency: 500, gain: -12 } },
	{ type: "highshelf", params: { frequency: 3000, gain: -12 } },
	{ type: "highpass", params: { frequency: 1200 } },
	{ type: "lowpass", params: { frequency: 400 } },
	{ type: "compressor", params: { threshold: -24, ratio: 8, attack: 1 } },
	{ type: "limiter", params: { limit: -12, attack: 1 } },
	{ type: "gate", params: { threshold: -4, range: -18 } },
	{ type: "saturate", params: { threshold: -12 } },
	{ type: "bitcrush", params: { bits: 4, samples: 8 } },
	{ type: "pitchshift", params: { semitones: 5 } },
	{ type: "delay", params: { time: 20, feedback: 0.2, mix: 0.6 } },
	{ type: "chorus", params: { delay: 8, depth: 3, speed: 2, mix: 0.8 } },
	{ type: "phaser", params: { in_gain: 0.6, out_gain: 0.8, delay: 3 } },
	{ type: "reverb", params: { size: 0, wet: 0.6, dry: 0.5 } },
];

export function nativeFxSignal(frames = 14400) {
	const pcm = Buffer.alloc(frames * 8);
	for (let frame = 0; frame < frames; frame++) {
		const time = frame / 48000;
		const left =
			0.55 * Math.sin(2 * Math.PI * 211 * time) +
			0.25 * Math.sin(2 * Math.PI * 2300 * time) +
			0.12 * Math.sin(2 * Math.PI * 7500 * time);
		pcm.writeFloatLE(left, frame * 8);
		pcm.writeFloatLE(0.37 * Math.sin(2 * Math.PI * 397 * time), frame * 8 + 4);
	}
	return pcm;
}

export function nativeFxMetrics(output: Buffer, input: Buffer) {
	let energy = 0,
		difference = 0,
		peak = 0;
	for (let byte = 0; byte < output.length; byte += 4) {
		const sample = output.readFloatLE(byte);
		if (!Number.isFinite(sample)) throw Error("Nonfinite test PCM");
		energy += sample * sample;
		peak = Math.max(peak, Math.abs(sample));
		const dry = byte < input.length ? input.readFloatLE(byte) : 0;
		difference += (sample - dry) ** 2;
	}
	return {
		rms: Math.sqrt(energy / (output.length / 4)),
		differenceRms: Math.sqrt(difference / (output.length / 4)),
		peak,
	};
}
