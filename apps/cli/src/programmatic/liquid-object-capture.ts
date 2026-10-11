import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { launchFrameBrowser } from "./chromium-process";
import { htmlLiquidObjectCaptureExpression } from "./html-document";
import { enableParticleRootContext } from "./particle-capture-context";
import { openLiquidObjectBrowserContext } from "./liquid-object-browser-context";
import {
	createParticleCaptureIdentity as createCaptureIdentity,
	assertParticleCaptureSnapshot as assertCaptureSnapshot,
	raceParticleCapture as raceCapture,
	withHtmlCaptureCleanup,
} from "./particle-capture";
import {
	captureHtmlBrowserFrame,
	htmlBrowserException,
} from "./particle-capture-frame";
import { particleDeadline } from "./particle-broker-deadline";
import {
	assertCurrentThreeLiquidObjectAdapter,
	loadThreeLiquidObjectArchive,
} from "./three-liquid-object-provenance";
import {
	assertThreeLiquidObjectCompileIdentity,
	threeLiquidObjectCompileIdentity,
} from "./three-liquid-object-identity";
import { attachLiquidObjectFrame } from "./liquid-object-frame-host";
import type { ProgrammaticResourceStore } from "./resources";
import type { LiquidObjectPageConfig } from "./liquid-object-page-capture";
import { pinElectronScopedConnection } from "./electron-particle-transport";
import { captureElectronLiquidObjectPng } from "./liquid-object-electron-capture";

/** Explicit Liquid capability only; ordinary Three keeps the existing route. */
export async function captureThreeLiquidObjectPng(options: {
	executable?: string;
	connectionFile?: string;
	source: ProgrammaticSource;
	mappedFrame: unknown;
	code: string;
	resources: readonly ResolvedProgrammaticResource[];
	resourceStore?: ProgrammaticResourceStore;
	signal: AbortSignal;
}): Promise<Buffer> {
	const { source, code, resources, signal } = options;
	if (!options.resourceStore)
		throw Error(
			"Three Liquid capture requires its verified archive resource store",
		);
	if (
		source.audio ||
		resources.some(({ resource }) => resource.kind === "video")
	)
		throw Error(
			"Liquid Object capture does not support source audio or offthread video",
		);
	const archive = await loadThreeLiquidObjectArchive({
		source,
		resourceStore: options.resourceStore,
		signal,
	});
	if (!archive)
		throw Error("Three Liquid capture requires its explicit archived identity");
	assertCurrentThreeLiquidObjectAdapter(
		archive,
		source.resources?.some(
			(resource) =>
				resource.kind === "model" && resource.mimeType === "image/svg+xml",
		),
	);
	if (options.connectionFile) {
		const mapped = options.mappedFrame as {
			index?: unknown;
			time?: unknown;
			seed?: unknown;
		};
		if (
			!mapped ||
			typeof mapped.index !== "number" ||
			typeof mapped.time !== "number" ||
			typeof mapped.seed !== "number"
		)
			throw Error("Liquid capture requires a trusted Rust mapped frame");
		return captureElectronLiquidObjectPng({
			connection: await pinElectronScopedConnection(
				options.connectionFile,
				signal,
				"liquidObject-v1",
			),
			width: source.width,
			height: source.height,
			code,
			resources,
			frame: options.mappedFrame as {
				index: number;
				time: number;
				seed: number;
			},
			archive,
			signal,
		});
	}
	if (!options.executable)
		throw Error("No Liquid Object frame backend configured");
	const browser = await launchFrameBrowser(options.executable, signal);
	let session: string | undefined,
		expressionStarted = false;
	let context:
		| Awaited<ReturnType<typeof enableParticleRootContext>>
		| undefined;
	let liquid: Awaited<ReturnType<typeof attachLiquidObjectFrame>> | undefined;
	let initialization: Promise<void> | undefined;
	return withHtmlCaptureCleanup({
		async run() {
			const opened = await openLiquidObjectBrowserContext({
				browser,
				source,
				signal,
			});
			({ session, context } = opened);
			const { send } = opened;
			const identityInput = {
				session,
				code,
				resources,
				archiveIdentityHash: archive.identityHash,
				frame: options.mappedFrame,
			};
			const identity = createCaptureIdentity(identityInput);
			const copied: unknown = JSON.parse(JSON.stringify(options.mappedFrame));
			if (
				!copied ||
				typeof copied !== "object" ||
				!("index" in copied) ||
				!("time" in copied) ||
				!("seed" in copied) ||
				typeof copied.index !== "number" ||
				typeof copied.time !== "number" ||
				typeof copied.seed !== "number"
			)
				throw Error("Liquid capture requires a trusted Rust mapped frame");
			const mapped = {
				index: copied.index,
				time: copied.time,
				seed: copied.seed,
			};
			const frame = Object.freeze({
				sessionId: identity.captureId,
				index: mapped.index,
				time: mapped.time,
				seed: mapped.seed,
			});
			const pending = attachLiquidObjectFrame({
				browser,
				session,
				executionContextId: context.executionContextId,
				frame,
				expectedIdentity: archive.workerIdentity,
				signal,
			});
			initialization = pending.then((value) => {
				liquid = value;
			});
			await raceCapture(initialization, [context.failure]);
			context.check();
			assertThreeLiquidObjectCompileIdentity({
				archived: archive,
				current: threeLiquidObjectCompileIdentity({
					runtime: liquid!,
					adapterSha256: archive.adapterSha256,
				}),
			});
			assertCaptureSnapshot(identity, identityInput);
			const config: LiquidObjectPageConfig = Object.freeze({
				version: 1,
				frame,
				policy: liquid!.policy,
			});
			const expression = htmlLiquidObjectCaptureExpression({
				code,
				frame: options.mappedFrame,
				resources,
				config,
			});
			return captureHtmlBrowserFrame({
				send: (method, params) => send({ method, params }),
				expression,
				signal,
				failures: [context.failure, liquid!.failure],
				executionContextId: context.executionContextId,
				beforeEvaluate() {
					expressionStarted = true;
				},
				async check() {
					context!.check();
					if (!expressionStarted) return;
					const page = await send({
						method: "Runtime.evaluate",
						params: {
							contextId: context!.executionContextId,
							expression:
								"(() => { if(typeof window.__rocutLiquidObjectCheck!=='function') throw Error('Liquid page check unavailable'); return window.__rocutLiquidObjectCheck(); })()",
							awaitPromise: true,
							returnByValue: true,
						},
					});
					if (page.exceptionDetails)
						throw htmlBrowserException(
							"Liquid page check failed",
							page.exceptionDetails,
						);
					liquid!.check();
				},
			});
		},
		async cleanupPage() {
			if (!expressionStarted || !context || !session) return;
			const cleanup = await particleDeadline(
				browser.send(
					"Runtime.evaluate",
					{
						contextId: context.executionContextId,
						expression:
							"(() => { if(typeof window.__rocutLiquidObjectCleanup!=='function') throw Error('Liquid page cleanup unavailable'); return window.__rocutLiquidObjectCleanup(); })()",
						awaitPromise: true,
						returnByValue: true,
					},
					session,
				),
				archive.transportPolicy.cleanupTimeoutMs,
			);
			if (cleanup.exceptionDetails)
				throw htmlBrowserException(
					"Liquid page cleanup failed",
					cleanup.exceptionDetails,
				);
		},
		disposeBrokers: [
			async () => {
				await initialization?.catch((error) => {
					if (error instanceof AggregateError) throw error;
				});
				await liquid?.dispose();
			},
		],
		async closeBrowser() {
			context?.dispose();
			await browser.close();
		},
	});
}
