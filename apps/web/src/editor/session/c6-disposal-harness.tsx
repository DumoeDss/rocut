"use client";

import { useEffect, useRef, useState } from "react";

import type {
	AudioContextHandle,
	ObjectUrlHandle,
	RuntimeGpuResourceQuery,
	RuntimeResourceHost,
	WorkerHandle,
} from "@opencut/editor-ports";
import type { EditorHost } from "@opencut/editor-ports/host";
import { editorForSession } from "@/editor/runtime/session-core-owner";
import { prepareWasmRuntimeProviders } from "@/editor/runtime/wasm-runtime-providers";
import { createRafLoop } from "@/hooks/use-raf-loop";
import { buildScene } from "@/services/renderer/scene-builder";
import { createEditorSession, type EditorSession } from "@/editor/session";
import {
	SessionActivityGenerationError,
	type SessionResourceLifecycle,
} from "@/editor/session/session-resources";
import type { DisposalReport, SessionResources } from "./resources";
import type { DurableReopenProofResult } from "./c6-durable-reopen";
import {
	runDurableReopenBrowserProof,
	type DurableReopenPreparation,
} from "./c6-durable-reopen-browser";
import {
	DISPOSAL_ORACLE_CLASSES,
	evaluateDisposalRun,
	runDisposalCycles,
	type DisposalCycleObservation,
	type DisposalOracleResult,
} from "./disposal-oracle";
import {
	installIndependentTimerLedger,
	type IndependentPlatformCounts,
	type IndependentTimerLedger,
} from "./independent-timer-ledger";

export type C6DisposalControl = "ordinary" | "missing-created" | "leak";

export interface C6DisposalHarnessProps {
	readonly createHost: (args: {
		projectId: string;
		onProjectReplaced: (projectId: string) => void;
		onExitProject: () => void;
		onGoBack: () => void;
	}) => EditorHost;
	readonly isDurableBrowserStore: (store: EditorHost["store"]) => boolean;
	readonly buildMarker: string;
}

type HarnessState =
	| { status: "starting"; result: null; error: null }
	| {
			status: "ready";
			result: DisposalOracleResult | DurableReopenProofResult;
			error: null;
	  }
	| { status: "error"; result: null; error: string };

function readControl(): C6DisposalControl {
	if (typeof window === "undefined") return "ordinary";
	const value = new URLSearchParams(window.location.search).get("control");
	return value === "missing-created" || value === "leak" ? value : "ordinary";
}

function readProof(): "durable-reopen" | null {
	if (typeof window === "undefined") return null;
	return new URLSearchParams(window.location.search).get("proof") ===
		"durable-reopen"
		? "durable-reopen"
		: null;
}

interface IndependentRuntimeLedger {
	readonly runtimeResources: RuntimeResourceHost;
	readonly counts: Record<
		"worker" | "audioContext" | "objectUrl",
		IndependentPlatformCounts
	>;
	/** Raw workers retained by the leak control until the observation is captured. */
	readonly retainedWorkers: Set<WorkerHandle>;
}

