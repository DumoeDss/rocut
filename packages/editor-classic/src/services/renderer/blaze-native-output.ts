import * as wasm from "opencut-wasm";
import type { EffectPass } from "../../effects/types";

export interface NativeBlazePng {
    png: Uint8Array;
    width: number;
    height: number;
    requestId: number;
    generation: number;
    peakBytes: number;
    format: "rgba8unorm";
    alphaMode: "straight";
    colorSpace: "srgb";
    mimeType: "image/png";
    backend: "webgl" | "webgpu";
}
export interface BlazeOutputAbi {
    renderPng(options: { source: OffscreenCanvas; width: number; height: number; requestId: number; passes: { shader: string; uniforms: { name: string; value: number[] }[] }[] }): Promise<NativeBlazePng>;
    cancel(): void;
    dispose(): void;
    pending(): boolean;
    free(): void;
}
export function createBlazeOutputAbi(): BlazeOutputAbi {
    const Constructor = Reflect.get(wasm, "BlazeOutputOwner");
    if (typeof Constructor !== "function") throw new Error("The normal WASM package does not support native Blaze PNG output.");
    return new Constructor() as BlazeOutputAbi;
}
function cancelled(): Error { const error = new Error("Native Blaze output is stale or cancelled"); error.name = "AbortError"; return error; }

/** A production output owner, not a displayCanvas readback or diagnostic adapter. */
export class BlazeNativeOutput {
    private native: BlazeOutputAbi | undefined;
    private nextRequest = 0;
    private generation = 0;
    private disposed = false;
    private active: Promise<NativeBlazePng> | undefined;
    private retirement: Promise<void> | undefined;
    constructor(private readonly createOwner: () => BlazeOutputAbi = createBlazeOutputAbi) {}

    exportPng({ source, width, height, passes, signal }: { source: OffscreenCanvas; width: number; height: number; passes: EffectPass[]; signal?: AbortSignal }): Promise<NativeBlazePng> {
        if (this.disposed) return Promise.reject(new Error("Blaze output owner is disposed."));
        if (signal?.aborted) return Promise.reject(cancelled());
        if (this.active) return Promise.reject(new Error("Blaze output must drain before another request."));
        if (passes.length > 1 || passes.some(pass => pass.shader !== "blaze")) return Promise.reject(new Error("Native Blaze output requires one Blaze pass or neutral bypass."));
        if (this.nextRequest >= 0xffff_ffff) return Promise.reject(new Error("Blaze output request identity exhausted."));
        const native = this.native ??= this.createOwner();
        const requestId = ++this.nextRequest;
        const generation = ++this.generation;
        const onAbort = () => { ++this.generation; native.cancel(); };
        signal?.addEventListener("abort", onAbort, { once: true });
        const job = (async () => {
            try {
                // The normal Rust ABI performs checked dimensions,64MiB joint peak
                // admission, pass validation and texture copy before returning.
                const result = await native.renderPng({ source, width, height, requestId, passes: passes.map(pass => ({ shader: pass.shader, uniforms: Object.entries(pass.uniforms).map(([name, value]) => ({ name, value: typeof value === "number" ? [value] : value })) })) });
                if (this.disposed || generation !== this.generation || signal?.aborted) throw cancelled();
                if (result.width !== width || result.height !== height || result.requestId !== requestId || !Number.isSafeInteger(result.generation) || result.generation < 1 || result.alphaMode !== "straight" || result.colorSpace !== "srgb" || result.format !== "rgba8unorm" || result.mimeType !== "image/png" || !["webgl", "webgpu"].includes(result.backend) || !Number.isSafeInteger(result.peakBytes) || result.peakBytes <= 0 || result.peakBytes > 64 * 1024 * 1024 || !(result.png instanceof Uint8Array) || result.png.length < 8 || result.png.length > result.peakBytes || ![137,80,78,71,13,10,26,10].every((byte, i) => result.png[i] === byte)) throw new TypeError("Native Blaze PNG output violated its identity/pixel contract.");
                return result;
            } finally { signal?.removeEventListener("abort", onAbort); }
        })();
        this.active = job;
        void job.finally(() => { if (this.active === job) this.active = undefined; }).catch(() => {});
        return job;
    }
    cancel(): void { ++this.generation; this.native?.cancel(); }
    async drain(): Promise<void> { if (this.active) await this.active.then(() => {}, () => {}); }
    dispose(): Promise<void> {
        if (this.retirement) return this.retirement;
        this.disposed = true; ++this.generation; this.native?.dispose();
        return this.retirement = this.drain().then(() => { if (this.native?.pending()) throw new Error("Native Blaze owner did not drain."); this.native?.free(); this.native = undefined; });
    }
}
