import { createTunnelBrowserOracle } from "./mv-tunnel-browser-oracle";
import {
	createTunnelNativeCapture,
	createTunnelNativeDiagnosticCapture,
} from "./mv-tunnel-native-capture";
import { diagnoseTunnelFrame4 } from "./mv-tunnel-native-diagnostic";
import { verifyTunnelPixelMatrix } from "./mv-tunnel-pixel-suite";
import { verifyTunnelTransportBoundary } from "./mv-tunnel-transport-browser";
import type { TunnelReference } from "./mv-tunnel-reference";
import type { TunnelPostReference } from "./mv-tunnel-post-reference";
import type { TypeCardReferenceFont } from "./mv-type-card-reference-contract";

declare global {
	var __tunnelNativeInput: {
		reference: TunnelReference;
		postReference: TunnelPostReference;
		fonts: readonly { family: string; weight: number; file: string }[];
		fontBytes: Readonly<Record<string, string>>;
		frame4GrainDiagnostic?: boolean;
	};
	var __tunnelNativeProgress: { current: string; visits: number };
	var __tunnelNativeResult: unknown;
	var __tunnelNativeDiagnostic:
		| Awaited<ReturnType<typeof diagnoseTunnelFrame4>>
		| undefined;
}
async function run() {
	const input = globalThis.__tunnelNativeInput;
	if (!input) throw Error("Private Tunnel native inputs missing");
	const transportBoundary = verifyTunnelTransportBoundary();
	const buffers = new Map(
		Object.entries(input.fontBytes).map(([file, encoded]) => [
			file,
			Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)).buffer,
		]),
	);
	const fonts: TypeCardReferenceFont[] = input.fonts.map((f) => {
		const bytes = buffers.get(f.file);
		if (!bytes) throw Error("Tunnel pinned font missing");
		return { family: f.family, weight: f.weight, bytes };
	});
	const oracle = await createTunnelBrowserOracle({
		reference: input.reference,
		postReference: input.postReference,
		fonts,
	});
	try {
		if (input.frame4GrainDiagnostic) {
			globalThis.__tunnelNativeProgress = {
				current: "frame4-grain-diagnostic",
				visits: 0,
			};
			let plan: unknown;
			const captureNative = await createTunnelNativeDiagnosticCapture({
				fonts,
				onPlan(p) {
					plan = p;
				},
			});
			const diagnostic = await diagnoseTunnelFrame4({
				oracle,
				captureNative,
				readNativePlan: () => plan,
			});
			globalThis.__tunnelNativeDiagnostic = diagnostic;
			return {
				diagnosticComplete: true,
				mode: "frame4-grain-diagnostic",
				fullMatrixTested: false,
				metadata: diagnostic.metadata,
				proofs: {
					production: diagnostic.production.proof,
					omitted: diagnostic.nativeOmitted.proof,
				},
				plans: {
					production: diagnostic.production.plan,
					omitted: diagnostic.nativeOmitted.plan,
				},
				provenance: {
					original: diagnostic.original.provenance,
					omitted: diagnostic.originalOmitted.provenance,
				},
				transportBoundary,
			};
		}
		const captureNative = await createTunnelNativeCapture(fonts);
		globalThis.__tunnelNativeProgress = { current: "starting", visits: 0 };
		const result = await verifyTunnelPixelMatrix({
			oracle,
			captureNative,
			onProgress(current) {
				globalThis.__tunnelNativeProgress = {
					current,
					visits: globalThis.__tunnelNativeProgress.visits + 1,
				};
			},
		});
		return { ...result, transportBoundary };
	} finally {
		oracle.dispose();
	}
}
run()
	.then((result) => {
		globalThis.__tunnelNativeResult = result;
	})
	.catch((error) => {
		globalThis.__tunnelNativeResult = {
			passed: false,
			error: String(error?.stack ?? error),
		};
	});
