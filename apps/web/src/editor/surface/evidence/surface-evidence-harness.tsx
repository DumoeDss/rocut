"use client";

import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type CSSProperties,
} from "react";

import type { EditorHost } from "@opencut/editor-ports/host";
import { editorForSession } from "@/editor/runtime/session-core-owner";
import { prepareWasmRuntimeProviders } from "@/editor/runtime/wasm-runtime-providers";
import {
	createEditorSession,
	type EditorSession,
	type EditorSessionRootHandle,
} from "@/editor/session";
import type { DisposalReport } from "@/editor/session/resources";
import { createRafLoop } from "@/hooks/use-raf-loop";
import { buildTextElement } from "@/timeline";
import { buildEmptyTrack } from "@/timeline/placement";
import { mediaTimeFromSeconds, ZERO_MEDIA_TIME } from "@/wasm";

import {
	runAgentEvidence,
	type AgentEvidenceOutcome,
	type AgentEvidencePhase,
} from "./agent-evidence-run";
import { EditorSurface } from "../embedding/editor-surface";
import {
	SurfaceReactIdentityProbe,
	type SurfaceReactIdentityResult,
} from "../embedding/surface-react-identity-probe";
import type { FocusMode } from "../embedding/types";

type SurfaceVisibility = "visible" | "hidden";

/**
 * Which evidence scenario this mount runs (S03 T4, design D6).
 *
 * Read from the query string, and read the way `c6-disposal-harness` already
 * reads its own control: guarded for the server, surfaced as an attribute, and
 * acted on inside the effect. The rendered tree is identical for both scenarios
 * on the first paint, so the default Surface path — which later gates re-run —
 * is behaviourally unchanged and nothing about hydration moves.
 */
type EvidenceScenario = "surface" | "agent";

function readEvidenceScenario(): EvidenceScenario {
	if (typeof window === "undefined") return "surface";
	return new URLSearchParams(window.location.search).get("scenario") === "agent"
		? "agent"
		: "surface";
}

function readEvidencePhase(): AgentEvidencePhase {
	if (typeof window === "undefined") return "apply";
	return new URLSearchParams(window.location.search).get("phase") === "reopen"
		? "reopen"
		: "apply";
}

export interface SurfaceEvidenceHarnessProps {
	readonly hostName: "next" | "vite";
	readonly hostReactIdentity: typeof import("react");
	readonly buildMarker: string;
	readonly createHost: (args: {
		readonly projectId: string;
		readonly onProjectReplaced: (projectId: string) => void;
	}) => EditorHost;
}

interface LedgerEntry {
	readonly sequence: number;
	readonly surface: "harness" | "primary" | "secondary";
	readonly kind: string;
	readonly detail: unknown;
}

interface ActivityObservation {
	frames: number;
	generation: number | null;
	resourceId: string | null;
	workerMessages: number;
	workerErrors: number;
}

interface PreparedSurfaceSession {
	readonly session: EditorSession;
	readonly disposeRuntime: () => Promise<void>;
	readonly activity: ActivityObservation;
	readonly action: { playing: boolean };
	readonly stopPreview: () => void;
}

interface HarnessLedger {
	readonly schema: "r2-surface-evidence-v1";
	readonly host: "next" | "vite";
	readonly buildMarker: string;
	readonly reactIdentity: SurfaceReactIdentityResult | null;
	readonly actionStates: {
		readonly primaryPlaying: boolean | null;
		readonly secondaryPlaying: boolean | null;
	};
	readonly calls: readonly LedgerEntry[];
	readonly errors: readonly LedgerEntry[];
	readonly resources: readonly LedgerEntry[];
	readonly disposals: readonly LedgerEntry[];
}

