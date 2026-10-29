import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThemeProvider } from "next-themes";
import { useEmbeddedHostTheme } from "./host/use-embedded-host-theme";
import { bindEmbeddedHostLifecycle } from "./host/embedded-host-lifecycle";
import { bindMvNativeNavigation } from "./host/mv-native-navigation";
import { subscribeEmbeddedHostLocale } from "./host/embedded-host-locale";
import { createHostEditorTasks } from "./host/editor-tasks";
import { createProjectReadiness } from "./host/project-readiness";
import { createCompositionExportController } from "./host/composition-export-controller";
import { createNativeExportProgress } from "./host/native-export-progress";
import { createCompositionExportTransport } from "./host/host-composition-export";
import { Toaster } from "@opencut/editor-classic/ui";
import { TooltipProvider } from "@opencut/editor-classic/ui";
import { MobileGate } from "@opencut/editor-classic/ui";
import {
	SessionEditorSurface,
	CreatorWorkspaceProvider,
} from "@opencut/editor-classic/surface";
import {
	connectCreatorWorkspaceBridge,
	type ConnectedCreatorWorkspaceBridge,
} from "./host/creator-workspace-bridge";
import {
	EditorSessionHost,
	EditorLocaleProvider,
	useEditorInstance,
} from "@opencut/editor-classic/session";
import { ViteEditorHost } from "./host/vite-editor-host";
import { createViteEditorHost } from "./host/vite-host-config";
import {
	createHostServedEditorHost,
	detectHostServedSurface,
	reportExportFailure,
	reportExportProgress,
	subscribeHostEvents,
	uploadExportResult,
	type HostCommand,
	type HostExportOptions,
	type HostServedSurface,
} from "./host/host-served";
import { ProjectPicker } from "./project-picker";
import { EditorErrorBoundary } from "./editor-error-boundary";
import { C3SessionHarness } from "./c3-session-harness";
import { C4ForcedNoneHarness } from "./c4-forced-none-harness";
import { C4WorkerHarness } from "./c4-worker-harness";
import { C4SessionHarness } from "./c4-session-harness";
import { C6DisposalHarness } from "@opencut/editor-classic/evidence";
import { BrowserProjectStore } from "@opencut/editor-classic/storage";
import { mediaTime } from "@opencut/editor-classic";
import * as nativeExportWasm from "opencut-wasm";
import { verifyNativeExportSource } from "./host/host-export-protocol";
import { CreatorWorkspaceHarness } from "./creator-workspace-harness";
import { CreatorTimelineSave } from "./host/creator-timeline-save";

const C4_BUILD_MARKER = import.meta.env.VITE_C4_BUILD_MARKER ?? "development";

function readProjectIdFromUrl(): string | null {
	return new URLSearchParams(window.location.search).get("project");
}

export function App() {
	if (
		import.meta.env.DEV &&
		new URLSearchParams(window.location.search).get(
			"creator-workspace-harness",
		) === "1"
	)
		return <CreatorWorkspaceHarness />;
	if (
		new URLSearchParams(window.location.search).get(
			"c4-forced-none-harness",
		) === "1"
	) {
		return <C4ForcedNoneHarness />;
	}
	if (
		new URLSearchParams(window.location.search).get("c4-session-harness") ===
		"1"
	) {
		return <C4SessionHarness />;
	}
	if (
		new URLSearchParams(window.location.search).get("c4-worker-harness") === "1"
	) {
		return <C4WorkerHarness />;
	}
	if (
		new URLSearchParams(window.location.search).get("c3-session-harness") ===
		"1"
	) {
		return <C3SessionHarness />;
	}
	if (
		new URLSearchParams(window.location.search).get("c6-disposal-harness") ===
		"1"
	) {
		return (
			<C6DisposalHarness
				createHost={({ projectId, onProjectReplaced, onExitProject }) =>
					createViteEditorHost({
						projectId,
						onProjectIdChange: onProjectReplaced,
						onExitProject,
					})
				}
				isDurableBrowserStore={(store) => store instanceof BrowserProjectStore}
				buildMarker={import.meta.env.VITE_C6_BUILD_MARKER ?? "development"}
			/>
		);
	}
	return <BootApp />;
}

/**
 * One async gate before anything mounts: if the CLI host serves this page
 * (the pane deployment), the session boots against the host's project and its
 * file SSOT; otherwise the standalone IndexedDB app, unchanged.
 */
