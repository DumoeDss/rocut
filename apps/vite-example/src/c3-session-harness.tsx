import { memo, useCallback, useEffect, useRef, useState } from "react";

import { editorForSession } from "@/editor/runtime/session-core-owner";
import { prepareWasmRuntimeProviders } from "@/editor/runtime/wasm-runtime-providers";
import {
	createEditorSession,
	EditorSessionProvider,
	type EditorSession,
} from "@/editor/session";
import { useEditor, useEditorInstance } from "@/editor/use-editor";
import { createInMemoryHost } from "@opencut/editor-ports/in-memory/host";
import { MigrationDialog } from "@/project/components/migration-dialog";
import { IndexedDBAdapter } from "@/services/storage/indexeddb-adapter";
import type { CanvasRenderer } from "@/services/renderer/canvas-renderer";
import { buildScene } from "@/services/renderer/scene-builder";
import { buildTextElement } from "@/timeline/element-utils";
import type { TextElement, TScene } from "@/timeline";
import { mediaTime, type MediaTime } from "@/wasm";

type HarnessSession = {
	session: EditorSession;
	renderer: CanvasRenderer;
	canvas: HTMLCanvasElement;
	handle: number;
};

type HarnessState = {
	status: "starting" | "ready" | "error";
	backend: "webgl" | "webgpu" | null;
	capacity: number;
	sessions: HarnessSession[];
	rejection: string | null;
	error: string | null;
	revision: number;
};

const BUILD_COMMIT = import.meta.env.VITE_C3_BUILD_COMMIT ?? "missing";
const C4_BUILD_MARKER = import.meta.env.VITE_C4_BUILD_MARKER ?? "development";

function seedEditorState({
	session,
	projectId,
	selectionId,
	playhead,
}: {
	session: EditorSession;
	projectId: string;
	selectionId: string;
	playhead: MediaTime;
}) {
	const editor = editorForSession(session);
	const sceneId = `${projectId}-scene`;
	const trackId = `${projectId}-track`;
	const now = new Date();
	const textElement: TextElement = {
		id: selectionId,
		...(buildTextElement({
			raw: { name: selectionId, duration: mediaTime({ ticks: 12_000 }) },
			startTime: mediaTime({ ticks: 0 }),
		}) as Omit<TextElement, "id">),
	};
	const scene: TScene = {
		id: sceneId,
		name: `${projectId} scene`,
		isMain: true,
		tracks: {
			overlay: [
				{
					id: trackId,
					name: `${projectId} text`,
					type: "text" as const,
					elements: [textElement],
					hidden: false,
				},
			],
			main: {
				id: `${projectId}-main`,
				name: "Main",
				type: "video" as const,
				elements: [],
				muted: false,
				hidden: false,
			},
			audio: [],
		},
		bookmarks: [],
		createdAt: now,
		updatedAt: now,
	};

	editor.project.setActiveProject({
		project: {
			metadata: {
				id: projectId,
				name: projectId,
				duration: mediaTime({ ticks: 12_000 }),
				createdAt: now,
				updatedAt: now,
			},
			scenes: [scene],
			currentSceneId: scene.id,
			settings: {
				fps: { numerator: 30, denominator: 1 },
				canvasSize: { width: 160, height: 100 },
				background: { type: "color", color: "#09090b" },
			},
			version: 1,
		},
	});
	editor.scenes.initializeScenes({ scenes: [scene], currentSceneId: scene.id });
	editor.selection.setSelectedElements({
		elements: [{ trackId, elementId: selectionId }],
	});
	editor.playback.seek({ time: playhead });
}

async function renderOwnedFrame({
	session,
	renderer,
	color,
}: {
	session: EditorSession;
	renderer: CanvasRenderer;
	color: string;
}) {
	const editor = editorForSession(session);
	const active = editor.project.getActive();
	const renderTree = buildScene({
		tracks: editor.scenes.getActiveScene().tracks,
		mediaAssets: editor.media.getAssets(),
		duration: editor.timeline.getTotalDuration(),
		canvasSize: active.settings.canvasSize,
		background: { type: "color", color },
		assetResolver: editor.renderer.assetResolver,
	});
	editor.renderer.setRenderTree({ renderTree });
	await renderer.render({
		node: renderTree,
		time: editor.playback.getCurrentTime(),
	});
}

