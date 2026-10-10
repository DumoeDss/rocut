import * as wasm from "opencut-wasm";
import { isProgrammaticResource, type ProgrammaticResource } from "../../../../../editor-contracts/src/programmatic-resources";
import type { MvTrain, MvTrainPlan } from "../../../../../editor-contracts/src/mv-train";
import type { MvWetFloor, MvWetFloorPlan } from "../../../../../editor-contracts/src/mv-wet-floor";
import type { ReferencePostPlan } from "../../../../../editor-contracts/src/mv-reference-post";
import type { MvLutAtlasPlan, MvLutAtlasRowSample } from "../../../../../editor-contracts/src/mv-lut-atlas";
import { renderTrainScene } from "./mv-train";
import { renderWetFloor } from "./mv-wet-floor";
import { renderReferencePost } from "./mv-reference-post";
import { renderLutAtlas, readLutAtlasRow, releaseLutAtlas, type NativeLutAtlas } from "./mv-lut-atlas";

export interface NightOwner {
    preflight(metadata: string, length: number): void;
    prepare(metadata: string, bytes: Uint8Array): unknown;
    bindDecoded(id: number, facts: string): void;
    bindReflection(id: number, rgba: Uint8Array): unknown;
    prepareLut(metadata: string, bytes: Uint8Array): unknown;
    bindLutRow(rgba: Uint8Array): unknown;
    evaluate(id: number, sample: string): unknown;
    releaseFrame(id: number): void;
    dispose(id: number): void;
    clear(): void;
    diagnostic(): unknown;
    free(): void;
}
export type NightBinding =
    | { readonly scene: "wetFloor"; readonly settings: MvWetFloor }
    | { readonly scene: "train"; readonly settings: MvTrain };
export interface NightBytes {
    readonly resource: ProgrammaticResource;
    readonly bytes: ArrayBuffer;
}
export interface NightFontInstance {
    readonly id: string;
    readonly resourceId: string;
    readonly weight: number;
    readonly axes: Readonly<Record<string, number>>;
}
export interface NightPrepared {
    readonly sessionId: number;
    readonly scene: "wetFloor" | "train";
    readonly reflectionRequired: boolean;
    readonly postRequired: boolean;
    readonly reservedBytes: number;
    readonly decodeRequests: readonly { readonly resourceId: string; readonly width: number; readonly height: number }[];
    /** Owner-derived logical aliases, not the physical authored resource list. */
    readonly fontResources: readonly ProgrammaticResource[];
    readonly fontBindings: readonly NightFontInstance[];
    readonly fontInstanceBytes: number;
    readonly physicalEncodedBytes: number;
}
export interface NightFrame {
    readonly sessionId: number;
    readonly frameId: number;
    readonly scene: MvTrainPlan | MvWetFloorPlan;
    readonly postRequired: boolean;
    readonly post: ReferencePostPlan | null;
    readonly lut: { readonly alias: "P4"; readonly byteLength: 1024; readonly sampledSha256: string; readonly sample: MvLutAtlasRowSample } | null;
    readonly reservedBytes: number;
}
function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isNightAtlasPrepared(value: unknown): value is { plan: MvLutAtlasPlan; samples: { P4: MvLutAtlasRowSample } } {
    return record(value) && record(value.plan) && value.plan.profile === "original-lut-atlas-v1" && value.plan.version === 1 && Array.isArray(value.plan.rows) &&
        Array.isArray(value.plan.size) && value.plan.size[0] === 256 && value.plan.size[1] === 16 && typeof value.plan.atlasSha256 === "string" &&
        record(value.samples) && record(value.samples.P4) && value.samples.P4.atlasSha256 === value.plan.atlasSha256 && Array.isArray(value.samples.P4.rect);
}
function owner(value: unknown): value is NightOwner {
    return record(value) && ["preflight", "prepare", "bindDecoded", "bindReflection", "prepareLut", "bindLutRow", "evaluate", "releaseFrame", "dispose", "clear", "diagnostic", "free"].every(key => typeof value[key] === "function");
}
export function createNightOwner(): NightOwner {
    const constructor: unknown = Reflect.get(wasm, "MvNightOwner");
    if (typeof constructor !== "function") throw Error("Actual compiled WASM Night owner unavailable");
    const value: unknown = Reflect.construct(constructor, []);
    if (!owner(value)) throw Error("Actual WASM Night owner protocol unavailable");
    return value;
}
export function isNightPrepared(value: unknown): value is NightPrepared {
    return record(value) && Number.isInteger(value.sessionId) && typeof value.sessionId === "number" && value.sessionId > 0 &&
        ["wetFloor", "train"].includes(String(value.scene)) && typeof value.reflectionRequired === "boolean" && typeof value.postRequired === "boolean" &&
        typeof value.reservedBytes === "number" && Array.isArray(value.decodeRequests) && value.decodeRequests.every(f => record(f) && typeof f.resourceId === "string" && Number.isInteger(f.width) && Number.isInteger(f.height)) &&
        typeof value.fontInstanceBytes === "number" && typeof value.physicalEncodedBytes === "number" && Array.isArray(value.fontResources) && value.fontResources.every(f => isProgrammaticResource(f) && f.kind === "font") &&
        Array.isArray(value.fontBindings) && value.fontBindings.every(isNightFontInstance) && value.fontResources.length === value.fontBindings.length;
}
export function isNightFontInstance(value: unknown): value is NightFontInstance {
    return record(value) && typeof value.id === "string" && typeof value.resourceId === "string" && typeof value.weight === "number" && record(value.axes) && Object.values(value.axes).every(n => typeof n === "number");
}
/** This guard accepts only a response from the live opaque WASM owner. It is
 * transport shape validation, not an authored/native-admission substitution. */
