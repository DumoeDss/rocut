"use client";

import { HostImage } from "../../../../../editor/host/host-image";
import { useMemo, useState } from "react";
import { PanelView } from "./base-panel";
import { MediaDragOverlay } from "../drag-overlay";
import { DraggableItem } from "../draggable-item";
import { Button } from "../../../../ui/button";
import { toast } from "sonner";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "../../../../ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../../../ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "../../../../ui/tooltip";
import { DEFAULT_NEW_ELEMENT_DURATION } from "../../../../../timeline/creation";
import { mediaTimeFromSeconds, type MediaTime } from "../../../../../wasm";
import { useEditor, useEditorInstance } from "../../../../../editor/use-editor";
import { useFileUpload } from "../../../../../media/use-file-upload";
import { useActionInvoker } from "../../../../../actions/action-scope";
import { processMediaAssets } from "../../../../../media/processing";
import { showMediaUploadToast } from "../../../../../media/upload-toast";
import {
	SelectableSurface,
	useSelection,
	useSelectionScope,
} from "../../../../../selection";
import { buildElementFromMedia } from "../../../../../timeline/element-utils";
import {
	type MediaSortKey,
	type MediaSortOrder,
	type MediaViewMode,
	useAssetsPanelStore,
} from "../../../../../editor/use-session-store";
import { MASKABLE_ELEMENT_TYPES } from "../../../../../timeline";
import type { MediaAsset } from "../../../../../media/types";
import { cn } from "../../../../../utils/ui";
import {
	GridViewIcon,
	LeftToRightListDashIcon,
	SortingOneNineIcon,
	Image02Icon,
	Video01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { ClipExportDialog } from "../../../clip-export-dialog";
import { useMediaPreview } from "../../../../../media/use-media-preview";
import { MediaWaveformPreview } from "../../../../../media/media-waveform-preview";
import { useNativeAssetPreview } from "../../../../../editor/surface/native-asset-preview";
import { MediaCard } from "./media-card";
import { useHoverScrub } from "./use-hover-scrub";
import {
	ALL_MEDIA,
	ROOT_MEDIA,
	MediaFolders,
	MoveMediaSelection,
} from "./media-folders";
import { useEditorMessages } from "../../../../../editor/host/editor-host-context";
import type { CreatorAsset } from "../../../../../editor/surface/creator-workspace-types";
import { MediaLibraryToolbar } from "./media-library-toolbar";

export function MediaView({
	projectLibrary,
}: {
	projectLibrary?: {
		assets: readonly CreatorAsset[];
		renderAssets: (assets: readonly CreatorAsset[]) => React.ReactNode;
		onGenerate: (type: "image" | "video") => void;
		busy: boolean;
		notice?: React.ReactNode;
		onRetryPreviews: () => void;
	};
} = {}) {
	const invokeAction = useActionInvoker();
	const editor = useEditorInstance();
	const mediaFiles = useEditor((e) => e.media.getAssets());
	const activeProject = useEditor((e) => e.project.getActive());
	const messages = useEditorMessages();
	const registeredMediaIds = new Set(
		projectLibrary?.assets.flatMap((asset) =>
			asset.versions.flatMap((version) =>
				version.mediaId ? [version.mediaId] : [],
			),
		),
	);
	const libraryMedia = mediaFiles.filter(
		(asset) => !asset.ephemeral && !registeredMediaIds.has(asset.id),
	);
	const counts: Record<string, number> = {
		all: libraryMedia.length + (projectLibrary?.assets.length ?? 0),
		image: 0,
		video: 0,
		audio: 0,
		programmatic: 0,
	};
	for (const asset of libraryMedia) counts[asset.type]++;
	for (const asset of projectLibrary?.assets ?? []) {
		for (const type of new Set(
			asset.versions.map((version) => version.mediaType),
		))
			counts[type]++;
	}

	const {
		mediaViewMode,
		setMediaViewMode,
		highlightMediaId,
		clearHighlight,
		mediaSortBy,
		mediaSortOrder,
		setMediaSort,
	} = useAssetsPanelStore();

	const [isProcessing, setIsProcessing] = useState(false);
	const [progress, setProgress] = useState(0);
	const [search, setSearch] = useState("");
	const [typeFilter, setTypeFilter] = useState("all");
	const [usedOnly, setUsedOnly] = useState(false);
	const [folder, setFolder] = useState(ALL_MEDIA);
	const filteredProjectAssets =
		projectLibrary?.assets.filter(
			(asset) =>
				asset.name
					.toLocaleLowerCase()
					.includes(search.trim().toLocaleLowerCase()) &&
				(typeFilter === "all" ||
					asset.versions.some((version) => version.mediaType === typeFilter)) &&
				(!usedOnly || Boolean(asset.usages?.length)),
		) ?? [];
	const folders = useEditor((current) => current.media.getFolders());
	const folderAssignments = useEditor(
		(current) => current.project.getActiveOrNull()?.mediaFolders,
	);
	const activeFolder =
		folder === ROOT_MEDIA || folders.some((entry) => entry.id === folder)
			? folder
			: ALL_MEDIA;
	const scenes = useEditor((current) => current.scenes.getScenes());
	const usedMediaIds = useMemo(
		() =>
			new Set(
				scenes.flatMap((scene) =>
					[
						scene.tracks.main,
						...scene.tracks.overlay,
						...scene.tracks.audio,
					].flatMap((track) =>
						track.elements.flatMap((element) =>
							"mediaId" in element && typeof element.mediaId === "string"
								? [element.mediaId]
								: [],
						),
					),
				),
			),
		[scenes],
	);

	const processFiles = async ({ files }: { files: File[] }) => {
		if (!files || files.length === 0) return;
		if (!activeProject) {
			toast.error("当前没有打开的工程");
			return;
		}

		setIsProcessing(true);
		setProgress(0);
		try {
			await showMediaUploadToast({
				filesCount: files.length,
				resources: editor.resources,
				promise: async () => {
					const processedAssets = await processMediaAssets({
						files,
						resources: editor.resources,
						store: editor.persistence.store,
						reportPersistenceFailure: (failure) =>
							editor.reportPersistenceFailure(failure),
						onProgress: (progress: { progress: number }) =>
							setProgress(progress.progress),
					});
					const assetNames: string[] = [];
					for (const asset of processedAssets) {
						const saved = await editor.media.addMediaAsset({
							projectId: activeProject.metadata.id,
							asset,
						});
						if (saved) assetNames.push(saved.name);
					}
					if (assetNames.length === 0) {
						throw new Error("未能保存任何素材");
					}
					return {
						uploadedCount: assetNames.length,
						assetNames,
					};
				},
			});
		} catch {
			console.error("处理素材文件失败");
		} finally {
			setIsProcessing(false);
			setProgress(0);
		}
	};

	const { isDragOver, dragProps, openFilePicker, fileInputProps } =
		useFileUpload({
			accept: "image/*,video/*,audio/*",
			multiple: true,
			onFilesSelected: (files) => processFiles({ files }),
		});

	const handleRemove = ({
		event,
		ids,
	}: {
		event: React.MouseEvent;
		ids: string[];
	}) => {
		event.stopPropagation();

		invokeAction("remove-media-assets", {
			projectId: activeProject.metadata.id,
			assetIds: ids,
		});
	};

	const handleSort = ({ key }: { key: MediaSortKey }) => {
		if (mediaSortBy === key) {
			setMediaSort({
				key,
				order: mediaSortOrder === "asc" ? "desc" : "asc",
			});
		} else {
			setMediaSort({ key, order: "asc" });
		}
	};

	const filteredMediaItems = useMemo(() => {
		const filtered = mediaFiles.filter(
			(item) =>
				!item.ephemeral &&
				(activeFolder === ALL_MEDIA ||
					(activeFolder === ROOT_MEDIA
						? !folderAssignments?.assignments.some(
								(entry) => entry.assetId === item.id,
							)
						: folderAssignments?.assignments.some(
								(entry) =>
									entry.assetId === item.id && entry.folderId === activeFolder,
							))) &&
				item.name
					.toLocaleLowerCase()
					.includes(search.trim().toLocaleLowerCase()) &&
				(typeFilter === "all" || item.type === typeFilter) &&
				(!usedOnly || usedMediaIds.has(item.id)),
		);

		filtered.sort((a, b) => {
			let valueA: string | number;
			let valueB: string | number;

			switch (mediaSortBy) {
				case "name":
					valueA = a.name.toLowerCase();
					valueB = b.name.toLowerCase();
					break;
				case "type":
					valueA = a.type;
					valueB = b.type;
					break;
				case "duration":
					valueA = a.duration || 0;
					valueB = b.duration || 0;
					break;
				case "size":
					valueA = a.file.size;
					valueB = b.file.size;
					break;
				default:
					return 0;
			}

			if (valueA < valueB) return mediaSortOrder === "asc" ? -1 : 1;
			if (valueA > valueB) return mediaSortOrder === "asc" ? 1 : -1;
			return 0;
		});

		return filtered;
	}, [
		mediaFiles,
		mediaSortBy,
		mediaSortOrder,
		search,
		typeFilter,
		usedOnly,
		usedMediaIds,
		activeFolder,
		folderAssignments,
	]);
	const visibleNativeItems = filteredMediaItems.filter(
		(item) => !registeredMediaIds.has(item.id),
	);
	const orderedMediaIds = useMemo(() => {
		return visibleNativeItems.map((item) => item.id);
	}, [visibleNativeItems]);

	return (
		<>
			<input {...fileInputProps} />
			<div className="flex h-full min-h-0 flex-col">
				<MediaLibraryToolbar
					counts={counts}
					type={typeFilter}
					onTypeChange={setTypeFilter}
					query={search}
					onQueryChange={setSearch}
					used={usedOnly}
					onUsedChange={setUsedOnly}
					onImport={openFilePicker}
					onGenerate={projectLibrary?.onGenerate}
					importing={isProcessing}
					generating={projectLibrary?.busy}
				>
					<MediaActions
						mediaViewMode={mediaViewMode}
						setMediaViewMode={setMediaViewMode}
						isProcessing={isProcessing}
						sortBy={mediaSortBy}
						sortOrder={mediaSortOrder}
						onSort={handleSort}
					/>
					{projectLibrary && (
						<Button
							size="sm"
							variant="ghost"
							onClick={projectLibrary.onRetryPreviews}
						>
							{messages.retryPreview}
						</Button>
					)}
					<MediaFolders
						key={activeProject.metadata.id}
						active={activeFolder}
						onSelect={setFolder}
					/>
				</MediaLibraryToolbar>
				<PanelView
					hideHeader
					className={cn("flex-1", isDragOver && "bg-accent/30")}
					scrollClassName="!pt-2"
					{...dragProps}
				>
					{projectLibrary?.notice}
					{!isDragOver && projectLibrary?.renderAssets(filteredProjectAssets)}
					{isProcessing && (
						<p role="status" className="py-2 text-xs text-muted-foreground">
							正在导入素材 {Math.round(progress)}%
						</p>
					)}
					{!isDragOver &&
					visibleNativeItems.length + filteredProjectAssets.length === 0 &&
					counts.all > 0 ? (
						<p className="py-6 text-xs text-muted-foreground">
							没有匹配的素材。调整搜索或筛选条件。
						</p>
					) : isDragOver || counts.all === 0 ? (
						<MediaDragOverlay
							isVisible={true}
							isProcessing={isProcessing}
							progress={progress}
							onClick={openFilePicker}
						/>
					) : visibleNativeItems.length > 0 ? (
						<SelectableSurface
							ariaLabel="工程素材"
							orderedIds={orderedMediaIds}
							revealId={highlightMediaId}
							onRevealComplete={clearHighlight}
						>
							<MediaScopeRegistrar />
							<MoveMediaSelection />
							<MediaItemList
								key={activeProject.metadata.id}
								items={visibleNativeItems}
								mode={mediaViewMode}
								usedMediaIds={usedMediaIds}
								onRemove={handleRemove}
							/>
						</SelectableSurface>
					) : null}
				</PanelView>
			</div>
		</>
	);
}

export function MediaFilters({
	search,
	typeFilter,
	usedOnly,
	onSearchChange,
	onTypeFilterChange,
	onUsedOnlyChange,
}: {
	search: string;
	typeFilter: string;
	usedOnly: boolean;
	onSearchChange: (value: string) => void;
	onTypeFilterChange: (value: string) => void;
	onUsedOnlyChange: (value: boolean) => void;
}) {
	return (
		<div className="flex min-w-0 flex-wrap items-center gap-2 pb-3 text-xs">
			<input
				type="search"
				aria-label="搜索工程素材"
				placeholder="搜索素材"
				value={search}
				onChange={(event) => onSearchChange(event.target.value)}
				className="min-w-0 w-full rounded border bg-background px-2 py-1.5 focus-visible:outline-ring"
			/>
			<select
				aria-label="工程素材类型"
				value={typeFilter}
				onChange={(event) => onTypeFilterChange(event.target.value)}
				className="min-w-0 max-w-full rounded border bg-background px-2 py-1"
			>
				<option value="all">全部类型</option>
				<option value="image">图片</option>
				<option value="video">视频</option>
				<option value="audio">音频</option>
			</select>
			<label className="flex items-center gap-1">
				<input
					type="checkbox"
					checked={usedOnly}
					onChange={(event) => onUsedOnlyChange(event.target.checked)}
				/>
				已使用
			</label>
			<Button
				variant="ghost"
				size="sm"
				className="text-xs"
				disabled={!search && typeFilter === "all" && !usedOnly}
				onClick={() => {
					onSearchChange("");
					onTypeFilterChange("all");
					onUsedOnlyChange(false);
				}}
			>
				清除筛选
			</Button>
		</div>
	);
}

function MediaScopeRegistrar() {
	useSelectionScope();
	return null;
}

function MediaAssetDraggable({
	item,
	preview,
	variant,
	isRounded,
}: {
	item: MediaAsset;
	preview: React.ReactNode;
	variant: "card" | "compact";
	isRounded?: boolean;
}) {
	const editor = useEditorInstance();

	const addElementAtTime = ({
		asset,
		startTime,
	}: {
		asset: MediaAsset;
		startTime: MediaTime;
	}) => {
		const duration =
			asset.duration != null
				? mediaTimeFromSeconds({ seconds: asset.duration })
				: DEFAULT_NEW_ELEMENT_DURATION;
		const element = buildElementFromMedia({
			mediaId: asset.id,
			mediaType: asset.type,
			name: asset.name,
			duration,
			startTime,
		});
		editor.timeline.insertElement({
			element,
			placement: { mode: "auto" },
		});
	};

	return (
		<DraggableItem
			name={item.name}
			preview={preview}
			dragData={{
				id: item.id,
				type: "media",
				mediaType: item.type,
				name: item.name,
				...(item.type !== "audio" && {
					targetElementTypes: [...MASKABLE_ELEMENT_TYPES],
				}),
			}}
			shouldShowPlusOnDrag={false}
			onAddToTimeline={({ currentTime }) =>
				addElementAtTime({ asset: item, startTime: currentTime })
			}
			variant={variant}
			containerClassName={variant === "card" ? "min-w-0 w-full" : undefined}
			isRounded={isRounded}
		/>
	);
}

function MediaItemWithContextMenu({
	item,
	children,
	onRemove,
}: {
	item: MediaAsset;
	children: React.ReactNode;
	onRemove: ({
		event,
		ids,
	}: {
		event: React.MouseEvent;
		ids: string[];
	}) => void;
}) {
	const { isSelected, selectedIds } = useSelection();
	const [exportOpen, setExportOpen] = useState(false);
	const idsToDelete = isSelected(item.id) ? selectedIds : [item.id];
	const deleteLabel =
		idsToDelete.length > 1 ? `删除 ${idsToDelete.length} 项素材` : "删除素材";

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
				<ContextMenuContent
					onCloseAutoFocus={(event) => {
						if (exportOpen) event.preventDefault();
					}}
				>
					<ContextMenuItem onSelect={() => setExportOpen(true)}>
						导出片段
					</ContextMenuItem>
					<ContextMenuItem
						variant="destructive"
						onClick={(event: React.MouseEvent<HTMLDivElement>) =>
							onRemove({ event, ids: idsToDelete })
						}
					>
						{deleteLabel}
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			{exportOpen && (
				<ClipExportDialog
					selection={{ kind: "media", ids: idsToDelete }}
					onClose={() => setExportOpen(false)}
				/>
			)}
		</>
	);
}

