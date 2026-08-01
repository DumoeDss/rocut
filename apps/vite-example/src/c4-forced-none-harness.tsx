import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeProvider } from "next-themes";

import { DEFAULT_BACKGROUND_COLOR } from "@/background/color";
import { DEFAULT_CANVAS_SIZE } from "@/canvas/sizes";
import { EditorProvider } from "@/components/providers/editor-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { editorForSession } from "@/editor/runtime/session-core-owner";
import { storesForSession } from "@/editor/runtime/session-stores";
import { EditorHostProvider } from "@/editor/host/editor-host-context";
import type {
	GraphicsCapabilityReport,
	RuntimeGpuResourceQuery,
	RuntimeGraphicsQuery,
} from "@/editor/ports";
import {
	createEditorSession,
	EditorSessionProvider,
	type EditorSession,
	useEditorSession,
} from "@/editor/session";
import { EditorRoot } from "@/editor/surface/editor-root";
import { DEFAULT_FPS } from "@/fps/defaults";
import type { TProject } from "@/project/types";
import { CURRENT_PROJECT_VERSION } from "@/services/storage/migrations";
import { storageService } from "@/services/storage/service";
import {
	buildDefaultScene,
	getProjectDurationFromScenes,
} from "@/timeline/scenes";

import { EditorErrorBoundary } from "./editor-error-boundary";
import { createViteEditorHost } from "./host/vite-host-config";

const PROJECT_ID = "c4-forced-none-project";
const FORCED_NONE_VALUE = "none";

type AsyncErrorTracker = {
	pageErrors: string[];
	unhandledRejections: string[];
	listeners: Set<() => void>;
	installed: boolean;
};

type TrackerWindow = Window & {
	__c4ForcedNoneAsyncErrors?: AsyncErrorTracker;
};

function errorText(value: unknown): string {
	if (value instanceof Error) return value.message;
	return String(value);
}

function getAsyncErrorTracker(): AsyncErrorTracker {
	const harnessWindow = window as TrackerWindow;
	const tracker = harnessWindow.__c4ForcedNoneAsyncErrors ?? {
		pageErrors: [],
		unhandledRejections: [],
		listeners: new Set<() => void>(),
		installed: false,
	};
	harnessWindow.__c4ForcedNoneAsyncErrors = tracker;
	if (!tracker.installed) {
		tracker.installed = true;
		window.addEventListener("error", (event) => {
			tracker.pageErrors.push(errorText(event.error ?? event.message));
			tracker.listeners.forEach((listener) => listener());
		});
		window.addEventListener("unhandledrejection", (event) => {
			tracker.unhandledRejections.push(errorText(event.reason));
			tracker.listeners.forEach((listener) => listener());
		});
	}
	return tracker;
}

const asyncErrorTracker = getAsyncErrorTracker();

type ForcedNoneObservation = {
	report: GraphicsCapabilityReport;
	sessionState: EditorSession["state"];
	sessionLive: boolean;
	bannerVisible: boolean;
	previewUnavailableVisible: boolean;
	effectPreviewCount: number;
	renderTreeIsNull: boolean;
	compositorHandle: number | null;
	gpuWorkCount: number;
	thumbnailAbsentAfterExit: boolean;
	graphicsQueryCalls: readonly string[];
};

function createFixtureProject(): TProject {
	const scene = buildDefaultScene({ name: "Main scene", isMain: true });
	const now = new Date();
	return {
		metadata: {
			id: PROJECT_ID,
			name: "C4 forced-none surface",
			duration: getProjectDurationFromScenes({ scenes: [scene] }),
			createdAt: now,
			updatedAt: now,
		},
		scenes: [scene],
		currentSceneId: scene.id,
		settings: {
			fps: DEFAULT_FPS,
			canvasSize: DEFAULT_CANVAS_SIZE,
			canvasSizeMode: "preset",
			lastCustomCanvasSize: null,
			originalCanvasSize: null,
			background: { type: "color", color: DEFAULT_BACKGROUND_COLOR },
		},
		version: CURRENT_PROJECT_VERSION,
	};
}

async function settleOrdinarySchedules(): Promise<void> {
	// CDP opens disposable smoke tabs in the background, where Chrome may pause
	// requestAnimationFrame indefinitely. A wall-clock wait still passes the
	// ordinary preview RAF registration and both effect-preview useEffects; the
	// DOM assertions below prove those surfaces actually reached degraded state.
	await new Promise<void>((resolve) => window.setTimeout(resolve, 1_500));
}