function createIndependentRuntimeLedger({
	runtimeResources,
	control,
	cycle,
}: {
	runtimeResources: RuntimeResourceHost;
	control: C6DisposalControl;
	cycle: number;
}): IndependentRuntimeLedger {
	const counts = {
		worker: { created: 0, released: 0 },
		audioContext: { created: 0, released: 0 },
		objectUrl: { created: 0, released: 0 },
	};
	const retainedWorkers = new Set<WorkerHandle>();
	const leakWorker = control === "leak" && cycle === 6;

	const wrapped: RuntimeResourceHost = {
		createWorker: (args) => {
			const raw = runtimeResources.createWorker(args);
			counts.worker.created += 1;
			let terminated = false;
			const handle: WorkerHandle = {
				id: raw.id,
				resourceId: raw.resourceId,
				postMessage: (message) => raw.postMessage(message),
				onMessage: (listener) => raw.onMessage(listener),
				onError: (listener) => raw.onError(listener),
				terminate: () => {
					if (terminated) return;
					terminated = true;
					if (leakWorker) {
						retainedWorkers.add(raw);
						return;
					}
					counts.worker.released += 1;
					raw.terminate();
				},
			};
			return handle;
		},
		createAudioContext: (args) => {
			const raw = runtimeResources.createAudioContext(args);
			counts.audioContext.created += 1;
			let closed = false;
			const handle: AudioContextHandle = {
				resourceId: raw.resourceId,
				sampleRate: raw.sampleRate,
				get state() {
					return raw.state;
				},
				get context() {
					return raw.context;
				},
				close: async () => {
					if (closed) return;
					await raw.close();
					closed = true;
					counts.audioContext.released += 1;
				},
			};
			return handle;
		},
		createObjectUrl: (args) => {
			const raw = runtimeResources.createObjectUrl(args);
			counts.objectUrl.created += 1;
			let revoked = false;
			const handle: ObjectUrlHandle = {
				...raw,
				revoke: () => {
					if (revoked) return;
					revoked = true;
					counts.objectUrl.released += 1;
					raw.revoke();
				},
			};
			return handle;
		},
	};

	return { runtimeResources: wrapped, counts, retainedWorkers };
}

function runtimeGpuForControl({
	runtimeGpu,
	control,
	leak,
}: {
	runtimeGpu: RuntimeGpuResourceQuery;
	control: C6DisposalControl;
	leak: boolean;
}): RuntimeGpuResourceQuery {
	if (control !== "leak" || !leak) return runtimeGpu;
	return {
		liveHandles: () => runtimeGpu.liveHandles(),
		// Keep the real WASM handle live while reporting a successful registry
		// release. The oracle must catch the runtime residual, not a count mismatch.
		release: () => {},
	};
}

/** Yield real browser task turns without acquiring an unmediated timer. */
async function yieldBrowserTasks(minimumMs = 20): Promise<void> {
	const started = performance.now();
	await new Promise<void>((resolve) => {
		const channel = new MessageChannel();
		const advance = () => {
			if (performance.now() - started >= minimumMs) {
				channel.port1.close();
				channel.port2.close();
				resolve();
				return;
			}
			channel.port2.postMessage(undefined);
		};
		channel.port1.addEventListener("message", advance);
		channel.port1.start();
		channel.port2.postMessage(undefined);
	});
}

interface RetainedRendererActivitySnapshot {
	readonly publications: number;
	readonly generation: number | null;
	readonly resourceId: string | null;
}

interface RetainedRendererActivity {
	compositorHandle(): number | null;
	snapshot(): RetainedRendererActivitySnapshot;
	stop(): void;
	throwIfFailed(): void;
}

type ActivityGenerationAssertion = Pick<
	SessionResourceLifecycle,
	"assertActivityGeneration"
>;

function hasActivityGenerationAssertion(
	resources: SessionResources,
): resources is SessionResources & ActivityGenerationAssertion {
	return (
		"assertActivityGeneration" in resources &&
		typeof resources.assertActivityGeneration === "function"
	);
}

function resolveActivityGenerationAssertion(
	resources: SessionResources,
): ActivityGenerationAssertion {
	if (!hasActivityGenerationAssertion(resources)) {
		throw new Error("Renderer activity requires a session generation gate.");
	}
	return resources;
}

