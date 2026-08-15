import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";

import {
	DEFAULT_BACKGROUND_COLOR,
	DEFAULT_CANVAS_SIZE,
	DEFAULT_FPS,
	ZERO_MEDIA_TIME,
} from "@opencut/editor-classic";
import { Toaster } from "@opencut/editor-classic/ui";
import { TooltipProvider } from "@opencut/editor-classic/ui";
import {
	createEditorSession,
	EditorSessionProvider,
} from "@opencut/editor-classic/session";
import { editorForSession } from "@opencut/editor-classic/runtime";
import { SessionEditorSurface } from "@opencut/editor-classic/surface";
import type { TProject } from "@opencut/editor-classic/project";
import { CURRENT_PROJECT_VERSION } from "@opencut/editor-classic/storage";
import {
	buildDefaultScene,
	buildTextElement,
	getProjectDurationFromScenes,
	type CreateTextElement,
} from "@opencut/editor-classic/timeline";

import { createExampleEditorHost } from "./host";
import "./styles.css";

const PROJECT_ID = "embed-surface-example";

/**
 * A minimal but real project for the editor to open — one default scene, the
 * published default frame rate and canvas. The editor's own builders produce
 * the shape, so this file holds no schema knowledge.
 */
function createExampleProject(): TProject {
	const scene = buildDefaultScene({ name: "Main scene", isMain: true });
	// One real element, and not just for looks: a scene with no elements has
	// zero duration, and the timeline clamps every seek to the duration — the
	// playhead of an empty project provably cannot move. The text element
	// carries the published default duration (5s), which is what makes the
	// timeline scrubbable in the smoke. Text rides an overlay text track; the
	// main track only accepts video/image elements. The builder is declared to
	// return the whole creation union, so the placement narrows it to the
	// member the track accepts.
	const textElement = buildTextElement({
		raw: { name: "Hello from the host" },
		startTime: ZERO_MEDIA_TIME,
	}) as CreateTextElement;
	scene.tracks.overlay.push({
		id: crypto.randomUUID(),
		name: "Text",
		type: "text",
		hidden: false,
		elements: [{ id: crypto.randomUUID(), ...textElement }],
	});
	const now = new Date();
	return {
		metadata: {
			id: PROJECT_ID,
			name: "Embed example",
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

const container = document.getElementById("root");
if (!container) {
	throw new Error("#root is missing from index.html");
}

void (async () => {
	const session = await createEditorSession({
		host: createExampleEditorHost({ projectId: PROJECT_ID }),
	});
	await editorForSession(session).persistence.saveProject({
		project: createExampleProject(),
	});
	window.addEventListener("pagehide", () => {
		void session.dispose().catch(() => {});
	});
	createRoot(container).render(
		<StrictMode>
			{/*
			 * What the editor expects around it: a theme, tooltips, and a
			 * toaster. Everything else — portal owners, drag coordination, the
			 * session context the bridge reads — SessionEditorSurface supplies
			 * itself through the declared ./surface entry.
			 */}
			<ThemeProvider
				attribute="class"
				defaultTheme="dark"
				disableTransitionOnChange={true}
			>
				<TooltipProvider>
					<Toaster />
					<EditorSessionProvider session={session}>
						{/*
						 * The Surface fills its box — the host owes it a definite
						 * one. `min-height` on the mount chain is not definite
						 * (percentage heights resolve against it as auto), which
						 * collapses the editor to its header strip; the in-repo
						 * harnesses give it an explicit viewport-height wrapper
						 * (apps/vite-example/src/c4-forced-none-harness.tsx), and
						 * so does this example.
						 */}
						<div style={{ height: "100vh", overflow: "hidden" }}>
							<SessionEditorSurface focusMode="focused" />
						</div>
					</EditorSessionProvider>
				</TooltipProvider>
			</ThemeProvider>
		</StrictMode>,
	);
})();