const EditorHookProbe = memo(function EditorHookProbe({
	label,
}: {
	label: string;
}) {
	const [project, selection, playhead, isMigrating] = useEditor((editor) => [
		editor.project.getActiveOrNull()?.metadata.name ?? "none",
		editor.selection.getSelectedElements()[0]?.elementId ?? "none",
		editor.playback.getCurrentTime(),
		editor.project.getMigrationState().isMigrating,
	]);
	const editor = useEditorInstance();
	const firstEditor = useRef(editor);
	const renderCount = useRef(0);
	renderCount.current += 1;

	return (
		<output
			data-testid={`c3-hook-${label}`}
			data-project={project}
			data-selection={selection}
			data-playhead={playhead}
			data-migrating={String(isMigrating)}
			data-render-count={renderCount.current}
			data-instance-stable={String(firstEditor.current === editor)}
		/>
	);
});

export function C3SessionHarness() {
	const [state, setState] = useState<HarnessState>({
		status: "starting",
		backend: null,
		capacity: 0,
		sessions: [],
		rejection: null,
		error: null,
		revision: 0,
	});
	const ownedRef = useRef<{
		sessions: EditorSession[];
		disposeRuntime: () => void;
	} | null>(null);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const runtime = await prepareWasmRuntimeProviders();
				const createHarnessSession = async ({
					project,
					color,
					selection,
					playhead,
				}: {
					project: string;
					color: string;
					selection: string;
					playhead: MediaTime;
				}): Promise<HarnessSession> => {
					const session = await createEditorSession({
						host: createInMemoryHost({ projectId: project }),
						runtimeGraphics: runtime.runtimeGraphics,
						runtimeGpu: runtime.runtimeGpu,
					});
					seedEditorState({
						session,
						projectId: project,
						selectionId: selection,
						playhead,
					});
					const editor = editorForSession(session);
					const renderer = editor.renderer.createCanvasRenderer({
						width: 160,
						height: 100,
						fps: { numerator: 30, denominator: 1 },
					});
					const canvas = await renderer.getOutputCanvas();
					const handle = editor.renderer.getCompositorHandle();
					if (!handle)
						throw new Error("Session compositor did not publish a handle.");
					await renderOwnedFrame({ session, renderer, color });
					return { session, renderer, canvas, handle };
				};

				const first = await createHarnessSession({
					project: "c3-project-red",
					color: "#ef4444",
					selection: "red-title",
					playhead: mediaTime({ ticks: 1_200 }),
				});
				const report = await first.session.capabilities.graphics();
				const sessions = [first];
				// This is the Host decision point: capability is observed before a
				// second session, compositor or layout node exists.
				if (report.rasterizer === "gpu" && report.livePreviewLimit >= 2) {
					sessions.push(
						await createHarnessSession({
							project: "c3-project-blue",
							color: "#2563eb",
							selection: "blue-title",
							playhead: mediaTime({ ticks: 4_800 }),
						}),
					);
				}
				ownedRef.current = {
					sessions: sessions.map((entry) => entry.session),
					disposeRuntime: runtime.dispose,
				};
				if (cancelled) {
					await Promise.all(sessions.map((entry) => entry.session.dispose()));
					runtime.dispose();
					return;
				}
				setState({
					status: "ready",
					backend: report.backend,
					capacity: report.livePreviewLimit,
					sessions,
					rejection: null,
					error: null,
					revision: 0,
				});
			} catch (error) {
				if (!cancelled) {
					setState((current) => ({
						...current,
						status: "error",
						error: error instanceof Error ? error.message : String(error),
					}));
				}
			}
		})();
		return () => {
			cancelled = true;
			const owned = ownedRef.current;
			ownedRef.current = null;
			if (owned) {
				void Promise.all(
					owned.sessions.map((session) => session.dispose()),
				).finally(owned.disposeRuntime);
			}
		};
	}, []);

	const mountCanvas = useCallback(
		(index: number, node: HTMLDivElement | null) => {
			const canvas = state.sessions[index]?.canvas;
			if (!node || !canvas) return;
			canvas.dataset.frame = index === 0 ? "red" : "blue";
			canvas.style.width = "320px";
			canvas.style.height = "200px";
			if (canvas.parentElement !== node) node.appendChild(canvas);
		},
		[state.sessions],
	);

	const requestSecond = () => {
		if (state.capacity < 2) {
			setState((current) => ({
				...current,
				rejection: "over-capacity: runtime reports one live preview",
			}));
		}
	};

	const mutateFirst = async () => {
		const first = state.sessions[0];
		if (!first) return;
		const editor = editorForSession(first.session);
		const active = editor.project.getActive();
		editor.project.setActiveProject({
			project: {
				...active,
				metadata: { ...active.metadata, name: "c3-project-green" },
			},
		});
		editor.selection.setSelectedElements({
			elements: [{ trackId: "c3-project-red-track", elementId: "green-title" }],
		});
		editor.playback.seek({ time: mediaTime({ ticks: 7_200 }) });
		await renderOwnedFrame({
			session: first.session,
			renderer: first.renderer,
			color: "#22c55e",
		});
		setState((current) => ({ ...current, revision: current.revision + 1 }));
	};

	const migrateFirst = async () => {
		const first = state.sessions[0];
		if (!first) return;
		const editor = editorForSession(first.session);
		const active = editor.project.getActive();
		const legacyProjects = new IndexedDBAdapter<Record<string, unknown>>({
			dbName: "video-editor-projects",
			storeName: "projects",
			version: 1,
		});
		await legacyProjects.clear();
		await legacyProjects.set({
			key: "c3-legacy-project",
			value: {
				...active,
				metadata: {
					...active.metadata,
					id: "c3-legacy-project",
					name: "C3 legacy project",
				},
				version: 30,
			},
		});
		await editor.project.loadAllProjects();
	};

	return (
		<main
			data-testid="c3-session-harness"
			data-status={state.status}
			data-backend={state.backend ?? "none"}
			data-capacity={state.capacity}
			data-handles={state.sessions.map((entry) => entry.handle).join(",")}
			data-build-commit={BUILD_COMMIT}
			data-c4-build-marker={C4_BUILD_MARKER}
			data-revision={state.revision}
			style={{
				minHeight: "100vh",
				padding: 24,
				background: "#09090b",
				color: "white",
			}}
		>
			<h1>C3 explicit session preview harness</h1>
			{state.error ? <pre data-testid="c3-error">{state.error}</pre> : null}
			<div style={{ display: "flex", gap: 24 }}>
				{state.sessions.map((entry, index) => {
					const editor = editorForSession(entry.session);
					const active = editor.project.getActive();
					return (
						<section
							key={entry.session.id}
							data-testid={`c3-session-${index === 0 ? "a" : "b"}`}
							data-project={active.metadata.id}
							data-project-name={active.metadata.name}
							data-selection={
								editor.selection.getSelectedElements()[0]?.elementId ?? "none"
							}
							data-playhead={editor.playback.getCurrentTime()}
							data-handle={entry.handle}
						>
							<div ref={(node) => mountCanvas(index, node)} />
							<p>{active.metadata.name}</p>
							<EditorSessionProvider session={entry.session}>
								<EditorHookProbe label={index === 0 ? "a" : "b"} />
								<MigrationDialog />
							</EditorSessionProvider>
						</section>
					);
				})}
			</div>
			<button
				type="button"
				data-testid="c3-mutate-a"
				onClick={() => void mutateFirst()}
			>
				Mutate session A
			</button>
			<button
				type="button"
				data-testid="c3-request-second"
				onClick={requestSecond}
			>
				Request second preview
			</button>
			<button
				type="button"
				data-testid="c3-migrate-a"
				onClick={() => void migrateFirst()}
			>
				Migrate session A legacy project
			</button>
			{state.rejection ? (
				<p data-testid="c3-capacity-rejection">{state.rejection}</p>
			) : null}
		</main>
	);
}