export function isNightFrame(value: unknown): value is NightFrame {
    if (!record(value) || !Number.isInteger(value.sessionId) || !Number.isInteger(value.frameId) || !record(value.scene) || value.scene.version !== 1 ||
        !Array.isArray(value.scene.fontStacks) || !Array.isArray(value.scene.surfaces) || !Array.isArray(value.scene.operations) || typeof value.scene.songTicks !== "number" || typeof value.reservedBytes !== "number") return false;
    if (value.scene.profile === "night-wet-floor-v1") return value.postRequired === false && value.post === null && value.lut === null && ["fall", "count"].includes(String(value.scene.mode));
    return value.scene.profile === "night-train-v1" && record(value.scene.post) && value.scene.post.required === true && value.scene.post.lutA === "P4" &&
        value.postRequired === true && record(value.post) && value.post.profile === "tunnel-original-gl-v1" && value.post.required === true && value.post.lutAtlasRequired === true &&
        Array.isArray(value.post.passes) && value.post.passes.length === 15 && Array.isArray(value.post.targets) &&
        record(value.lut) && value.lut.alias === "P4" && value.lut.byteLength === 1024 && typeof value.lut.sampledSha256 === "string" && record(value.lut.sample);
}
function canvas({ width = 1920, height = 1080 }: { width?: number; height?: number } = {}): HTMLCanvasElement {
    const value = document.createElement("canvas"); value.width = width; value.height = height; return value;
}
async function digest(bytes: ArrayBuffer): Promise<string> {
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}
export interface NightNativeSession {
    readonly owner: NightOwner;
    readonly prepared: NightPrepared;
    readonly images: readonly { readonly resourceId: string; readonly image: ImageBitmap; readonly width: number; readonly height: number; readonly sha256: string }[];
    bindLut(input: { readonly metadata: string; readonly bytes: Uint8Array; readonly images: Parameters<typeof renderLutAtlas>[0]["images"] }): void;
    render(sample: { readonly songTicks: number; readonly shotStartTicks: number; readonly shotEndTicks: number }): Promise<{ readonly canvas: HTMLCanvasElement; readonly frame: NightFrame; release(): void }>;
    dispose(): void;
}
/** Actual byte packet -> Rust encoded/SFNT admission -> native decode -> Rust
 * decoded binding. No source/scene helper, palette parsing, timing or masking
 * is performed by this adapter. */
