import * as React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";

import { Toaster } from "@opencut/editor-classic/ui";
import { TooltipProvider } from "@opencut/editor-classic/ui";
import { SurfaceEvidenceHarness } from "@opencut/editor-classic/evidence";

import { createElectronEditorHost } from "./host/electron-host-config";
import "./styles.css";

/**
 * The Electron host's surface-evidence entry (task 6.1) — the Vite example's
 * `surface-evidence-main.tsx` mirrored, selected at launch via
 * `--opencut-entry=surface-evidence` (main.cjs loads `<dist>/<name>.html`).
 * The harness itself is the package's own, unmodified: only this composition
 * is new (design/spec: "through the same harnesses rather than Host-private
 * copies"). Evidence runs always point `OPENCUT_STORE_ROOT` at a disposable
 * directory — nothing here writes toward `userData` by accident.
 */
const createEvidenceHost = ({
	projectId,
	onProjectReplaced,
}: {
	projectId: string;
	onProjectReplaced: (projectId: string) => void;
}) =>
	createElectronEditorHost({
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
				/*
				 * The harness's `hostName` union was born dual ("next" | "vite") and
				 * task 6.1 freezes the harness file unmodified, so the third Host's
				 * name crosses as a documented call-site cast: the prop is a label
				 * recorded verbatim into the ledger (`host`, `data-host`), not a
				 * value the harness branches on. The runtime ledger therefore
				 * attributes this run to "electron" truthfully; only the static
				 * union lags. Widening the union instead would modify the harness
				 * this change's own task text forbids touching.
				 */
				hostName={"electron" as "next" | "vite"}
				hostReactIdentity={React}
				buildMarker={
					import.meta.env.VITE_R2_BUILD_MARKER ?? "missing-electron-marker"
				}
				createHost={createEvidenceHost}
			/>
		</TooltipProvider>
	</ThemeProvider>,
);
