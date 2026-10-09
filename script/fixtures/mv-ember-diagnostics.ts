import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { MvEmberPlan } from "../../packages/editor-contracts/src/mv-ember-plan";

export async function emberPngBase64(canvas: OffscreenCanvas) {
	const bytes = new Uint8Array(
		await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
	);
	let binary = "";
	for (let i = 0; i < bytes.length; i += 32768)
		binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
	return btoa(binary);
}

export function emberDiagnostics() {
	let retained = 0;
	const seen = new Set<string>();
	return async (
		label: string,
		actual: Uint8ClampedArray,
		expected: Uint8ClampedArray,
		source: ProgrammaticSource,
		plan: MvEmberPlan | undefined,
		provenance: unknown,
	) => {
		if (seen.has(label)) return { retained: true, label, repeated: true };
		if (retained++ >= 6)
			return { retained: false, reason: "bounded diagnostic image limit" };
		seen.add(label);
		const writer: unknown = Reflect.get(globalThis, "__writeEmberDiagnostic");
		if (typeof writer !== "function")
			return { retained: false, reason: "no dedicated artifact sink" };
		const differences: { x: number; y: number; delta: number }[] = [];
		for (let i = 0; i < actual.length; i += 4) {
			const delta = Math.max(
				...[0, 1, 2, 3].map((c) => Math.abs(actual[i + c] - expected[i + c])),
			);
			if (
				delta > 2 &&
				(differences.length < 32 ||
					delta > differences[differences.length - 1].delta)
			) {
				differences.push({
					x: (i / 4) % 1920,
					y: Math.floor(i / 4 / 1920),
					delta,
				});
				differences.sort((a, b) => b.delta - a.delta);
				if (differences.length > 32) differences.pop();
			}
		}
		for (const [kind, data] of [
			["actual", actual],
			["expected", expected],
		] as const) {
			const canvas = new OffscreenCanvas(1920, 1080),
				ctx = canvas.getContext("2d")!;
			ctx.putImageData(
				new ImageData(new Uint8ClampedArray(data), 1920, 1080),
				0,
				0,
			);
			try {
				await writer(label, kind, await emberPngBase64(canvas));
			} finally {
				canvas.width = canvas.height = 1;
			}
		}
		await writer(
			label,
			"plan",
			JSON.stringify({
				source,
				plan,
				provenance,
				topPixels: differences.slice(0, 32),
			}),
		);
		return { retained: true, label, topPixels: differences.slice(0, 8) };
	};
}
