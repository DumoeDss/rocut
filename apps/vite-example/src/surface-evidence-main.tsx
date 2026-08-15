import * as React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";

import { Toaster } from "@opencut/editor-classic/ui";
import { TooltipProvider } from "@opencut/editor-classic/ui";
import { SurfaceEvidenceHarness } from "@opencut/editor-classic/evidence";

import { createViteEditorHost } from "./host/vite-host-config";
import "./styles.css";

const createEvidenceHost = ({
	projectId,
	onProjectReplaced,
}: {
	projectId: string;
	onProjectReplaced: (projectId: string) => void;
}) =>
	createViteEditorHost({
		projectId,
		onProjectIdChange: onProjectReplaced,
		onExitProject: () => {},
		forceRendererBackend: "none",
	});

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from surface-evidence.html");

createRoot(container).render(
	<ThemeProvider
		attribute="class"
		defaultTheme="system"
		disableTransitionOnChange={true}
	>
		<TooltipProvider>
			<Toaster />
			<SurfaceEvidenceHarness
				hostName="vite"
				hostReactIdentity={React}
				buildMarker={
					import.meta.env.VITE_R2_BUILD_MARKER ?? "missing-vite-marker"
				}
				createHost={createEvidenceHost}
			/>
		</TooltipProvider>
	</ThemeProvider>,
);
