import { useEffect, useState } from "react";
import { ThemeProvider } from "next-themes";
import { createEditorSession, EditorSessionProvider, type EditorSession } from "@opencut/editor-classic/session";
import { CreatorWorkspaceProvider, SessionEditorSurface, type CreatorWorkspaceBridge, type CreatorWorkspaceSnapshot } from "@opencut/editor-classic/surface";
import { TooltipProvider } from "@opencut/editor-classic/ui";
import { editorForSession } from "@opencut/editor-classic/runtime";
import { DEFAULT_BACKGROUND_COLOR, DEFAULT_CANVAS_SIZE, DEFAULT_FPS, mediaTime } from "@opencut/editor-classic";
import { buildDefaultScene, buildTextElement, getProjectDurationFromScenes } from "@opencut/editor-classic/timeline";
import { CURRENT_PROJECT_VERSION } from "@opencut/editor-classic/storage";
import { createViteEditorHost } from "./host/vite-host-config";
import shortMotionUrl from "../public/workspace-fixtures/short-motion.mp4?url";
import toneUrl from "../public/workspace-fixtures/tone.wav?url";
import { buildElementFromMedia } from "../../../packages/editor-classic/src/timeline/element-utils";
import { mediaTimeFromSeconds } from "../../../packages/editor-classic/src/wasm";
import { resolveVideoSourceTime, planVideoFreezeFrame, isVideoReverseSupported } from "../../../packages/editor-classic/src/wasm/video-time";
import { annotationFixtureStart, createAnnotationFixture, AnnotationFixtureSave } from "./creator-annotation-fixture";
import { installMusicGridFixture } from "./music-grid-fixture";

const thumbnail = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#586f8c"/><circle cx="160" cy="90" r="45" fill="#d4e2ed"/></svg>');
function content(projectId: string): CreatorWorkspaceSnapshot {
	return { projectId, revision: "1", capabilities: { saveDocument: true, selectVersion: true, regenerate: true, generate: true, placeVersion: false, mention: false, replaceVersion: true, locateInCanvas: false }, documents: [{ id: "plan", title: `${projectId} 制作计划`, group: "项目计划", revision: "1:hash", content: "第一段制作计划。\n保留已有片段的固定版本。" }], assets: [
		{ id: "character", name: "角色设定", selectedVersionId: "v1", versions: [{ id: "v1", label: "V1", mediaType: "image", previewUrl: thumbnail, canRegenerate: true, source: "项目图片", model: "记录的模型", prompt: "角色参考图" }, { id: "v2", label: "V2", mediaType: "image", previewUrl: thumbnail }], usages: [{ id: "existing-clip", label: "已有片段", versionId: "v1" }] },
		{ id: "music", name: "背景音乐", versions: [{ id: "audio-v1", label: "V1", mediaType: "audio" }] },
	] };
}

