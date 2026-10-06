import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createInMemoryPorts } from "@opencut/editor-ports/in-memory";
import type { EditorHost } from "@opencut/editor-ports/host";
import { createBrowserRuntimePorts } from "../../editor/host/browser-runtime";
import { EditorSessionHost } from "../../editor/session/editor-session-host";
import { useEditorSession } from "../../editor/session/editor-session-provider";
import { EditorHostProvider } from "../../editor/host/editor-host-context";
import { TooltipProvider } from "../../components/ui/tooltip";
import { SoundsView } from "../components/assets-view";
import { useSoundSearch } from "../use-sound-search";
import { useSoundsStore } from "../../editor/use-session-store";
import "../../surface/surface.css";

const browser = createBrowserRuntimePorts({ base: "/" });
const host: EditorHost = {
	...createInMemoryPorts(),
	...browser,
	projectId: "sounds-browser-fixture",
	navigation: { onProjectReplaced() {}, onExitProject() {}, onGoBack() {} },
	services: { soundSearchEndpoint: "/fixture-sounds" },
	branding: { logoUrl: "" },
	links: { discordUrl: "", roadmapUrl: "" },
};

// A hook-only mount drives duplicate-pagination attempts deterministically;
// the panel mount below exercises the actual product controls and error UI.
function HookProbe() {
	const [query, setQuery] = useState("rain");
	const [commercialOnly, setCommercialOnly] = useState(true);
	const search = useSoundSearch({ query, commercialOnly });
	return (
		<div>
			<input
				aria-label="Probe query"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
			/>
			<button onClick={() => setCommercialOnly((value) => !value)}>
				Probe filter
			</button>
			<button
				onClick={() => {
					void search.loadMore();
					void search.loadMore();
				}}
			>
				Probe more twice
			</button>
			<button onClick={() => void search.retry()}>Probe retry</button>
			<output data-testid="result">
				{JSON.stringify({
					names: search.results.map((sound) => sound.name),
					loading: search.isLoading,
					error: search.error,
					more: search.hasNextPage,
				})}
			</output>
		</div>
	);
}

function Fixture() {
	const session = useEditorSession();
	const [endpoint, setEndpoint] = useState<string | undefined>(
		"/fixture-sounds",
	);
	const [mounted, setMounted] = useState(true);
	const [panel, setPanel] = useState(false);
	const saved = useSoundsStore((state) => state.savedSounds.length);
	return (
		<EditorHostProvider
			host={{ ...session.host, services: { soundSearchEndpoint: endpoint } }}
		>
			<button onClick={() => setMounted((value) => !value)}>
				Toggle mount
			</button>
			<button onClick={() => setPanel((value) => !value)}>Toggle panel</button>
			<button
				onClick={() =>
					setEndpoint((value) => (value ? undefined : "/fixture-sounds"))
				}
			>
				Toggle endpoint
			</button>
			<output data-testid="saved-count">{saved}</output>
			<div data-editor-surface="true" style={{ width: 320, height: 540 }}>
				{mounted && (panel ? <SoundsView /> : <HookProbe />)}
			</div>
		</EditorHostProvider>
	);
}

const target = document.getElementById("root");
if (!target) throw new Error("Missing test mount");
createRoot(target).render(
	<TooltipProvider>
		<EditorSessionHost host={host}>
			<Fixture />
		</EditorSessionHost>
	</TooltipProvider>,
);
