"use client";

import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import type {
	CreatorAsset,
	CreatorAssetVersion,
	CreatorDocument,
	CreatorWorkspaceCommand,
	CreatorWorkspaceSnapshot,
	CreatorWorkspaceBridge,
} from "./creator-workspace-types";
import { useEditor, useEditorInstance } from "../use-editor";
import { DEFAULT_NEW_ELEMENT_DURATION } from "../../timeline/creation";
import { mediaTimeFromSeconds } from "../../wasm";
import {
	CreatorGenerationOptions,
	type GenerationOptions,
} from "./creator-generation-options";

export function CreatorDocumentView({
	document: sourceDocument,
	execute,
	busy,
	canEdit,
	readDocument,
	snapshot,
}: {
	document: CreatorDocument;
	execute: (command: CreatorWorkspaceCommand) => Promise<boolean>;
	busy: boolean;
	canEdit?: boolean;
	readDocument?: CreatorWorkspaceBridge["readDocument"];
	snapshot?: CreatorWorkspaceSnapshot;
}) {
	const [loaded, setLoaded] = useState<CreatorDocument | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [readAttempt, setReadAttempt] = useState(0);
	useEffect(() => {
		let active = true;
		if (sourceDocument.contentState !== "unloaded") {
			return;
		}
		const reading =
			readDocument && snapshot
				? readDocument({ document: sourceDocument, snapshot })
				: Promise.reject(new Error("Document loading is unavailable"));
		void reading
			.then((value) => {
				if (active) {
					setLoaded(value);
					setLoadError(null);
				}
			})
			.catch((failure: unknown) => {
				if (active)
					setLoadError(
						failure instanceof Error
							? failure.message
							: "Document loading failed",
					);
			});
		return () => {
			active = false;
		};
	}, [sourceDocument, readDocument, snapshot, readAttempt]);
	const document =
		loaded?.id === sourceDocument.id &&
		loaded.revision === sourceDocument.revision
			? loaded
			: sourceDocument;
	const ready = document.contentState !== "unloaded";
	const [editing, setEditing] = useState(false);
	const [content, setContent] = useState(document.content);
	const [baseRevision, setBaseRevision] = useState(document.revision);
	return (
		<article className="creator-document" data-testid="creator-document-view">
			{!ready && (
				<p role="status">
					{loadError ?? "正在加载文档…"}
					{loadError && (
						<button
							onClick={() => {
								setLoadError(null);
								setReadAttempt((value) => value + 1);
							}}
						>
							重试
						</button>
					)}
				</p>
			)}
			<div className="flex items-center justify-between gap-2">
				<h1 className="text-xl font-medium">{document.title}</h1>
				{editing ? (
					<div className="flex gap-1">
						<Button
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={() => {
								setContent(document.content);
								setEditing(false);
							}}
						>
							取消
						</Button>
						<Button
							size="sm"
							disabled={busy || !canEdit || !ready}
							data-testid="creator-document-save"
							onClick={() =>
								void execute({
									type: "document.save",
									documentId: document.id,
									content,
									revision: baseRevision,
								}).then((success) => {
									if (success) setEditing(false);
								})
							}
						>
							保存文档
						</Button>
					</div>
				) : (
					<Button
						size="sm"
						variant="secondary"
						disabled={!canEdit || !ready}
						onClick={() => {
							setContent(document.content);
							setBaseRevision(document.revision);
							setEditing(true);
						}}
					>
						编辑文档
					</Button>
				)}
			</div>
			{editing && document.revision !== baseRevision && (
				<p
					role="status"
					data-testid="creator-document-updated"
					className="mt-3 text-sm text-muted-foreground"
				>
					文档已在其他位置更新，当前草稿已保留。保存将检查开始编辑时的版本；取消编辑可查看最新正文。
				</p>
			)}
			{editing ? (
				<textarea
					className="creator-document-editor"
					aria-label="文档内容"
					value={content}
					disabled={busy}
					onChange={(event) => setContent(event.target.value)}
				/>
			) : ready ? (
				<div className="whitespace-pre-wrap break-words text-sm leading-8 mt-6">
					{document.content || "文档暂无内容。点击编辑文档开始记录。"}
				</div>
			) : null}
		</article>
	);
}

