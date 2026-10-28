"use client";

import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import type {
	ImperativePanelGroupHandle,
	ImperativePanelHandle,
} from "react-resizable-panels";
import { Button } from "../../components/ui/button";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "../../components/ui/resizable";
import { useContainerSize } from "../../hooks/use-container-size";
import {
	getEditorPanelPolicy,
	getHorizontalPanelLayout,
} from "../../panels/editor-panel-policy";
import { usePanelStore } from "../use-session-store";
import { useEditorInstance } from "../use-editor";
import { useEditorMessages } from "../host/editor-host-context";
import { EditorFocusTabs, type FocusPanel } from "./editor-focus-tabs";
import { CreatorWorkspace } from "./creator-workspace";
import {
	NativeAssetPreviewProvider,
	NativeAssetViewer,
} from "./native-asset-preview";

function readCollapsed(panel: "assets" | "inspector") {
	try {
		const saved = JSON.parse(localStorage.getItem("editor-panel-visibility") ?? "null")?.[panel];
		return typeof saved === "boolean" ? saved : panel === "inspector";
	} catch {
		return panel === "inspector";
	}
}

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
	return (
		<NativeAssetPreviewProvider>
			<CreatorWorkspace
				assets={assets}
				preview={<NativeAssetViewer>{preview}</NativeAssetViewer>}
			>
				{(content) => (
					<EditorPanelLayout {...content} properties={properties} />
				)}
			</CreatorWorkspace>
		</NativeAssetPreviewProvider>
	);
}

