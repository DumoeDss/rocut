"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { useCreatorWorkspace } from "./creator-workspace-context";
import type { CreatorWorkspaceCommand } from "./creator-workspace-types";
import { CreatorAssetView, CreatorDocumentView } from "./creator-content-view";
import "./creator-workspace.css";
import { useEditorInstance } from "../use-editor";
import { useEditorMessages } from "../host/editor-host-context";
import { useNativeAssetPreview } from "./native-asset-preview";
import { CreatorNewAssetView } from "./creator-new-asset-view";
import { CreatorContentNavigationProvider } from "./creator-content-navigation";

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
		<CreatorContentNavigationProvider
			value={{ view, activate: activateContent, busy }}
		>
			{children({ assets, preview: center, contentActivation })}
		</CreatorContentNavigationProvider>
	);
}
