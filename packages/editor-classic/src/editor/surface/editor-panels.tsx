"use client";

import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "../../components/ui/resizable";
import { useContainerSize } from "../../hooks/use-container-size";
import { getEditorPanelPolicy } from "../../panels/editor-panel-policy";
import { usePanelStore } from "../use-session-store";
import { useEditorInstance } from "../use-editor";
import { EditorFocusTabs, type FocusPanel } from "./editor-focus-tabs";

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
	const editor = useEditorInstance();
	const [focusedPanel, setFocusedPanel] = useState<FocusPanel>("assets");
	const policy = getEditorPanelPolicy(width);
	const { focus, compact, sidebarMin, previewMin } = policy;
	useEffect(() => {
		if (!focus) return;
		const selectionKey = () =>
			editor.selection
				.getSelectedElements()
				.map((item) => item.elementId)
				.join("|");
		let previous = selectionKey();
		return editor.selection.subscribe(() => {
			const next = selectionKey();
			if (next && next !== previous) setFocusedPanel("properties");
			previous = next;
		});
	}, [editor, focus]);
	useLayoutEffect(() => {
		if (width <= 0 || focus) return;
		const defaults = getEditorPanelPolicy(width).defaultLayout;
		groupRef.current?.setLayout(
			compact
				? (compactLayout.current ?? defaults)
				: [panels.tools, panels.preview, panels.properties],
		);
	}, [width, focus, compact, panels.tools, panels.preview, panels.properties]);
	// Persist only deliberate resizing, not constraint normalization during host resize.
	const saveResize = () => {
		if (focus) return;
		const sizes = groupRef.current?.getLayout();
		if (!sizes || sizes.length !== 3) return;
		if (compact) compactLayout.current = sizes;
		else
			setPanels({ tools: sizes[0], preview: sizes[1], properties: sizes[2] });
	};
	const handleProps: React.ComponentProps<typeof ResizableHandle> = {
		disabled: focus,
		style: focus ? { display: "none" } : undefined,
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
			className="flex size-full min-h-0 min-w-0 flex-col"
			data-testid="editor-main-panels"
			data-layout={focus ? "focus" : compact ? "compact" : "wide"}
		>
			{focus && (
				<EditorFocusTabs value={focusedPanel} onChange={setFocusedPanel} />
			)}
			<ResizablePanelGroup
				ref={groupRef}
				direction="horizontal"
				keyboardResizeBy={2}
				className="min-h-0 flex-1 gap-[0.19rem] px-3"
			>
				<ResizablePanel
					id="editor-assets"
					role={focus ? "tabpanel" : undefined}
					aria-labelledby={focus ? "focus-tab-assets" : undefined}
					style={
						focus && focusedPanel !== "assets" ? { display: "none" } : undefined
					}
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
					role={focus ? "tabpanel" : undefined}
					aria-labelledby={focus ? "focus-tab-preview" : undefined}
					style={
						focus && focusedPanel !== "preview"
							? { display: "none" }
							: undefined
					}
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
					role={focus ? "tabpanel" : undefined}
					aria-labelledby={focus ? "focus-tab-properties" : undefined}
					style={
						focus && focusedPanel !== "properties"
							? { display: "none" }
							: undefined
					}
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
