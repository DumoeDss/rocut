"use client";

import { useState } from "react";
import { Button } from "../../components/ui/button";
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
				<p className="p-3 text-xs text-muted-foreground">
					{messages.loading}
				</p>
			)}
			{snapshot && snapshot.documents.length === 0 && (
				<p className="p-3 text-xs text-muted-foreground">
					{messages.noPlans}
				</p>
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
								onClick={() =>
									activate({ type: "document", id: document.id })
								}
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
	const [query, setQuery] = useState("");
	const [type, setType] = useState("all");
	const [used, setUsed] = useState(false);
	const [thumbnailAttempt, setThumbnailAttempt] = useState(0);
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

	return (
		<section className="creator-project-library" aria-label={messages.library}>
			<div className="creator-panel-heading">
				<h2>{messages.library}</h2>
				<span className="text-xs text-muted-foreground">
					{filtered.length}
				</span>
			</div>
			<div className="flex items-center gap-2 px-3 pb-2">
				<Button
					type="button"
					size="sm"
					variant="secondary"
					className="min-w-0 flex-1"
					data-testid="creator-generate-new"
					disabled={!snapshot || busy}
					onClick={() => activate({ type: "generate", id: "new" })}
				>
					{messages.generateAsset}
				</Button>
				<button
					type="button"
					className="text-xs text-muted-foreground underline"
					onClick={() => setThumbnailAttempt((value) => value + 1)}
				>
					{messages.retryPreview}
				</button>
			</div>
			<div className="space-y-2 px-3 pb-2">
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
							aria-pressed={view?.type === "asset" && view.id === asset.id}
							onClick={() => activate({ type: "asset", id: asset.id })}
						>
							<div className="creator-card-image">
								<CreatorAssetThumbnail
									key={thumbnailAttempt}
									assetId={asset.id}
									version={version}
								/>
							</div>
							<span className="block truncate p-2 text-xs">
								{asset.name}
							</span>
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
								{asset.usages?.length ? ` / ${messages.used}` : ""}
							</span>
						</button>
					);
				})}
				{snapshot && filtered.length === 0 && (
					<p className="col-span-full p-3 text-xs text-muted-foreground">
						{messages.noAssets}
					</p>
				)}
			</div>
			{Boolean(snapshot?.jobs?.length) && (
				<div
					className="border-t px-3 py-2 text-xs text-muted-foreground"
					aria-label={messages.generationTasks}
				>
					{snapshot?.jobs?.slice(-5).map((job) => (
						<p key={job.id} className="py-1">
							{job.stage} / {job.status}
						</p>
					))}
				</div>
			)}
		</section>
	);
}

