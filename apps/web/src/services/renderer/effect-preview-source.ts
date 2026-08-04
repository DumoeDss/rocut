import type { AssetResolver } from "@/editor/ports";
import { createCanvasSurface } from "./canvas-utils";

const PREVIEW_IMAGE_REF = { path: "effects/preview.jpg" } as const;

/**
 * Resolver-scoped path, image and source-canvas state for effect thumbnails.
 * The GPU/effect registry stays in `effect-preview.ts`; this narrow acquisition
 * object is deliberately importable by C4 isolation tests without initializing
 * the renderer graph.
 */
export class EffectPreviewSource {
	private testSourceCanvas: OffscreenCanvas | null = null;
	private previewImageElement: HTMLImageElement | null = null;
	private onReadyCallbacks = new Set<() => void>();
	private loadGeneration = 0;

	constructor(readonly previewImageUrl: string) {
		this.loadPreviewImage();
	}

	onReady({ callback }: { callback: () => void }): () => void {
		this.onReadyCallbacks.add(callback);
		return () => this.onReadyCallbacks.delete(callback);
	}

	dispose(): void {
		this.releaseMediaState();
		this.onReadyCallbacks.clear();
	}

	reset(): void {
		this.releaseMediaState();
		this.loadPreviewImage();
	}

	private releaseMediaState(): void {
		this.loadGeneration += 1;
		this.testSourceCanvas = null;
		if (this.previewImageElement) {
			this.previewImageElement.onload = null;
			this.previewImageElement.onerror = null;
			this.previewImageElement.src = "";
		}
		this.previewImageElement = null;
	}

	getTestSource({
		width,
		height,
	}: {
		width: number;
		height: number;
	}): OffscreenCanvas | null {
		if (
			!this.testSourceCanvas ||
			this.testSourceCanvas.width !== width ||
			this.testSourceCanvas.height !== height
		) {
			this.testSourceCanvas = this.createTestSource({ width, height });
		}
		return this.testSourceCanvas;
	}

	private loadPreviewImage(): void {
		if (typeof window === "undefined") return;
		const generation = ++this.loadGeneration;
		const image = new Image();
		image.onload = () => {
			if (
				generation !== this.loadGeneration ||
				this.previewImageElement !== image
			) {
				return;
			}
			this.testSourceCanvas = null;
			for (const callback of this.onReadyCallbacks) callback();
		};
		image.onerror = () => {
			if (
				generation === this.loadGeneration &&
				this.previewImageElement === image
			) {
				this.previewImageElement = null;
			}
		};
		image.src = this.previewImageUrl;
		this.previewImageElement = image;
	}

	private createTestSource({
		width,
		height,
	}: {
		width: number;
		height: number;
	}): OffscreenCanvas | null {
		const isImageReady =
			this.previewImageElement?.complete &&
			(this.previewImageElement.naturalWidth ?? 0) > 0;
		if (!isImageReady || !this.previewImageElement) return null;

		const { canvas, context } = createCanvasSurface({ width, height });
		context.drawImage(this.previewImageElement, 0, 0, width, height);
		return canvas;
	}
}

const sources = new WeakMap<object, EffectPreviewSource>();

export function getEffectPreviewSource({
	resolver,
}: {
	resolver: AssetResolver;
}): EffectPreviewSource {
	let source = sources.get(resolver as object);
	if (!source) {
		source = new EffectPreviewSource(
			resolver.resolve({ ref: PREVIEW_IMAGE_REF }),
		);
		sources.set(resolver as object, source);
	}
	return source;
}

export function releaseEffectPreviewSource({
	resolver,
	source,
}: {
	resolver: AssetResolver;
	source: EffectPreviewSource;
}): void {
	const key = resolver as object;
	if (sources.get(key) !== source) return;
	sources.delete(key);
	source.dispose();
}

// C6 owns deterministic image/canvas disposal. C4 only prevents one resolver
// identity from poisoning another resolver's path-sensitive source state.
