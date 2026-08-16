import { useCallback, useState } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@opencut/editor-classic/ui";
import { TooltipProvider } from "@opencut/editor-classic/ui";
import { MobileGate } from "@opencut/editor-classic/ui";
import { SessionEditorSurface } from "@opencut/editor-classic/surface";
import { C6DisposalHarness } from "@opencut/editor-classic/evidence";
import { ElectronEditorHost } from "./host/electron-editor-host";
import { ProjectPicker } from "./project-picker";
import { EditorErrorBoundary } from "./editor-error-boundary";
import { C4WorkerHarness } from "./c4-worker-harness";
import { FilesystemProjectStore } from "./store/filesystem-project-store";
import { ExportPanel } from "./export/export-panel";
import { createElectronEditorHost } from "./host/electron-host-config";

function readProjectIdFromUrl(): string | null {
	return new URLSearchParams(window.location.search).get("project");
}

/**
 * The Electron host's app entry — the Vite example's `app.tsx` mirrored, minus
 * the bounding HostChrome: a desktop window is the container, so the editor
 * fills the window rather than a bordered box inside a page. The C4 worker
 * harness dispatch is the vite example's own pattern (`?c4-worker-harness=1`,
 * task 5.3), and the C6 disposal dispatch mirrors the vite example's own
 * (`?c6-disposal-harness=1`, task 6.2). Evidence dispatches run against a
 * disposable `OPENCUT_STORE_ROOT` (main.cjs honors it) — never `userData`.
 */
export function App() {
	const query = new URLSearchParams(window.location.search);
	if (query.get("c4-worker-harness") === "1") {
		return <C4WorkerHarness />;
	}
	if (query.get("c6-disposal-harness") === "1") {
		return (
			<C6DisposalHarness
				createHost={({ projectId, onProjectReplaced, onExitProject }) =>
					createElectronEditorHost({
						projectId,
						onProjectIdChange: onProjectReplaced,
						onExitProject,
					})
				}
				isDurableBrowserStore={(store) => store instanceof FilesystemProjectStore}
				buildMarker={import.meta.env.VITE_C6_BUILD_MARKER ?? "development"}
			/>
		);
	}
	return <EditorApp />;
}

/**
 * The project picker records `?project=<id>` the same way, so the identity
 * seam is exercised identically across hosts.
 */
function EditorApp() {
	const [projectId, setProjectId] = useState<string | null>(readProjectIdFromUrl);

	const openProject = useCallback((id: string) => {
		setProjectId(id);
		window.history.replaceState(null, "", `?project=${encodeURIComponent(id)}`);
	}, []);

	const exitProject = useCallback(() => {
		setProjectId(null);
		window.history.replaceState(null, "", window.location.pathname);
	}, []);

	return (
		// Mirrors what `apps/web`'s root layout provides, minus `next/font` and
		// the analytics scripts — the editor expects a theme, tooltips and a
		// toaster.
		<ThemeProvider
			attribute="class"
			defaultTheme="system"
			disableTransitionOnChange={true}
		>
			<TooltipProvider>
				<Toaster />
				{/* The viewport-sized wrapper the editor's embedding contract
				 * requires (editor-root.tsx: "the host supplies the
				 * viewport-sized wrapper"). The Vite example wraps this same
				 * tree in its HostChrome, whose bordered box is demo decoration
				 * but whose `height: 100vh` + flex main is load-bearing:
				 * without a definite-height ancestor the editor's `size-full`
				 * chain resolves against `auto`, and the panel layout collapses
				 * to near-zero below the header — found by the Group 7 parity
				 * run (hover hit-tests landed on the header and panel
				 * separators; both step screenshots showed chrome only). A
				 * desktop window is its own chrome, so the wrapper is the whole
				 * window. */}
				<main className="h-screen w-screen overflow-hidden">
					{projectId === null ? (
						<ElectronEditorHost
							projectId="project-picker"
							onProjectIdChange={setProjectId}
							onExitProject={exitProject}
						>
							<ProjectPicker onOpen={openProject} />
						</ElectronEditorHost>
					) : (
						<EditorErrorBoundary>
							<ElectronEditorHost
								projectId={projectId}
								onProjectIdChange={setProjectId}
								onExitProject={exitProject}
							>
								<MobileGate>
									<SessionEditorSurface focusMode="focused" />
								</MobileGate>
								{/* Host chrome, not editor surface: the export panel is this
								 * Host's own job-control surface (design D3), a fixed-overlay
								 * sibling of the editor — outside
								 * SessionEditorSurface's tree, beside MobileGate. */}
								<ExportPanel projectId={projectId} />
							</ElectronEditorHost>
						</EditorErrorBoundary>
					)}
				</main>
			</TooltipProvider>
		</ThemeProvider>
	);
}