function MediaItemList({
	items,
	mode,
	usedMediaIds,
	onRemove,
}: {
	items: MediaAsset[];
	mode: MediaViewMode;
	usedMediaIds: ReadonlySet<string>;
	onRemove: ({
		event,
		ids,
	}: {
		event: React.MouseEvent;
		ids: string[];
	}) => void;
}) {
	const isGrid = mode === "grid";
	const messages = useEditorMessages();
	const nativePreview = useNativeAssetPreview();
	const thumbnailSize = useAssetsPanelStore((state) => state.mediaThumbnailSize);
	const setThumbnailSize = useAssetsPanelStore((state) => state.setMediaThumbnailSize);
	const hover = useHoverScrub();

	return (
		<>
		{isGrid && <label className="flex items-center gap-2 py-2 text-xs">{messages.thumbnailSize}<input aria-label={messages.thumbnailSize} type="range" min={80} max={240} step={8} value={thumbnailSize} onChange={(event) => setThumbnailSize(Number(event.target.value))} /></label>}
		<div
			className={cn(isGrid ? "grid gap-4" : "flex flex-col gap-1.5")}
			style={
				isGrid
					? {
							gridTemplateColumns:
								`repeat(auto-fill, minmax(min(100%, ${thumbnailSize}px), 1fr))`,
						}
					: undefined
			}
		>
			{items.map((item) => (
				<MediaItemWithContextMenu item={item} onRemove={onRemove} key={item.id}>
					<div onPointerMove={(event) => {
						if (item.type !== "video" || event.buttons || event.pointerType === "touch") return;
						const bounds = event.currentTarget.getBoundingClientRect();
						if (bounds.width > 0) hover.move({ id: item.id, ratio: (event.clientX - bounds.left) / bounds.width, duration: item.duration ?? 0 });
					}} onPointerLeave={hover.cancel} onPointerDown={hover.cancel}>
					<MediaCard
						id={item.id}
						name={item.name}
						isUsed={usedMediaIds.has(item.id)}
						onPreview={() => nativePreview.open(item)}
					>
						<MediaAssetDraggable
							item={item}
							preview={
								<MediaPreview
									item={item}
									variant={isGrid ? "grid" : "compact"}
									timeSeconds={hover.sample?.id === item.id ? hover.sample.time : undefined}
								/>
							}
							variant={isGrid ? "card" : "compact"}
							isRounded={isGrid ? false : undefined}
						/>
					</MediaCard>
					</div>
				</MediaItemWithContextMenu>
			))}
		</div>
		</>
	);
}

