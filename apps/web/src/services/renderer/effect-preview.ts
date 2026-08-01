import { effectsRegistry, resolveEffectPasses } from "@/effects";
import { buildDefaultParamValues } from "@/params/registry";
import type { ParamValues } from "@/params";
import { gpuRenderer } from "./gpu-renderer";
import type { AssetResolver } from "@/editor/ports";
import {
	getEffectPreviewSource,
	type EffectPreviewSource,
} from "./effect-preview-source";

const PREVIEW_SIZE = 160;
export class EffectPreviewService {
	readonly PREVIEW_SIZE = PREVIEW_SIZE;

	constructor(private readonly source: EffectPreviewSource) {}

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

const services = new WeakMap<object, EffectPreviewService>();

export function getEffectPreviewService({
	resolver,
}: {
	resolver: AssetResolver;
}): EffectPreviewService {
	let service = services.get(resolver as object);
	if (!service) {
		service = new EffectPreviewService(getEffectPreviewSource({ resolver }));
		services.set(resolver as object, service);
	}
	return service;
}

// C6 owns deterministic image/canvas/service disposal. C4 intentionally limits
// this cache to resolver identity so one Host base can never poison another.