function startRetainedRendererActivity({
	session,
}: {
	session: EditorSession;
}): RetainedRendererActivity {
	const editor = editorForSession(session);
	const renderer = editor.renderer.createCanvasRenderer({
		width: 16,
		height: 10,
		fps: { numerator: 30, denominator: 1 },
	});
	const tracks = {
		overlay: [],
		main: {
			id: `c6-main-${session.id}`,
			name: "Main",
			type: "video" as const,
			elements: [],
			muted: false,
			hidden: false,
		},
		audio: [],
	};
	const renderTree = buildScene({
		tracks,
		mediaAssets: [],
		duration: 1,
		canvasSize: { width: 16, height: 10 },
		background: { type: "color", color: "#09090b" },
		assetResolver: editor.renderer.assetResolver,
	});
	const activityLifecycle = resolveActivityGenerationAssertion(
		session.resources,
	);
	let latestRequest: { resourceId: string; generation: number } | null = null;
	let publications = 0;
	let publicationGeneration: number | null = null;
	let publicationResourceId: string | null = null;
	let rendering = false;
	let stopped = false;
	let failure: unknown;
	let stopLoop = () => {};

	const render = ({
		generation,
		resourceId,
	}: {
		generation: number;
		resourceId: string;
	}) => {
		if (rendering || stopped || failure !== undefined) return;
		rendering = true;
		void renderer
			.render({ node: renderTree, time: 0 })
			.then(() => {
				activityLifecycle.assertActivityGeneration({ generation });
				if (stopped) return;
				publications += 1;
				publicationGeneration = generation;
				publicationResourceId = resourceId;
			})
			.catch((error: unknown) => {
				if (error instanceof SessionActivityGenerationError) return;
				failure = error;
			})
			.finally(() => {
				rendering = false;
			});
	};

	stopLoop = createRafLoop({
		resources: session.resources,
		callback: () => {
			if (latestRequest) render(latestRequest);
		},
		onRequest: ({ resourceId, generation }) => {
			latestRequest = { resourceId: String(resourceId), generation };
		},
	});

	return {
		compositorHandle: () => editor.renderer.getCompositorHandle(),
		snapshot: () => ({
			publications,
			generation: publicationGeneration,
			resourceId: publicationResourceId,
		}),
		stop: () => {
			if (stopped) return;
			stopped = true;
			stopLoop();
		},
		throwIfFailed: () => {
			if (failure === undefined) return;
			throw failure;
		},
	};
}

async function waitForRetainedRendererPublication({
	activity,
	after,
	timeoutMs = 2_000,
}: {
	activity: RetainedRendererActivity;
	after: number;
	timeoutMs?: number;
}): Promise<RetainedRendererActivitySnapshot> {
	const started = performance.now();
	while (performance.now() - started < timeoutMs) {
		activity.throwIfFailed();
		const snapshot = activity.snapshot();
		if (snapshot.publications > after) return snapshot;
		await yieldBrowserTasks(20);
	}
	activity.throwIfFailed();
	throw new Error(
		`Retained renderer did not publish after ${after} successful render(s).`,
	);
}

function platformObservation({
	resourceClass,
	report,
	independent,
}: {
	resourceClass: (typeof DISPOSAL_ORACLE_CLASSES)[number];
	report: DisposalCycleObservation["report"];
	independent?: IndependentPlatformCounts;
}): DisposalCycleObservation["platform"][typeof resourceClass] {
	if (independent) {
		const residual = independent.created - independent.released;
		return {
			residual,
			terminal: residual === 0,
			detail:
				residual === 0
					? "independent Host/global ledger is terminal"
					: `independent ledger retained ${residual} handle(s)`,
		};
	}
	if (resourceClass === "gpuResource") {
		const residual =
			(report.gpuReconciliation?.untracked.length ?? 0) +
			(report.gpuReconciliation?.leaked.length ?? 0);
		return {
			residual,
			terminal: residual === 0,
			detail:
				residual === 0
					? "runtime liveHandles() is empty"
					: `runtime liveHandles() retained ${residual} handle(s)`,
		};
	}
	const counts = report[resourceClass];
	const residual = counts.created - counts.released;
	return {
		residual,
		terminal: residual === 0,
		detail:
			residual === 0 ? "registry count is terminal" : "registry count is live",
	};
}

