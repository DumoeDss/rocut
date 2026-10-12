import type { createTunnelBrowserOracle } from "./mv-tunnel-browser-oracle";
import { tunnelFrame4, tunnelDiagnosticDifference } from "./mv-tunnel-native-diagnostic";
import { typeCardReferenceDigest } from "./mv-type-card-reference-realm";

type Oracle = Awaited<ReturnType<typeof createTunnelBrowserOracle>>;
type Output = { pixels: Uint8ClampedArray; postPixels: Uint8ClampedArray };
declare global {
	var __tunnelOracleRepeatDiagnostic: { metadata: unknown; buffers: Record<string, Output> } | undefined;
}
export async function diagnoseTunnelOracleRepeats({ oracle, createOracle, count, observations }: {
	oracle: Oracle; createOracle(): Promise<Oracle>; count: number;
	observations: Record<string, unknown>[];
}) {
	if (!Number.isSafeInteger(count) || count < 2 || count > 12) throw Error("Oracle repeats require count 2..12");
	const frame = tunnelFrame4(), buffers: Record<string, Output> = {};
	const records: Record<string, unknown>[] = [];
	let baseline: Output | undefined;
	let commandBaseline: string | undefined;
	const metadata = { frame, count, records, baselineCommands: undefined as unknown,
		scope: "Oracle-only fixed-frame observation; no native, full matrix or acceptance decision",
		fullMatrixTested: false, thresholdsUnchanged: true };
	globalThis.__tunnelOracleRepeatDiagnostic = { metadata, buffers };
	for (const mode of ["continuous", "fresh-realm"]) for (let repeat = 0; repeat < count; repeat++) {
		globalThis.__tunnelNativeProgress = { current: `oracle-${mode}-${repeat}`, visits: records.length };
		const instance = mode === "continuous" ? oracle : await createOracle();
		const started = performance.now();
		try {
			const output = await instance.render({ frame });
			const key = `${mode}-${repeat}`;
			const retained = { pixels: output.pixels.slice(), postPixels: output.postPixels.slice() };
			buffers[key] = retained;
			baseline ??= retained;
			const observation = observations[observations.length - 1]!;
			const commands = JSON.stringify(observation.commands);
			commandBaseline ??= commands;
			metadata.baselineCommands ??= observation.commands;
			records.push({ key, elapsedMs: performance.now() - started,
				scene: tunnelDiagnosticDifference({ a: retained.pixels, b: baseline.pixels }),
				post: tunnelDiagnosticDifference({ a: retained.postPixels, b: baseline.postPixels }),
				sceneSha256: await typeCardReferenceDigest(retained.pixels.slice().buffer),
				postSha256: await typeCardReferenceDigest(retained.postPixels.slice().buffer),
				commandSha256: await typeCardReferenceDigest(new TextEncoder().encode(commands).buffer),
				commandsEqualBaseline: commands === commandBaseline,
				observation: { ...observation, commands: undefined },
			});
		} finally {
			if (mode === "fresh-realm") instance.dispose();
		}
	}
	return { diagnosticComplete: true, oracleRepeatDiagnostic: true, fullMatrixTested: false, metadata };
}
