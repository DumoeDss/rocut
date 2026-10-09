import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { attachParticleSamplerFrame } from "./particle-broker-host";
import { enableParticleRootContext } from "./particle-capture-context";
import {
	assertParticleCaptureSnapshot,
	createParticleCaptureIdentity,
	raceParticleCapture,
	withHtmlCaptureCleanup,
} from "./particle-capture";
import { captureHtmlBrowserFrame } from "./particle-capture-frame";
import { htmlCaptureExpression } from "./html-document";
import {
	assertThreeParticleCompileIdentity,
	threeParticleCompileIdentity,
	type ThreeParticleCompileIdentity,
} from "./three-particle-provenance";
import {
	ElectronParticleBrowser,
	ELECTRON_PARTICLE_CHECK,
	ELECTRON_PARTICLE_CLEANUP,
} from "./electron-particle-browser";
import type { ElectronParticleConnection } from "./electron-particle-transport";

/** Backend-only orchestration after the normal Rust frame/archive/resource admission.
 * The second argument is a CPU-test seam, never accepted from a frame request. */
export async function captureElectronParticlePng(
	options: {
		connection: ElectronParticleConnection;
		width: number;
		height: number;
		code: string;
		resources: readonly ResolvedProgrammaticResource[];
		frame: Parameters<typeof htmlCaptureExpression>[1];
		archive: ThreeParticleCompileIdentity;
		signal: AbortSignal;
	},
	attachSampler: typeof attachParticleSamplerFrame = attachParticleSamplerFrame,
): Promise<Buffer> {
	const { connection, width, height, code, resources, frame, archive, signal } =
		options;
	// Probe and compare the entire frozen native limit object and archived policy
	// before opening a native window or constructing a private Rust worker.
	const admitted = await connection.probe(
		archive.transportPolicy.hostDefaults,
		signal,
	);
	const transport = await admitted.open(width, height, signal);
	const capture = new AbortController();
	const activeSignal = AbortSignal.any([signal, capture.signal]);
	const browser = new ElectronParticleBrowser(
		transport,
		archive.transportPolicy.hostDefaults,
		activeSignal,
		width,
		height,
	);
	void browser.failure.catch((error) => capture.abort(error));
	const session = transport.sessionId;
	let context:
		| Awaited<ReturnType<typeof enableParticleRootContext>>
		| undefined;
	let particles:
		| Awaited<ReturnType<typeof attachParticleSamplerFrame>>
		| undefined;
	let initialization: Promise<void> | undefined;
	let samplerDisposalStarted = false;
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
			const identityInput = {
				session,
				code,
				resources,
				archiveIdentityHash: archive.identityHash,
				frame,
			};
			const identity = createParticleCaptureIdentity(identityInput);
			browser.setIdentity(identity);
			initialization = attachSampler({
				mappedFrame: frame,
				browser,
				session,
				executionContextId: context.executionContextId,
				identity,
				signal: activeSignal,
				bootstrapTimeoutMs:
					archive.transportPolicy.hostDefaults.process.initTimeoutMs,
				expectedIdentity: archive.samplerIdentity,
			}).then((value) => {
				particles = value;
				void value.failure.catch((error) => {
					// The real worker rejects failure on intentional terminateSampler().
					// During disposal, its result (including confirmed exit) owns errors;
					// do not turn normal termination into a native-session cancellation.
					if (!samplerDisposalStarted) capture.abort(error);
				});
			});
			await raceParticleCapture(initialization, [
				context.failure,
				browser.failure,
			]);
			context.check();
			browser.check();
			assertThreeParticleCompileIdentity(
				archive,
				threeParticleCompileIdentity(particles!, archive.adapterSha256),
			);
			assertParticleCaptureSnapshot(identity, identityInput);
			const expression = htmlCaptureExpression(
				code,
				frame,
				resources,
				false,
				false,
				undefined,
				Object.freeze({
					version: 1,
					identity,
					policy: particles!.policy,
					requestTimeoutMs: particles!.policy.requestTimeoutMs,
				}),
			);
			browser.freezeExpression(expression);
			const png = await captureHtmlBrowserFrame({
				send,
				expression,
				signal: activeSignal,
				failures: [context.failure, particles!.failure, browser.failure],
				executionContextId: context.executionContextId,
				beforeEvaluate() {
					expressionStarted = true;
				},
				async check() {
					context!.check();
					browser.check();
					if (expressionStarted)
						await send("Runtime.evaluate", {
							contextId: context!.executionContextId,
							expression: ELECTRON_PARTICLE_CHECK,
							awaitPromise: true,
							returnByValue: true,
						});
					await particles!.check();
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
					expression: ELECTRON_PARTICLE_CLEANUP,
					awaitPromise: true,
					returnByValue: true,
				});
		},
		disposeBrokers: [
			async () => {
				await initialization?.catch((error) => {
					if (error instanceof AggregateError) throw error;
				});
				samplerDisposalStarted = true;
				await particles?.dispose();
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