function isDisposalReport(value: unknown): value is DisposalReport {
	if (typeof value !== "object" || value === null) return false;
	const classesValid = DISPOSAL_ORACLE_CLASSES.every((resourceClass) => {
		const counts = Reflect.get(value, resourceClass);
		return (
			typeof counts === "object" &&
			counts !== null &&
			typeof Reflect.get(counts, "created") === "number" &&
			typeof Reflect.get(counts, "released") === "number"
		);
	});
	if (!classesValid || !Array.isArray(Reflect.get(value, "releaseOrder"))) {
		return false;
	}
	const reconciliation = Reflect.get(value, "gpuReconciliation");
	if (typeof reconciliation !== "object" || reconciliation === null) {
		return false;
	}
	const source = Reflect.get(reconciliation, "source");
	return (
		(source === "runtime" || source === "unimplemented") &&
		Array.isArray(Reflect.get(reconciliation, "untracked")) &&
		Array.isArray(Reflect.get(reconciliation, "leaked"))
	);
}

async function runCycle({
	cycle,
	control,
	createHost,
	target,
	active,
	prepareSession,
}: {
	cycle: number;
	control: C6DisposalControl;
	createHost: C6DisposalHarnessProps["createHost"];
	target: HTMLDivElement;
	active: Set<EditorSession>;
	prepareSession?: (args: DurableReopenPreparation) => Promise<void>;
}): Promise<DisposalCycleObservation> {
	const rawHost = createHost({
		projectId: `c6-disposal-${control}-${cycle}`,
		onProjectReplaced: () => {},
		onExitProject: () => {},
		onGoBack: () => {},
	});
	const runtime = await prepareWasmRuntimeProviders();
	const independentRuntime = createIndependentRuntimeLedger({
		runtimeResources: rawHost.runtimeResources,
		control,
		cycle,
	});
	const host = Object.freeze({
		...rawHost,
		runtimeResources: independentRuntime.runtimeResources,
	});
	let session: EditorSession | null = null;
	let worker: WorkerHandle | null = null;
	let sessionDisposed = false;
	let runtimeDisposed = false;
	let timerLedger: IndependentTimerLedger | null = null;
	let timerCallbacks = 0;
	let workerMessages = 0;
	let workerErrors = 0;
	let savePublications = 0;
	let retainedRenderer: RetainedRendererActivity | null = null;
	let stopSaveObservation: (() => void) | null = null;
	try {
		session = await createEditorSession({
			host,
			runtimeGraphics: runtime.runtimeGraphics,
			runtimeGpu: runtimeGpuForControl({
				runtimeGpu: runtime.runtimeGpu,
				control,
				// Keep the real compositor alive only in the final cycle. Earlier
				// cycles must release their handles so the real C0b capacity gate does
				// not prevent the six-cycle leak control from reaching the oracle.
				leak: control === "leak" && cycle === 6,
			}),
		});
		active.add(session);
		const root = session.mount({ target });
		await root.ready;
		timerLedger = installIndependentTimerLedger();
		const editor = editorForSession(session);
		const projectIdBefore = session.projectId;
		stopSaveObservation = editor.save.observePublications(() => {
			savePublications += 1;
		});
		await prepareSession?.({ session, editor });

		// Leave every handle live until session.dispose() so the ordinary run proves
		// the session-owned teardown path rather than individual call-site cleanup.
		session.resources.setInterval({
			handler: () => {
				timerCallbacks += 1;
			},
			ms: 5,
		});
		// Retain the same production RAF owner used by PreviewCanvas. Only a
		// successful, current-generation CanvasRenderer.render() completion counts
		// as a publication; suspend drains its old RAF chain and resume must acquire
		// a distinct resource before another render can complete.
		retainedRenderer = startRetainedRendererActivity({ session });
		// Queue a debounced save before suspend. Core.suspend must cancel that timer;
		// the pending intent may replay only after resume.
		editor.save.markDirty({ force: true });
		if (control !== "missing-created") {
			worker = session.resources.createWorker({
				request: {
					id: `c6-disposal-worker-${cycle}`,
					url: new URL(
						host.assets.resolve({
							ref: { path: "workers/c4-worker-fixture.js" },
						}),
						window.location.href,
					),
					type: "classic",
					name: `C6 disposal worker ${cycle}`,
				},
			});
			worker.onMessage(() => {
				workerMessages += 1;
			});
			worker.onError(() => {
				workerErrors += 1;
			});
			worker.postMessage({
				message: { kind: "ping", payload: new Uint8Array([cycle]).buffer },
			});
		}
		const audio = session.resources.createAudioContext({
			request: { sampleRate: 44_100 },
		});
		const objectUrl = session.resources.createObjectUrl({
			blob: new Blob([`c6-${control}-${cycle}`], { type: "text/plain" }),
		});
		let objectUrlFetchedBeforeDispose = false;
		try {
			const response = await fetch(objectUrl.url);
			objectUrlFetchedBeforeDispose = response.ok;
			await response.text();
		} catch {
			objectUrlFetchedBeforeDispose = false;
		}
		// Let the interval and Worker each exercise their live callbacks before
		// disposal. The same task-turn helper is used after disposal to prove that
		// no callback/message can arrive on a terminal handle.
		await yieldBrowserTasks(220);
		const rendererBeforeSuspend = await waitForRetainedRendererPublication({
			activity: retainedRenderer,
			after: 0,
		});
		const compositor = { handle: retainedRenderer.compositorHandle() };
		const audioStateBeforeDispose = audio.state;

		await session.suspend();
		const rootMountedDuringSuspend = root.state === "mounted";
		const suspendedEditor = editorForSession(session);
		const suspendedDwellBefore = {
			timerCallbacks,
			timerResourcesCreated: session.resources.inspect().timer.created,
			workerMessages: worker ? workerMessages : null,
			workerErrors: worker ? workerErrors : null,
			savePublications,
			renderActivity: retainedRenderer.snapshot(),
		};
		let acquisitionRefused = false;
		try {
			session.resources.setTimeout({ handler: () => {}, ms: 1 });
		} catch (error) {
			acquisitionRefused =
				error instanceof Error && /admission is closed/i.test(error.message);
		}
		await yieldBrowserTasks(120);
		const suspendedDwellAfter = {
			timerCallbacks,
			timerResourcesCreated: session.resources.inspect().timer.created,
			workerMessages: worker ? workerMessages : null,
			workerErrors: worker ? workerErrors : null,
			savePublications,
			renderActivity: retainedRenderer.snapshot(),
		};
		await session.resume();
		const rootMountedAfterResume = root.state === "mounted";
		const rendererAfterResume = await waitForRetainedRendererPublication({
			activity: retainedRenderer,
			after: suspendedDwellAfter.renderActivity.publications,
		});
		const postResumeOperation =
			rendererAfterResume.publications >
				suspendedDwellAfter.renderActivity.publications &&
			rendererBeforeSuspend.generation !== null &&
			rendererAfterResume.generation !== null &&
			rendererAfterResume.generation > rendererBeforeSuspend.generation &&
			rendererBeforeSuspend.resourceId !== null &&
			rendererAfterResume.resourceId !== null &&
			rendererAfterResume.resourceId !== rendererBeforeSuspend.resourceId;
		const lifecycle = {
			projectIdBefore,
			projectIdAfter: session.projectId,
			rootMountedDuringSuspend,
			rootMountedAfterResume,
			sameEditor: suspendedEditor === editor,
			postResumeOperation,
		};
		if (
			!rootMountedDuringSuspend ||
			!rootMountedAfterResume ||
			!lifecycle.sameEditor ||
			!lifecycle.postResumeOperation
		) {
			throw new Error("C6 suspend/resume lifecycle invariant failed");
		}

		const before = session.resources.inspect();
		const selectedBackend = runtime.runtimeGraphics.selectedBackend();
		const concurrentCompositorInstances =
			runtime.runtimeGraphics.concurrentCompositorInstances();
		const liveHandlesBeforeDispose = [...runtime.runtimeGpu.liveHandles()];
		const timerCallbacksBeforeDispose = timerCallbacks;
		const workerMessagesBeforeDispose = worker ? workerMessages : null;
		const workerErrorsBeforeDispose = worker ? workerErrors : null;
		let report = before;
		try {
			report = await session.dispose();
		} catch (error) {
			if (
				typeof error === "object" &&
				error !== null &&
				"report" in error &&
				isDisposalReport(error.report)
			) {
				report = error.report;
			} else {
				report = session.resources.inspect();
			}
		}
		sessionDisposed = true;
		await yieldBrowserTasks(60);
		const timerCallbacksAfterDispose = timerCallbacks;
		const workerMessagesAfterDispose = worker ? workerMessages : null;
		const workerErrorsAfterDispose = worker ? workerErrors : null;
		let objectUrlFetchAfterDispose = false;
		try {
			const response = await fetch(objectUrl.url);
			objectUrlFetchAfterDispose = response.ok;
			await response.text();
		} catch {
			objectUrlFetchAfterDispose = false;
		}
		const audioStateAfterDispose = audio.state;
		const liveHandlesAfterDispose = [...runtime.runtimeGpu.liveHandles()];
		const independentTimers = timerLedger.snapshot();
		const independentRuntimeCounts = independentRuntime.counts;
		let runtimeDisposeError: string | null = null;
		try {
			await runtime.dispose();
			runtimeDisposed = true;
		} catch (error) {
			runtimeDisposeError =
				error instanceof Error ? error.message : String(error);
			runtimeDisposed = true;
		}
		return {
			cycle,
			beforeDispose: {
				timer: { created: before.timer.created },
				worker: { created: before.worker.created },
				audioContext: { created: before.audioContext.created },
				objectUrl: { created: before.objectUrl.created },
				gpuResource: { created: before.gpuResource.created },
			},
			report,
			platform: {
				timer: platformObservation({ resourceClass: "timer", report }),
				worker: platformObservation({ resourceClass: "worker", report }),
				audioContext: platformObservation({
					resourceClass: "audioContext",
					report,
				}),
				objectUrl: platformObservation({
					resourceClass: "objectUrl",
					report,
				}),
				gpuResource: platformObservation({
					resourceClass: "gpuResource",
					report,
				}),
			},
			independentPlatform: {
				timer: platformObservation({
					resourceClass: "timer",
					report,
					independent: independentTimers,
				}),
				worker: platformObservation({
					resourceClass: "worker",
					report,
					independent: independentRuntimeCounts.worker,
				}),
				audioContext: platformObservation({
					resourceClass: "audioContext",
					report,
					independent: independentRuntimeCounts.audioContext,
				}),
				objectUrl: platformObservation({
					resourceClass: "objectUrl",
					report,
					independent: independentRuntimeCounts.objectUrl,
				}),
				gpuResource: platformObservation({
					resourceClass: "gpuResource",
					report,
				}),
			},
			lifecycle,
			platformProof: {
				timerCallbacksBeforeDispose,
				timerCallbacksAfterDispose,
				timerTerminal:
					timerCallbacksAfterDispose === timerCallbacksBeforeDispose,
				workerMessagesBeforeDispose,
				workerMessagesAfterDispose,
				workerErrorsBeforeDispose,
				workerErrorsAfterDispose,
				workerTerminal:
					worker === null
						? null
						: workerMessagesAfterDispose === workerMessagesBeforeDispose &&
							workerErrorsAfterDispose === workerErrorsBeforeDispose,
				audioStateBeforeDispose,
				audioStateAfterDispose,
				audioTerminal: audioStateAfterDispose === "closed",
				objectUrlFetchedBeforeDispose,
				objectUrlFetchAfterDispose,
				objectUrlTerminal: !objectUrlFetchAfterDispose,
				gpuTerminal: liveHandlesAfterDispose.length === 0,
				suspendedDwell: {
					timerCallbacksBefore: suspendedDwellBefore.timerCallbacks,
					timerCallbacksAfter: suspendedDwellAfter.timerCallbacks,
					workerMessagesBefore: suspendedDwellBefore.workerMessages,
					workerMessagesAfter: suspendedDwellAfter.workerMessages,
					workerErrorsBefore: suspendedDwellBefore.workerErrors,
					workerErrorsAfter: suspendedDwellAfter.workerErrors,
					savePublicationsBefore: suspendedDwellBefore.savePublications,
					savePublicationsAfter: suspendedDwellAfter.savePublications,
					renderPublicationsBefore:
						suspendedDwellBefore.renderActivity.publications,
					renderPublicationsAfter:
						suspendedDwellAfter.renderActivity.publications,
					timerResourcesCreatedBefore:
						suspendedDwellBefore.timerResourcesCreated,
					timerResourcesCreatedAfter: suspendedDwellAfter.timerResourcesCreated,
					rendererBeforeSuspend,
					rendererDwellAfter: suspendedDwellAfter.renderActivity,
					rendererAfterResume,
					acquisitionRefused,
					postResumeActivity:
						rendererAfterResume.publications >
						suspendedDwellAfter.renderActivity.publications,
				},
			},
			runtime: {
				selectedBackend: selectedBackend ?? null,
				concurrentCompositorInstances,
				compositorHandle: compositor.handle,
				liveHandlesBeforeDispose,
				liveHandlesAfterDispose,
				disposeError: runtimeDisposeError,
			},
		};
	} finally {
		if (session && !sessionDisposed) {
			await session.dispose().catch(() => {});
		}
		retainedRenderer?.stop();
		if (!runtimeDisposed) {
			await Promise.resolve(runtime.dispose()).catch(() => {});
		}
		timerLedger?.restore();
		for (const retainedWorker of independentRuntime.retainedWorkers) {
			retainedWorker.terminate();
		}
		if (session) active.delete(session);
		stopSaveObservation?.();
		stopSaveObservation = null;
		void worker;
	}
}

