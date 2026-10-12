import {
	buildDefaultEffectInstance,
	effectsRegistry,
	resolveEffectPasses,
} from "../../effects";
import type { ParamValues } from "../../params";
import { gpuRenderer } from "./gpu-renderer";
import type { BlazeNativeOutput, NativeBlazePng } from "./blaze-native-output";
import type { AssetResolver } from "@opencut/editor-ports";
import {
	getEffectPreviewSource,
	releaseEffectPreviewSource,
	type EffectPreviewSource,
} from "./effect-preview-source";

const PREVIEW_SIZE = 160;
export class EffectPreviewService {
	readonly PREVIEW_SIZE = PREVIEW_SIZE;
    private pngOutput: BlazeNativeOutput | undefined;
    private disposed = false;

	constructor(private readonly source: EffectPreviewSource) {}

	dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.pngOutput) void this.pngOutput.dispose().finally(() => this.source.dispose()).catch(error => console.warn("Native Blaze output retirement failed", error));
        else this.source.dispose();
	}

	reset(): void {
        this.pngOutput?.cancel();
		this.source.reset();
	}

    /** Lossless production effect PNG: native straight pixels never traverse the
     * preview/display Canvas. This does not claim timeline/codec export parity. */
    async exportEffectPng({ effectType, params, source, width, height, localTime = 0, frameRate = { numerator: 30, denominator: 1 }, signal }: { effectType: "blaze"; params: ParamValues; source: OffscreenCanvas; width: number; height: number; localTime?: number; frameRate?: { numerator: number; denominator: number }; signal?: AbortSignal }): Promise<NativeBlazePng> {
        if (this.disposed) throw new Error("Effect preview service is disposed.");
        if (effectType !== "blaze") throw new Error("Native effect PNG currently supports Blaze only.");
        const definition = effectsRegistry.get(effectType);
        const effectParams = Object.keys(params).length > 0 ? params : buildDefaultEffectInstance({ effectType }).params;
        const passes = resolveEffectPasses({ definition, effectParams, width, height, frame: { localTime, frameRate } });
        const owner = this.pngOutput ??= gpuRenderer.createBlazeOutputOwner();
        return owner.exportPng({ source, width, height, passes, signal });
    }

    drainEffectOutput(): Promise<void> { return this.pngOutput?.drain() ?? Promise.resolve(); }

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
					: buildDefaultEffectInstance({ effectType }).params;

			const passes = resolveEffectPasses({
				definition,
				effectParams: resolvedParams,
				width: uniformDimensions?.width ?? size,
				height: uniformDimensions?.height ?? size,
				frame: { localTime: 0, frameRate: { numerator: 30, denominator: 1 } },
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
