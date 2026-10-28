"use client";

import { useState } from "react";
import { MediaView } from "../../components/editor/panels/assets/views/assets";
import { useEditorMessages } from "../host/editor-host-context";
import { useEditorInstance } from "../use-editor";
import { CreatorAssetThumbnail } from "./creator-asset-thumbnail";
import { useCreatorContentNavigation } from "./creator-content-navigation";
import { useCreatorWorkspace } from "./creator-workspace-context";

export function CreatorPlansView() {
	const { snapshot, error } = useCreatorWorkspace();
	const { view, activate } = useCreatorContentNavigation();
	const messages = useEditorMessages();
	const groups = Array.from(
		new Set(snapshot?.documents.map((document) => document.group)),
	);

	return (
		<section className="creator-plan" aria-label={messages.plans}>
			<div className="creator-panel-heading">
				<h2>{messages.plans}</h2>
				<span className="text-xs text-muted-foreground">
					{snapshot?.documents.length ?? 0}
				</span>
			</div>
			{error && (
				<p role="alert" className="p-3 text-xs text-destructive">
					{error}
				</p>
			)}
			{!snapshot && !error && (
				<p className="p-3 text-xs text-muted-foreground">{messages.loading}</p>
			)}
			{snapshot && snapshot.documents.length === 0 && (
				<p className="p-3 text-xs text-muted-foreground">{messages.noPlans}</p>
			)}
			{groups.map((group) => (
				<details key={group} open>
					<summary>{group}</summary>
					{snapshot?.documents
						.filter((document) => document.group === group)
						.map((document) => (
							<button
								className="creator-document-row"
								key={document.id}
								aria-pressed={
									view?.type === "document" && view.id === document.id
								}
								onClick={() => activate({ type: "document", id: document.id })}
							>
								{document.title}
							</button>
						))}
				</details>
			))}
		</section>
	);
}

export function CreatorProjectLibraryView() {
	const { snapshot, error } = useCreatorWorkspace();
	const { view, activate, busy } = useCreatorContentNavigation();
	const editor = useEditorInstance();
	const messages = useEditorMessages();
	const [operationError, setOperationError] = useState<string | null>(null);
	const [thumbnailAttempt, setThumbnailAttempt] = useState(0);

	return (
		<section className="creator-project-library" aria-label={messages.library}>
			<MediaView
				projectLibrary={{
					assets: snapshot?.assets ?? [],
					busy: !snapshot || busy,
					onGenerate: (type) => activate({ type: "generate", id: type }),
					onRetryPreviews: () => setThumbnailAttempt((value) => value + 1),
					notice: (
						<>
							{(error || operationError) && (
								<p role="alert" className="px-3 py-2 text-xs text-destructive">
									{operationError ?? error}
								</p>
							)}
							{!snapshot && !error && (
								<p className="p-3 text-xs text-muted-foreground">
									{messages.loading}
								</p>
							)}
						</>
					),
					renderAssets: (filtered) => (
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
										title={`${asset.name} · ${version?.label ?? messages.noVersion}${asset.usages?.length ? ` · ${messages.used}` : ""}`}
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
											setOperationError(null);
											try {
												editor.timeline.dragSource.begin({
													dataTransfer: event.dataTransfer,
													dragData: {
														type: "media",
														id: version.mediaId ?? version.id,
														name: asset.name,
														mediaType: version.mediaType,
														creator: {
															projectId: snapshot.projectId,
															nativeProjectId:
																editor.project.getActive().metadata.id,
															sceneId: editor.scenes.getActiveScene().id,
															assetId: asset.id,
															versionId: version.id,
															sha256: version.sha256,
															durationSeconds: version.durationSeconds,
														},
													},
												});
											} catch (failure) {
												event.preventDefault();
												setOperationError(
													failure instanceof Error
														? failure.message
														: messages.operationFailed,
												);
											}
										}}
										onDragEnd={() => editor.timeline.dragSource.end()}
										aria-pressed={
											view?.type === "asset" && view.id === asset.id
										}
										onClick={() => activate({ type: "asset", id: asset.id })}
									>
										<div className="creator-card-image">
											<CreatorAssetThumbnail
												key={thumbnailAttempt}
												assetId={asset.id}
												version={version}
											/>
										</div>
										<span className="creator-card-caption">{asset.name}</span>
										{(version?.mediaType === "video" ||
											version?.mediaType === "audio") &&
											typeof version.durationSeconds === "number" &&
											Number.isFinite(version.durationSeconds) &&
											version.durationSeconds > 0 && (
												<span className="creator-card-duration">
													{version.durationSeconds.toLocaleString("zh-CN", {
														maximumFractionDigits: 2,
													})}{" "}
													{messages.seconds}
												</span>
											)}
										{Boolean(asset.usages?.length) && (
											<span className="creator-card-used">{messages.used}</span>
										)}
									</button>
								);
							})}
						</div>
					),
				}}
			/>
			{Boolean(snapshot?.jobs?.length) && (
				<details className="shrink-0 border-t px-3 py-2 text-xs text-muted-foreground">
					<summary className="cursor-pointer">
						{messages.generationTasks}
					</summary>
					{snapshot?.jobs?.slice(-5).map((job) => (
						<p key={job.id} className="py-1">
							{job.stage} / {job.status}
						</p>
					))}
				</details>
			)}
		</section>
	);
}