export function CreatorWorkspaceHarness() {
	const annotationFixture = new URLSearchParams(location.search).has("annotation-fixture");
	const [session, setSession] = useState<EditorSession | null>(null);
	const [error, setError] = useState("");
	const [bridge, setBridge] = useState<CreatorWorkspaceBridge | null>(null);
	useEffect(() => {
		let active = true;
		let owned: EditorSession | null = null;
		void (async () => {
			const id = "workspace-fixture";
			owned = await createEditorSession({ host: createViteEditorHost({ projectId: id, onProjectIdChange: () => {}, onExitProject: () => {}, forceRendererBackend: "none" }) });
			const editor = editorForSession(owned);
			const scene = buildDefaultScene({ name: "Main scene", isMain: true });
			const text = buildTextElement({ raw: { name: "Existing fixed clip" }, startTime: mediaTime({ ticks: annotationFixture ? annotationFixtureStart() : 0 }) });
			if (annotationFixture) text.duration = mediaTime({ ticks: 120000 });
			if (text.type === "text") scene.tracks.overlay.push({ id: "text-track", type: "text", name: "字幕", hidden: false, elements: [{ ...text, id: "existing-clip" }] });
			const now = new Date();
			if (new URLSearchParams(location.search).has("fixed-reference-fixture")) {
				const second = buildTextElement({ raw: { name: "Second fixed clip" }, startTime: mediaTimeFromSeconds({ seconds: 5 }) });
				const textTrack = scene.tracks.overlay.find((track) => track.type === "text");
				if (second.type === "text" && textTrack?.type === "text") textTrack.elements.push({ ...second, id: "second-fixed-clip" });
			}
			await editor.persistence.saveProject({ project: { metadata: { id, name: "Workspace fixture", duration: getProjectDurationFromScenes({ scenes: [scene] }), createdAt: now, updatedAt: now }, scenes: [scene], currentSceneId: scene.id, motionTextSequences: [], version: CURRENT_PROJECT_VERSION, settings: { fps: DEFAULT_FPS, canvasSize: DEFAULT_CANVAS_SIZE, canvasSizeMode: "preset", lastCustomCanvasSize: null, originalCanvasSize: null, background: { type: "color", color: DEFAULT_BACKGROUND_COLOR } } } });
			let snapshot = content("A");
			const posterFixture = new URLSearchParams(location.search).has("poster-fixture");
			if (posterFixture) snapshot = { ...snapshot, assets: [0, 1].map((index) => ({
				id: `poster-video-${index}`, name: `Video ${index}`, versions: [{ id: "video-v1", label: "V1", mediaType: "video", sha256: "a".repeat(64), previewUrl: shortMotionUrl, status: "ready" }],
			})) };
			let rejectPoster = new URLSearchParams(location.search).has("poster-failure");
			let rejectDocument = false;
			let rejectSave = false;
			let rejectCatalog = false;
			let rejectAudio = false;
			let rejectGeneration = false;
			const commands: unknown[] = [];
			const annotations = annotationFixture ? createAnnotationFixture({ editor, projectId: id, sceneId: scene.id }) : null;
			const listeners = new Set<(next: CreatorWorkspaceSnapshot) => void>();
			const publish = () => listeners.forEach((listener) => listener(snapshot));
			const makeBridge = (late = false): CreatorWorkspaceBridge => ({
				getSnapshot: () => late ? new Promise((resolve) => setTimeout(() => resolve(content("Late A")), 250)) : Promise.resolve(snapshot),
				subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
				execute: async (command) => {
					commands.push(command);
					const annotationResult = await annotations?.execute(command);
					if (annotationResult) return annotationResult;
					if (command.type === "asset.ensure-poster") {
						await new Promise((resolve) => setTimeout(resolve, 150));
						if (rejectPoster) throw new Error("Poster decoder failed");
						return { poster: { status: "available", url: thumbnail } };
					}
					if (command.type === "generation.catalog") { await new Promise((resolve) => setTimeout(resolve, 150)); if (rejectCatalog) throw new Error("目录暂不可用"); return { catalog: { status: "ready", providers: [{ id: "fixture-provider", name: "测试服务", defaultModelId: "fixture-model", models: [{ id: "fixture-model", name: "测试模型" }] }] } }; }
					if (command.type === "asset.audio-summary") { await new Promise((resolve) => setTimeout(resolve, 150)); if (rejectAudio) throw new Error("摘要暂不可用"); return { summary: { status: "available", durationSeconds: 3, waveform: [0.1, 0.8, 0.3] } }; }
					if (command.type === "asset.generate") {
						await new Promise((resolve) => setTimeout(resolve, 150));
						if (rejectGeneration) throw new Error("生成任务暂不可提交，请重试");
						snapshot = { ...snapshot, jobs: [...(snapshot.jobs ?? []), { id: `fixture-generation-${commands.length}`, stage: "图片或视频生成", status: "queued" }] };
						publish();
						return { snapshot, message: "生成任务已提交，可在项目素材库查看进度" };
					}
					if (command.type === "document.save") {
						if (rejectDocument || snapshot.documents.find((document) => document.id === command.documentId)?.revision !== command.revision) throw new Error("文档已被更新，请重新载入后再保存");
						const revision = String(Number(snapshot.revision) + 1);
						snapshot = { ...snapshot, revision, documents: snapshot.documents.map((document) => document.id === command.documentId ? { ...document, revision: `${revision}:hash`, content: command.content } : document) };
					} else if (command.type === "asset.select-version") snapshot = { ...snapshot, assets: snapshot.assets.map((asset) => asset.id === command.assetId ? { ...asset, selectedVersionId: command.versionId } : asset) };
					else if (command.type === "context.locate-canvas") return { snapshot, message: "已在画布中定位" };
					else if (command.type === "asset.replace-version.prepare") {
						if (!command.registeredTargetId || !command.nativeRevision) throw new Error("replacement target and native revision are required");
						return { snapshot, planId: "fixture-replace-plan" };
					}
					else if (command.type === "asset.replace-version.confirm") {
						if (command.planId !== "fixture-replace-plan") throw new Error("replace plan is missing");
						snapshot = { ...snapshot, revision: String(Number(snapshot.revision) + 1), assets: snapshot.assets.map((asset) => asset.id === "character" ? { ...asset, selectedVersionId: "v2", usages: asset.usages?.map((usage) => usage.versionId === "v1" ? { ...usage, versionId: "v2" } : usage) } : asset) };
					}
					publish();
					return { snapshot };
				},
			});
			const save = editor.project.saveCurrentProject.bind(editor.project);
			editor.project.saveCurrentProject = async () => { if (rejectSave) throw new Error("测试存储暂不可写"); await save(); };
			Object.assign(window, { __creatorWorkspaceFixture: {
				loadMusicGrid: () => installMusicGridFixture({ editor, projectId: id }),
				...annotations?.probe,
				getPlayhead: () => editor.playback.getCurrentTime(),
				getIsPlaying: () => editor.playback.getIsPlaying(),
				seekPlayhead: () => editor.playback.seek({ time: mediaTimeFromSeconds({ seconds: 1 }) }),
				pinNativeVideoWithDifferentMedia: () => {
					const clip = editor.scenes.getActiveScene().tracks.main.elements.find((element) => element.type === "video");
					if (!clip) throw new Error("Native video clip required");
					const asset = content("A").assets[0];
					snapshot = { ...snapshot, revision: String(Number(snapshot.revision) + 1), assets: [{ ...asset, versions: asset.versions.map((version) => ({ ...version, sha256: "a".repeat(64), mediaId: "different-native-media" })) }], clipReferences: [{ projectId: id, sceneId: scene.id, clipId: clip.id, assetId: asset.id, versionId: "v1", sha256: "a".repeat(64), status: "linked" }] };
					editor.selection.clearSelection();
					publish();
					return clip.id;
				},
				configureFixedReference: (mode: string) => {
					const asset = content("A").assets[0];
					const pin = { projectId: id, sceneId: scene.id, clipId: "existing-clip", assetId: asset.id, versionId: mode === "v2" ? "v2" : "v1", sha256: "a".repeat(64) };
					snapshot = { ...snapshot, revision: String(Number(snapshot.revision) + 1),
						clipReferences: mode === "unknown" || mode === "legacy" ? [] : mode === "dual" ? [pin, { ...pin, clipId: "second-fixed-clip", versionId: "v2" }] : [{ ...pin, ...(mode === "foreign" ? { sceneId: "other-scene" } : {}), ...(mode === "foreign-project" ? { projectId: "other-project" } : {}) }],
						assets: mode === "missing-asset" ? [] : [{ ...asset, selectedVersionId: "v2", usages: mode === "legacy" ? [{ id: pin.clipId, label: "Fixed clip", versionId: "missing" }] : [], versions: asset.versions.filter((version) => mode !== "missing-version" || version.id !== "v1").map((version) => ({ ...version, sha256: mode === "hash-mismatch" ? "b".repeat(64) : pin.sha256, ...(mode === "offline" ? { previewUrl: undefined } : {}) })) }],
					};
					if (mode === "ambiguous") snapshot = { ...snapshot, clipReferences: [pin, { ...pin, versionId: "v2" }] };
					if (mode === "mixed-status") snapshot = { ...snapshot, clipReferences: [{ ...pin, status: "linked" }, { ...pin, status: "missing" }] };
					if (mode === "duplicate") snapshot = { ...snapshot, clipReferences: [pin, pin] };
					if (mode === "missing" || mode === "needs-reconciliation") snapshot = { ...snapshot, clipReferences: [{ ...pin, status: mode }] };
					editor.selection.clearSelection();
					publish();
				},
				setDocumentConflict: (value: boolean) => { rejectDocument = value; },
				updateDocumentFromOutside: (content: string, revision: string) => {
					snapshot = { ...snapshot, revision: String(Number(snapshot.revision) + 1), documents: snapshot.documents.map((document) => document.id === "plan" ? { ...document, content, revision } : document) };
					publish();
				},
				setSaveFailure: (value: boolean) => { rejectSave = value; const live = editorForSession(owned!); live.project.saveCurrentProject = async () => { if (rejectSave) throw new Error("测试存储暂不可写"); await save(); }; },
				getSaveProbe: () => ({ sameEditor: editorForSession(owned!) === editor, state: editorForSession(owned!).save.getState() }),
				getNativeScenes: () => JSON.stringify(editor.scenes.getScenes()),
				getSnapshot: () => snapshot,
				getTimelineView: () => editor.project.getActive().timelineViewState,
				markDirty: () => editorForSession(owned!).save.markDirty({ force: true }),
				getCommands: () => commands,
				setPosterFailure: (value: boolean) => { rejectPoster = value; },
				enablePlacement: () => { snapshot = { ...snapshot, capabilities: { ...snapshot.capabilities!, placeVersion: true }, assets: snapshot.assets.map((asset) => ({ ...asset, versions: asset.versions.map((version) => ({ ...version, sha256: version.id === "v1" ? "a".repeat(64) : "b".repeat(64), status: "ready" as const })) })) }; publish(); },
				enableLocateInCanvas: () => { snapshot = { ...snapshot, capabilities: { ...snapshot.capabilities!, locateInCanvas: true } }; publish(); },
				changeDraggedVersion: (changeHash: boolean) => { snapshot = { ...snapshot, assets: snapshot.assets.map((asset) => asset.id === "character" ? { ...asset, selectedVersionId: "v2", versions: asset.versions.map((version) => changeHash && version.id === "v1" ? { ...version, sha256: "c".repeat(64) } : version) } : asset) }; publish(); },
				broadcastSnapshot: (revision: string, title: string, projectId = "A") => { const next = { ...snapshot, revision, projectId, documents: snapshot.documents.map((document) => ({ ...document, title })) }; listeners.forEach((listener) => listener(next)); },
				setCatalogFailure: (value: boolean) => { rejectCatalog = value; },
				setAudioFailure: (value: boolean) => { rejectAudio = value; },
				setGenerationFailure: (value: boolean) => { rejectGeneration = value; },
				setGenerationAvailable: (value: boolean) => {
					if (!snapshot.capabilities) return;
					const { generate: _generate, ...capabilities } = snapshot.capabilities;
					snapshot = { ...snapshot, capabilities: { ...capabilities, ...(value ? { generate: true } : {}) } };
					publish();
				},
				loadNativeFixtures: async () => {
					for (const [name, type] of [["short-motion.mp4", "video"], ["tone.wav", "audio"]] as const) {
						const response = await fetch(type === "video" ? shortMotionUrl : toneUrl);
						const bytes = await response.arrayBuffer();
						const file = new File([bytes], name, { type: type === "video" ? "video/mp4" : "audio/wav" });
						await editor.media.addMediaAsset({ projectId: id, asset: { name, type, file, url: URL.createObjectURL(file), duration: 0.6, width: 160, height: 90, hasAudio: true } });
					}
				},
				sampleNativeFrames: async () => {
					const asset = editor.media.getAssets().find((item) => item.type === "video")!;
					const resources = editor.media.getPreviewResources();
					const requests = [0, 0.4].map((time) => resources.acquire({ file: asset.file, projectId: id, time }));
					try { return await Promise.all(requests.map(async (request) => { const result = await request.promise; if (result.status !== "ready") return result.status; const bytes = await (await fetch(result.url)).arrayBuffer(); const hash = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(hash)).join(","); })); } finally { requests.forEach((request) => request.release()); }
				},
				previewFailureThenRecover: async () => {
					const resources = editor.media.getPreviewResources();
					const bad = resources.acquire({ file: new File(["invalid"], "broken.mp4", { type: "video/mp4" }), projectId: id, time: 0 });
					const failed = (await bad.promise).status; bad.release();
					const asset = editor.media.getAssets().find((item) => item.type === "video")!;
					const good = resources.acquire({ file: asset.file, projectId: id, time: 0.2 });
					const recovered = (await good.promise).status; good.release(); return { failed, recovered };
				},
				previewDiagnostic: async () => { const asset = editor.media.getAssets().find((item) => item.type === "video")!; const request = editor.media.getPreviewResources().acquire({ file: asset.file, projectId: id, time: 0 }); try { return await request.promise; } finally { request.release(); } },
				insertNativeVideo: async () => { const asset = editor.media.getAssets().find((item) => item.type === "video")!; const main = editor.scenes.getActiveScene().tracks.main; editor.timeline.insertElement({ element: buildElementFromMedia({ mediaId: asset.id, mediaType: "video", name: asset.name, duration: mediaTimeFromSeconds({ seconds: 0.6 }), startTime: mediaTime({ ticks: 0 }) }), placement: { mode: "explicit", trackId: main.id } }); for (let attempt = 0; attempt < 50; attempt++) { const clip = editor.scenes.getActiveScene().tracks.main.elements.find((item) => item.type === "video"); if (clip) { editor.selection.setSelectedElements({ elements: [{ trackId: main.id, elementId: clip.id }] }); return; } await new Promise((resolve) => setTimeout(resolve, 20)); } throw new Error("视频片段入轨未完成"); },
				getNativeReverse: () => { const clip = editor.scenes.getActiveScene().tracks.main.elements.find((item) => item.type === "video"); return clip?.type === "video" ? clip.retime : undefined; },
				reverseSupport: () => isVideoReverseSupported(),
				reverseFrameProbe: async () => {
					const sourceDuration = mediaTimeFromSeconds({ seconds: 0.6 }); const trimStart = mediaTimeFromSeconds({ seconds: 0.1 }); const clipDuration = mediaTimeFromSeconds({ seconds: 0.2 }); const clipTime = mediaTimeFromSeconds({ seconds: 0.05 });
					const sourceTime = resolveVideoSourceTime({ clipTime, clipDuration, trimStart, playbackRate: 2, sourceDuration, reverse: true });
					const freezeTime = planVideoFreezeFrame({ playhead: clipTime, clipStart: mediaTime({ ticks: 0 }), clipDuration, trimStart, playbackRate: 2, sourceDuration, reverse: true });
					return { sourceTime, freezeTime, expected: mediaTimeFromSeconds({ seconds: 0.4 }) };
				},
				changeBridge: () => { setBridge(makeBridge(true)); setTimeout(() => { snapshot = content("B"); setBridge(makeBridge()); }, 20); },
			} });
			if (!active) { await owned.dispose(); return; }
			setBridge(makeBridge()); setSession(owned);
		})().catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : String(failure)); });
		return () => { active = false; if (owned) void owned.dispose(); };
	}, [annotationFixture]);
	if (error) return <pre role="alert">{error}</pre>;
	return <ThemeProvider attribute="class" defaultTheme="dark"><TooltipProvider><main style={{ height: "100dvh" }} data-testid="workspace-harness">{session && <EditorSessionProvider session={session}><CreatorWorkspaceProvider bridge={bridge}>{annotationFixture && <AnnotationFixtureSave bridge={bridge} />}<SessionEditorSurface focusMode="focused" hostOwnsChrome /></CreatorWorkspaceProvider></EditorSessionProvider>}</main></TooltipProvider></ThemeProvider>;
}
