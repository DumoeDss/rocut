import type { TunnelNativeCapture, TunnelNativeOutput } from "./mv-tunnel-pixel-suite";
import { tunnelPixelDifference, tunnelPixelSamples } from "./mv-tunnel-pixel-suite";
import type { createTunnelBrowserOracle } from "./mv-tunnel-browser-oracle";
import type { TunnelOracleFrame } from "./mv-tunnel-oracle";
import { typeCardReferenceDigest } from "./mv-type-card-reference-realm";

type Oracle = Awaited<ReturnType<typeof createTunnelBrowserOracle>>;
type Output = Pick<TunnelNativeOutput, "pixels" | "postPixels">;
declare global {
	var __tunnelRaceFailure: {
		metadata: Record<string, unknown>;
		buffers: Record<string, Output>;
	} | undefined;
}

/** Runs only after the unchanged gate has failed. The original failing bytes
 * are retained before any follow-up render changes the scheduling or caches. */
export function tunnelRaceFailureRecorder({
	oracle,
	captureNative,
	readPlan,
}: {
	oracle: Oracle;
	captureNative: TunnelNativeCapture;
	readPlan(): unknown;
}) {
	return async ({ key, frame, index, expected, actual, oldHashes }: {
		key: string;
		frame: TunnelOracleFrame;
		index: number;
		expected: Output;
		actual: Output;
		oldHashes?: unknown;
	}) => {
		const snapshot = (output: Output): Output => ({
			pixels: output.pixels.slice(),
			postPixels: output.postPixels.slice(),
		});
		const buffers: Record<string, Output> = {
			original: snapshot(expected), native: snapshot(actual),
		};
		const plans: unknown[] = [structuredClone(readPlan())];
		const timings: unknown[] = [];
		globalThis.__tunnelRaceFailure = { metadata: { key, frame, index, oldHashes }, buffers };
		try {
		for (let i = 0; i < 2; i++) {
			const start = performance.now();
			buffers[`originalRepeat${i}`] = snapshot(await oracle.render({ frame }));
			const afterOracle = performance.now();
			buffers[`nativeRepeat${i}`] = snapshot(await captureNative({ frame, index }));
			plans.push(structuredClone(readPlan()));
			timings.push({ oracleMs: afterOracle - start, nativeMs: performance.now() - afterOracle,
				iframesAfter: document.querySelectorAll("iframe").length,
				fontStatus: document.fonts.status, hostFontStatus: document.fonts.status });
		}
		const hashes: Record<string, unknown> = {};
		for (const [owner, output] of Object.entries(buffers)) hashes[owner] = {
			scene: await typeCardReferenceDigest(output.pixels.slice().buffer),
			post: await typeCardReferenceDigest(output.postPixels.slice().buffer),
		};
		const compare = (a: Output, b: Output) => ({
			scene: tunnelPixelDifference({ a: a.pixels, b: b.pixels }),
			post: tunnelPixelDifference({ a: a.postPixels, b: b.postPixels }),
			sceneSamples: tunnelPixelSamples({ a: a.pixels, b: b.pixels }).samples,
		});
		globalThis.__tunnelRaceFailure.metadata = {
			key, frame, index, oldHashes, hashes, timings, plans, preflightPlans: plans,
			originalRepeats: [0, 1].map(i => compare(buffers.original!, buffers[`originalRepeat${i}`]!)),
			nativeRepeats: [0, 1].map(i => compare(buffers.native!, buffers[`nativeRepeat${i}`]!)),
			parityRepeats: [0, 1].map(i => compare(buffers[`nativeRepeat${i}`]!, buffers[`originalRepeat${i}`]!)),
			scope: "Failure follow-up only; the original gate result is never replaced by a retry",
		};
		} catch (error) {
			globalThis.__tunnelRaceFailure.metadata = {
				...globalThis.__tunnelRaceFailure.metadata,
				diagnosticError: String(error), timings, plans, preflightPlans: plans,
			};
		}
	};
}