function BootApp() {
	const [surface, setSurface] = useState<HostServedSurface | null | "checking">(
		"checking",
	);
	useEffect(() => {
		let cancelled = false;
		void detectHostServedSurface().then((detected) => {
			if (!cancelled) setSurface(detected);
		});
		return () => {
			cancelled = true;
		};
	}, []);
	if (surface === "checking") {
		return <div style={{ height: "100vh" }} />;
	}
	if (surface !== null) {
		return <HostServedApp surface={surface} />;
	}
	return <EditorApp />;
}

function HostServedApp({ surface }: { surface: HostServedSurface }) {
	const hostTheme = useEmbeddedHostTheme();
	const [locale, setLocale] = useState(surface.locale);
	useEffect(() => subscribeEmbeddedHostLocale({ onLocale: setLocale }), []);
	const [creatorBridge, setCreatorBridge] =
		useState<ConnectedCreatorWorkspaceBridge | null>(null);
	const bridgeConnection = useMemo(() => {
		let resolve!: (bridge: ConnectedCreatorWorkspaceBridge | null) => void;
		const promise = new Promise<ConnectedCreatorWorkspaceBridge | null>((done) => { resolve = done; });
		return { promise, resolve };
	}, [surface.projectId]);
	useEffect(() => {
		const controller = new AbortController();
		let bridge: ConnectedCreatorWorkspaceBridge | null = null;
		void connectCreatorWorkspaceBridge({ signal: controller.signal }).then(
			(connected) => {
				bridgeConnection.resolve(connected);
				bridge = connected;
				if (!controller.signal.aborted) setCreatorBridge(connected);
				else connected?.dispose();
			},
		);
		return () => {
			controller.abort();
			bridge?.dispose();
		};
	}, [surface.projectId, bridgeConnection]);
	const host = useMemo(
		() =>
			createHostServedEditorHost({
				projectId: surface.projectId,
				base: surface.apiBase,
				locale: surface.locale,
			}),
		[surface],
	);
	return (
		<ThemeProvider
			attribute="class"
			forcedTheme={hostTheme}
			defaultTheme="system"
			disableTransitionOnChange={true}
		>
			<TooltipProvider>
				<Toaster />
				<main id="editor-container" data-host-embedded="true">
					<EditorErrorBoundary>
						<EditorSessionHost host={host}>
							<CreatorTimelineSave connection={bridgeConnection.promise} />
							<EditorLocaleProvider locale={locale}>
								<HostServedSync projectId={surface.projectId} />
							{/* No MobileGate here: the host-served pane is a real
							    desktop editor embedded in a possibly-narrow
							    WebContentsView — the width guard exists for
							    opencut.app mobile visitors, not for the pane. */}
								<CreatorWorkspaceProvider bridge={creatorBridge}>
									<SessionEditorSurface
										focusMode="focused"
										hostOwnsChrome={window.parent !== window}
									/>
								</CreatorWorkspaceProvider>
							</EditorLocaleProvider>
						</EditorSessionHost>
					</EditorErrorBoundary>
				</main>
			</TooltipProvider>
		</ThemeProvider>
	);
}

/**
 * Live view of agent commits: the host's revision stream fires only on
 * engine-side applies, so every event means "the project changed outside this
 * session" — reload it from the host store (debounced; a reload storm during
 * an agent batch is one repaint at the end). This session's own saves never
 * fire the stream.
 */
