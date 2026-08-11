import { useCallback, useState } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MobileGate } from "@/components/editor/mobile-gate";
import { SessionEditorSurface } from "@/editor/surface/embedding/session-surface-bridge";
import { ViteEditorHost } from "./host/vite-editor-host";
import { createViteEditorHost } from "./host/vite-host-config";
import { ProjectPicker } from "./project-picker";
import { EditorErrorBoundary } from "./editor-error-boundary";
import { C3SessionHarness } from "./c3-session-harness";
import { C4ForcedNoneHarness } from "./c4-forced-none-harness";
import { C4WorkerHarness } from "./c4-worker-harness";
import { C4SessionHarness } from "./c4-session-harness";
import { C6DisposalHarness } from "@/editor/session/c6-disposal-harness";
import { BrowserProjectStore } from "@/services/storage/browser-project-store";

const C4_BUILD_MARKER = import.meta.env.VITE_C4_BUILD_MARKER ?? "development";

function readProjectIdFromUrl(): string | null {
	return new URLSearchParams(window.location.search).get("project");
}

export function App() {
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
	return <EditorApp />;
}

function EditorApp() {
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
									<SessionEditorSurface focusMode="focused" />
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
