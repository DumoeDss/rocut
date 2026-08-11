import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SurfaceEvidenceHarness } from "@/editor/surface/evidence/surface-evidence-harness";

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
			<SurfaceEvidenceHarness hostName="vite" createHost={createEvidenceHost} />
		</TooltipProvider>
	</ThemeProvider>,
);
