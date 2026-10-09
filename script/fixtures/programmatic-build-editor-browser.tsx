import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorSessionProvider } from "../../packages/editor-classic/src/editor/session/editor-session-provider";
import { useEditor } from "../../packages/editor-classic/src/editor/use-editor";
import { GraphicTab } from "../../packages/editor-classic/src/graphics/components/graphic-tab";
import { Button } from "../../packages/editor-classic/src/components/ui/button";
import {
	editor,
	session,
	frames,
	refs,
	externalSourceChange,
} from "./programmatic-build-editor-session";
import "../../apps/vite-example/src/styles.css";

function Probe() {
	const tracks = useEditor((value) => value.scenes.getActiveScene().tracks);
	const selected = useEditor((value) => value.selection.getSelectedElements());
	const ref = selected[0];
	const element = tracks.overlay
		.find((track) => track.id === ref?.trackId)
		?.elements.find((item) => item.id === ref?.elementId);
	const canvas = useRef<HTMLCanvasElement>(null);
	const [pixel, setPixel] = useState("");
	const [error, setError] = useState("");
	useEffect(() => {
		const controller = new AbortController();
		if (element?.type !== "graphic" || !element.programmatic) return;
		setPixel("");
		setError("");
		void frames
			.renderPng({
				request: {
					source: element.programmatic,
					clipStart: element.startTime,
					clipDuration: element.duration,
					trimStart: element.trimStart,
					timelineTime: element.startTime,
				},
				signal: controller.signal,
			})
			.then(async (png) => {
				const bitmap = await createImageBitmap(png);
				try {
					if (controller.signal.aborted) return;
					const ctx = canvas.current?.getContext("2d");
					if (!ctx) throw Error("Missing preview canvas");
					ctx.clearRect(0, 0, 64, 64);
					ctx.drawImage(bitmap, 0, 0);
					setPixel([...ctx.getImageData(32, 32, 1, 1).data].join(","));
				} finally {
					bitmap.close();
				}
			})
			.catch((caught) => {
				if (!controller.signal.aborted) setError(String(caught));
			});
		return () => controller.abort();
	}, [element]);
	if (element?.type !== "graphic") throw Error("Missing selected graphic");
	return (
		<main
			data-editor-surface
			style={{
				display: "grid",
				gridTemplateColumns: "1fr 380px",
				minHeight: "100vh",
				background: "var(--background)",
			}}
		>
			<div style={{ padding: 24 }}>
				<h1>Archived author editor acceptance</h1>
				<p>
					Private HTTP compiler and frame renderer; in-memory editor timeline.
				</p>
				<div className="flex flex-wrap gap-2 py-4">
					{refs.map((item) => (
						<Button
							variant="outline"
							key={item.elementId}
							onClick={() =>
								editor.selection.setSelectedElements({ elements: [item] })
							}
						>
							Select {item.name}
						</Button>
					))}
					<Button variant="outline" onClick={() => void editor.command.undo()}>
						Undo
					</Button>
					<Button variant="outline" onClick={() => void editor.command.redo()}>
						Redo
					</Button>
					<Button variant="outline" onClick={() => void externalSourceChange()}>
						External source change
					</Button>
				</div>
				<canvas
					ref={canvas}
					width={64}
					height={64}
					style={{
						width: 256,
						height: 256,
						imageRendering: "pixelated",
						border: "1px solid var(--border)",
					}}
				/>
				<p>
					Pixel: <output data-testid="pixel">{pixel}</output>
				</p>
				<p>Selected: {element.name}</p>
				<output data-testid="committed-seed">
					{element.programmatic?.seed}
				</output>
				<pre data-testid="committed-source" style={{ display: "none" }}>
					{JSON.stringify(element.programmatic)}
				</pre>
				{error && (
					<p data-testid="render-error" role="alert">
						{error}
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
const root = createRoot(document.getElementById("root")!);
root.render(
	<EditorSessionProvider session={session}>
		<Probe />
	</EditorSessionProvider>,
);
Object.assign(globalThis, {
	__buildEditorProbe: {
		dispose: async () => {
			root.unmount();
			await session.dispose();
		},
	},
});