function formatDuration({ duration }: { duration: number }) {
	const min = Math.floor(duration / 60);
	const sec = Math.floor(duration % 60);
	return `${min}:${sec.toString().padStart(2, "0")}`;
}

function MediaDurationBadge({ duration }: { duration?: number }) {
	if (!duration) return null;

	return (
		<div className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-xs text-white">
			{formatDuration({ duration })}
		</div>
	);
}

function MediaDurationLabel({ duration }: { duration?: number }) {
	if (!duration) return null;

	return (
		<span className="text-xs opacity-70">{formatDuration({ duration })}</span>
	);
}

function MediaTypePlaceholder({
	icon,
	label,
	duration,
	variant,
}: {
	icon: IconSvgElement;
	label: string;
	duration?: number;
	variant: "muted" | "bordered";
}) {
	const iconClassName = cn("size-6", variant === "bordered" && "mb-1");

	return (
		<div
			className={cn(
				"text-muted-foreground flex size-full flex-col items-center justify-center rounded",
				variant === "muted" ? "bg-muted/30" : "border",
			)}
		>
			<HugeiconsIcon icon={icon} className={iconClassName} />
			<span className="text-xs">{label}</span>
			<MediaDurationLabel duration={duration} />
		</div>
	);
}

function MediaPreview({
	item,
	variant = "grid",
	timeSeconds,
}: {
	item: MediaAsset;
	variant?: "grid" | "compact";
	timeSeconds?: number;
}) {
	const shouldShowDurationBadge = variant === "grid";
	const derivedPreview = useMediaPreview({ asset: item, timeSeconds });

	if (item.type === "image") {
		return (
			<div className="relative flex size-full items-center justify-center bg-muted">
				<HostImage
					src={item.url ?? ""}
					alt={item.name}
					fill
					sizes="100vw"
					className="object-cover"
					loading="lazy"
					unoptimized
				/>
			</div>
		);
	}

	if (item.type === "video") {
		if (derivedPreview.status === "ready") {
			return (
				<div className="relative size-full">
					<HostImage
						src={derivedPreview.url}
						onError={derivedPreview.reportError}
						alt={item.name}
						fill
						sizes="100vw"
						className="rounded object-cover"
						loading="lazy"
						unoptimized
					/>
					{shouldShowDurationBadge ? (
						<MediaDurationBadge duration={item.duration} />
					) : null}
				</div>
			);
		}

		return (
			<div className="relative flex size-full flex-col items-center justify-center">
				<MediaTypePlaceholder
					icon={Video01Icon}
					label={
						derivedPreview.status === "loading"
							? "正在获取封面"
							: derivedPreview.status === "offline"
								? "素材离线"
								: derivedPreview.status === "unsupported"
									? "暂不支持预览"
									: "封面不可用"
					}
					duration={item.duration}
					variant="muted"
				/>
				{derivedPreview.status === "failed" && (
					<button
						type="button"
						className="absolute bottom-1 rounded bg-background px-1 text-xs focus-visible:outline-ring"
						onDoubleClick={(event) => event.stopPropagation()}
						onClick={(event) => {
							event.stopPropagation();
							derivedPreview.retry();
						}}
					>
						重试预览
					</button>
				)}
			</div>
		);
	}

	if (item.type === "audio") {
		return (
			<div className="relative flex size-full items-center justify-center border rounded">
				<MediaWaveformPreview asset={item} className="w-full h-12" />
				{shouldShowDurationBadge && (
					<MediaDurationBadge duration={item.duration} />
				)}
			</div>
		);
	}

	return (
		<MediaTypePlaceholder icon={Image02Icon} label="未知类型" variant="muted" />
	);
}