function VersionPreview({
	version,
	name,
}: {
	version: CreatorAssetVersion;
	name: string;
}) {
	if (!version.previewUrl)
		return (
			<div className="text-muted-foreground p-8 text-center">
				{version.status === "pending"
					? "正在生成预览"
					: version.status === "failed"
						? "预览不可用，请检查素材来源"
						: "此版本暂无可用预览"}
			</div>
		);
	if (version.mediaType === "video")
		return (
			<video
				className="max-h-full max-w-full"
				src={version.previewUrl}
				controls
				preload="metadata"
			/>
		);
	if (version.mediaType === "audio")
		return (
			<audio
				className="max-w-full"
				src={version.previewUrl}
				controls
				preload="metadata"
			/>
		);
	if (version.mediaType === "image")
		return (
			<img
				className="max-h-full max-w-full object-contain"
				src={version.previewUrl}
				alt={name}
			/>
		);
	return (
		<p className="text-muted-foreground">程序化素材通过成片监视器预览。</p>
	);
}

export function CreatorAssetView({
	asset,
	initialVersionId,
	execute,
	busy,
	openAsset,
	capabilities,
}: {
	asset: CreatorAsset;
	initialVersionId?: string;
	execute: (command: CreatorWorkspaceCommand) => Promise<boolean>;
	busy: boolean;
	openAsset: (id: string) => void;
	capabilities?: CreatorWorkspaceSnapshot["capabilities"];
}) {
	const editor = useEditorInstance();
	const scene = useEditor((current) => current.scenes.getActiveSceneOrNull());
	const [trackId, setTrackId] = useState("");
	const [versionId, setVersionId] = useState(
		initialVersionId ?? asset.selectedVersionId ?? asset.versions[0]?.id,
	);
	const version =
		asset.versions.find((candidate) => candidate.id === versionId) ??
		(initialVersionId ? undefined : asset.versions[0]);
	const [regenerating, setRegenerating] = useState(false);
	const [prompt, setPrompt] = useState("");
	const [generationOptions, setGenerationOptions] = useState<GenerationOptions>(
		{},
	);
	const tracks = scene
		? [
				scene.tracks.main,
				...scene.tracks.overlay,
				...scene.tracks.audio,
			].filter((track) =>
				version?.mediaType === "audio"
					? track.type === "audio"
					: track.type === "video",
			)
		: [];
	const selectedTrack = tracks.find((track) => track.id === trackId);
	const duration =
		version?.mediaType === "image"
			? DEFAULT_NEW_ELEMENT_DURATION
			: version?.durationSeconds &&
				  Number.isFinite(version.durationSeconds) &&
				  version.durationSeconds > 0
				? mediaTimeFromSeconds({ seconds: version.durationSeconds })
				: null;
	if (!version)
		return <p className="p-5 text-muted-foreground">此素材暂无候选版本。</p>;
	return (
		<div className="creator-asset-detail" data-testid="creator-asset-detail">
			<div className="creator-asset-preview">
				<VersionPreview version={version} name={asset.name} />
			</div>
			<div className="p-4 space-y-4">
				<div className="flex flex-wrap items-center gap-2">
					<h2 className="mr-auto font-medium">{asset.name}</h2>
					<span className="text-xs text-muted-foreground">
						{version.label}
						{asset.selectedVersionId === version.id ? " · 已选用" : " · 候选"}
					</span>
				</div>
				<div className="flex gap-1 flex-wrap" aria-label="候选版本">
					{asset.versions.map((candidate) => (
						<Button
							key={candidate.id}
							data-testid="creator-version"
							data-version-id={candidate.id}
							size="sm"
							variant={version.id === candidate.id ? "secondary" : "ghost"}
							aria-pressed={version.id === candidate.id}
							onClick={() => {
								setVersionId(candidate.id);
								setRegenerating(false);
							}}
						>
							{candidate.label}
							{asset.selectedVersionId === candidate.id ? " ✓" : ""}
						</Button>
					))}
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						size="sm"
						disabled={
							busy ||
							!capabilities?.placeVersion ||
							!selectedTrack ||
							version.status === "pending" ||
							version.status === "failed"
						}
						title={
							!capabilities?.placeVersion
								? "宿主暂未提供版本入轨"
								: !selectedTrack
									? "先选择目标轨道"
									: undefined
						}
						onClick={() => {
							if (!scene || !selectedTrack) return;
							void execute({
								type: "asset.place-version",
								assetId: asset.id,
								versionId: version.id,
								native: {
									projectId: editor.project.getActive().metadata.id,
									sceneId: scene.id,
									revision: 0,
									placement: {
										clipId: crypto.randomUUID(),
										trackId: selectedTrack.id,
										startTime: editor.playback.getCurrentTime(),
										...(duration ? { duration } : {}),
										trimStart: 0,
										trimEnd: 0,
									},
								},
							});
						}}
					>
						放入时间轴
					</Button>
					<Button
						size="sm"
						variant="secondary"
						disabled={
							busy ||
							!capabilities?.selectVersion ||
							asset.selectedVersionId === version.id ||
							version.status === "pending" ||
							version.status === "failed"
						}
						onClick={() =>
							void execute({
								type: "asset.select-version",
								assetId: asset.id,
								versionId: version.id,
							})
						}
					>
						选用此版本
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={
							busy || !capabilities?.regenerate || !version.canRegenerate
						}
						onClick={() => {
							setPrompt(version.prompt ?? "");
							setGenerationOptions({});
							setRegenerating(!regenerating);
						}}
					>
						重新生成
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={busy || !capabilities?.mention}
						onClick={() =>
							void execute({
								type: "context.mention",
								assetId: asset.id,
								versionId: version.id,
							})
						}
					>
						@ 提问
					</Button>
				</div>
				{capabilities?.placeVersion && (
					<label className="flex flex-wrap gap-2 items-center text-xs">
						目标轨道
						<select
							className="creator-type"
							value={trackId}
							onChange={(event) => setTrackId(event.target.value)}
						>
							<option value="">选择轨道</option>
							{tracks.map((track) => (
								<option key={track.id} value={track.id}>
									{track.name || track.type}
								</option>
							))}
						</select>
						<span className="text-muted-foreground">从当前播放头放置</span>
					</label>
				)}
				{regenerating && (
					<form
						className="space-y-2"
						onSubmit={(event) => {
							event.preventDefault();
							void execute({
								type: "asset.regenerate",
								assetId: asset.id,
								versionId: version.id,
								prompt,
								...generationOptions,
							}).then((success) => {
								if (success) setRegenerating(false);
							});
						}}
					>
						<label
							className="text-xs block"
							htmlFor="creator-regenerate-prompt"
						>
							生成提示词
						</label>
						{(version.mediaType === "image" ||
							version.mediaType === "video") && (
							<CreatorGenerationOptions
								mediaType={version.mediaType}
								value={generationOptions}
								onChange={setGenerationOptions}
							/>
						)}
						<textarea
							id="creator-regenerate-prompt"
							className="creator-prompt"
							value={prompt}
							onChange={(event) => setPrompt(event.target.value)}
						/>
						<Button size="sm" disabled={busy || !prompt.trim()} type="submit">
							提交生成任务
						</Button>
					</form>
				)}
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
					<dt className="text-muted-foreground">模型</dt>
					<dd>{version.model || "未记录"}</dd>
					<dt className="text-muted-foreground">来源</dt>
					<dd className="break-words">{version.source || "未记录"}</dd>
					<dt className="text-muted-foreground">提示词</dt>
					<dd className="whitespace-pre-wrap break-words leading-6">
						{version.prompt || "未记录"}
					</dd>
				</dl>
				{Boolean(version.references?.length) && (
					<div>
						<h3 className="text-xs text-muted-foreground mb-2">参考素材</h3>
						<div className="flex flex-wrap gap-1">
							{version.references?.map((reference) => (
								<Button
									key={reference.id}
									size="sm"
									variant="secondary"
									onClick={() => openAsset(reference.id)}
								>
									{reference.label}
								</Button>
							))}
						</div>
					</div>
				)}
				<div className="border-t pt-3 text-xs text-muted-foreground">
					<h3 className="mb-2">使用位置</h3>
					{asset.usages?.length ? (
						asset.usages.map((usage) => (
							<p key={usage.id} className="py-1">
								{usage.label} ·{" "}
								{asset.versions.find(
									(candidate) => candidate.id === usage.versionId,
								)?.label ?? usage.versionId}
							</p>
						))
					) : (
						<p>尚未使用</p>
					)}
					<p className="mt-3">预览和选用版本不会替换已有片段。</p>
				</div>
			</div>
		</div>
	);
}
