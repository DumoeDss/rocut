import { useEditor } from "../../editor/use-editor";
import { useElementSelection } from "../hooks/element/use-element-selection";
import {
	TooltipProvider,
	Tooltip,
	TooltipTrigger,
	TooltipContent,
} from "../../components/ui/tooltip";
import { Button } from "../../components/ui/button";
import {
	SplitButton,
	SplitButtonLeft,
	SplitButtonRight,
	SplitButtonSeparator,
} from "../../components/ui/split-button";
import { Slider } from "../../components/ui/slider";
import { TIMELINE_ZOOM_BUTTON_FACTOR } from "./interaction";
import { TIMELINE_ZOOM_MAX } from "../scale";
import { sliderToZoom, zoomToSlider } from "../zoom-utils";
import { ScenesView } from "../../components/editor/scenes-view";
import { type TActionWithOptionalArgs } from "../../actions";
import { useActionInvoker } from "../../actions/action-scope";
import {
	canToggleSourceAudio,
	getSourceAudioActionLabel,
	isSourceAudioSeparated,
} from "../audio-separation";
import { hasMediaId } from "..";
import { cn } from "../../utils/ui";
import { useTimelineStore } from "../../editor/use-session-store";
import {
	Bookmark02Icon,
	Delete02Icon,
	SnowIcon,
	ScissorIcon,
	MagnetIcon,
	SearchAddIcon,
	SearchMinusIcon,
	Copy01Icon,
	AlignLeftIcon,
	AlignRightIcon,
	Link02Icon,
	Layers01Icon,
	Chart03Icon,
	Unlink02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { OcRippleIcon } from "../../components/icons";
import { GraphEditorPopover } from "./graph-editor/popover";
import { PopoverTrigger } from "../../components/ui/popover";
import { useGraphEditorController } from "./graph-editor/use-controller";
import { selectElementWithTrackTuple } from "../element-with-track-selector";
import { useVideoFreeze } from "../hooks/use-video-freeze";
import { useEditorMessages } from "../../editor/host/editor-host-context";

export function TimelineToolbar({
	zoomLevel,
	minZoom,
	setZoomLevel,
	onFit,
}: {
	zoomLevel: number;
	minZoom: number;
	setZoomLevel: ({ zoom }: { zoom: number }) => void;
	onFit: (scope: "project" | "selection") => void;
}) {
	const messages = useEditorMessages();
	const selectionCount = useEditor((editor) => editor.selection.getSelectedElements().length);
	const handleZoom = ({ direction }: { direction: "in" | "out" }) => {
		const newZoomLevel =
			direction === "in"
				? Math.min(TIMELINE_ZOOM_MAX, zoomLevel * TIMELINE_ZOOM_BUTTON_FACTOR)
				: Math.max(minZoom, zoomLevel / TIMELINE_ZOOM_BUTTON_FACTOR);
		setZoomLevel({ zoom: newZoomLevel });
	};

	return (
		<div
			className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b px-2 py-1"
			data-testid="timeline-toolbar"
			role="group"
			aria-label={messages.timelineOperations}
		>
			<ToolbarLeftSection />

			<SceneSelector />
			<div className="flex items-center gap-1" aria-label={messages.fitRange}><Button size="sm" variant="ghost" data-testid="timeline-fit-project" onClick={() => onFit("project")}>{messages.fitProject}</Button><Button size="sm" variant="ghost" data-testid="timeline-fit-selection" disabled={selectionCount === 0} onClick={() => onFit("selection")}>{messages.fitSelection}</Button></div>

			<ToolbarRightSection
				zoomLevel={zoomLevel}
				minZoom={minZoom}
				onZoomChange={(zoom) => setZoomLevel({ zoom })}
				onZoom={handleZoom}
			/>
		</div>
	);
}

function ToolbarLeftSection() {
	const invokeAction = useActionInvoker();
	const mediaAssets = useEditor((currentEditor) =>
		currentEditor.media.getAssets(),
	);
	const { selectedElements } = useElementSelection();
	const graphEditor = useGraphEditorController();
	const freeze = useVideoFreeze();
	const isCurrentlyBookmarked = useEditor((e) =>
		e.scenes.isBookmarked({ time: e.playback.getCurrentTime() }),
	);
	const [, selectedElement] = useEditor((currentEditor) =>
		selectElementWithTrackTuple({
			editor: currentEditor,
			elements: selectedElements,
		}),
	);
	const selectedMediaAsset = (() => {
		if (!selectedElement) {
			return null;
		}

		if (!hasMediaId(selectedElement)) {
			return null;
		}

		return (
			mediaAssets.find((asset) => asset.id === selectedElement.mediaId) ?? null
		);
	})();
	const canToggleSelectedSourceAudio =
		!!selectedElement &&
		canToggleSourceAudio(selectedElement, selectedMediaAsset);
	const sourceAudioLabel =
		selectedElement?.type === "video"
			? getSourceAudioActionLabel({
					element: selectedElement,
				})
			: "提取音频";
	const isSelectedSourceAudioSeparated =
		selectedElement?.type === "video" &&
		isSourceAudioSeparated({
			element: selectedElement,
		});

	const handleAction = ({
		action,
		event,
	}: {
		action: TActionWithOptionalArgs;
		event: React.MouseEvent;
	}) => {
		event.stopPropagation();
		invokeAction(action);
	};

	return (
		<div className="flex items-center gap-1">
			<TooltipProvider delayDuration={500}>
				<ToolbarButton
					icon={<HugeiconsIcon icon={ScissorIcon} />}
					tooltip="分割片段"
					disabled={selectedElements.length === 0}
					onClick={({ event }) => handleAction({ action: "split", event })}
				/>

				<ToolbarButton
					icon={<HugeiconsIcon icon={AlignLeftIcon} />}
					tooltip="分割并移除左侧"
					disabled={selectedElements.length === 0}
					onClick={({ event }) => handleAction({ action: "split-left", event })}
				/>

				<ToolbarButton
					icon={<HugeiconsIcon icon={AlignRightIcon} />}
					tooltip="分割并移除右侧"
					disabled={selectedElements.length === 0}
					onClick={({ event }) =>
						handleAction({ action: "split-right", event })
					}
				/>

				<ToolbarButton
					icon={
						<HugeiconsIcon
							icon={isSelectedSourceAudioSeparated ? Unlink02Icon : Link02Icon}
						/>
					}
					tooltip={sourceAudioLabel}
					disabled={!canToggleSelectedSourceAudio}
					onClick={({ event }) =>
						handleAction({ action: "toggle-source-audio", event })
					}
				/>

				<ToolbarButton
					icon={<HugeiconsIcon icon={Copy01Icon} />}
					tooltip="复制片段"
					disabled={selectedElements.length === 0}
					onClick={({ event }) =>
						handleAction({ action: "duplicate-selected", event })
					}
				/>

				<ToolbarButton
					icon={<HugeiconsIcon icon={SnowIcon} />}
					tooltip={freeze.label}
					disabled={freeze.disabled}
					isActive={freeze.isActive}
					onClick={({ event }) => { event.stopPropagation(); void freeze.apply(); }}
				/>

				<ToolbarButton
					icon={<HugeiconsIcon icon={Delete02Icon} />}
					tooltip="删除片段"
					disabled={selectedElements.length === 0}
					onClick={({ event }) =>
						handleAction({ action: "delete-selected", event })
					}
				/>

				<div className="bg-border mx-1 h-6 w-px" />

				<Tooltip>
					<ToolbarButton
						icon={<HugeiconsIcon icon={Bookmark02Icon} />}
						isActive={isCurrentlyBookmarked}
						tooltip={isCurrentlyBookmarked ? "移除书签" : "添加书签"}
						onClick={({ event }) =>
							handleAction({ action: "toggle-bookmark", event })
						}
					/>
				</Tooltip>

				<GraphEditorPopover
					open={graphEditor.open}
					onOpenChange={graphEditor.onOpenChange}
					value={
						graphEditor.state.status === "ready"
							? graphEditor.state.cubicBezier
							: null
					}
					message={graphEditor.state.message}
					componentOptions={graphEditor.state.componentOptions}
					activeComponentKey={graphEditor.state.activeComponentKey}
					onActiveComponentKeyChange={graphEditor.onActiveComponentKeyChange}
					onPreviewValue={graphEditor.onPreviewValue}
					onCommitValue={graphEditor.onCommitValue}
					onCancelPreview={graphEditor.onCancelPreview}
				>
					<ToolbarButton
						icon={<HugeiconsIcon icon={Chart03Icon} />}
						tooltip={graphEditor.tooltip}
						disabled={!graphEditor.canOpen}
						buttonWrapper={(button) =>
							graphEditor.canOpen ? (
								<PopoverTrigger asChild>{button}</PopoverTrigger>
							) : (
								button
							)
						}
					/>
				</GraphEditorPopover>
			</TooltipProvider>
		</div>
	);
}

function SceneSelector() {
	const currentScene = useEditor((editor) => editor.scenes.getActiveScene());

	return (
		<div>
			<SplitButton className="border-foreground/10 border">
				<SplitButtonLeft>{currentScene?.name || "无场景"}</SplitButtonLeft>
				<SplitButtonSeparator />
				<ScenesView>
					<SplitButtonRight aria-label="管理场景">
						<HugeiconsIcon icon={Layers01Icon} className="size-4" />
					</SplitButtonRight>
				</ScenesView>
			</SplitButton>
		</div>
	);
}

function ToolbarRightSection({
	zoomLevel,
	minZoom,
	onZoomChange,
	onZoom,
}: {
	zoomLevel: number;
	minZoom: number;
	onZoomChange: (zoom: number) => void;
	onZoom: (options: { direction: "in" | "out" }) => void;
}) {
	const snappingEnabled = useTimelineStore((s) => s.snappingEnabled);
	const messages = useEditorMessages();
	const heightScale = useTimelineStore((s) => s.trackHeightScale);
	const setHeightScale = useTimelineStore((s) => s.setTrackHeightScale);
	const rippleEditingEnabled = useTimelineStore((s) => s.rippleEditingEnabled);
	const toggleSnapping = useTimelineStore((s) => s.toggleSnapping);
	const toggleRippleEditing = useTimelineStore((s) => s.toggleRippleEditing);

	return (
		<div className="flex items-center gap-1">
			<TooltipProvider delayDuration={500}>
				<ToolbarButton
					icon={<HugeiconsIcon icon={MagnetIcon} />}
					isActive={snappingEnabled}
					tooltip="自动吸附"
					onClick={() => toggleSnapping()}
				/>

				<ToolbarButton
					icon={<OcRippleIcon size={24} className="scale-110" />}
					isActive={rippleEditingEnabled}
					tooltip="波纹编辑"
					onClick={() => toggleRippleEditing()}
				/>
			</TooltipProvider>

			<div className="bg-border mx-1 h-6 w-px" />
			<select aria-label={messages.trackHeight} value={heightScale} onChange={(event) => setHeightScale(Number(event.target.value))} className="rounded border bg-background p-1 text-xs">
				<option value={0.8}>{messages.trackCompact}</option><option value={1}>{messages.trackStandard}</option><option value={1.5}>{messages.trackLarge}</option><option value={2}>{messages.trackExtraLarge}</option>
			</select>

			<div className="flex items-center gap-1">
				<Button
					variant="text"
					size="icon"
					aria-label="缩小时间轴"
					onClick={() => onZoom({ direction: "out" })}
				>
					<HugeiconsIcon icon={SearchMinusIcon} />
				</Button>
				<Slider
					aria-label="时间轴缩放"
					className="w-28"
					value={[zoomToSlider({ zoomLevel, minZoom })]}
					onValueChange={(values) =>
						onZoomChange(sliderToZoom({ sliderPosition: values[0], minZoom }))
					}
					min={0}
					max={1}
					step={0.005}
				/>
				<Button
					variant="text"
					size="icon"
					aria-label="放大时间轴"
					onClick={() => onZoom({ direction: "in" })}
				>
					<HugeiconsIcon icon={SearchAddIcon} />
				</Button>
			</div>
		</div>
	);
}

function ToolbarButton({
	icon,
	tooltip,
	onClick,
	disabled,
	isActive,
	buttonWrapper,
}: {
	icon: React.ReactNode;
	tooltip: string;
	onClick?: ({ event }: { event: React.MouseEvent }) => void;
	disabled?: boolean;
	isActive?: boolean;
	buttonWrapper?: (button: React.ReactElement) => React.ReactElement;
}) {
	const button = (
		<Button
			variant={isActive ? "secondary" : "text"}
			aria-label={tooltip}
			aria-pressed={isActive}
			size="icon"
			disabled={disabled}
			onClick={onClick ? (event) => onClick({ event }) : undefined}
			className={cn(
				"rounded-sm",
				disabled ? "cursor-not-allowed opacity-50" : "",
			)}
		>
			{icon}
		</Button>
	);
	const trigger = disabled ? (
		<span className="inline-flex">{button}</span>
	) : buttonWrapper ? (
		buttonWrapper(button)
	) : (
		button
	);

	return (
		<Tooltip delayDuration={200}>
			<TooltipTrigger asChild>{trigger}</TooltipTrigger>
			<TooltipContent>{tooltip}</TooltipContent>
		</Tooltip>
	);
}
