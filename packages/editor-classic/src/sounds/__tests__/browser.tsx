import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	createInMemoryPorts,
	InMemoryProjectStore,
	InMemoryProjectStoreControl,
} from "@opencut/editor-ports/in-memory";
import type { EditorHost } from "@opencut/editor-ports/host";
import { createBrowserRuntimePorts } from "../../editor/host/browser-runtime";
import { EditorSessionHost } from "../../editor/session/editor-session-host";
import { useEditorSession } from "../../editor/session/editor-session-provider";
import { EditorHostProvider } from "../../editor/host/editor-host-context";
import { TooltipProvider } from "../../components/ui/tooltip";
import { Toaster } from "../../components/ui/sonner";
import { SoundsView } from "../components/assets-view";
import { useSoundSearch } from "../use-sound-search";
import { useSoundsStore } from "../../editor/use-session-store";
import { useEditorInstance } from "../../editor/use-editor";
import "../../surface/surface.css";

const browser = createBrowserRuntimePorts({ base: "/" });
const storageControl = new InMemoryProjectStoreControl();
const host: EditorHost = {
	...createInMemoryPorts({
		store: new InMemoryProjectStore({ control: storageControl }),
	}),
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
	const editor = useEditorInstance();
	const [projectReady, setProjectReady] = useState(false);
	const [audioNames, setAudioNames] = useState<string[]>([]);
	const [reopened, setReopened] = useState(false);
	const [mediaAudit, setMediaAudit] = useState("");
	useEffect(
		() =>
			editor.scenes.subscribe(() => {
				setAudioNames(
					editor.scenes
						.getActiveSceneOrNull()
						?.tracks.audio.flatMap((track) =>
							track.elements.map((element) => element.name),
						) ?? [],
				);
			}),
		[editor],
	);
	const mountTarget = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!mountTarget.current) return;
		const root = session.mount({ target: mountTarget.current });
		void root.ready;
		return () => {
			void session.unmount();
		};
	}, [session]);
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
			<div ref={mountTarget} data-testid="session-root" />
			<button onClick={() => setMounted((value) => !value)}>
				Toggle mount
			</button>
			<button onClick={() => setPanel((value) => !value)}>Toggle panel</button>
			<button onClick={() => void session.suspend()}>Suspend session</button>
			<button onClick={() => void session.resume()}>Resume session</button>
			<button
				onClick={async () => {
					await editor.project.createNewProject({
						name: "Owned Sounds fixture",
					});
					setProjectReady(true);
				}}
			>
				Create project
			</button>
			<output data-testid="project-ready">{String(projectReady)}</output>
			<output data-testid="audio-names">{JSON.stringify(audioNames)}</output>
			<button onClick={() => void editor.command.undo()}>Undo insertion</button>
			<button onClick={() => void editor.command.redo()}>Redo insertion</button>
			<button
				onClick={async () => {
					const id = editor.project.getActiveOrNull()?.metadata.id;
					if (!id) throw new Error("Fixture project not open");
					await editor.project.saveCurrentProject();
					await editor.project.loadProject({ id });
					setReopened(true);
				}}
			>
				Reopen project
			</button>
			<output data-testid="reopened">{String(reopened)}</output>
			<button
				onClick={async () => {
					const assets = editor.media.getAssets();
					const details = await Promise.all(
						assets.map(async (asset) => {
							const bytes = await asset.file.arrayBuffer();
							const digest = await crypto.subtle.digest("SHA-256", bytes);
							return {
								type: asset.type,
								duration: asset.duration,
								size: bytes.byteLength,
								sha256: Array.from(new Uint8Array(digest), (byte) =>
									byte.toString(16).padStart(2, "0"),
								).join(""),
							};
						}),
					);
					setMediaAudit(JSON.stringify(details));
				}}
			>
				Audit media bytes
			</button>
			<output data-testid="media-audit">{mediaAudit}</output>
			<button
				onClick={() =>
					setEndpoint((value) => (value ? undefined : "/fixture-sounds"))
				}
			>
				Toggle endpoint
			</button>
			<output data-testid="saved-count">{saved}</output>
			<button
				onClick={() =>
					storageControl.failNext({ operation: "clear", code: "unavailable" })
				}
			>
				Fail next library clear
			</button>
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
		<Toaster />
		<EditorSessionHost host={host}>
			<Fixture />
		</EditorSessionHost>
	</TooltipProvider>,
);
