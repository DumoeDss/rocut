import type { EditorCore } from "..";
import type { RootNode } from "../../services/renderer/nodes/root-node";
import type { ExportOptions, ExportResult } from "../../export";
import {
	CanvasRenderer,
	type RendererPublicationGuard,
	type RendererPublicationToken,
} from "../../services/renderer/canvas-renderer";
import { WasmCompositor } from "../../services/renderer/compositor/wasm-compositor";
import type { SessionResources } from "../../editor/session/resources";
import { SceneExporter } from "../../services/renderer/scene-exporter";
import { buildScene } from "../../services/renderer/scene-builder";
import { createTimelineAudioBuffer } from "../../media/audio";
import { formatTimecode } from "opencut-wasm";
import { downloadBlob } from "../../utils/browser";
import type { AssetResolver } from "@opencut/editor-ports";
import type { VideoCache } from "../../services/video-cache/service";
import { resetEffectPreviewService } from "../../services/renderer/effect-preview";
import { SessionActivityGenerationError } from "../../editor/session/session-resources";

interface RendererActivityLifecycle {
	getActivityGeneration(): number;
	assertActivityGeneration(args: { generation: number }): void;
}

class RendererExporterTerminalError extends Error {
	readonly exporterIndex: number;
	override readonly cause: unknown;

	constructor({
		exporterIndex,
		cause,
	}: {
		exporterIndex: number;
		cause: unknown;
	}) {
		super(`Renderer exporter ${exporterIndex} failed during terminal drain.`);
		this.name = "RendererExporterTerminalError";
		this.exporterIndex = exporterIndex;
		this.cause = cause;
	}
}

function throwRendererLifecycleErrors({
	results,
	message,
}: {
	results: PromiseSettledResult<unknown>[];
	message: string;
}): void {
	const errors = results.flatMap((result) =>
		result.status === "rejected" ? [result.reason] : [],
	);
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) throw new AggregateError(errors, message);
}

function hasActivityLifecycle(
	resources: SessionResources,
): resources is SessionResources & RendererActivityLifecycle {
	return (
		"getActivityGeneration" in resources &&
		typeof resources.getActivityGeneration === "function" &&
		"assertActivityGeneration" in resources &&
		typeof resources.assertActivityGeneration === "function"
	);
}

function resolveActivityLifecycle(
	resources: SessionResources,
): RendererActivityLifecycle {
	if (!hasActivityLifecycle(resources)) {
		throw new Error(
			"RendererManager requires session activity-generation controls.",
		);
	}
	return resources;
}

interface RendererPublication {
	guard: RendererPublicationGuard;
	token: RendererPublicationToken;
}

type SnapshotResult =
	| {
			success: true;
			blob: Blob;
			filename: string;
			publication: RendererPublication;
	  }
	| { success: false; error: string };

export const RASTERIZER_UNAVAILABLE_ERROR =
	"Renderer unavailable: this environment has no rasterizer";

export class RendererManager {
	private renderTree: RootNode | null = null;
	private _isDegraded = false;
	private listeners = new Set<() => void>();
	private readonly editor: EditorCore;
	readonly assetResolver: AssetResolver;

	private readonly compositor: WasmCompositor;
	private readonly videoCache: VideoCache;
	private readonly activityLifecycle: RendererActivityLifecycle;
	private publicationGeneration = 0;
	private readonly activeExporters = new Set<SceneExporter>();

	constructor({
		editor,
		resources,
		assetResolver,
		videoCache,
	}: {
		editor: EditorCore;
		resources: SessionResources;
		assetResolver: AssetResolver;
		videoCache: VideoCache;
	}) {
		this.editor = editor;
		this.assetResolver = assetResolver;
		this.activityLifecycle = resolveActivityLifecycle(resources);
		this.compositor = new WasmCompositor(resources);
		this.videoCache = videoCache;
	}

	createCanvasRenderer({
		width,
		height,
		fps,
	}: {
		width: number;
		height: number;
		fps: import("opencut-wasm").FrameRate;
	}): CanvasRenderer {
		return new CanvasRenderer({
			width,
			height,
			fps,
			compositor: this.compositor,
			videoCache: this.videoCache,
			publicationGuard: this.createPublicationGuard(),
		});
	}

	getCompositorHandle(): number | null {
		return this.compositor.handle;
	}

	get isDegraded(): boolean {
		return this._isDegraded;
	}

	setDegraded(degraded: boolean): void {
		if (this._isDegraded === degraded) return;
		this._isDegraded = degraded;
		this.notify();
	}

	setRenderTree({ renderTree }: { renderTree: RootNode | null }): void {
		this.renderTree = renderTree;
		this.notify();
	}

