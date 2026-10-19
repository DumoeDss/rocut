"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { useCreatorWorkspace } from "./creator-workspace-context";
import type { CreatorWorkspaceCommand } from "./creator-workspace-types";
import { CreatorAssetView, CreatorDocumentView } from "./creator-content-view";
import "./creator-workspace.css";
import { useEditorInstance } from "../use-editor";
import { useEditorMessages } from "../host/editor-host-context";
import { CreatorAssetThumbnail } from "./creator-asset-thumbnail";
import { useNativeAssetPreview } from "./native-asset-preview";
import { CreatorNewAssetView } from "./creator-new-asset-view";

export function CreatorWorkspace({
	assets,
	preview,
	children,
}: {
	assets: ReactNode;
	preview: ReactNode;
	children: (panels: {
		assets: ReactNode;
		preview: ReactNode;
		contentActivation: number;
	}) => ReactNode;
}) {
	const { bridge, snapshot, setSnapshot, error } = useCreatorWorkspace();
	const operationScope = useRef<{
		bridge: typeof bridge;
		active: boolean;
		running: boolean;
	} | null>(null);
	useEffect(() => {
		const scope = { bridge, active: true, running: false };
		operationScope.current = scope;
		return () => {
			scope.active = false;
		};
	}, [bridge]);
	const editor = useEditorInstance();
	const messages = useEditorMessages();
	const nativePreview = useNativeAssetPreview();
	const [view, setView] = useState<{
		type: "document" | "asset" | "generate" | "unavailable";
		id: string;
		versionId?: string;
		sha256?: string;
	} | null>(null);
	const [busy, setBusy] = useState(false);
	const [contentActivation, setContentActivation] = useState(0);
	const activateContent = (next: NonNullable<typeof view>) => {
		setView(next);
		setContentActivation((value) => value + 1);
	};
	const [operationError, setOperationError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [type, setType] = useState("all");
	const [used, setUsed] = useState(false);
	const [thumbnailAttempt, setThumbnailAttempt] = useState(0);
	const [scopeBridge, setScopeBridge] = useState(bridge);
	const [previewActivation, setPreviewActivation] = useState(
		nativePreview.activation,
	);
	if (scopeBridge !== bridge) {
		setScopeBridge(bridge);
		setView(null);
		setBusy(false);
		setOperationError(null);
		setMessage(null);
	}
	if (previewActivation !== nativePreview.activation) {
		setPreviewActivation(nativePreview.activation);
		if (nativePreview.asset) {
			setView(null);
			setContentActivation((value) => value + 1);
		}
	}
	useEffect(() => {
		if (nativePreview.asset) editor.playback.pause();
	}, [nativePreview.asset, editor]);
	useEffect(() => {
		if (view) editor.playback.pause();
	}, [editor, view]);
	useEffect(
		() =>
			editor.selection.subscribe(() => {
				const selected = editor.selection.getSelectedElements();
				if (selected.length !== 1 || !snapshot) return;
				const reference = selected[0];
				const element = editor.timeline
					.getTrackById({ trackId: reference.trackId })
					?.elements.find((candidate) => candidate.id === reference.elementId);
				const openFixedVersion = ({
					assetId,
					versionId,
					sha256,
				}: {
					assetId: string;
					versionId: string;
					sha256?: string;
				}) => {
					const version = snapshot.assets
						.find((asset) => asset.id === assetId)
						?.versions.find((candidate) => candidate.id === versionId);
					if (
						version?.mediaId &&
						element &&
						"mediaId" in element &&
						element.mediaId &&
						element.mediaId !== version.mediaId
					) {
						setView({ type: "unavailable", id: reference.elementId });
						return;
					}
					setView({ type: "asset", id: assetId, versionId, sha256 });
				};
				const pins = snapshot.clipReferences?.filter(
					(candidate) =>
						candidate.clipId === reference.elementId &&
						candidate.projectId === editor.project.getActive().metadata.id &&
						candidate.sceneId === editor.scenes.getActiveSceneOrNull()?.id,
				);
				const pin = pins?.[0];
				if (
					pin &&
					(pin.status === "missing" ||
						pin.status === "needs-reconciliation" ||
						pins?.some(
							(candidate) =>
								candidate.assetId !== pin.assetId ||
								candidate.versionId !== pin.versionId ||
								candidate.sha256 !== pin.sha256 ||
								candidate.status !== pin.status,
						))
				) {
					setView({ type: "unavailable", id: reference.elementId });
					return;
				}
				if (pin) {
					openFixedVersion(pin);
					return;
				}
				for (const asset of snapshot.assets) {
					const usage = asset.usages?.find(
						(candidate) =>
							candidate.id === reference.elementId &&
							(!candidate.projectId ||
								candidate.projectId ===
									editor.project.getActive().metadata.id) &&
							(!candidate.sceneId ||
								candidate.sceneId === editor.scenes.getActiveSceneOrNull()?.id),
					);
					if (usage) {
						openFixedVersion({ assetId: asset.id, versionId: usage.versionId });
						return;
					}
				}
			}),
		[editor, snapshot],
	);
	const execute = async (command: CreatorWorkspaceCommand) => {
		const scope = operationScope.current;
		if (!bridge || !scope?.active || scope.bridge !== bridge || scope.running)
			return false;
		scope.running = true;
		setBusy(true);
		setOperationError(null);
		setMessage(null);
		try {
			if (command.type === "asset.place-version" && command.native) {
				await editor.save.flush();
				if (!scope.active) return false;
				command = {
					...command,
					native: {
						...command.native,
						revision: Number(await editor.transactions.revision()),
					},
				};
			}
			const result = await bridge.execute(command);
			const next = result.snapshot ?? (await bridge.getSnapshot());
			if (!scope.active) return false;
			setSnapshot(next);
			setMessage(result.message ?? messages.completed);
			if (command.type === "asset.place-version")
				await editor.project.loadProject({
					id: editor.project.getActive().metadata.id,
				});
			return true;
		} catch (failure) {
			if (!scope.active) return false;
			setOperationError(
				failure instanceof Error ? failure.message : messages.operationFailed,
			);
			return false;
		} finally {
			scope.running = false;
			if (scope.active) setBusy(false);
		}
	};
	// Event handlers render failures locally; the returned promise remains usable by editors.
	const run = execute;
	if (!bridge) return <>{children({ assets, preview, contentActivation })}</>;
	const selectedDocument = snapshot?.documents.find(
		(document) => view?.type === "document" && document.id === view.id,
	);
	const selectedAsset = snapshot?.assets.find(
		(asset) =>
			view?.type === "asset" &&
			asset.id === view.id &&
			(!view.versionId ||
				asset.versions.some(
					(version) =>
						version.id === view.versionId &&
						(!view.sha256 || version.sha256 === view.sha256),
				)),
	);
	const filtered =
		snapshot?.assets.filter(
			(asset) =>
				asset.name
					.toLocaleLowerCase()
					.includes(query.trim().toLocaleLowerCase()) &&
				(type === "all" ||
					asset.versions.some((version) => version.mediaType === type)) &&
				(!used || Boolean(asset.usages?.length)),
		) ?? [];
	const library = (
		<div className="creator-library">
			<section className="creator-plan">
				<details open>
					<summary>
						{messages.plans}{" "}
						<span className="text-muted-foreground">
							{snapshot?.documents.length ?? 0}
						</span>
					</summary>
					{error && (
						<p role="alert" className="p-3 text-xs text-destructive">
							{error}
						</p>
					)}
					{!snapshot && !error && (
						<p className="p-3 text-xs text-muted-foreground">
							{messages.loading}
						</p>
					)}
					{snapshot && snapshot.documents.length === 0 && (
						<p className="p-3 text-xs text-muted-foreground">
							{messages.noPlans}
						</p>
					)}
					{Array.from(
						new Set(snapshot?.documents.map((document) => document.group)),
					).map((group) => (
						<div key={group}>
							<h3 className="px-3 pt-3 pb-1 text-xs text-muted-foreground">
								{group}
							</h3>
							{snapshot?.documents
								.filter((document) => document.group === group)
								.map((document) => (
									<button
										className="creator-document-row"
										key={document.id}
										aria-pressed={view?.id === document.id}
										onClick={() =>
											activateContent({ type: "document", id: document.id })
										}
									>
										{document.title}
									</button>
								))}
						</div>
					))}
				</details>
			</section>
			<section className="creator-project-library">
				<div className="px-3 pt-2">
					<Button
						type="button"
						size="sm"
						variant="secondary"
						data-testid="creator-generate-new"
						disabled={!snapshot || busy}
						onClick={() => activateContent({ type: "generate", id: "new" })}
					>
						{messages.generateAsset}
					</Button>
				</div>
				<div className="flex items-center justify-between px-3 py-2">
					<h2 className="text-xs font-medium">{messages.library}</h2>
					<button
						type="button"
						className="text-xs text-muted-foreground underline"
						onClick={() => setThumbnailAttempt((value) => value + 1)}
					>
						{messages.retryPreview}
					</button>
					<span className="text-xs text-muted-foreground">
						{filtered.length}
					</span>
				</div>
				<div className="px-3 pb-2 space-y-2">
					<input
						className="creator-search"
						type="search"
						aria-label={messages.searchAssets}
						placeholder={messages.search}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
					<div className="flex flex-wrap items-center gap-2 text-xs">
						<select
							className="creator-type"
							aria-label={messages.assetType}
							value={type}
							onChange={(event) => setType(event.target.value)}
						>
							<option value="all">{messages.allTypes}</option>
							<option value="image">{messages.image}</option>
							<option value="video">{messages.video}</option>
							<option value="audio">{messages.audio}</option>
							<option value="programmatic">{messages.programmatic}</option>
						</select>
						<label className="flex items-center gap-1">
							<input
								type="checkbox"
								checked={used}
								onChange={(event) => setUsed(event.target.checked)}
							/>
							{messages.used}
						</label>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							data-testid="creator-clear-filters"
							disabled={!query && type === "all" && !used}
							onClick={() => {
								setQuery("");
								setType("all");
								setUsed(false);
							}}
						>
							{messages.clearFilters}
						</Button>
					</div>
				</div>
				<div className="creator-project-assets">
					{filtered.map((asset) => {
						const version =
							asset.versions.find(
								(candidate) => candidate.id === asset.selectedVersionId,
							) ?? asset.versions[0];
						return (
							<button
								key={asset.id}
								className="creator-project-card"
								data-testid="creator-asset-card"
								data-asset-id={asset.id}
								draggable={Boolean(
									!busy &&
									snapshot?.capabilities?.placeVersion &&
									version?.sha256 &&
									version.mediaType !== "programmatic" &&
									version.status !== "pending" &&
									version.status !== "failed",
								)}
								onDragStart={(event) => {
									if (
										!snapshot ||
										!version?.sha256 ||
										version.mediaType === "programmatic"
									) {
										event.preventDefault();
										return;
									}
									editor.timeline.dragSource.begin({
										dataTransfer: event.dataTransfer,
										dragData: {
											type: "media",
											id: version.mediaId ?? version.id,
											name: asset.name,
											mediaType: version.mediaType,
											creator: {
												projectId: snapshot.projectId,
												nativeProjectId: editor.project.getActive().metadata.id,
												sceneId: editor.scenes.getActiveScene().id,
												assetId: asset.id,
												versionId: version.id,
												sha256: version.sha256,
												durationSeconds: version.durationSeconds,
											},
										},
									});
								}}
								onDragEnd={() => editor.timeline.dragSource.end()}
								aria-pressed={view?.id === asset.id}
								onClick={() => activateContent({ type: "asset", id: asset.id })}
							>
								<div className="creator-card-image">
									<CreatorAssetThumbnail
										key={thumbnailAttempt}
										assetId={asset.id}
										version={version}
									/>
								</div>
								<span className="block truncate p-2 text-xs">{asset.name}</span>
								{(version?.mediaType === "video" ||
									version?.mediaType === "audio") &&
									typeof version.durationSeconds === "number" &&
									Number.isFinite(version.durationSeconds) &&
									version.durationSeconds > 0 && (
										<span className="block px-2 pb-2 text-xs text-muted-foreground">
											{messages.duration}
											{version.durationSeconds.toLocaleString("zh-CN", {
												maximumFractionDigits: 2,
											})}{" "}
											{messages.seconds}
										</span>
									)}
								<span className="block px-2 pb-2 text-xs text-muted-foreground">
									{version?.label ?? messages.noVersion}
									{asset.usages?.length ? ` · ${messages.used}` : ""}
								</span>
							</button>
						);
					})}
					{snapshot && filtered.length === 0 && (
						<p className="col-span-full text-xs text-muted-foreground p-3">
							{messages.noAssets}
						</p>
					)}
				</div>
				{Boolean(snapshot?.jobs?.length) && (
					<div
						className="px-3 py-2 border-t text-xs text-muted-foreground"
						aria-label={messages.generationTasks}
					>
						{snapshot?.jobs?.slice(-5).map((job) => (
							<p key={job.id} className="py-1">
								{job.stage} · {job.status}
							</p>
						))}
					</div>
				)}
				<details className="creator-native-library">
					<summary>{messages.projectTools}</summary>
					<div className="h-80 min-h-0">{assets}</div>
				</details>
			</section>
		</div>
	);
	const center = (
		<div className="creator-viewer" data-testid="creator-content-viewer">
			<div className="creator-viewer-heading">
				<span className="truncate text-xs">
					{view?.type === "generate"
						? messages.generateAsset
						: (selectedDocument?.title ??
							selectedAsset?.name ??
							messages.monitor)}
				</span>
				{view && (
					<Button variant="ghost" size="sm" onClick={() => setView(null)}>
						{messages.backToFinal}
					</Button>
				)}
			</div>
			{operationError && (
				<p role="alert" className="text-xs text-destructive px-3 py-2">
					{operationError}
				</p>
			)}
			{message && (
				<p
					role="status"
					data-testid="creator-operation-status"
					className="text-xs text-muted-foreground px-3 py-1"
				>
					{message}
				</p>
			)}
			<div
				className="min-h-0 flex-1"
				style={{ display: view ? "none" : undefined }}
			>
				{preview}
			</div>
			{selectedDocument && (
				<div className="overflow-auto min-h-0 flex-1">
					<CreatorDocumentView
						key={selectedDocument.id}
						document={selectedDocument}
						execute={run}
						busy={busy}
						canEdit={snapshot?.capabilities?.saveDocument}
						readDocument={bridge.readDocument}
						snapshot={snapshot ?? undefined}
					/>
				</div>
			)}
			{selectedAsset && (
				<CreatorAssetView
					key={`${selectedAsset.id}:${view?.versionId ?? "selected"}`}
					asset={selectedAsset}
					initialVersionId={view?.versionId}
					execute={run}
					busy={busy}
					capabilities={snapshot?.capabilities}
					openAsset={(id) => setView({ type: "asset", id })}
				/>
			)}
			{view?.type === "generate" && (
				<div className="overflow-auto min-h-0 flex-1">
					<CreatorNewAssetView
						key={snapshot?.projectId}
						execute={run}
						busy={busy}
						available={snapshot?.capabilities?.generate === true}
					/>
				</div>
			)}
			{view &&
				view.type !== "generate" &&
				!selectedAsset &&
				!selectedDocument && (
					<div
						data-testid="creator-content-unavailable"
						role="status"
						className="p-5 text-xs text-muted-foreground"
					>
						{messages.contentUnavailable}
					</div>
				)}
		</div>
	);
	return (
		<>{children({ assets: library, preview: center, contentActivation })}</>
	);
}