export async function prepareNightNative({ binding, beats, resources, fontInstances }: {
    readonly binding: NightBinding; readonly beats: readonly number[]; readonly resources: readonly NightBytes[]; readonly fontInstances: readonly NightFontInstance[];
}): Promise<NightNativeSession> {
    const native = createNightOwner();
    const images: { resourceId: string; image: ImageBitmap; width: number; height: number; sha256: string }[] = [];
    const faces: FontFace[] = [];
    let atlas: NativeLutAtlas | undefined, active: { canvas: HTMLCanvasElement; scene: HTMLCanvasElement; id: number } | undefined, disposed = false;
    try {
        binding = structuredClone(binding);
        fontInstances = structuredClone(fontInstances);
        resources = resources.map(source => ({ resource: structuredClone(source.resource), bytes: source.bytes }));
        let length = 0;
        const byteLayout = resources.map(({ resource, bytes }) => {
            const part = { resourceId: resource.id, offset: length, length: bytes.byteLength };
            length += bytes.byteLength; return part;
        });
        const metadata = JSON.stringify({ binding, resources: resources.map(r => r.resource), fontInstances, byteLayout, decodedImages: [], beats });
        native.preflight(metadata, length);
        const packet = new Uint8Array(length);
        resources.forEach(({ bytes }, index) => packet.set(new Uint8Array(bytes), byteLayout[index].offset));
        const prepared: unknown = native.prepare(metadata, packet);
        if (!isNightPrepared(prepared)) throw Error("Night actual native preparation response mismatch");
        const physicalFonts = new Map(resources.filter(r => r.resource.kind === "font").map(({ resource }) => {
            const part = byteLayout.find(p => p.resourceId === resource.id);
            if (!part) throw Error("Night font packet layout missing");
            return [resource.id, packet.slice(part.offset, part.offset + part.length).buffer] as const;
        }));
        // Bind each returned instance to its returned physical source. No
        // family/weight/axis expansion is performed or trusted on the TS side.
        const fontSources = new Map(prepared.fontBindings.map(instance => {
            const bytes = physicalFonts.get(instance.resourceId);
            if (!bytes || !prepared.fontResources.some(r => r.id === instance.id)) throw Error("Night owner-derived font source binding missing");
            return [instance.id, bytes] as const;
        }));
        physicalFonts.clear();
        for (const request of prepared.decodeRequests) {
            const index = resources.findIndex(r => r.resource.id === request.resourceId);
            if (index < 0) throw Error("Night encoded decode request resource missing");
            const part = byteLayout[index];
            const bytes = packet.slice(part.offset, part.offset + part.length);
            const bitmap = await createImageBitmap(new Blob([bytes], { type: resources[index].resource.mimeType }));
            images.push({ resourceId: request.resourceId, image: bitmap, width: bitmap.width, height: bitmap.height, sha256: resources[index].resource.sha256 });
        }
        native.bindDecoded(prepared.sessionId, JSON.stringify(images.map(({ resourceId, width, height }) => ({ resourceId, width, height }))));
        if (prepared.reflectionRequired) {
            const image = images.find(i => i.resourceId === binding.settings.bg);
            if (!image) throw Error("Night reflection decoded background unavailable");
            const sample = canvas({ width: 418, height: 235 });
            try {
                const context = sample.getContext("2d", { willReadFrequently: true });
                if (!context) throw Error("Night real native reflection readback unavailable");
                context.drawImage(image.image, 0, 0, 418, 235);
                native.bindReflection(prepared.sessionId, new Uint8Array(context.getImageData(0, 0, 418, 235).data));
            } finally { sample.width = sample.height = 1; }
        }
        function release(): void {
            if (!active) return;
            const current = active;
            current.canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
            current.canvas.width = current.canvas.height = current.scene.width = current.scene.height = 1;
            for (const face of faces.splice(0)) document.fonts.delete(face);
            active = undefined;
            native.releaseFrame(current.id);
        }
        return {
            owner: native, prepared, images,
            bindLut({ metadata, bytes, images: lutImages }) {
                if (disposed || active || atlas) throw Error("Night LUT/native lifecycle unavailable");
                const receipt: unknown = native.prepareLut(metadata, bytes);
                if (!isNightAtlasPrepared(receipt)) throw Error("Night actual native LUT response mismatch");
                atlas = renderLutAtlas({ plan: receipt.plan, images: lutImages });
                native.bindLutRow(new Uint8Array(readLutAtlasRow({ atlas, sample: receipt.samples.P4 })));
            },
            async render(sample) {
                if (disposed || active) throw Error("Night native session disposed/frame still live");
                const value: unknown = native.evaluate(prepared.sessionId, JSON.stringify(sample));
                if (!isNightFrame(value)) throw Error("Night actual native frame protocol mismatch");
                const scene = canvas();
                const output = value.postRequired ? canvas() : scene;
                active = { canvas: output, scene, id: value.frameId };
                try {
                    const fonts: { resourceId: string; face: FontFace }[] = [];
                    for (const stack of value.scene.fontStacks) {
                        for (let index = 0; index < 2; index++) {
                            const resource = stack.resources[index];
                            const bytes = fontSources.get(resource.id);
                            if (!bytes || !resource.font || await digest(bytes) !== resource.sha256) throw Error("Night native font bytes changed after admission");
                            const face = new FontFace(stack.aliases[index], bytes, {
                                weight: String(resource.font.weight), style: resource.font.style,
                                variationSettings: Object.entries(resource.font.axes ?? {}).map(([tag, number]) => `"${tag}" ${number}`).join(",") || "normal",
                            });
                            await face.load(); document.fonts.add(face); faces.push(face); fonts.push({ resourceId: resource.id, face });
                        }
                    }
                    if (value.scene.profile === "night-train-v1") {
                        if (!value.post || !value.lut || !atlas || atlas.atlasSha256 !== value.lut.sample.atlasSha256 ||
                            await digest(new Uint8Array(readLutAtlasRow({ atlas, sample: value.lut.sample })).buffer) !== value.lut.sampledSha256) throw Error("Train original P4 post binding unavailable/changed");
                        renderTrainScene({ canvas: scene, plan: value.scene, images, fonts });
                        renderReferencePost({ canvas: output, scene, lutAtlas: atlas.canvas, plan: value.post });
                    } else {
                        const image = images.find(i => i.resourceId === binding.settings.bg);
                        if (!image) throw Error("Night admitted background unavailable");
                        renderWetFloor({ canvas: scene, plan: value.scene, image, fonts });
                    }
                    return { canvas: output, frame: value, release };
                } catch (error) { release(); throw error; }
            },
            dispose() {
                if (disposed) return;
                release();
                if (atlas) releaseLutAtlas({ atlas });
                for (const image of images) image.image.close();
                images.length = 0; fontSources.clear(); resources = [];
                native.clear(); native.free(); disposed = true;
            },
        };
    } catch (error) {
        for (const image of images) image.image.close();
        for (const face of faces) document.fonts.delete(face);
        if (atlas) releaseLutAtlas({ atlas });
        native.free(); throw error;
    }
}
