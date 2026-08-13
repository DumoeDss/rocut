import { effectsRegistry, resolveEffectPasses } from "@/effects";
import { buildDefaultParamValues } from "@/params/registry";
import type { ParamValues } from "@/params";
import { gpuRenderer } from "./gpu-renderer";
import type { AssetResolver } from "@opencut/editor-ports";
import {
	getEffectPreviewSource,
	releaseEffectPreviewSource,
	type EffectPreviewSource,
} from "./effect-preview-source";

const PREVIEW_SIZE = 160;
export class EffectPreviewService {
	readonly PREVIEW_SIZE = PREVIEW_SIZE;

	constructor(private readonly source: EffectPreviewSource) {}

	dispose(): void {
		this.source.dispose();
	}

	reset(): void {
		this.source.reset();
	}

	get previewImageUrl(): string {
		return this.source.previewImageUrl;
	}

	onPreviewImageReady({ callback }: { callback: () => void }): () => void {
		return this.source.onReady({ callback });
	}

	renderPreview({
		effectType,
		params,
		targetCanvas,
		uniformDimensions,
		isDegraded = false,
	}: {
		effectType: string;
		params: ParamValues;
		targetCanvas: HTMLCanvasElement;
		uniformDimensions?: { width: number; height: number };
		isDegraded?: boolean;
	}): void {
		const size = PREVIEW_SIZE;
		const targetCtx = targetCanvas.getContext(
			"2d",
		) as CanvasRenderingContext2D | null;
		if (!targetCtx) {
			return;
		}

		targetCanvas.width = size;
		targetCanvas.height = size;
		if (isDegraded) {
			targetCtx.clearRect(0, 0, size, size);
			return;
		}

		const source = this.source.getTestSource({ width: size, height: size });
		if (!source) {
			targetCtx.clearRect(0, 0, size, size);
			return;
		}

		try {
			const definition = effectsRegistry.get(effectType);
			const resolvedParams =
				Object.keys(params).length > 0
					? params
					: buildDefaultParamValues(definition.params);

			const passes = resolveEffectPasses({
				definition,
				effectParams: resolvedParams,
				width: uniformDimensions?.width ?? size,
				height: uniformDimensions?.height ?? size,
			});
			const result = this.applyGpuEffect({
				source,
				width: size,
				height: size,
				passes,
			});

			targetCtx.drawImage(result, 0, 0, size, size);
		} catch (error) {
			console.warn("Failed to render effect preview", { effectType, error });
			targetCtx.clearRect(0, 0, size, size);
			targetCtx.drawImage(source, 0, 0, size, size);
		}
	}

	private applyGpuEffect({
		source,
		width,
		height,
		passes,
	}: {
		source: OffscreenCanvas;
		width: number;
		height: number;
		passes: ReturnType<typeof resolveEffectPasses>;
	}): OffscreenCanvas {
		return gpuRenderer.applyEffect({
			source,
			width,
			height,
			passes,
		});
	}
}

interface EffectPreviewEntry {
	readonly service: EffectPreviewService;
	readonly source: EffectPreviewSource;
	owners: number;
}

const services = new WeakMap<object, EffectPreviewEntry>();

export function acquireEffectPreviewService({
	resolver,
}: {
	resolver: AssetResolver;
}): EffectPreviewService {
	let entry = services.get(resolver as object);
	if (!entry) {
		const source = getEffectPreviewSource({ resolver });
		entry = {
			service: new EffectPreviewService(source),
			source,
			owners: 0,
		};
		services.set(resolver as object, entry);
	}
	entry.owners += 1;
	return entry.service;
}

export function releaseEffectPreviewService({
	resolver,
}: {
	resolver: AssetResolver;
}): void {
	const key = resolver as object;
	const entry = services.get(key);
	if (!entry) return;
	entry.owners = Math.max(0, entry.owners - 1);
	if (entry.owners !== 0) return;
	services.delete(key);
	releaseEffectPreviewSource({ resolver, source: entry.source });
}

export function resetEffectPreviewService({
	resolver,
}: {
	resolver: AssetResolver;
}): void {
	services.get(resolver as object)?.service.reset();
}

// C6 owns deterministic image/canvas/service disposal. C4 intentionally limits
// this cache to resolver identity so one Host base can never poison another.
