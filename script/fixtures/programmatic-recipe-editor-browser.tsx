import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorSessionProvider } from "../../packages/editor-classic/src/editor/session/editor-session-provider";
import { useEditor } from "../../packages/editor-classic/src/editor/use-editor";
import { GraphicTab } from "../../packages/editor-classic/src/graphics/components/graphic-tab";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { Button } from "../../packages/editor-classic/src/components/ui/button";
import {
	compiledSource,
	editor,
	externalUpdate,
	persistedRecord,
	refs,
	selectedSource,
	session,
	solidSource,
} from "./programmatic-recipe-editor-session";
import "../../apps/vite-example/src/styles.css";

function Probe() {
	const tracks = useEditor((editor) => editor.scenes.getActiveScene().tracks);
	const selected = useEditor((editor) =>
			editor.selection.getSelectedElements(),
		),
		ref = selected[0];
	const element = tracks.overlay
		.find((track) => track.id === ref?.trackId)
		?.elements.find((item) => item.id === ref?.elementId);
	const canvas = useRef<HTMLCanvasElement>(null),
		[preview, setPreview] = useState({ source: "", pixel: "", error: "" }),
		[error, setError] = useState("");
	useEffect(() => {
		const controller = new AbortController();
		if (element?.type !== "graphic" || !element.programmatic?.recipe) {
			return;
		}
		const source = element.programmatic,
			frame = resolveProgrammaticFrame({
				source,
				clipStart: element.startTime,
				clipDuration: element.duration,
				trimStart: element.trimStart,
				timelineTime: element.startTime,
			});
		if (!frame) throw Error("Missing recipe frame");
		void renderProgrammaticCanvas({ source, frame, signal: controller.signal })
			.then((bitmap) => {
				try {
					if (controller.signal.aborted) return;
					const context = canvas.current?.getContext("2d");
					if (!context) throw Error("Missing canvas");
					context.drawImage(bitmap, 0, 0);
					setPreview({
						source: JSON.stringify(source),
						pixel: [...context.getImageData(0, 0, 1, 1).data].join(","),
						error: "",
					});
				} finally {
					bitmap.close();
				}
			})
			.catch((error) => {
				if (!controller.signal.aborted)
					setPreview({
						source: JSON.stringify(source),
						pixel: "",
						error: String(error),
					});
			});
		return () => controller.abort();
	}, [element]);
	if (element?.type !== "graphic") throw Error("Missing selected graphic");
	const currentPreview =
		preview.source === JSON.stringify(element.programmatic);
	const pixel = !element.programmatic?.recipe
		? "document"
		: currentPreview
			? preview.pixel
			: "";
	const failure = error || (currentPreview ? preview.error : "");
	const action = (operation: () => Promise<unknown>) => {
		void operation().catch((error) => setError(String(error)));
	};
	return (
		<main
			data-editor-surface
			style={{
				display: "grid",
				gridTemplateColumns: "1fr 340px",
				minHeight: "100vh",
				background: "var(--background)",
			}}
		>
			<div style={{ padding: 32 }}>
				<h1>Recipe editor acceptance</h1>
				<div className="flex gap-2" style={{ margin: "24px 0" }}>
					{refs.map((ref, index) => (
						<Button
							key={ref.elementId}
							variant="outline"
							onClick={() =>
								editor.selection.setSelectedElements({ elements: [ref] })
							}
						>
							Select clip {index ? "B" : "A"}
						</Button>
					))}
					<Button
						variant="outline"
						onClick={() => action(() => editor.command.undo())}
					>
						Undo
					</Button>
					<Button
						variant="outline"
						onClick={() => action(() => editor.command.redo())}
					>
						Redo
					</Button>
				</div>
				<canvas
					data-testid="preview"
					ref={canvas}
					width={64}
					height={32}
					style={{
						width: 384,
						height: 192,
						imageRendering: "pixelated",
						border: "1px solid var(--border)",
					}}
				/>
				<p>
					Pixel: <output data-testid="pixel">{pixel}</output>
				</p>
				<p role="status">Selected: {element.name}</p>
				<pre data-testid="committed-source">
					{JSON.stringify(element.programmatic)}
				</pre>
				<Button
					variant="outline"
					onClick={() =>
						action(() => externalUpdate(solidSource([1, 1, 0, 1])))
					}
				>
					External recipe update
				</Button>
				<Button
					variant="outline"
					onClick={() =>
						action(() =>
							externalUpdate({
								...solidSource([1, 0, 1, 1]),
								recipe: undefined,
								code: "canvas.getContext('2d').fillRect(0,0,64,32)",
							}),
						)
					}
				>
					External inline update
				</Button>
				<Button
					variant="outline"
					onClick={() => action(() => externalUpdate(compiledSource()))}
				>
					External compiled update
				</Button>
				{failure && (
					<p data-testid="preview-error" role="alert">
						{failure}
					</p>
				)}
			</div>
			<aside
				style={{
					borderLeft: "1px solid var(--border)",
					overflow: "auto",
					maxHeight: "100vh",
				}}
			>
				<GraphicTab element={element} trackId={ref.trackId} />
			</aside>
		</main>
	);
}
const mount = document.getElementById("root");
if (!mount) throw Error("Missing root");
const root = createRoot(mount);
root.render(
	<EditorSessionProvider session={session}>
		<Probe />
	</EditorSessionProvider>,
);
Object.assign(globalThis, {
	__recipeEditorProbe: {
		ready: true,
		source: selectedSource,
		record: persistedRecord,
		dispose: async () => {
			root.unmount();
			return session.dispose();
		},
	},
});
