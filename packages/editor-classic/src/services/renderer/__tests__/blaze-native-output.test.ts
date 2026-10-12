import { expect, test } from "bun:test";
import { BlazeNativeOutput, type BlazeOutputAbi, type NativeBlazePng } from "../blaze-native-output";
const source = { getContext: () => { throw new Error("Canvas inverse readback is forbidden"); } } as unknown as OffscreenCanvas;
const params = { source, width: 2, height: 1, passes: [{ shader: "blaze", uniforms: { u: 1 } }] };
const result = (requestId = 1): NativeBlazePng => ({ png: new Uint8Array([137,80,78,71,13,10,26,10,1,2]), width: 2, height: 1, requestId, generation: 1, peakBytes: 2048, format: "rgba8unorm", alphaMode: "straight", colorSpace: "srgb", mimeType: "image/png", backend: "webgl" });
function fake() {
    let finish!: (value: NativeBlazePng) => void;
    const calls: string[] = [];
    let pending = false;
    const native: BlazeOutputAbi = { renderPng: options => { calls.push("render:" + options.requestId); pending = true; return new Promise(resolve => { finish = value => { pending = false; resolve(value); }; }); }, cancel: () => { calls.push("cancel"); }, dispose: () => { calls.push("dispose"); }, pending: () => pending, free: () => { calls.push("free"); } };
    return { native, calls, finish: (value = result()) => finish(value) };
}
test("native PNG bytes and straight color/alpha contract reach the consumer without Canvas", async () => {
    const f = fake(), owner = new BlazeNativeOutput(() => f.native), job = owner.exportPng(params); const png = result(); f.finish(png);
    expect(await job).toBe(png); await owner.dispose(); expect(f.calls).toEqual(["render:1", "dispose", "free"]);
});
test("abort/stale owner waits for actual native drain before freeing", async () => {
    const f = fake(), owner = new BlazeNativeOutput(() => f.native), abort = new AbortController();
    const job = owner.exportPng({ ...params, signal: abort.signal });
    await expect(owner.exportPng(params)).rejects.toThrow("drain"); abort.abort();
    const retired = owner.dispose(); expect(f.calls).toEqual(["render:1", "cancel", "dispose"]);
    f.finish(); await expect(job).rejects.toMatchObject({ name: "AbortError" }); await retired; expect(f.calls.at(-1)).toBe("free");
    await expect(owner.exportPng(params)).rejects.toThrow("disposed");
});
test("malformed identity alpha color budget and PNG bytes fail closed", async () => {
    for (const patch of [{ requestId: 2 }, { alphaMode: "premultiplied" }, { colorSpace: "display-p3" }, { peakBytes: 64 * 1024 * 1024 + 1 }, { png: new Uint8Array(8) }, { width: 3 }]) {
        const f = fake(), owner = new BlazeNativeOutput(() => f.native), job = owner.exportPng(params); f.finish({ ...result(), ...patch } as NativeBlazePng);
        await expect(job).rejects.toThrow("contract"); await owner.dispose();
    }
});
test("cancelled output cannot publish and neutral bypass remains supported", async () => {
    const f = fake(), owner = new BlazeNativeOutput(() => f.native), first = owner.exportPng(params); owner.cancel(); f.finish(); await expect(first).rejects.toMatchObject({ name: "AbortError" }); await owner.drain();
    const second = owner.exportPng({ ...params, passes: [] }); f.finish(result(2)); expect((await second).requestId).toBe(2); await owner.dispose();
});
test("other effects and preaborted jobs never allocate a native owner", async () => {
    const owner = new BlazeNativeOutput(() => { throw Error("must not allocate"); }); const abort = new AbortController(); abort.abort();
    await expect(owner.exportPng({ ...params, signal: abort.signal })).rejects.toMatchObject({ name: "AbortError" });
    await expect(owner.exportPng({ ...params, passes: [{ shader: "frost", uniforms: {} }] })).rejects.toThrow("Blaze pass"); await owner.dispose();
});