export function C4ForcedNoneHarness() {
	const [session, setSession] = useState<EditorSession | null>(null);
	const [observation, setObservation] = useState<ForcedNoneObservation | null>(
		null,
	);
	const [setupError, setSetupError] = useState<string | null>(null);
	const [asyncErrorRevision, setAsyncErrorRevision] = useState(0);
	const graphicsQueryCalls = useRef<string[]>([]);

	useEffect(() => {
		const onAsyncError = () => setAsyncErrorRevision((value) => value + 1);
		asyncErrorTracker.listeners.add(onAsyncError);
		return () => {
			asyncErrorTracker.listeners.delete(onAsyncError);
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		let ownedSession: EditorSession | null = null;
		void (async () => {
			try {
				const requestedBackend = new URLSearchParams(
					window.location.search,
				).get("forceRendererBackend");
				if (requestedBackend !== FORCED_NONE_VALUE) {
					throw new Error(
						"C4 forced-none harness requires forceRendererBackend=none.",
					);
				}

				const host = createViteEditorHost({
					projectId: PROJECT_ID,
					onProjectIdChange: () => {},
					onExitProject: () => {},
					forceRendererBackend: "none",
				});
				const poison = (method: string): never => {
					graphicsQueryCalls.current.push(method);
					throw new Error(`Poison runtime graphics query called: ${method}`);
				};
				const runtimeGraphics: RuntimeGraphicsQuery = {
					selectedBackend: () => poison("selectedBackend"),
					concurrentCompositorInstances: () =>
						poison("concurrentCompositorInstances"),
					unavailableReason: () => poison("unavailableReason"),
				};
				const runtimeGpu: RuntimeGpuResourceQuery = {
					liveHandles: () => [],
					release: () => {},
				};

				ownedSession = await createEditorSession({
					host,
					runtimeGraphics,
					runtimeGpu,
				});
				await storageService.saveProject({ project: createFixtureProject() });
				storesForSession(ownedSession).assetsPanel.setState({
					activeTab: "effects",
				});
				if (cancelled) {
					await ownedSession.dispose();
					return;
				}
				setSession(ownedSession);
			} catch (error) {
				if (!cancelled) setSetupError(errorText(error));
			}
		})();

		return () => {
			cancelled = true;
			const sessionToDispose = ownedSession;
			ownedSession = null;
			if (sessionToDispose) {
				void sessionToDispose.dispose().catch((error: unknown) => {
					console.error("C4 forced-none session disposal failed:", error);
				});
			}
		};
	}, []);

	const handleObservation = useCallback((next: ForcedNoneObservation) => {
		setObservation(next);
	}, []);

	const pageErrors = asyncErrorTracker.pageErrors.length;
	const unhandledRejections = asyncErrorTracker.unhandledRejections.length;
	const assertionFailures = observation
		? [
				observation.report.source === "host-forced" || "source",
				observation.report.backend === null || "backend",
				observation.report.livePreviewLimit === 0 || "capacity",
				observation.bannerVisible || "banner",
				observation.previewUnavailableVisible || "preview-schedule",
				observation.effectPreviewCount > 0 || "effect-schedule",
				observation.renderTreeIsNull || "render-tree",
				observation.compositorHandle === null || "compositor",
				observation.gpuWorkCount === 0 || "gpu-work",
				observation.thumbnailAbsentAfterExit || "project-thumbnail",
				observation.graphicsQueryCalls.length === 0 || "runtime-query",
				observation.sessionLive || "session-live",
				pageErrors === 0 || "page-error",
				unhandledRejections === 0 || "unhandled-rejection",
			].filter((value): value is string => value !== true)
		: [];
	const status =
		setupError || pageErrors > 0 || unhandledRejections > 0
			? "error"
			: observation
				? assertionFailures.length === 0
					? "ready"
					: "failed"
				: session
					? "settling"
					: "starting";
	void asyncErrorRevision;

	return (
		<main
			data-testid="c4-forced-none-harness"
			data-status={status}
			data-evidence-scope="c4-host-constructibility-only"
			data-e1-open="software-raster-timing,actual-no-rasterizer-machine"
			data-page-errors={pageErrors}
			data-unhandled-rejections={unhandledRejections}
			data-assertion-failures={assertionFailures.join(",")}
			style={{ height: "100vh", overflow: "hidden" }}
		>
			{setupError ? (
				<pre data-testid="c4-forced-none-error">{setupError}</pre>
			) : null}
			{session ? (
				<ThemeProvider attribute="class" defaultTheme="dark">
					<TooltipProvider>
						<EditorErrorBoundary>
							<EditorHostProvider host={session.host}>
								<EditorSessionProvider session={session}>
									<EditorProvider>
										<C4ForcedNoneSurfaceProbe
											onObservation={handleObservation}
											graphicsQueryCalls={graphicsQueryCalls.current}
										/>
										<EditorRoot />
									</EditorProvider>
								</EditorSessionProvider>
							</EditorHostProvider>
						</EditorErrorBoundary>
					</TooltipProvider>
				</ThemeProvider>
			) : null}
			<output data-testid="c4-forced-none-report">
				{observation ? JSON.stringify(observation) : ""}
			</output>
		</main>
	);
}

function C4ForcedNoneSurfaceProbe({
	onObservation,
	graphicsQueryCalls,
}: {
	onObservation: (observation: ForcedNoneObservation) => void;
	graphicsQueryCalls: readonly string[];
}) {
	const session = useEditorSession();

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			await settleOrdinarySchedules();
			if (cancelled) return;
			const editor = editorForSession(session);
			await editor.project.prepareExit();
			const report = await session.capabilities.graphics();
			const statusText = Array.from(
				document.querySelectorAll<HTMLElement>('[role="status"]'),
			).map((element) => element.textContent ?? "");
			const effectPreviewCount = Array.from(
				document.querySelectorAll<HTMLCanvasElement>("canvas"),
			).filter(
				(canvas) => canvas.width === 160 && canvas.height === 160,
			).length;
			const resources = session.resources.inspect();
			onObservation({
				report,
				sessionState: session.state,
				sessionLive: session.state !== "disposed",
				bannerVisible: statusText.some((text) =>
					text.includes("Renderer unavailable in this environment"),
				),
				previewUnavailableVisible: statusText.some((text) =>
					text.includes("Preview unavailable"),
				),
				effectPreviewCount,
				renderTreeIsNull: editor.renderer.getRenderTree() === null,
				compositorHandle: editor.renderer.getCompositorHandle(),
				gpuWorkCount: resources.gpuResource.created,
				thumbnailAbsentAfterExit:
					editor.project.getActive().metadata.thumbnail === undefined,
				graphicsQueryCalls: [...graphicsQueryCalls],
			});
		})();
		return () => {
			cancelled = true;
		};
	}, [graphicsQueryCalls, onObservation, session]);

	return null;
}
