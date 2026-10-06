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
import { useEditorInstance } from "../../editor/use-editor";
import { TooltipProvider } from "../../components/ui/tooltip";
import { Captions } from "../components/assets-view";
import "../../surface/surface.css";

const storageControl = new InMemoryProjectStoreControl();
const host: EditorHost = {
	...createInMemoryPorts({
		store: new InMemoryProjectStore({ control: storageControl }),
	}),
	...createBrowserRuntimePorts({ base: "/" }),
	projectId: "caption-cancel-fixture",
	navigation: { onProjectReplaced() {}, onExitProject() {}, onGoBack() {} },
	branding: { logoUrl: "" },
	links: { discordUrl: "", roadmapUrl: "" },
};

function Fixture() {
	const session = useEditorSession();
	const editor = useEditorInstance();
	const target = useRef<HTMLDivElement>(null);
	const [ready, setReady] = useState(false);
	const [mounted, setMounted] = useState(true);
	const [names, setNames] = useState<string[]>([]);
	const [project, setProject] = useState("");
	useEffect(() => {
		if (!target.current) return;
		const mounted = session.mount({ target: target.current });
		void mounted.ready.then(() => setReady(true));
		const unsubscribe = editor.scenes.subscribe(() => {
			setNames(
				editor.scenes
					.getActiveSceneOrNull()
					?.tracks.overlay.flatMap((track) =>
						track.elements.map((element) => element.name),
					) ?? [],
			);
		});
		return () => {
			unsubscribe();
			void session.unmount();
		};
	}, [editor, session]);
	return (
		<>
			<div ref={target} />
			<output data-testid="ready">{String(ready)}</output>
			<output data-testid="captions">{JSON.stringify(names)}</output>
			<output data-testid="project">{project}</output>
			<button
				onClick={() =>
					storageControl.failNext({
						operation: "save-project",
						code: "unavailable",
					})
				}
			>
				Fail next caption save
			</button>
			<button
				onClick={async () => {
					await editor.project.createNewProject({
						name: "Owned caption fixture",
					});
					setProject(editor.project.getActive().metadata.id);
				}}
			>
				New project
			</button>
			<button onClick={() => setMounted((value) => !value)}>
				Toggle panel
			</button>
			<button onClick={() => void session.suspend()}>Suspend</button>
			<button onClick={() => void session.resume()}>Resume</button>
			<div data-editor-surface="true" style={{ width: 320, height: 520 }}>
				{mounted && <Captions />}
			</div>
		</>
	);
}
const target = document.getElementById("root");
if (!target) throw new Error("Missing fixture root");
createRoot(target).render(
	<TooltipProvider>
		<EditorSessionHost host={host}>
			<Fixture />
		</EditorSessionHost>
	</TooltipProvider>,
);