	async drainProjectLiveState(): Promise<void> {
		const results = await Promise.allSettled([
			this.invalidatePublications(),
			Promise.resolve().then(() => {
				this.renderTree = null;
				this.notify();
			}),
			Promise.resolve().then(() =>
				resetEffectPreviewService({ resolver: this.assetResolver }),
			),
		]);
		throwRendererLifecycleErrors({
			results,
			message: "Failed to drain renderer project owners.",
		});
	}

	async suspend(): Promise<void> {
		await this.invalidatePublications();
	}

	resume(): void {
		// Renderer work is demand-driven. Retained owners receive the session's
		// post-manager-ready resume publication and request a fresh frame there.
	}

	getRenderTree(): RootNode | null {
		return this.renderTree;
	}

	async saveSnapshot(): Promise<{ success: boolean; error?: string }> {
		try {
			const snapshot = await this.createSnapshot();
			if (!snapshot.success) return snapshot;
			snapshot.publication.guard.assertCurrent({
				token: snapshot.publication.token,
			});
			downloadBlob({
				blob: snapshot.blob,
				filename: snapshot.filename,
				resources: this.editor.resources,
			});
			return { success: true };
		} catch (error) {
			return this.snapshotFailure(error);
		}
	}

	async copySnapshot(): Promise<{ success: boolean; error?: string }> {
		if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
			return {
				success: false,
				error: "Clipboard image copy is not supported in this browser",
			};
		}