function HostServedSync({ projectId }: { projectId: string }) {
	const editor = useEditorInstance();
	const readiness = useMemo(
		() =>
			createProjectReadiness({
				reload: () => editor.project.loadProject({ id: projectId }),
				schedule: (run) => {
					const timer = window.setTimeout(run, 250);
					return () => window.clearTimeout(timer);
				},
			}),
		[editor, projectId],
	);
	const editorTasks = useMemo(
		() => createHostEditorTasks({ editor }, readiness.whenReady),
		[editor, readiness],
	);
	useEffect(
		() => bindMvNativeNavigation(editor, readiness.whenReady),
		[editor, readiness],
	);
	useEffect(
		() =>
			bindEmbeddedHostLifecycle(async () => {
				if (editor.project.getActiveOrNull()?.metadata.id !== projectId) {
					throw new Error("Project is not ready to close");
				}
				editor.playback.pause();
				await editor.save.flush();
				if (editor.project.getActiveOrNull()?.metadata.id !== projectId) {
					throw new Error("Project changed while preparing to close");
				}
			}),
		[editor, projectId],
	);
	// Cancellation and the busy guard are refs, not state: they are read from
	// inside a running export's callbacks, where a re-rendered closure would
	// see a stale value and keep rendering a job the CLI already cancelled.
	const cancelledJobs = useRef(new Set<string>());
	const exportWaiters = useRef(new Map<string, AbortController>());
	const exporting = useRef(false);
	const compositionExports = useRef<ReturnType<
		typeof createCompositionExportController
	> | null>(null);
	useEffect(() => {
		const controller = createCompositionExportController({
			isBusy: () => exporting.current,
			setBusy: (value) => {
				exporting.current = value;
			},
			verify: (command) => {
				if (
					typeof command.receipt !== "object" ||
					command.receipt === null ||
					!("jobId" in command.receipt) ||
					command.receipt.jobId !== command.jobId
				)
					throw new Error("composition-export-job-mismatch");
				verifyNativeExportSource(
					Reflect.get(nativeExportWasm, "resolveNativeExportJobJson"),
					command.receipt,
					command.source,
				);
			},
			render: ({ source, options, onProgress, onCancel }) => {
				const { range, ...renderOptions } = options;
				return editor.renderer.exportIsolatedProject({
					source,
					options: {
						...renderOptions,
						...(range === undefined
							? {}
							: {
									range: {
										startTime: mediaTime({ ticks: range.startTime }),
										endTime: mediaTime({ ticks: range.endTime }),
									},
								}),
					},
					onProgress,
					onCancel,
				});
			},
			transport: createCompositionExportTransport(),
		});
		compositionExports.current = controller;
		return () => {
			controller.disconnect();
			compositionExports.current = null;
		};
	}, [editor]);

	/**
	 * Render an export the host asked for. THIS is why the pane matters: the
	 * host process has no canvas, no WebGL and no WebCodecs, so the renderer
	 * living in this page is the only one either process can reach.
	 */
	const runExport = useCallback(
		async (
			jobId: string,
			options: HostExportOptions,
			token: string,
			receipt: unknown,
		) => {
			// One render at a time — the compositor is GPU-bound, and a second
			// concurrent export would starve both.
			if (exporting.current) {
				await reportExportFailure({
					jobId,
					token,
					error: "this editor pane is already rendering another export",
				});
				return;
			}
			exporting.current = true;
			const waiter = new AbortController();
			const progressReports = createNativeExportProgress({
				report: (progress, signal) =>
					reportExportProgress({ jobId, progress, token, signal }),
				onCancel: () => cancelledJobs.current.add(jobId),
				signal: waiter.signal,
			});
			exportWaiters.current.set(jobId, waiter);
			try {
				await readiness.whenReady(waiter.signal);
				await editor.command.whenIdle();
				const assertSource = async () => {
					const binding = (
						nativeExportWasm as unknown as Record<string, unknown>
					).resolveNativeExportJobJson;
					const revision = Number(await editor.transactions.revision());
					const project = editor.project.getActive();
					const data = editor.persistence.captureNativeExportSourceData({
						project: {
							...project,
							scenes: editor.scenes.getScenes(),
							currentSceneId: editor.scenes.getActiveScene().id,
						},
					});
					if (Number(await editor.transactions.revision()) !== revision)
						throw new Error("native-export-source-changed-during-capture");
					verifyNativeExportSource(binding, receipt, {
						projectId: project.metadata.id,
						revision,
						data,
					});
				};
				await assertSource();
				if (cancelledJobs.current.has(jobId)) throw new Error("cancelled");
				const result = await editor.renderer.exportProject({
					options: {
						format: options.format,
						quality: options.quality,
						...(options.videoQuantizer === undefined
							? {}
							: { videoQuantizer: options.videoQuantizer }),
						...(options.videoChroma === undefined
							? {}
							: { videoChroma: options.videoChroma }),
						...(options.includeAudio === undefined
							? {}
							: { includeAudio: options.includeAudio }),
						...(options.range === undefined
							? {}
							: {
									range: {
										startTime: mediaTime({ ticks: options.range.startTime }),
										endTime: mediaTime({ ticks: options.range.endTime }),
									},
								}),
					},
					onProgress: ({ progress }) => progressReports.report(progress),
					onCancel: () => cancelledJobs.current.has(jobId),
				});
				if (
					result.success === true &&
					result.buffer !== undefined &&
					!result.cancelled
				)
					await progressReports.finish();
				else progressReports.stop();
				if (result.cancelled === true || cancelledJobs.current.has(jobId)) {
					await reportExportFailure({
						jobId,
						token,
						error: "cancelled",
						terminated: true,
					});
					return;
				}
				if (result.success !== true || result.buffer === undefined) {
					await reportExportFailure({
						jobId,
						token,
						error: result.error ?? "export failed",
					});
					return;
				}
				await assertSource();
				await uploadExportResult({ jobId, token, bytes: result.buffer });
			} catch (error) {
				// Report termination explicitly; transport failure remains unknown.
				await reportExportFailure({
					jobId,
					token,
					terminated: cancelledJobs.current.has(jobId),
					error: error instanceof Error ? error.message : String(error),
				});
			} finally {
				progressReports.stop();
				exporting.current = false;
				exportWaiters.current.delete(jobId);
				cancelledJobs.current.delete(jobId);
			}
		},
		[editor, readiness],
	);

	const onCommand = useCallback(
		(command: HostCommand) => {
			if (
				command.command === "composition.export.start" ||
				command.command === "composition.export.cancel"
			) {
				compositionExports.current?.handle(command);
				return;
			}
			if (editorTasks.handle(command)) return;
			if (command.command === "export.cancel") {
				cancelledJobs.current.add(command.jobId);
				exportWaiters.current.get(command.jobId)?.abort(new Error("cancelled"));
				return;
			}
			if (command.command === "export.start")
				void runExport(
					command.jobId,
					command.options,
					command.token,
					command.receipt,
				).catch(() => undefined);
		},
		[runExport, editorTasks],
	);

	useEffect(() => {
		const dispose = subscribeHostEvents({
			editorTaskSurface: editorTasks.surfaceId,
			onDisconnect: () => {
				editorTasks.disconnect();
				compositionExports.current?.disconnect();
			},
			onRevision: () => readiness.changed(),
			onCommand,
		});
		return () => {
			dispose();
			editorTasks.disconnect();
			readiness.cancelPending();
			compositionExports.current?.disconnect();
		};
	}, [readiness, onCommand, editorTasks]);
	return null;
}

