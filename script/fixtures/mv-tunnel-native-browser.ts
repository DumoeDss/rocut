import { createTunnelBrowserOracle } from "./mv-tunnel-browser-oracle";
import {
	createTunnelNativeCapture,
	createTunnelNativeDiagnosticCapture,
} from "./mv-tunnel-native-capture";
import {
	diagnoseTunnelFrame4,
	tunnelFrame4,
} from "./mv-tunnel-native-diagnostic";
import { verifyTunnelPixelMatrix } from "./mv-tunnel-pixel-suite";
import { tunnelRaceFailureRecorder } from "./mv-tunnel-race-experiment";
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
		raceDiagnostics?: boolean;
		settleRealms?: boolean;
		frameDelayMs?: number;
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
			const preRoll = Number(globalThis.__tunnelDiagPreRoll ?? 0);
			if (preRoll > 0) {
				for (let k = 0; k < preRoll; k++) {
					await captureNative({
						frame: { ...tunnelFrame4(), time: 12.25 + k / 60 },
						index: k,
					});
					await oracle.render({
						frame: { ...tunnelFrame4(), time: 12.25 + k / 60 },
					});
				}
			}
			if (Number(globalThis.__tunnelDiagRepeatProbe ?? 0) > 0) {
				const probeFrame = tunnelFrame4();
				const outputs = [];
				for (let r = 0; r < 2; r++) {
					const out = await captureNative({ frame: probeFrame, index: 4 });
					outputs.push(out);
				}
				let firstDiff = -1;
				for (let i = 0; i < outputs[0].pixels.length; i++)
					if (outputs[0].pixels[i] !== outputs[1].pixels[i]) { firstDiff = i; break; }
				globalThis.__tunnelRepeatProbe = {
					pixelsEqual: firstDiff < 0,
					firstDiffIndex: firstDiff,
					firstDiff: firstDiff < 0 ? null : {
						x: ((firstDiff / 4) | 0) % 1920,
						y: ((firstDiff / 4) | 0) / 1920 | 0,
						c: firstDiff % 4,
						a: outputs[0].pixels[firstDiff],
						b: outputs[1].pixels[firstDiff],
					},
				};
			}
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
				repeatProbe: globalThis.__tunnelRepeatProbe,
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
		let plan: unknown;
		const native = input.raceDiagnostics
			? await createTunnelNativeDiagnosticCapture({ fonts, onPlan(p) { plan = p; } })
			: await createTunnelNativeCapture(fonts);
		const captureNative: typeof native = async (request) => {
			if (input.settleRealms) {
				const deadline = performance.now() + 2000;
				while (document.querySelectorAll("iframe").length > 1) {
					if (performance.now() > deadline) throw Error("Tunnel experiment realm disposal did not settle");
					await new Promise(resolve => setTimeout(resolve, 10));
				}
			}
			if (input.frameDelayMs) await new Promise(resolve => setTimeout(resolve, input.frameDelayMs));
			return native(request);
		};
		globalThis.__tunnelNativeProgress = { current: "starting", visits: 0 };
		const result = await verifyTunnelPixelMatrix({
			oracle,
			captureNative,
			cap: Number(globalThis.__tunnelMatrixCap) || undefined,
			onFailure: input.raceDiagnostics ? tunnelRaceFailureRecorder({
				oracle, captureNative, readPlan: () => plan,
			}) : undefined,
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
			progress: globalThis.__tunnelNativeProgress,
		};
	});