export function C6DisposalHarness({
	createHost,
	isDurableBrowserStore,
	buildMarker,
}: C6DisposalHarnessProps) {
	const targetRef = useRef<HTMLDivElement>(null);
	const active = useRef<Set<EditorSession>>(new Set());
	const [state, setState] = useState<HarnessState>({
		status: "starting",
		result: null,
		error: null,
	});
	const control = readControl();
	const proof = readProof();

	useEffect(() => {
		let cancelled = false;
		const target = targetRef.current;
		const activeSessions = active.current;
		if (!target) {
			setState({
				status: "error",
				result: null,
				error: "C6 disposal target was not mounted.",
			});
			return () => {
				cancelled = true;
			};
		}

		const run =
			proof === "durable-reopen"
				? runDurableReopenBrowserProof({
						buildMarker,
						target,
						active: activeSessions,
						isDurableBrowserStore,
						runFirstCycle: (prepareSession) =>
							runCycle({
								cycle: 1,
								control,
								createHost,
								target,
								active: activeSessions,
								prepareSession,
							}),
					})
				: runDisposalCycles({
						cycles: 6,
						runCycle: (cycle) =>
							runCycle({
								cycle,
								control,
								createHost,
								target,
								active: activeSessions,
							}),
					});

		void run
			.then((result) => {
				if (!cancelled) setState({ status: "ready", result, error: null });
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setState({
						status: "error",
						result: null,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			});

		return () => {
			cancelled = true;
			void Promise.allSettled(
				[...activeSessions].map((session) => session.dispose()),
			);
		};
	}, [buildMarker, control, createHost, isDurableBrowserStore, proof]);

	return (
		<main
			data-testid="c6-disposal-harness"
			data-status={state.status}
			data-control={control}
			data-proof={proof ?? "disposal"}
			data-c6-build-marker={buildMarker}
			data-c5-host-store={
				state.status === "ready" ? "BrowserProjectStore" : "pending"
			}
			data-audio-fallback="false"
		>
			<h1>C6 session disposal oracle</h1>
			<div ref={targetRef} data-testid="c6-disposal-mount" hidden />
			{state.error ? (
				<pre data-testid="c6-disposal-error">{state.error}</pre>
			) : null}
			<output data-testid="c6-disposal-report">
				{state.result ? JSON.stringify(state.result) : ""}
			</output>
		</main>
	);
}

// Keep the evaluator import in this module's public graph for hosts that need
// to inspect a serialized result without mounting React.
export { evaluateDisposalRun };