const CONTAINER_STYLE: CSSProperties = {
	position: "relative",
	width: "720px",
	height: "420px",
	maxWidth: "calc(100vw - 48px)",
	border: "2px solid rgb(71 85 105)",
	borderRadius: "8px",
	overflow: "hidden",
	background: "rgb(15 23 42)",
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function releaseGate(): {
	readonly promise: Promise<void>;
	readonly release: () => void;
	readonly isReleased: () => boolean;
} {
	let released = false;
	let resolve: () => void = () => {};
	const promise = new Promise<void>((settle) => {
		resolve = settle;
	});
	return {
		promise,
		release: () => {
			if (released) return;
			released = true;
			resolve();
		},
		isReleased: () => released,
	};
}

async function seedSurfaceProject(session: EditorSession): Promise<void> {
	const editor = editorForSession(session);
	const seedId = await editor.project.createNewProject({
		name: "R1 Surface evidence seed",
	});
	const seed = await editor.persistence.loadProject({ id: seedId });
	if (!seed)
		throw new Error("Surface evidence could not create its seed project.");
	const activeScene = seed.scenes.find(
		(scene) => scene.id === seed.currentSceneId,
	);
	if (!activeScene)
		throw new Error("Surface evidence seed has no active scene.");
	const duration = mediaTimeFromSeconds({ seconds: 10 });
	const evidenceElement = buildTextElement({
		raw: {
			name: "Surface action evidence",
			duration,
			params: { content: "Surface action scope" },
		},
		startTime: ZERO_MEDIA_TIME,
	});
	if (evidenceElement.type !== "text")
		throw new Error(
			"Surface evidence element builder returned a non-text type.",
		);
	const evidenceTrack = buildEmptyTrack({
		id: `r1-surface-track-${session.projectId}`,
		type: "text",
		name: "Surface action evidence",
	});
	evidenceTrack.elements.push({
		id: `r1-surface-element-${session.projectId}`,
		...evidenceElement,
	});
	await editor.persistence.saveProject({
		project: {
			...seed,
			metadata: {
				...seed.metadata,
				id: session.projectId,
				name: `R1 Surface ${session.projectId}`,
				duration,
			},
			scenes: seed.scenes.map((scene) =>
				scene.id === activeScene.id
					? {
							...scene,
							tracks: {
								...scene.tracks,
								overlay: [...scene.tracks.overlay, evidenceTrack],
							},
						}
					: scene,
			),
		},
	});
}

function instrumentSession({
	session,
	surface,
	readyGate,
	activity,
	action,
	append,
}: {
	session: EditorSession;
	surface: "primary" | "secondary";
	readyGate: ReturnType<typeof releaseGate>;
	activity: ActivityObservation;
	action: { playing: boolean };
	append: (
		surface: LedgerEntry["surface"],
		kind: string,
		detail?: unknown,
	) => void;
}): void {
	const mount = session.mount.bind(session);
	const suspend = session.suspend.bind(session);
	const resume = session.resume.bind(session);
	const unmount = session.unmount.bind(session);
	const dispose = session.dispose.bind(session);
	const editor = editorForSession(session);
	const togglePlayback = editor.playback.toggle.bind(editor.playback);

	const resourceDetail = (phase: string) => ({
		phase,
		sessionState: session.state,
		report: session.resources.inspect(),
		activity: { ...activity },
	});

	editor.playback.toggle = () => {
		const before = editor.playback.getIsPlaying();
		togglePlayback();
		action.playing = editor.playback.getIsPlaying();
		append(surface, "playback-toggle", {
			before,
			after: action.playing,
		});
	};

	session.mount = ({ target }): EditorSessionRootHandle => {
		append(surface, "mount", {
			targetIsSurface: target.hasAttribute("data-editor-surface"),
			containerTestId:
				target.parentElement?.getAttribute("data-testid") ?? null,
			readyBlocked: !readyGate.isReleased(),
		});
		const handle = mount({ target });
		const ready = handle.ready.then(async () => {
			append(surface, "underlying-ready", { state: handle.state });
			await readyGate.promise;
			append(surface, "ready-released", { state: handle.state });
		});
		ready.catch(() => {});
		return {
			sessionId: handle.sessionId,
			container: handle.container,
			ready,
			get state() {
				return handle.state;
			},
			unmount: () => handle.unmount(),
		};
	};

	session.suspend = async () => {
		append(surface, "resource", resourceDetail("before-suspend"));
		append(surface, "suspend-call", { state: session.state });
		try {
			await suspend();
			append(surface, "suspend-settled", { state: session.state });
			append(surface, "resource", resourceDetail("after-suspend"));
		} catch (error) {
			append(surface, "error", {
				operation: "suspend",
				message: errorMessage(error),
			});
			throw error;
		}
	};

	session.resume = async () => {
		append(surface, "resource", resourceDetail("before-resume"));
		append(surface, "resume-call", { state: session.state });
		try {
			await resume();
			append(surface, "resume-settled", { state: session.state });
			append(surface, "resource", resourceDetail("after-resume"));
		} catch (error) {
			append(surface, "error", {
				operation: "resume",
				message: errorMessage(error),
			});
			throw error;
		}
	};

	session.unmount = async () => {
		append(surface, "unmount-call", { state: session.state });
		try {
			await unmount();
			append(surface, "unmount-settled", { state: session.state });
		} catch (error) {
			append(surface, "error", {
				operation: "unmount",
				message: errorMessage(error),
			});
			throw error;
		}
	};

	session.dispose = async (): Promise<DisposalReport> => {
		append(surface, "dispose-call", { state: session.state, owner: "host" });
		try {
			const report = await dispose();
			append(surface, "dispose-report", report);
			return report;
		} catch (error) {
			append(surface, "error", {
				operation: "dispose",
				message: errorMessage(error),
			});
			throw error;
		}
	};
}

async function prepareSurfaceSession({
	surface,
	cycle,
	createHost,
	readyGate,
	append,
}: {
	surface: "primary" | "secondary";
	cycle: number;
	createHost: SurfaceEvidenceHarnessProps["createHost"];
	readyGate: ReturnType<typeof releaseGate>;
	append: (
		surface: LedgerEntry["surface"],
		kind: string,
		detail?: unknown,
	) => void;
}): Promise<PreparedSurfaceSession> {
	const projectId = `r1-surface-${surface}-${cycle}`;
	const host = createHost({
		projectId,
		onProjectReplaced: (replacement) =>
			append(surface, "project-replaced", { replacement }),
	});
	const runtime = await prepareWasmRuntimeProviders();
	let session: EditorSession | null = null;
	try {
		session = await createEditorSession({
			host,
			runtimeGraphics: runtime.runtimeGraphics,
			runtimeGpu: runtime.runtimeGpu,
		});
		await seedSurfaceProject(session);
		const activity: ActivityObservation = {
			frames: 0,
			generation: null,
			resourceId: null,
			workerMessages: 0,
			workerErrors: 0,
		};
		const action = {
			playing: editorForSession(session).playback.getIsPlaying(),
		};
		const stopPreview = createRafLoop({
			resources: session.resources,
			callback: () => {
				activity.frames += 1;
			},
			onRequest: ({ resourceId, generation }) => {
				activity.resourceId = String(resourceId);
				activity.generation = generation;
			},
		});
		const decoder = session.resources.createWorker({
			request: {
				id: `r1-surface-decoder-${surface}-${cycle}`,
				url: new URL(
					host.assets.resolve({
						ref: { path: "workers/c4-worker-fixture.js" },
					}),
					window.location.href,
				),
				type: "classic",
				name: `R1 Surface decoder ${surface} ${cycle}`,
			},
		});
		decoder.onMessage(() => {
			activity.workerMessages += 1;
		});
		decoder.onError(() => {
			activity.workerErrors += 1;
		});
		decoder.postMessage({
			message: { kind: "ping", payload: new Uint8Array([cycle]).buffer },
		});
		instrumentSession({
			session,
			surface,
			readyGate,
			activity,
			action,
			append,
		});
		append(surface, "resource", {
			phase: "prepared",
			sessionState: session.state,
			report: session.resources.inspect(),
			activity: { ...activity },
		});
		return {
			session,
			activity,
			action,
			stopPreview,
			disposeRuntime: async () => {
				await runtime.dispose();
			},
		};
	} catch (error) {
		if (session) await session.dispose().catch(() => {});
		await Promise.resolve(runtime.dispose()).catch(() => {});
		throw error;
	}
}

export function SurfaceEvidenceHarness({
	hostName,
	hostReactIdentity,
	buildMarker,
	createHost,
}: SurfaceEvidenceHarnessProps) {
	const sequence = useRef(0);
	const live = useRef<Set<PreparedSurfaceSession>>(new Set());
	const primaryGate = useRef(releaseGate());
	const secondaryGate = useRef(releaseGate());
	const [calls, setCalls] = useState<LedgerEntry[]>([]);
	const [primary, setPrimary] = useState<PreparedSurfaceSession | null>(null);
	const [secondary, setSecondary] = useState<PreparedSurfaceSession | null>(
		null,
	);
	const [mounted, setMounted] = useState(false);
	const [secondaryMounted, setSecondaryMounted] = useState(false);
	const [focusMode, setFocusMode] = useState<FocusMode>("passive");
	const [reactIdentity, setReactIdentity] =
		useState<SurfaceReactIdentityResult | null>(null);
	const [containerSize, setContainerSize] = useState({
		width: 720,
		height: 420,
	});
	const [visibility, setVisibility] = useState<SurfaceVisibility>("visible");
	const [cycle, setCycle] = useState(1);
	const [status, setStatus] = useState<"starting" | "ready" | "error">(
		"starting",
	);
	const [fatalError, setFatalError] = useState<string | null>(null);
	// Read once per mount, never per render, and never during the server render:
	// the *rendered* scenario below starts at the default on both sides and is
	// published from the effect, so the first paint is byte-identical whatever
	// the query string says and hydration has nothing to reconcile.
	const [requested] = useState<{
		scenario: EvidenceScenario;
		phase: AgentEvidencePhase;
	}>(() => ({ scenario: readEvidenceScenario(), phase: readEvidencePhase() }));
	const { scenario, phase } = requested;
	// Null until a run publishes it, and published by both branches — so
	// `data-scenario`/`data-phase` are always a fact the run asserted about
	// itself, never a default that happens to read correctly.
	const [reported, setReported] = useState<{
		scenario: EvidenceScenario;
		phase: AgentEvidencePhase;
	} | null>(null);
	const [agentOutcome, setAgentOutcome] = useState<AgentEvidenceOutcome | null>(
		null,
	);

	const append = useCallback(
		(surface: LedgerEntry["surface"], kind: string, detail: unknown = null) => {
			setCalls((current) => [
				...current,
				{ sequence: ++sequence.current, surface, kind, detail },
			]);
		},
		[],
	);

	const prepare = useCallback(
		async ({
			surface,
			cycleNumber,
			gate,
		}: {
			surface: "primary" | "secondary";
			cycleNumber: number;
			gate: ReturnType<typeof releaseGate>;
		}) => {
			const prepared = await prepareSurfaceSession({
				surface,
				cycle: cycleNumber,
				createHost,
				readyGate: gate,
				append,
			});
			live.current.add(prepared);
			return prepared;
		},
		[append, createHost],
	);

	useEffect(() => {
		let cancelled = false;
		const active = live.current;
		if (scenario === "agent") {
			// The agent run owns its own session; the Surface matrix prepares none,
			// so nothing here mounts a Surface or seeds a Surface project.
			const running = runAgentEvidence({
				hostName,
				buildMarker,
				phase,
				createHost,
			});
			void running
				.then((run) => {
					if (cancelled) {
						void run.dispose();
						return;
					}
					setReported({ scenario, phase });
					setAgentOutcome(run.outcome);
					setStatus(run.outcome.error === null ? "ready" : "error");
					if (run.outcome.error !== null) setFatalError(run.outcome.error);
					append("harness", "agent-evidence-complete", { phase });
				})
				.catch((error: unknown) => {
					if (cancelled) return;
					setReported({ scenario, phase });
					setFatalError(errorMessage(error));
					setStatus("error");
					append("harness", "error", { message: errorMessage(error) });
				});
			return () => {
				cancelled = true;
				void running.then((run) => run.dispose()).catch(() => {});
			};
		}
		void Promise.all([
			prepare({
				surface: "primary",
				cycleNumber: 1,
				gate: primaryGate.current,
			}),
			prepare({
				surface: "secondary",
				cycleNumber: 1,
				gate: secondaryGate.current,
			}),
		])
			.then(([nextPrimary, nextSecondary]) => {
				secondaryGate.current.release();
				if (cancelled) return;
				setPrimary(nextPrimary);
				setSecondary(nextSecondary);
				setReported({ scenario, phase });
				setStatus("ready");
				append("harness", "ready", { hostName });
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setReported({ scenario, phase });
				setFatalError(errorMessage(error));
				setStatus("error");
				append("harness", "error", { message: errorMessage(error) });
			});

		return () => {
			cancelled = true;
			void Promise.allSettled(
				[...active].map(async (prepared) => {
					await prepared.session.dispose();
					prepared.stopPreview();
					await prepared.disposeRuntime();
				}),
			);
			active.clear();
		};
	}, [append, buildMarker, createHost, hostName, phase, prepare, scenario]);

	const releaseReadiness = () => {
		primaryGate.current.release();
		append("harness", "release-readiness", { cycle });
	};

	const disposePrimary = async () => {
		if (!primary || mounted) return;
		try {
			const retiring = primary;
			const report = await retiring.session.dispose();
			retiring.stopPreview();
			await retiring.disposeRuntime();
			live.current.delete(retiring);
			setPrimary(null);
			append("harness", "host-disposed-primary", { cycle, report });
			const nextCycle = cycle + 1;
			const gate = releaseGate();
			gate.release();
			primaryGate.current = gate;
			const replacement = await prepare({
				surface: "primary",
				cycleNumber: nextCycle,
				gate,
			});
			setCycle(nextCycle);
			setPrimary(replacement);
			setVisibility("visible");
			append("harness", "host-created-replacement", { cycle: nextCycle });
		} catch (error) {
			setFatalError(errorMessage(error));
			setStatus("error");
			append("harness", "error", {
				operation: "host-dispose-cycle",
				message: errorMessage(error),
			});
		}
	};

	const ledger: HarnessLedger = {
		schema: "r2-surface-evidence-v1",
		host: hostName,
		buildMarker,
		reactIdentity,
		actionStates: {
			primaryPlaying: primary?.action.playing ?? null,
			secondaryPlaying: secondary?.action.playing ?? null,
		},
		calls,
		errors: calls.filter((entry) => entry.kind === "error"),
		resources: calls.filter((entry) => entry.kind === "resource"),
		disposals: calls.filter(
			(entry) =>
				entry.kind === "dispose-report" ||
				entry.kind === "host-disposed-primary",
		),
	};

	return (
		<main
			data-testid="surface-evidence-harness"
			data-status={status}
			data-host={hostName}
			data-cycle={cycle}
			data-build-marker={buildMarker}
			data-scenario={reported?.scenario}
			data-phase={reported?.phase}
			style={{
				minHeight: "100vh",
				padding: "20px",
				boxSizing: "border-box",
				background: "rgb(2 6 23)",
				color: "rgb(226 232 240)",
				font: "13px/1.4 system-ui, sans-serif",
			}}
		>
			<button data-testid="outside-before" type="button">
				Outside before
			</button>
			<section
				data-testid="surface-host-chrome"
				style={{
					width: "768px",
					maxWidth: "100%",
					padding: "16px",
					boxSizing: "border-box",
					border: "1px solid rgb(51 65 85)",
					background: "rgb(15 23 42)",
				}}
			>
				<h1>R2 Surface evidence — {hostName}</h1>
				<SurfaceReactIdentityProbe
					hostReactIdentity={hostReactIdentity}
					onResult={setReactIdentity}
				/>
				<nav
					data-testid="surface-controls"
					style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
				>
					<button
						data-testid="mount-primary"
						type="button"
						onClick={() => setMounted(true)}
						disabled={!primary || mounted}
					>
						Mount
					</button>
					<button
						data-testid="unmount-primary"
						type="button"
						onClick={() => setMounted(false)}
						disabled={!mounted}
					>
						Unmount
					</button>
					<button
						data-testid="release-readiness"
						type="button"
						onClick={releaseReadiness}
					>
						Release readiness
					</button>
					{(["passive", "focused", "full"] as const).map((mode) => (
						<button
							key={mode}
							data-testid={`mode-${mode}`}
							type="button"
							onClick={() => setFocusMode(mode)}
						>
							{mode}
						</button>
					))}
					<button
						data-testid="visibility-hidden"
						type="button"
						onClick={() => setVisibility("hidden")}
					>
						Hide
					</button>
					<button
						data-testid="visibility-visible"
						type="button"
						onClick={() => setVisibility("visible")}
					>
						Show
					</button>
					<button
						data-testid="mount-secondary"
						type="button"
						onClick={() => setSecondaryMounted(true)}
						disabled={!secondary || secondaryMounted}
					>
						Mount second
					</button>
					<button
						data-testid="unmount-secondary"
						type="button"
						onClick={() => setSecondaryMounted(false)}
						disabled={!secondaryMounted}
					>
						Unmount second
					</button>
					{[
						["compact", 420, 260],
						["wide", 900, 320],
						["tall", 520, 620],
						["original", 720, 420],
					].map(([name, width, height]) => (
						<button
							key={name}
							data-testid={`resize-${name}`}
							type="button"
							onClick={() => {
								setContainerSize({
									width: Number(width),
									height: Number(height),
								});
								append("harness", "resize-request", { name, width, height });
							}}
						>
							Resize {name}
						</button>
					))}
					<button
						data-testid="host-toaster-sentinel"
						type="button"
						onClick={() => append("harness", "host-control-activated")}
					>
						Host control sentinel
					</button>
					<button
						data-testid="dispose-primary"
						type="button"
						onClick={() => void disposePrimary()}
						disabled={!primary || mounted}
					>
						Host dispose + replace
					</button>
				</nav>
				<div
					data-testid="primary-container"
					data-size={`${containerSize.width}x${containerSize.height}`}
					style={{
						...CONTAINER_STYLE,
						width: containerSize.width,
						height: containerSize.height,
					}}
				>
					{mounted && primary ? (
						<EditorSurface
							session={primary.session}
							focusMode={focusMode}
							visibility={visibility}
							cssNamespace="r1-evidence-primary"
							className="surface-evidence-primary"
							onFocusModeChange={(requested) =>
								append("primary", "focus-mode-request", {
									requested,
									effective: focusMode,
								})
							}
							onReady={() => append("primary", "on-ready", { cycle })}
							onError={(error) =>
								append("primary", "error", {
									operation: "surface-callback",
									message: error.message,
								})
							}
						/>
					) : null}
				</div>
				<div
					data-testid="secondary-container"
					style={{ ...CONTAINER_STYLE, width: 360, height: 220, marginTop: 12 }}
				>
					{secondaryMounted && secondary ? (
						<EditorSurface
							session={secondary.session}
							focusMode="full"
							cssNamespace="r1-evidence-secondary"
							onReady={() => append("secondary", "on-ready")}
							onError={(error) =>
								append("secondary", "error", {
									operation: "surface-callback",
									message: error.message,
								})
							}
						/>
					) : null}
				</div>
			</section>
			<input data-testid="outside-after" defaultValue="outside after" />
			{fatalError ? (
				<pre data-testid="surface-fatal-error">{fatalError}</pre>
			) : null}
			<output data-testid="surface-evidence-ledger" style={{ display: "none" }}>
				{JSON.stringify(ledger)}
			</output>
			<output data-testid="agent-evidence-ledger" style={{ display: "none" }}>
				{agentOutcome === null ? "" : JSON.stringify(agentOutcome)}
			</output>
		</main>
	);
}
