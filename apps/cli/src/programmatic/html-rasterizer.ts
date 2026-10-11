import * as wasm from "opencut-wasm";
import type { ProgrammaticFrameRequest } from "@opencut/editor-contracts";
import { launchFrameBrowser } from "./chromium-process";
import { htmlCaptureExpression } from "./html-document";
import { captureElectronPng } from "./electron-transport";
import { pinElectronParticleConnection } from "./electron-particle-transport";
import { captureElectronParticlePng } from "./electron-particle-capture";
import {
	loadProgrammaticResources,
	type ProgrammaticResourceStore,
} from "./resources";
import { resolveHtmlDocumentCode } from "./document-resource";
import { attachOffthreadBroker } from "./offthread-broker";
import { createElectronNativeVideoServer } from "./electron-native-video-server";
import type { NativeVideoDecoder } from "./video-decoder";
import { admitNativeAudioSources } from "./remotion-audio-analysis";
import type { NativeAudioAnalysisConfig } from "./remotion-audio-bootstrap";
import { attachParticleSamplerFrame } from "./particle-broker-host";
import { enableParticleRootContext } from "./particle-capture-context";
import {
	createParticleCaptureIdentity,
	assertParticleCaptureSnapshot,
	raceParticleCapture,
	withHtmlCaptureCleanup,
} from "./particle-capture";
import {
	captureHtmlBrowserFrame,
	htmlBrowserException,
} from "./particle-capture-frame";
import { particleDeadline } from "./particle-broker-deadline";
import { hasThreeLiquidObjectCapability } from "./three-liquid-object-provenance";
import { captureThreeLiquidObjectPng } from "./liquid-object-capture";
import {
	PARTICLE_PAGE_CLEANUP_NAME,
	PARTICLE_PAGE_CHECK_NAME,
	type ParticlePageConfig,
} from "./particle-page-contract";
import {
	assertCurrentThreeParticleAdapter,
	assertThreeParticleCompileIdentity,
	hasThreeParticleCapability,
	loadThreeParticleArchive,
	threeParticleCompileIdentity,
} from "./three-particle-provenance";