		try {
			const snapshot = await this.createSnapshot();
			if (!snapshot.success) return snapshot;
			snapshot.publication.guard.assertCurrent({
				token: snapshot.publication.token,
			});
			await navigator.clipboard.write([
				new ClipboardItem({
					[snapshot.blob.type || "image/png"]: snapshot.blob,
				}),
			]);
			snapshot.publication.guard.assertCurrent({
				token: snapshot.publication.token,
			});
			return { success: true };
		} catch (error) {
			return this.snapshotFailure(error);
		}
	}

	private async createSnapshot(): Promise<SnapshotResult> {
		const publication = this.capturePublication();
		if (this.isDegraded) {
			return { success: false, error: RASTERIZER_UNAVAILABLE_ERROR };
		}

		try {
			publication.guard.assertCurrent({ token: publication.token });
			const renderTree = this.getRenderTree();
			const activeProject = this.editor.project.getActive();

			if (!renderTree || !activeProject) {
				return { success: false, error: "No project or scene to capture" };
			}

			const duration = this.editor.timeline.getTotalDuration();
			if (duration === 0) {
				return { success: false, error: "Project is empty" };
			}

			const { canvasSize, fps } = activeProject.settings;
			const renderTime = Math.min(
				this.editor.playback.getCurrentTime(),
				this.editor.timeline.getLastFrameTime(),
			);

			const renderer = this.createCanvasRenderer({
				width: canvasSize.width,
				height: canvasSize.height,
				fps,
			});

			const tempCanvas = document.createElement("canvas");
			tempCanvas.width = canvasSize.width;
			tempCanvas.height = canvasSize.height;

			await renderer.renderToCanvas({
				node: renderTree,
				time: renderTime,
				targetCanvas: tempCanvas,
			});
			publication.guard.assertCurrent({ token: publication.token });

			const blob = await new Promise<Blob | null>((resolve) => {
				tempCanvas.toBlob((result) => resolve(result), "image/png");
			});
			publication.guard.assertCurrent({ token: publication.token });

			if (!blob) {
				return { success: false, error: "Failed to create image" };
			}

			const timecode = formatTimecode({ time: renderTime, rate: fps })!.replace(
				/:/g,
				"-",
			);
			const safeName =
				activeProject.metadata.name.replace(/[<>:"/\\|?*]/g, "-").trim() ||
				"snapshot";
			const filename = `${safeName}-${timecode}.png`;

			return { success: true, blob, filename, publication };
		} catch (error) {
			if (!(error instanceof SessionActivityGenerationError)) {
				console.error("Snapshot capture failed:", error);
			}
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	async exportProject({
		options,
		onProgress,
		onCancel,
	}: {
		options: ExportOptions;
		onProgress?: ({ progress }: { progress: number }) => void;
		onCancel?: () => boolean;
	}): Promise<ExportResult> {
		if (this.isDegraded) {
			return { success: false, error: RASTERIZER_UNAVAILABLE_ERROR };
		}

		const { format, quality, fps, includeAudio } = options;
		const publication = this.capturePublication();

		try {
			publication.guard.assertCurrent({ token: publication.token });
			const tracks = this.editor.scenes.getActiveScene().tracks;
			const mediaAssets = this.editor.media.getAssets();
			const activeProject = this.editor.project.getActive();

			if (!activeProject) {
				return { success: false, error: "No active project" };
			}

			const duration = this.editor.timeline.getTotalDuration();
			if (duration === 0) {
				return { success: false, error: "Project is empty" };
			}

			const exportFps = fps ?? activeProject.settings.fps;
			const canvasSize = activeProject.settings.canvasSize;

			let audioBuffer: AudioBuffer | null = null;
			if (includeAudio) {
				publication.guard.assertCurrent({ token: publication.token });
				onProgress?.({ progress: 0.05 });
				audioBuffer = await createTimelineAudioBuffer({
					tracks,
					mediaAssets,
					duration,
					resources: this.editor.resources,
				});
				publication.guard.assertCurrent({ token: publication.token });
			}

			const scene = buildScene({
				tracks,
				mediaAssets,
				duration,
				canvasSize,
				background: activeProject.settings.background,
				assetResolver: this.assetResolver,
			});

			const exporter = new SceneExporter({
				width: canvasSize.width,
				height: canvasSize.height,
				fps: exportFps,
				format,
				quality,
				shouldIncludeAudio: !!includeAudio,
				audioBuffer: audioBuffer || undefined,
				compositor: this.compositor,
				videoCache: this.videoCache,
				publicationGuard: publication.guard,
			});
			this.activeExporters.add(exporter);

			try {
				exporter.on("progress", (progress) => {
					publication.guard.assertCurrent({ token: publication.token });
					const adjustedProgress = includeAudio
						? 0.05 + progress * 0.95
						: progress;
					onProgress?.({ progress: adjustedProgress });
				});

				let cancelled = false;
				const checkCancel = () => {
					if (onCancel?.()) {
						cancelled = true;
						void exporter.cancel();
					}
				};

				const cancelInterval = this.editor.resources.setInterval({
					handler: checkCancel,
					ms: 100,
				});

				try {
					const buffer = await exporter.export({ rootNode: scene });
					publication.guard.assertCurrent({ token: publication.token });

					if (cancelled) {
						return { success: false, cancelled: true };
					}

					if (!buffer) {
						return { success: false, error: "Export failed to produce buffer" };
					}

					return {
						success: true,
						buffer,
					};
				} finally {
					cancelInterval.cancel();
				}
			} finally {
				this.activeExporters.delete(exporter);
			}
		} catch (error) {
			if (!(error instanceof SessionActivityGenerationError)) {
				console.error("Export failed:", error);
			}
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown export error",
			};
		}
	}

	async dispose(): Promise<void> {
		const results = await Promise.allSettled([this.invalidatePublications()]);
		const ownerResults = await Promise.allSettled([
			Promise.resolve().then(() => this.compositor.dispose()),
			Promise.resolve().then(() => this.listeners.clear()),
		]);
		throwRendererLifecycleErrors({
			results: [...results, ...ownerResults],
			message: "Failed to dispose renderer owners.",
		});
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}

	private createPublicationGuard(): RendererPublicationGuard {
		return {
			capture: () => ({
				activityGeneration: this.activityLifecycle.getActivityGeneration(),
				ownerGeneration: this.publicationGeneration,
			}),
			assertCurrent: ({ token }) => {
				this.activityLifecycle.assertActivityGeneration({
					generation: token.activityGeneration,
				});
				if (token.ownerGeneration !== this.publicationGeneration) {
					throw new SessionActivityGenerationError({
						expectedGeneration: token.ownerGeneration,
						actualGeneration: this.publicationGeneration,
					});
				}
			},
		};
	}

	private capturePublication(): {
		guard: RendererPublicationGuard;
		token: RendererPublicationToken;
	} {
		const guard = this.createPublicationGuard();
		return { guard, token: guard.capture() };
	}

	private async invalidatePublications(): Promise<void> {
		this.publicationGeneration += 1;
		const exporters = [...this.activeExporters];
		const results = await Promise.allSettled(
			exporters.map(async (exporter, exporterIndex) => {
				try {
					await exporter.cancel();
				} catch (cause) {
					if (cause instanceof SessionActivityGenerationError) return;
					throw new RendererExporterTerminalError({
						exporterIndex,
						cause,
					});
				}
			}),
		);
		throwRendererLifecycleErrors({
			results,
			message: "Failed to settle active renderer exporters.",
		});
	}

	private snapshotFailure(error: unknown): SnapshotResult {
		if (!(error instanceof SessionActivityGenerationError)) {
			console.error("Snapshot capture failed:", error);
		}
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
		};
	}
}
