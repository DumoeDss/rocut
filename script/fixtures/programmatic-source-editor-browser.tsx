import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { createInMemoryHost } from "@opencut/editor-ports/in-memory/host";
import { createEditorSession } from "../../packages/editor-classic/src/editor/session/create-session";
import { EditorSessionProvider } from "../../packages/editor-classic/src/editor/session/editor-session-provider";
import { editorForSession } from "../../packages/editor-classic/src/editor/runtime/session-core-owner";
import { useEditor } from "../../packages/editor-classic/src/editor/use-editor";
import { GraphicTab } from "../../packages/editor-classic/src/graphics/components/graphic-tab";
import { InsertElementCommand } from "../../packages/editor-classic/src/commands/timeline/element/insert-element";
import { UpdateElementsCommand } from "../../packages/editor-classic/src/commands/timeline/element/update-elements";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { Button } from "../../packages/editor-classic/src/components/ui/button";
import "../../apps/vite-example/src/styles.css";

const session = await createEditorSession({
	host: createInMemoryHost({
		projectId: "source-editor-probe",
		graphics: { mode: "force", rasterizer: "none" },
	}),
});
const editor = editorForSession(session);
await editor.project.createNewProject({ name: "Source editor acceptance" });
const code = (color: string) =>
	`const ctx = canvas.getContext('2d');\nctx.fillStyle = '${color}';\nctx.fillRect(0, 0, canvas.width, canvas.height);`;
const source: ProgrammaticSource = {
	version: 1,
	runtime: "canvas-worker",
	code: code("#ff0000"),
	width: 64,
	height: 32,
	frameRate: { numerator: 30, denominator: 1 },
	durationFrames: 90,
	seed: 7,
};
const refs: Array<{ trackId: string; elementId: string }> = [];
for (const [name, color] of [
	["Clip A", "#ff0000"],
	["Clip B", "#0000ff"],
]) {
	const insert = new InsertElementCommand({
		element: {
			type: "graphic",
			definitionId: "programmatic",
			name,
			params: {},
			programmatic: { ...source, code: code(color) },
			startTime: mediaTime({ ticks: 0 }),
			duration: mediaTime({ ticks: 240000 }),
			trimStart: mediaTime({ ticks: 0 }),
			trimEnd: mediaTime({ ticks: 0 }),
		},
		placement: { mode: "auto", trackType: "graphic" },
	});
	await editor.command.execute({ command: insert });
	refs.push({
		trackId: insert.getTrackId()!,
		elementId: insert.getElementId(),
	});
}
editor.selection.setSelectedElements({ elements: [refs[0]] });

function Probe() {
	const tracks = useEditor((editor) => editor.scenes.getActiveScene().tracks);
	const selected = useEditor((editor) =>
		editor.selection.getSelectedElements(),
	);
	const ref = selected[0];
	const element = tracks.overlay
		.find((track) => track.id === ref?.trackId)
		?.elements.find((element) => element.id === ref?.elementId);
	const canvas = useRef<HTMLCanvasElement>(null);
	const [pixel, setPixel] = useState("");
	const [error, setError] = useState("");
	useEffect(() => {
		const controller = new AbortController();
		if (
			element?.type !== "graphic" ||
			!element.programmatic ||
			element.programmatic.runtime !== "canvas-worker"
		) {
			setPixel("document");
			return;
		}
		const request = {
			source: element.programmatic,
			clipStart: element.startTime,
			clipDuration: element.duration,
			trimStart: element.trimStart,
			timelineTime: element.startTime,
		};
		const frame = resolveProgrammaticFrame(request);
		if (!frame) throw Error("Expected frame");
		void renderProgrammaticCanvas({
			source: request.source,
			frame,
			signal: controller.signal,
		})
			.then((bitmap) => {
				try {
					if (controller.signal.aborted) return;
					const ctx = canvas.current?.getContext("2d");
					if (!ctx) throw Error("Canvas unavailable");
					ctx.drawImage(bitmap, 0, 0);
					setPixel([...ctx.getImageData(0, 0, 1, 1).data].join(","));
				} finally {
					bitmap.close();
				}
			})
			.catch((error) => {
				if (!controller.signal.aborted) setError(String(error));
			});
		return () => controller.abort();
	}, [element]);
	if (element?.type !== "graphic") throw Error("Missing selected graphic");
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
				<h1>Programmatic source editor</h1>
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
					<Button variant="outline" onClick={() => void editor.command.undo()}>
						Undo
					</Button>
					<Button variant="outline" onClick={() => void editor.command.redo()}>
						Redo
					</Button>
				</div>
				<canvas
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
				<pre data-testid="committed-code">{element.programmatic?.code}</pre>
				<Button
					variant="outline"
					onClick={() =>
						void editor.command.execute({
							command: new UpdateElementsCommand({
								updates: [
									{
										...ref,
										patch: {
											programmatic: { ...source, code: code("#ffff00") },
										},
									},
								],
							}),
						})
					}
				>
					External inline update
				</Button>
				<Button
					variant="outline"
					onClick={() =>
						void editor.command.execute({
							command: new UpdateElementsCommand({
								updates: [
									{
										...ref,
										patch: {
											programmatic: {
												...source,
												runtime: "html-document",
												code: "",
												documentId: "author.html",
												resources: [
													{
														id: "author.html",
														kind: "document",
														mimeType: "text/html",
														byteLength: 1,
														sha256: "a".repeat(64),
														attachmentKey: `programmatic-sha256-${"a".repeat(64)}`,
													},
												],
											},
										},
									},
								],
							}),
						})
					}
				>
					External document update
				</Button>
				{error && <p role="alert">{error}</p>}
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
const root = createRoot(document.getElementById("root")!);
root.render(
	<EditorSessionProvider session={session}>
		<Probe />
	</EditorSessionProvider>,
);
Object.assign(globalThis, {
	__sourceEditorProbe: {
		ready: true,
		dispose: async () => {
			root.unmount();
			return session.dispose();
		},
	},
});
