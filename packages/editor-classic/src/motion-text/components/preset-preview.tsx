"use client";

import { useEffect, useMemo, useRef } from "react";

import { useEditorSession } from "../../editor/session/editor-session-provider";
import { createRafLoop } from "../../hooks/use-raf-loop";
import {
	createMotionTextRenderRuntime,
	drawMotionTextFrame,
	resolveMotionTextRenderFrame,
	type MotionTextRenderRuntime,
} from "../../services/renderer/motion-text/jizura-adapter";
import { MOTION_TEXT_RENDERER_SUPPORT } from "../../services/renderer/motion-text/support-manifest";
import { createMotionTextPresetPreview, TICKS_PER_SECOND } from "../../wasm";
import type { MotionTextPresetCatalogEntry } from "../preset-catalog";

const PREVIEW_WIDTH = 320;
const PREVIEW_HEIGHT = 180;
const PREVIEW_DURATION = 6 * TICKS_PER_SECOND;

interface PreviewWindow {
	readonly startTime: number;
	readonly duration: number;
}

function resolvePreviewWindow({
	entry,
	runtime,
}: {
	readonly entry: MotionTextPresetCatalogEntry;
	readonly runtime: MotionTextRenderRuntime;
}): PreviewWindow | null {
	const first = runtime.orderedCuts[0];
	if (!first) return null;
	const transitionTicks = Math.max(
		1,
		Math.min(36_000, Math.floor(first.duration / 3)),
	);
	switch (entry.group) {
		case "enter":
			return { startTime: first.startTime, duration: transitionTicks };
		case "hold":
			return {
				startTime: first.startTime + Math.floor(first.duration * 0.35),
				duration: Math.max(1, Math.floor(first.duration * 0.3)),
			};
		case "exit":
			return {
				startTime: first.startTime + first.duration - transitionTicks,
				duration: transitionTicks,
			};
		case "trans": {
			const second = runtime.orderedCuts[1];
			if (!second) return null;
			return {
				startTime: second.startTime,
				duration: Math.max(
					1,
					Math.min(36_000, Math.floor(second.duration / 3)),
				),
			};
		}
		default:
			return {
				startTime: first.startTime + Math.floor(first.duration * 0.2),
				duration: Math.max(1, Math.floor(first.duration * 0.6)),
			};
	}
}

export function MotionTextPresetPreview({
	active,
	entry,
}: {
	readonly active: boolean;
	readonly entry: MotionTextPresetCatalogEntry;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const { resources } = useEditorSession();
	const preview = useMemo(() => {
		if (!active) return null;
		try {
			const created = createMotionTextPresetPreview({
				sequenceId: `preset-preview:${entry.group}:${entry.id}`,
				previewText: `${entry.name}\nRO CUT`,
				duration: PREVIEW_DURATION,
				presetGroup: entry.group,
				presetId: entry.id,
				rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			});
			if (!created.sequence) {
				throw new Error(
					created.diagnostics[0]?.message ?? "Preview sequence is unavailable.",
				);
			}
			const runtime = createMotionTextRenderRuntime({
				sequence: created.sequence,
			});
			const previewWindow = resolvePreviewWindow({ entry, runtime });
			if (!previewWindow) throw new Error("Preview has no renderable cuts.");
			return { runtime, previewWindow, failure: null };
		} catch (error) {
			return {
				runtime: null,
				previewWindow: null,
				failure:
					error instanceof Error ? error.message : "Preview is unavailable.",
			};
		}
	}, [active, entry]);

	useEffect(() => {
		if (!preview?.runtime || !preview.previewWindow) return;
		const canvas = canvasRef.current;
		const context = canvas?.getContext("2d");
		if (!canvas || !context) return;
		const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
		canvas.width = Math.round(PREVIEW_WIDTH * pixelRatio);
		canvas.height = Math.round(PREVIEW_HEIGHT * pixelRatio);

		const { runtime, previewWindow } = preview;
		let elapsedMilliseconds = 0;
		const draw = () => {
			const elapsedTicks = Math.floor(
				elapsedMilliseconds * (TICKS_PER_SECOND / 1_000),
			);
			const sequenceTime =
				previewWindow.startTime + (elapsedTicks % previewWindow.duration);
			const frame = resolveMotionTextRenderFrame({ runtime, sequenceTime });
			context.clearRect(0, 0, canvas.width, canvas.height);
			if (frame) {
				drawMotionTextFrame({
					ctx: context,
					frame,
					width: canvas.width,
					height: canvas.height,
					compositionMode: runtime.sequence.compositionMode,
				});
			}
		};
		draw();
		const stop = createRafLoop({
			resources,
			callback: ({ time }) => {
				elapsedMilliseconds += time;
				draw();
			},
		});

		return () => {
			stop();
			context.clearRect(0, 0, canvas.width, canvas.height);
		};
	}, [preview, resources]);

	if (!active) {
		return (
			<div
				className="bg-muted/40 flex h-20 shrink-0 items-center justify-center"
				data-motion-text-preview-state="idle"
			>
				<span className="text-muted-foreground text-[10px] uppercase tracking-widest">
					{entry.group}
				</span>
			</div>
		);
	}

	return (
		<div className="bg-black/90 relative h-20 shrink-0 overflow-hidden">
			<canvas
				ref={canvasRef}
				className="size-full object-contain"
				data-motion-text-preview-active="true"
				data-motion-text-preview-key={entry.key}
			/>
			{preview?.failure && (
				<div
					className="bg-muted text-muted-foreground absolute inset-0 flex items-center justify-center px-2 text-center text-[10px] leading-4"
					title={preview.failure}
					data-motion-text-preview-state="unavailable"
				>
					Preview unavailable
				</div>
			)}
		</div>
	);
}