function MediaActions({
	mediaViewMode,
	setMediaViewMode,
	isProcessing,
	sortBy,
	sortOrder,
	onSort,
}: {
	mediaViewMode: MediaViewMode;
	setMediaViewMode: (mode: MediaViewMode) => void;
	isProcessing: boolean;
	sortBy: MediaSortKey;
	sortOrder: MediaSortOrder;
	onSort: ({ key }: { key: MediaSortKey }) => void;
}) {
	return (
		<div
			className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5"
			role="group"
			aria-label="素材操作"
		>
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							size="icon"
							aria-label={
								mediaViewMode === "grid" ? "切换列表视图" : "切换网格视图"
							}
							variant="ghost"
							onClick={() =>
								setMediaViewMode(mediaViewMode === "grid" ? "list" : "grid")
							}
							disabled={isProcessing}
							className="items-center justify-center"
						>
							{mediaViewMode === "grid" ? (
								<HugeiconsIcon icon={LeftToRightListDashIcon} />
							) : (
								<HugeiconsIcon icon={GridViewIcon} />
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						<p>{mediaViewMode === "grid" ? "切换列表视图" : "切换网格视图"}</p>
					</TooltipContent>
				</Tooltip>
				<Tooltip>
					<DropdownMenu>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button
									size="icon"
									aria-label="素材排序"
									variant="ghost"
									disabled={isProcessing}
									className="items-center justify-center"
								>
									<HugeiconsIcon icon={SortingOneNineIcon} />
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<DropdownMenuContent align="end">
							<SortMenuItem
								label="名称"
								sortKey="name"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
							<SortMenuItem
								label="类型"
								sortKey="type"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
							<SortMenuItem
								label="时长"
								sortKey="duration"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
							<SortMenuItem
								label="文件大小"
								sortKey="size"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
						</DropdownMenuContent>
					</DropdownMenu>
					<TooltipContent>
						<p>
							按
							{
								{
									name: "名称",
									type: "类型",
									duration: "时长",
									size: "文件大小",
								}[sortBy]
							}
							排序（
							{sortOrder === "asc" ? "升序" : "降序"}）
						</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		</div>
	);
}

function SortMenuItem({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	onSort,
}: {
	label: string;
	sortKey: MediaSortKey;
	currentSortBy: MediaSortKey;
	currentSortOrder: MediaSortOrder;
	onSort: ({ key }: { key: MediaSortKey }) => void;
}) {
	const isActive = currentSortBy === sortKey;
	const arrow = isActive ? (currentSortOrder === "asc" ? "↑" : "↓") : "";

	return (
		<DropdownMenuItem onClick={() => onSort({ key: sortKey })}>
			{label} {arrow}
		</DropdownMenuItem>
	);
}