/** Platform adapter only: Rust rechecks every source/range before launching. */
export async function renderHtmlPng({
	executable,
	connectionFile,
	request,
	signal,
	resourceStore,
	nativeVideoDecoder,
}: {
	executable?: string;
	connectionFile?: string;
	request: ProgrammaticFrameRequest;
	signal: AbortSignal;
	resourceStore?: ProgrammaticResourceStore;
	nativeVideoDecoder?: NativeVideoDecoder;
}): Promise<Buffer> {
	const particleEnabled = hasThreeParticleCapability(request.source);
	const electronParticles =
		particleEnabled && connectionFile
			? await pinElectronParticleConnection(connectionFile, signal)
			: undefined;
	if (particleEnabled && !resourceStore)
		throw Error(
			"Three particle capture requires its verified archive resource store",
		);
	const mapped = JSON.parse(
		wasm.resolveProgrammaticFrameJson(JSON.stringify(request)),
	);
	if (
		mapped.error ||
		!mapped.frame ||
		request.source.runtime !== "html-document"
	)
		throw new Error(
			mapped.error ?? "Expected an active html-document source frame",
		);
	const { source } = request;
	if (source.resources?.length && !resourceStore)
		throw new Error("HTML host cannot load project resources");
	const resources = resourceStore
		? await loadProgrammaticResources(
				resourceStore,
				source.resources ?? [],
				signal,
			)
		: [];
	// Three's shared loader must preflight image dimensions before any bitmap decode.
	// The default DOM image bridge would otherwise decode these resources eagerly.
	const code = resolveHtmlDocumentCode(source, resources);
	if (hasThreeLiquidObjectCapability(source))
		return captureThreeLiquidObjectPng({
			executable,
			connectionFile,
			source,
			mappedFrame: mapped.frame,
			code,
			resources,
			resourceStore,
			signal,
		});
	const particleArchive = particleEnabled
		? await loadThreeParticleArchive({
				source,
				resourceStore: resourceStore!,
				signal,
			})
		: undefined;
	if (particleEnabled && !particleArchive)
		throw Error("Three particle capture requires its archived identity");
	if (particleArchive) assertCurrentThreeParticleAdapter(particleArchive);
	if (source.audio && (!nativeVideoDecoder || connectionFile))
		throw Error(
			"Native source audio requires the configured soundtrack adapter on this backend",
		);
	const audioLimits = source.audio
		? JSON.parse(wasm.programmaticAudioPolicyJson())
		: null;
	const soundtrack: NativeAudioAnalysisConfig | undefined = audioLimits
		? {
				limits: audioLimits,
				engine:
					source.build?.engine === "hyperframes" ? "hyperframes" : "remotion",
				hyperframesGraph: source.audio?.profile === "hyperframes-graph-v1",
				sources: admitNativeAudioSources(code, resources, audioLimits).map(
					({ id, src }) => ({ id, src }),
				),
			}
		: undefined;
	if (electronParticles && particleArchive) {
		if (resources.some(({ resource }) => resource.kind === "video"))
			throw Error(
				"Electron particle sessions do not support source audio or offthread video",
			);
		return captureElectronParticlePng({
			connection: electronParticles,
			width: source.width,
			height: source.height,
			code,
			resources,
			frame: mapped.frame,
			archive: particleArchive,
			signal,
		});
	}
	if (connectionFile) {
		const nativeFrames = nativeVideoDecoder
			? await createElectronNativeVideoServer({
					decoder: nativeVideoDecoder,
					code,
					resources,
					limits: mapped.frame.videoLimits,
					signal,
				})
			: undefined;
		try {
			const png = await captureElectronPng({
				connectionFile,
				width: source.width,
				height: source.height,
				expression: htmlCaptureExpression(
					code,
					mapped.frame,
					resources,
					source.build?.engine !== "three",
					!!nativeFrames,
					soundtrack,
				),
				signal,
				...(nativeFrames ? { nativeVideo: nativeFrames.callback } : {}),
			});
			await nativeFrames?.check();
			return png;
		} finally {
			await nativeFrames?.dispose();
		}
	}
	if (!executable) throw Error("No HTML frame backend configured");
	const browser = await launchFrameBrowser(executable, signal);
	let nativeFrames:
		| Awaited<ReturnType<typeof attachOffthreadBroker>>
		| undefined;
	let particles:
		| Awaited<ReturnType<typeof attachParticleSamplerFrame>>
		| undefined;
	let particleInitialization: Promise<void> | undefined;
	let context:
		| Awaited<ReturnType<typeof enableParticleRootContext>>
		| undefined;
	let session: string | undefined;
	let expressionStarted = false;
	return withHtmlCaptureCleanup({
		async run() {
			const target = await browser.send("Target.createTarget", {
				url: "about:blank",
			});
			const attached = await browser.send("Target.attachToTarget", {
				targetId: target.targetId,
				flatten: true,
			});
			if (typeof attached.sessionId !== "string" || !attached.sessionId)
				throw Error("HTML browser returned no capture session");
			session = attached.sessionId;
			const send = (method: string, params = {}) =>
				browser.send(method, params, session);
			await send("Network.enable");
			await send("Page.enable");
			await send("Network.setBlockedURLs", {
				urls: [
					"http://*",
					"https://*",
					"file://*",
					"ftp://*",
					"ws://*",
					"wss://*",
				],
			});
			await send("Emulation.setDeviceMetricsOverride", {
				width: source.width,
				height: source.height,
				deviceScaleFactor: 1,
				mobile: false,
			});
			await send("Emulation.setDefaultBackgroundColorOverride", {
				color: { r: 0, g: 0, b: 0, a: 0 },
			});
			if (particleArchive)
				context = await enableParticleRootContext({
					browser,
					session,
					signal,
					timeoutMs: 5000,
				});
			else await send("Runtime.enable");
			if (nativeVideoDecoder)
				nativeFrames = await attachOffthreadBroker({
					browser,
					session,
					decoder: nativeVideoDecoder,
					code,
					resources,
					limits: mapped.frame.videoLimits,
					signal,
				});
			let particleConfig: ParticlePageConfig | undefined;
			if (particleArchive && context) {
				const identityInput = {
					session,
					code,
					resources,
					archiveIdentityHash: particleArchive.identityHash,
					frame: mapped.frame,
				};
				const identity = createParticleCaptureIdentity(identityInput);
				const pending = attachParticleSamplerFrame({
					mappedFrame: mapped.frame,
					browser,
					session,
					executionContextId: context.executionContextId,
					identity,
					signal,
					bootstrapTimeoutMs: 5000,
					expectedIdentity: particleArchive.samplerIdentity,
				});
				// Retain late ownership even if context failure wins the race. Cleanup
				// must await this initialization before it can dispose the new worker.
				particleInitialization = pending.then((value) => {
					particles = value;
				});
				await raceParticleCapture(particleInitialization, [context.failure]);
				context.check();
				assertThreeParticleCompileIdentity(
					particleArchive,
					threeParticleCompileIdentity(
						particles!,
						particleArchive.adapterSha256,
					),
				);
				// Worker admission yields to other host tasks. Rebind neither resource
				// bytes nor Rust frame after that await: reject mutation, then serialize
				// the actual worker publication and verified bytes synchronously.
				assertParticleCaptureSnapshot(identity, identityInput);
				particleConfig = Object.freeze({
					version: 1,
					identity,
					policy: particles!.policy,
					requestTimeoutMs: particles!.policy.requestTimeoutMs,
				});
			}
			const expression = htmlCaptureExpression(
				code,
				mapped.frame,
				resources,
				source.build?.engine !== "three",
				!!nativeVideoDecoder,
				soundtrack,
				particleConfig,
			);
			const failures = [
				...(context ? [context.failure] : []),
				...(particles ? [particles.failure] : []),
			];
			return captureHtmlBrowserFrame({
				send,
				expression,
				signal,
				failures,
				executionContextId: context?.executionContextId,
				beforeEvaluate() {
					expressionStarted = true;
				},
				async check() {
					context?.check();
					if (particleArchive && context && expressionStarted) {
						const page = await send("Runtime.evaluate", {
							contextId: context.executionContextId,
							expression: `(() => { const check = window[${JSON.stringify(PARTICLE_PAGE_CHECK_NAME)}]; if (typeof check !== 'function') throw Error('Particle page check is unavailable'); return check(); })()`,
							awaitPromise: true,
							returnByValue: true,
						});
						if (page.exceptionDetails)
							throw htmlBrowserException(
								"Particle page check failed",
								page.exceptionDetails,
							);
					}
					await Promise.all([nativeFrames?.check(), particles?.check()]);
				},
			});
		},
		async cleanupPage() {
			if (!particleArchive || !expressionStarted || !context || !session)
				return;
			const cleanup = await particleDeadline(
				browser.send(
					"Runtime.evaluate",
					{
						contextId: context.executionContextId,
						expression: `(() => { const cleanup = window[${JSON.stringify(PARTICLE_PAGE_CLEANUP_NAME)}]; if (typeof cleanup !== 'function') throw Error('Particle page cleanup is unavailable'); return cleanup(); })()`,
						awaitPromise: true,
						returnByValue: true,
					},
					session,
				),
				particleArchive.transportPolicy.hostDefaults.cleanupTimeoutMs,
			);
			if (cleanup.exceptionDetails)
				throw htmlBrowserException(
					"Particle page cleanup failed",
					cleanup.exceptionDetails,
				);
		},
		disposeBrokers: [
			async () => {
				// The initializer itself owns failure cleanup. Preserve any aggregate
				// cleanup uncertainty rather than losing it when context failure won.
				await particleInitialization?.catch((error) => {
					if (error instanceof AggregateError) throw error;
				});
				await particles?.dispose();
			},
			async () => {
				await nativeFrames?.dispose();
			},
		],
		async closeBrowser() {
			context?.dispose();
			await browser.close();
		},
	});
}
