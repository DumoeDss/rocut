import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { attachLiquidObjectFrame } from "./liquid-object-frame-host";
import { enableParticleRootContext } from "./particle-capture-context";
import {
	assertParticleCaptureSnapshot,
	createParticleCaptureIdentity,
	raceParticleCapture,
	withHtmlCaptureCleanup,
} from "./particle-capture";
import { captureHtmlBrowserFrame } from "./particle-capture-frame";
import { htmlLiquidObjectCaptureExpression } from "./html-document";
import {
	createElectronLiquidProfile,
	ELECTRON_LIQUID_CHECK,
	ELECTRON_LIQUID_CLEANUP,
} from "./liquid-object-electron-profile";
import type { LiquidTransportFrame } from "./engines/three-liquid-object-transport-publication";
import type { ThreeLiquidObjectCompileIdentity } from "./three-liquid-object-identity";
import {
	assertThreeLiquidObjectCompileIdentity,
	threeLiquidObjectCompileIdentity,
} from "./three-liquid-object-identity";
import { ElectronParticleBrowser } from "./electron-particle-browser";
import type { ElectronLiquidConnection } from "./electron-particle-transport";

/** Backend-only orchestration after the normal Rust frame/archive/resource admission.
 * The second argument is a CPU-test seam, never accepted from a frame request. */
export async function captureElectronLiquidObjectPng(
	options: {
		connection: ElectronLiquidConnection;
		width: number;
		height: number;
		code: string;
		resources: readonly ResolvedProgrammaticResource[];
		frame: { index: number; time: number; seed: number };
		archive: ThreeLiquidObjectCompileIdentity;
		signal: AbortSignal;
	},
	attachLiquid: typeof attachLiquidObjectFrame = attachLiquidObjectFrame,
): Promise<Buffer> {
	const { connection, width, height, code, resources, frame, archive, signal } =
		options;
	// Admit the exact archived Rust policy before native window/worker ownership.
	const admitted = await connection.probe(archive.transportPolicy, signal);
	const initialIdentity = createParticleCaptureIdentity({
		session: "electron-liquid-admission",
		code,
		resources,
		archiveIdentityHash: archive.identityHash,
		frame,
	});
	const transport = await admitted.open(width, height, signal);
	const identityInput = {
		session: transport.sessionId,
		code,
		resources,
		archiveIdentityHash: archive.identityHash,
		frame,
	};
	const identity = Object.freeze({
		...initialIdentity,
		sessionId: transport.sessionId,
	});
	const liquidFrame: LiquidTransportFrame = Object.freeze({
		sessionId: identity.captureId,
		index: frame.index,
		time: frame.time,
		seed: frame.seed,
	});
	const capture = new AbortController();
	const activeSignal = AbortSignal.any([signal, capture.signal]);
	const browser = new ElectronParticleBrowser(
		transport,
		archive.transportPolicy,
		activeSignal,
		width,
		height,
		createElectronLiquidProfile(liquidFrame, archive.transportPolicy),
	);
	void browser.failure.catch((error) => capture.abort(error));
	const session = transport.sessionId;
	let context:
		| Awaited<ReturnType<typeof enableParticleRootContext>>
		| undefined;
	let liquid: Awaited<ReturnType<typeof attachLiquidObjectFrame>> | undefined;
	let initialization: Promise<void> | undefined;
	let workerDisposalStarted = false;
	let expressionStarted = false;
	let completed = false;
	const send = (method: string, params = {}) =>
		browser.send(method, params, session);
	return withHtmlCaptureCleanup({
		async run() {
			context = await raceParticleCapture(
				enableParticleRootContext({
					browser,
					session,
					signal: activeSignal,
					timeoutMs: 5000,
				}),
				[browser.failure],
			);
			void context.failure.catch((error) => capture.abort(error));
			browser.setIdentity(identity);
			initialization = attachLiquid({
				frame: liquidFrame,
				browser,
				session,
				executionContextId: context.executionContextId,
				signal: activeSignal,
				expectedIdentity: archive.workerIdentity,
			}).then((value) => {
				liquid = value;
				void value.failure.catch((error) => {
					// Disposal owns intentional worker termination and its confirmed exit.
					if (!workerDisposalStarted) capture.abort(error);
				});
			});
			await raceParticleCapture(initialization, [
				context.failure,
				browser.failure,
			]);
			context.check();
			browser.check();
			assertThreeLiquidObjectCompileIdentity({
				archived: archive,
				current: threeLiquidObjectCompileIdentity({
					runtime: liquid!,
					adapterSha256: archive.adapterSha256,
				}),
			});
			assertParticleCaptureSnapshot(identity, identityInput);
			const expression = htmlLiquidObjectCaptureExpression({
				code,
				frame,
				resources,
				config: Object.freeze({
					version: 1,
					frame: liquidFrame,
					policy: liquid!.policy,
				}),
			});
			browser.freezeExpression(expression);
			const png = await captureHtmlBrowserFrame({
				send,
				expression,
				signal: activeSignal,
				failures: [context.failure, liquid!.failure, browser.failure],
				executionContextId: context.executionContextId,
				beforeEvaluate() {
					expressionStarted = true;
				},
				async check() {
					context!.check();
					browser.check();
					if (!expressionStarted) return;
					if (expressionStarted)
						await send("Runtime.evaluate", {
							contextId: context!.executionContextId,
							expression: ELECTRON_LIQUID_CHECK,
							awaitPromise: true,
							returnByValue: true,
						});
					await liquid!.check();
				},
			});
			completed = true;
			return png;
		},
		async cleanupPage() {
			browser.beginCleanup();
			if (expressionStarted && context)
				await send("Runtime.evaluate", {
					contextId: context.executionContextId,
					expression: ELECTRON_LIQUID_CLEANUP,
					awaitPromise: true,
					returnByValue: true,
				});
		},
		disposeBrokers: [
			async () => {
				await initialization?.catch((error) => {
					if (error instanceof AggregateError) throw error;
				});
				workerDisposalStarted = true;
				await liquid?.dispose();
			},
		],
		async closeBrowser() {
			context?.dispose();
			await browser.close(
				signal.aborted ? "cancelled" : completed ? "complete" : "failed",
			);
		},
	});
}