function EditorPanelLayout({
	assets,
	preview,
	properties,
	contentActivation,
}: {
	readonly assets: ReactNode;
	readonly preview: ReactNode;
	readonly properties: ReactNode;
	readonly contentActivation: number;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const groupRef = useRef<ImperativePanelGroupHandle>(null);
	const assetsRef = useRef<ImperativePanelHandle>(null);
	const inspectorRef = useRef<ImperativePanelHandle>(null);
	const [assetsCollapsed, setAssetsCollapsed] = useState(() =>
		readCollapsed("assets"),
	);
	const [inspectorCollapsed, setInspectorCollapsed] = useState(() =>
		readCollapsed("inspector"),
	);
	const pendingInspectorFocus = useRef<Element | null>(null);
	const { width } = useContainerSize({ containerRef });
	const {
		panels,
		hasCustomHorizontalLayout,
		compactLayout,
		setPanels,
		setCompactLayout,
		resetPanels,
	} = usePanelStore();
	const editor = useEditorInstance();
	const messages = useEditorMessages();
	const [focusedPanel, setFocusedPanel] = useState<FocusPanel>("preview");
	const policy = getEditorPanelPolicy(width);
	const { focus, compact, sidebarMin, previewMin } = policy;
	const [renderedContentActivation, setRenderedContentActivation] = useState(contentActivation);
	if (renderedContentActivation !== contentActivation) {
		setRenderedContentActivation(contentActivation);
		if (focus) setFocusedPanel("preview");
	}
	const previousContentActivation = useRef(contentActivation);
	useLayoutEffect(() => {
		if (previousContentActivation.current === contentActivation) return;
		previousContentActivation.current = contentActivation;
		if (!focus) return;
		containerRef.current
			?.querySelector<HTMLElement>("#focus-tab-preview")
			?.focus({ preventScroll: true });
	}, [contentActivation, focus]);
	const setCollapsed = ({
		panel,
		collapsed,
	}: {
		panel: "assets" | "inspector";
		collapsed: boolean;
	}) => {
		const next = {
			assets: panel === "assets" ? collapsed : assetsCollapsed,
			inspector: panel === "inspector" ? collapsed : inspectorCollapsed,
		};
		if (panel === "assets") setAssetsCollapsed(collapsed);
		else setInspectorCollapsed(collapsed);
		try {
			localStorage.setItem("editor-panel-visibility", JSON.stringify(next));
		} catch {
			/* Keep this session usable without storage. */
		}
	};
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
			if (next && next !== previous) {
				const container = containerRef.current;
				const active = container?.ownerDocument.activeElement;
				const panel = active?.closest("[data-panel-id]");
				// Add-to-timeline can hide its own focused button. Hand focus to
				// the revealed view so scoped shortcuts still receive Ctrl+Z.
				if (
					active &&
					panel &&
					container?.contains(active) &&
					panel.getAttribute("data-panel-id") !== "editor-properties"
				)
					pendingInspectorFocus.current = active;
				setFocusedPanel("properties");
			}
			previous = next;
		});
	}, [editor, focus]);
	useLayoutEffect(() => {
		const previous = pendingInspectorFocus.current;
		pendingInspectorFocus.current = null;
		const container = containerRef.current;
		if (!previous || !container || !focus || focusedPanel !== "properties")
			return;
		const document = container.ownerDocument;
		if (
			document.hasFocus() &&
			(document.activeElement === previous ||
				document.activeElement === document.body)
		) {
			container
				.querySelector<HTMLElement>("#focus-tab-properties")
				?.focus({ preventScroll: true });
		}
	}, [focus, focusedPanel]);
	useLayoutEffect(() => {
		if (width <= 0 || focus) return;
		groupRef.current?.setLayout(
			getHorizontalPanelLayout({
				width,
				panels,
				hasCustomHorizontalLayout,
				compactLayout,
				assetsCollapsed,
				inspectorCollapsed,
			}),
		);
	}, [
		width,
		focus,
		compact,
		compactLayout,
		panels,
		assetsCollapsed,
		inspectorCollapsed,
		hasCustomHorizontalLayout,
	]);
	// Persist only deliberate resizing, not constraint normalization during host resize.
	const saveResize = () => {
		if (focus || assetsCollapsed || inspectorCollapsed) return;
		const sizes = groupRef.current?.getLayout();
		if (!sizes || sizes.length !== 3) return;
		if (compact) setCompactLayout(sizes);
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
			{!focus && (
				<div className="flex shrink-0 items-center gap-1 px-3 pb-1">
					<Button
						size="sm"
						variant="ghost"
						data-testid="editor-layout-preview-first"
						onClick={() => {
							setAssetsCollapsed(false);
							setInspectorCollapsed(false);
							setCompactLayout([20, 60, 20]);
							setPanels({
								tools: 20,
								preview: 60,
								properties: 20,
								mainContent: 76,
								timeline: 24,
							});
							groupRef.current?.setLayout([20, 60, 20]);
						}}
					>
						{messages.previewFirst}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						data-testid="editor-layout-edit-first"
						onClick={() => {
							setAssetsCollapsed(false);
							setInspectorCollapsed(false);
							setCompactLayout([25, 50, 25]);
							setPanels({
								tools: 25,
								preview: 50,
								properties: 25,
								mainContent: 52,
								timeline: 48,
							});
							groupRef.current?.setLayout([25, 50, 25]);
						}}
					>
						{messages.editFirst}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						aria-expanded={!assetsCollapsed}
						onClick={() =>
							assetsCollapsed
								? assetsRef.current?.expand()
								: assetsRef.current?.collapse()
						}
					>
						{assetsCollapsed ? messages.showAssets : messages.hideAssets}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						aria-expanded={!inspectorCollapsed}
						onClick={() =>
							inspectorCollapsed
								? inspectorRef.current?.expand()
								: inspectorRef.current?.collapse()
						}
					>
						{inspectorCollapsed
							? messages.showInspector
							: messages.hideInspector}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						className="ml-auto"
						data-testid="editor-layout-reset"
						onClick={() => {
							setAssetsCollapsed(false);
							setInspectorCollapsed(true);
							try {
								localStorage.removeItem("editor-panel-visibility");
							} catch {
								/* Reset remains available without storage. */
							}
							resetPanels();
						}}
					>
						{messages.resetLayout}
					</Button>
				</div>
			)}
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
					ref={assetsRef}
					collapsible
					collapsedSize={0}
					onCollapse={() => setCollapsed({ panel: "assets", collapsed: true })}
					onExpand={() => setCollapsed({ panel: "assets", collapsed: false })}
					id="editor-assets"
					role={focus ? "tabpanel" : undefined}
					aria-labelledby={focus ? "focus-tab-assets" : undefined}
					style={
						focus && focusedPanel !== "assets" ? { display: "none" } : undefined
					}
					defaultSize={assetsCollapsed ? 0 : panels.tools}
					minSize={sidebarMin}
					maxSize={40}
					className="min-w-0"
				>
					{assets}
				</ResizablePanel>
				<ResizableHandle
					{...handleProps}
					aria-label={messages.resizeAssets}
					data-testid="editor-resize-assets"
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
					aria-label={messages.resizeInspector}
				/>
				<ResizablePanel
					id="editor-properties"
					ref={inspectorRef}
					collapsible
					collapsedSize={0}
					onCollapse={() =>
						setCollapsed({ panel: "inspector", collapsed: true })
					}
					onExpand={() =>
						setCollapsed({ panel: "inspector", collapsed: false })
					}
					role={focus ? "tabpanel" : undefined}
					aria-labelledby={focus ? "focus-tab-properties" : undefined}
					style={
						focus && focusedPanel !== "properties"
							? { display: "none" }
							: undefined
					}
					defaultSize={inspectorCollapsed ? 0 : panels.properties}
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