function EditorApp() {
	const hostTheme = useEmbeddedHostTheme();
	const [projectId, setProjectId] = useState<string | null>(
		readProjectIdFromUrl,
	);

	const openProject = useCallback((id: string) => {
		setProjectId(id);
		window.history.replaceState(null, "", `?project=${encodeURIComponent(id)}`);
	}, []);

	const exitProject = useCallback(() => {
		setProjectId(null);
		window.history.replaceState(null, "", window.location.pathname);
	}, []);

	return (
		// Mirrors what `apps/web`'s root layout provides, minus `next/font` and the
		// analytics scripts — the editor expects a theme, tooltips and a toaster.
		<ThemeProvider
			attribute="class"
			forcedTheme={hostTheme}
			defaultTheme="system"
			disableTransitionOnChange={true}
		>
			<TooltipProvider>
				<Toaster />
				<HostChrome>
					{projectId === null ? (
						<ViteEditorHost
							projectId="project-picker"
							onProjectIdChange={setProjectId}
							onExitProject={exitProject}
						>
							<ProjectPicker onOpen={openProject} />
						</ViteEditorHost>
					) : (
						<EditorErrorBoundary>
							<ViteEditorHost
								projectId={projectId}
								onProjectIdChange={setProjectId}
								onExitProject={exitProject}
							>
								<MobileGate>
									<SessionEditorSurface focusMode="focused" hostOwnsChrome />
								</MobileGate>
							</ViteEditorHost>
						</EditorErrorBoundary>
					)}
				</HostChrome>
			</TooltipProvider>
		</ThemeProvider>
	);
}

/**
 * A bounded container, on purpose.
 *
 * The editor is given a box that is deliberately *not* the whole viewport, so
 * "the editor mounts inside its root container" is actually exercised rather
 * than accidentally satisfied by it filling the screen anyway. The visible frame
 * around it is host chrome; anything the editor paints outside it is a bug.
 */
function HostChrome({ children }: { children: React.ReactNode }) {
	return (
		<div
			data-c4-build-marker={C4_BUILD_MARKER}
			style={{
				height: "100vh",
				display: "flex",
				flexDirection: "column",
				gap: "12px",
				padding: "16px",
				boxSizing: "border-box",
				background: "#111",
			}}
		>
			<header
				style={{
					color: "#eee",
					font: "13px/1.4 system-ui, sans-serif",
					flex: "0 0 auto",
				}}
			>
				Host chrome — the editor is embedded in the bordered box below, not in
				the page.
			</header>
			<main
				id="editor-container"
				style={{
					flex: "1 1 auto",
					minHeight: 0,
					border: "2px solid #444",
					borderRadius: "8px",
					overflow: "hidden",
				}}
			>
				{children}
			</main>
		</div>
	);
}
