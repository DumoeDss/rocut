import { useCallback, useState } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@opencut/editor-classic/ui";
import { TooltipProvider } from "@opencut/editor-classic/ui";
import { MobileGate } from "@opencut/editor-classic/ui";
import { SessionEditorSurface } from "@opencut/editor-classic/surface";
import { ElectronEditorHost } from "./host/electron-editor-host";
import { ProjectPicker } from "./project-picker";
import { EditorErrorBoundary } from "./editor-error-boundary";

function readProjectIdFromUrl(): string | null {
	return new URLSearchParams(window.location.search).get("project");
}

/**
 * The Electron host's app entry — the Vite example's `app.tsx` mirrored, minus
 * the C3/C4 harness dispatches (those land with their groups) and minus the
 * bounding HostChrome: a desktop window is the container, so the editor fills
 * the window rather than a bordered box inside a page.
 *
 * The project picker records `?project=<id>` the same way, so the identity
 * seam is exercised identically across hosts.
 */
export function App() {
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
						</ElectronEditorHost>
					</EditorErrorBoundary>
				)}
			</TooltipProvider>
		</ThemeProvider>
	);
}
