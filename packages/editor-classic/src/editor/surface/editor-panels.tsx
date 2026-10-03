"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "../../components/ui/resizable";
import { useContainerSize } from "../../hooks/use-container-size";
import { getEditorPanelPolicy } from "../../panels/editor-panel-policy";
import { usePanelStore } from "../use-session-store";

/** Rebalance narrow embeds without remounting editors or overwriting wide preferences. */
export function EditorPanels({
	assets,
	preview,
	properties,
}: {
	readonly assets: ReactNode;
	readonly preview: ReactNode;
	readonly properties: ReactNode;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const groupRef = useRef<ImperativePanelGroupHandle>(null);
	const compactLayout = useRef<number[] | null>(null);
	const { width } = useContainerSize({ containerRef });
	const { panels, setPanels } = usePanelStore();
	const policy = getEditorPanelPolicy(width);
	const { compact, sidebarMin, previewMin } = policy;
	useLayoutEffect(() => {
		if (width <= 0) return;
		const defaults = getEditorPanelPolicy(width).defaultLayout;
		groupRef.current?.setLayout(
			compact
				? (compactLayout.current ?? defaults)
				: [panels.tools, panels.preview, panels.properties],
		);
	}, [width, compact, panels.tools, panels.preview, panels.properties]);
	// Persist only deliberate resizing, not constraint normalization during host resize.
	const saveResize = () => {
		const sizes = groupRef.current?.getLayout();
		if (!sizes || sizes.length !== 3) return;
		if (compact) compactLayout.current = sizes;
		else
			setPanels({ tools: sizes[0], preview: sizes[1], properties: sizes[2] });
	};
	const handleProps: React.ComponentProps<typeof ResizableHandle> = {
		withHandle: true,
		onDragging: (dragging: boolean) => {
			if (!dragging) saveResize();
		},
		onKeyUp: (event) => {
			if (
				["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)
			)
				saveResize();
		},
	};
	return (
		<div
			ref={containerRef}
			className="size-full min-h-0 min-w-0"
			data-testid="editor-main-panels"
			data-layout={compact ? "compact" : "wide"}
		>
			<ResizablePanelGroup
				ref={groupRef}
				direction="horizontal"
				keyboardResizeBy={2}
				className="size-full gap-[0.19rem] px-3"
			>
				<ResizablePanel
					id="editor-assets"
					defaultSize={panels.tools}
					minSize={sidebarMin}
					maxSize={40}
					className="min-w-0"
				>
					{assets}
				</ResizablePanel>
				<ResizableHandle
					{...handleProps}
					aria-label="Resize assets and preview"
				/>
				<ResizablePanel
					id="editor-preview"
					defaultSize={panels.preview}
					minSize={previewMin}
					className="min-h-0 min-w-0 flex-1"
				>
					{preview}
				</ResizablePanel>
				<ResizableHandle
					{...handleProps}
					aria-label="Resize preview and inspector"
				/>
				<ResizablePanel
					id="editor-properties"
					defaultSize={panels.properties}
					minSize={sidebarMin}
					maxSize={40}
					className="min-w-0"
				>
					{properties}
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}
