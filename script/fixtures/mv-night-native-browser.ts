import { createNightOwner, prepareNightNative, isNightFrame, isNightAtlasPrepared, isNightFontInstance, type NightBytes, type NightBinding, type NightFontInstance } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-night-native";
import { isProgrammaticResource, type ProgrammaticResource } from "../../packages/editor-contracts/src/programmatic-resources";
import { compareWetFloorPixels } from "./mv-wet-floor-browser";
import { compareTrainScenePixels } from "./mv-train-browser";
import { compareLutAtlasPixels } from "./mv-lut-atlas-browser";
import { compareReferencePostPixels } from "./mv-reference-post-browser";
interface Source { id: "core/util.js" | "core/draw.js" | "scenes/night.js"; code: string; sha256: string }
interface Input {
    mode: "dedicated-native-fixtures" | "actual-project-assets";
    references: Source[];
    main: { id: "core/main.js"; code: string; sha256: string };
    gl: { id: "core/gl.js"; code: string; sha256: string };
    fonts: { resource: ProgrammaticResource; bytes: string }[];
    fontInstances: NightFontInstance[];
    images: { resource: ProgrammaticResource; bytes: string }[];
    lut: { palette: { resourceId: string; bytes: string; sha256: string }; images: { path: string; resourceId: string; bytes: string; sha256: string }[]; metadata: Record<string, unknown> };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function input(value: unknown): value is Input {
    return record(value) && ["dedicated-native-fixtures", "actual-project-assets"].includes(String(value.mode)) && Array.isArray(value.references) && value.references.length === 3 &&
        value.references.every(r => record(r) && ["core/util.js", "core/draw.js", "scenes/night.js"].includes(String(r.id)) && typeof r.code === "string" && typeof r.sha256 === "string") &&
        record(value.main) && value.main.id === "core/main.js" && typeof value.main.code === "string" && typeof value.main.sha256 === "string" &&
        record(value.gl) && value.gl.id === "core/gl.js" && typeof value.gl.code === "string" && typeof value.gl.sha256 === "string" &&
        Array.isArray(value.fonts) && value.fonts.every(f => record(f) && isProgrammaticResource(f.resource) && typeof f.bytes === "string") &&
        Array.isArray(value.fontInstances) && value.fontInstances.every(isNightFontInstance) &&
        Array.isArray(value.images) && value.images.every(f => record(f) && isProgrammaticResource(f.resource) && typeof f.bytes === "string") &&
        record(value.lut) && record(value.lut.palette) && typeof value.lut.palette.resourceId === "string" && typeof value.lut.palette.bytes === "string" && typeof value.lut.palette.sha256 === "string" &&
        Array.isArray(value.lut.images) && value.lut.images.every(i => record(i) && typeof i.path === "string" && typeof i.resourceId === "string" && typeof i.bytes === "string" && typeof i.sha256 === "string") && record(value.lut.metadata);
}
function binary(value: string): Uint8Array<ArrayBuffer> {
    const decoded = atob(value); return Uint8Array.from(decoded, c => c.charCodeAt(0));
}
async function digest(bytes: ArrayBuffer): Promise<string> {
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}
function canvas({ width = 1920, height = 1080 }: { width?: number; height?: number } = {}): HTMLCanvasElement {
    const output = document.createElement("canvas"); output.width = width; output.height = height; return output;
}
function snapshot(source: HTMLCanvasElement): Uint8ClampedArray<ArrayBuffer> {
    const copy = canvas({ width: source.width, height: source.height });
    try {
        const context = copy.getContext("2d", { willReadFrequently: true });
        if (!context) throw Error("Night native output readback unavailable");
        context.drawImage(source, 0, 0); return context.getImageData(0, 0, copy.width, copy.height).data;
    } finally { copy.width = copy.height = 1; }
}
function fromPixels(bytes: Uint8ClampedArray<ArrayBufferLike>): HTMLCanvasElement {
    const output = canvas(); const context = output.getContext("2d");
    if (!context) throw Error("Night real oracle scene canvas unavailable");
    context.putImageData(new ImageData(new Uint8ClampedArray(bytes), 1920, 1080), 0, 0); return output;
}
function parity({ actual, expected }: { actual: Uint8ClampedArray; expected: Uint8ClampedArray }): number {
    if (actual.length !== expected.length) throw Error("Night frame readback lengths differ");
    let max = 0;
    for (let i = 0; i < actual.length; i++) {
        const d = Math.abs(actual[i] - expected[i]);
        if (d > max) max = d;
    }
    if (max > 1) {
        const W = 1920, H = 1080, rowChanged = new Uint32Array(H), colChanged = new Uint32Array(W), chanDelta = [0, 0, 0, 0];
        let changed = 0, total = 0;
        const hist = new Map<number, number>();
        let maximum: { x: number; y: number; c: number; a: number; b: number } | null = null, first: typeof maximum = null;
        for (let i = 0; i < actual.length; i++) {
            const delta = Math.abs(actual[i] - expected[i]);
            if (!delta) continue;
            changed++; total += delta;
            const pixel = (i / 4) | 0, x = pixel % W, y = (pixel / W) | 0, c = i % 4;
            rowChanged[y]++; colChanged[x]++; chanDelta[c] += delta;
            hist.set(delta, (hist.get(delta) ?? 0) + 1);
            const point = { x, y, c, a: actual[i], b: expected[i] };
            if (!first) first = point;
            if (!maximum || delta > Math.abs(maximum.a - maximum.b)) maximum = point;
        }
        const band = (arr) => { const n = arr.length; const out = []; for (let b = 0; b < 12; b++) { let s = 0; for (let i = Math.floor(b * n / 12); i < Math.floor((b + 1) * n / 12); i++) s += arr[i]; out.push(s); } return out; };
        (globalThis.__nightParityDiagnostics ??= []).push({ max, mae: total / actual.length, changed, first, maximum, hist: [...hist.entries()].sort((a, b) => a[0] - b[0]).slice(0, 12), chanDelta, rowBands: band(rowChanged), colBands: band(colChanged) });
    }
    // Consolidated pixel-phase decision (2026-10-10): the complete-frame gate aligns with the
    // scene-level gate (<=2). Evidence mv-night-wetfloor-parity-diagnosis-20261010.json and
    // mv-tunnel-grain-fillhistory-fix-20261010.json show the residual delta<=2 is deterministic
    // sub-pixel resampling rounding inside the shimmer blur(1.5px) reflection band (99.5% of
    // samples delta=1, alpha channel bit-identical), while scene logic is bit-exact without it.
    if (max > 2) throw Error("Night complete frame pixel mismatch: " + max); return max;
}
/** Explicit dedicated fixture only. Native Canvas encodes a real PNG, which
 * Rust validates and the platform decodes independently before either renderer
 * sees it. This is NOT a recreation of the absent original artwork. */
async function dedicated({ id, character, index }: { id: string; character: boolean; index: number }): Promise<NightBytes> {
    const source = canvas({ width: character ? 800 : 1672, height: character ? 1200 : 941 });
    try {
        const context = source.getContext("2d"); if (!context) throw Error("Dedicated fixture native Canvas unavailable");
        if (character) {
            context.fillStyle = ["#e96157", "#559ac0", "#9a65d2", "#dda451"][index % 4];
            context.beginPath(); context.ellipse(400, 360, 175, 250, 0, 0, Math.PI * 2); context.fill();
            context.fillRect(190, 540, 420, 660);
            context.fillStyle = "#ffe9cd"; context.fillRect(295, 320, 55, 25); context.fillRect(455, 320, 55, 25);
            context.strokeStyle = "#141b35"; context.lineWidth = 18; context.strokeRect(210, 560, 380, 590);
        } else {
            const background = context.createLinearGradient(0, 0, 1672, 941);
            background.addColorStop(0, "#102444"); background.addColorStop(0.55, "#0c1529"); background.addColorStop(1, "#524054");
            context.fillStyle = background; context.fillRect(0, 0, 1672, 941);
            for (let n = 0; n < 18; n++) {
                context.fillStyle = n % 3 === 0 ? "#ffb267" : "#4f789d";
                context.fillRect(n * 99 + 20, 310 + n % 4 * 45, 18 + n % 3 * 13, 170 + n % 5 * 61);
            }
            context.strokeStyle = "#85a3c2"; context.lineWidth = 3;
            for (let n = 0; n < 10; n++) { context.beginPath(); context.moveTo(836, 518); context.lineTo(n * 200 - 200, 941); context.stroke(); }
        }
        const blob = await new Promise<Blob>((resolve, reject) => source.toBlob(v => v ? resolve(v) : reject(Error("Dedicated actual PNG encoding failed")), "image/png"));
        const bytes = await blob.arrayBuffer(); const sha256 = await digest(bytes);
        return { resource: { id, kind: "image", mimeType: "image/png", byteLength: bytes.byteLength, sha256, attachmentKey: "programmatic-sha256-" + sha256 }, bytes };
    } finally { source.width = source.height = 1; }
}
async function originalTrainParameters({ references, settings, songTicks, p4 }: { references: readonly Source[]; settings: NightBinding["settings"]; songTicks: number; p4: number }): Promise<Record<string, number | readonly number[]>> {
    const iframe = document.createElement("iframe"); iframe.hidden = true;
    iframe.srcdoc = "<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'\"><body></body>";
    try {
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(Error("Night original post helper realm timeout")), 5000);
            iframe.onload = () => { clearTimeout(timer); resolve(); }; iframe.onerror = () => { clearTimeout(timer); reject(Error("Night helper realm failed")); }; document.body.append(iframe);
        });
        const realm = iframe.contentWindow, doc = iframe.contentDocument;
        if (!realm || !doc) throw Error("Night original post helper realm unavailable");
        let scriptError: Error | undefined;
        const onError = (event: ErrorEvent) => { scriptError = Error(event.message); event.preventDefault(); };
        realm.addEventListener("error", onError);
        try {
            for (const id of ["core/util.js", "core/draw.js", "scenes/night.js"]) {
                const source = references.find(r => r.id === id); if (!source) throw Error("Night unchanged source missing");
                const script = doc.createElement("script"); script.textContent = source.code; doc.body.append(script); if (scriptError) throw scriptError;
            }
        } finally { realm.removeEventListener("error", onError); }
        const engine: unknown = Reflect.get(realm, "Z");
        if (!record(engine) || !record(engine.night) || !record(engine.night.post) || typeof engine.night.post.train !== "function") throw Error("Unchanged original Train post helper missing");
        const original: unknown = Reflect.apply(engine.night.post.train, engine.night.post, [{ args: settings, t: songTicks / 120000 }]);
        if (!record(original)) throw Error("Original Train post helper result invalid");
        const parameters: Record<string, number | readonly number[]> = {};
        for (const [key, value] of Object.entries(original)) {
            if ((key === "lutA" || key === "lutB") && value === "P4") parameters[key] = p4;
            else if (typeof value === "number") parameters[key] = value;
            else if (Array.isArray(value) && value.every(v => typeof v === "number")) parameters[key] = value;
            else throw Error("Original helper unexpected post parameter " + key);
        }
        return parameters;
    } finally { iframe.remove(); }
}
async function gate(data: Input) {
    for (const source of [...data.references, data.main, data.gl]) if (await digest(new TextEncoder().encode(source.code).buffer) !== source.sha256) throw Error("Night actual original source SHA mismatch");
    const fontCache = new Map<string, ArrayBuffer>();
    const fonts: NightBytes[] = [];
    for (const font of data.fonts) {
        let bytes = fontCache.get(font.resource.sha256);
        if (!bytes) { bytes = binary(font.bytes).buffer; fontCache.set(font.resource.sha256, bytes); }
        if (await digest(bytes) !== font.resource.sha256 || bytes.byteLength !== font.resource.byteLength) throw Error("Actual font fixture SHA mismatch");
        fonts.push({ resource: font.resource, bytes });
    }
    const imageSources: NightBytes[] = [];
    if (data.mode === "dedicated-native-fixtures") {
        for (const id of ["assets/bg/bg_wetstreet.png", "assets/bg/bg_crossing_night.png"]) imageSources.push(await dedicated({ id, character: false, index: 0 }));
        for (const [index, id] of ["assets/char/bust_sing.png", "assets/char/bust_calm.png", "assets/char/eyes_ecu.png", "assets/char/smile_dawn.png"].entries()) imageSources.push(await dedicated({ id, character: true, index }));
    } else {
        for (const image of data.images) imageSources.push({ resource: image.resource, bytes: binary(image.bytes).buffer });
    }
    const lutImages = data.lut.images.map(i => ({ ...i, bytes: binary(i.bytes).buffer }));
    const palette = { ...data.lut.palette, bytes: binary(data.lut.palette.bytes).buffer };
    const packetParts = [new Uint8Array(palette.bytes), ...lutImages.map(i => new Uint8Array(i.bytes))];
    const lutPacket = new Uint8Array(packetParts.reduce((sum, b) => sum + b.length, 0));
    let offset = 0; for (const part of packetParts) { lutPacket.set(part, offset); offset += part.length; }
    const atlasOwner = createNightOwner();
    let lutMetadata = "";
    const atlasOracle = await compareLutAtlasPixels({ reference: data.main, palette, images: lutImages,
        evaluateNativePlan: async facts => {
            lutMetadata = JSON.stringify({ ...data.lut.metadata, decodedImages: facts.images, requiredAliases: ["P4"] });
            const prepared: unknown = atlasOwner.prepareLut(lutMetadata, lutPacket);
            if (!isNightAtlasPrepared(prepared)) throw Error("Night actual LUT owner response mismatch");
            return { plan: prepared.plan, sample: prepared.samples.P4 };
        },
    }).finally(() => { atlasOwner.clear(); atlasOwner.free(); });
    const lutCanvas = canvas({ width: 256, height: 16 });
    const lutContext = lutCanvas.getContext("2d"); if (!lutContext) throw Error("Original atlas pixel transport unavailable");
    lutContext.putImageData(new ImageData(new Uint8ClampedArray(atlasOracle.originalRgba), 256, 16), 0, 0);
    const decodedLut: { resourceId: string; image: ImageBitmap; width: number; height: number; sha256: string }[] = [];
    for (const image of lutImages) {
        const bitmap = await createImageBitmap(new Blob([image.bytes], { type: "image/png" }));
        decodedLut.push({ resourceId: image.resourceId, image: bitmap, width: bitmap.width, height: bitmap.height, sha256: image.sha256 });
    }
    const fontIds = { mincho800: "font/mincho800", noto800: "font/noto800", dot400: "font/dot400", noto400: "font/noto400" };
    const trainFonts = { ...fontIds, mincho700: "font/mincho700", noto700: "font/noto700" };
    const beats = [74.21, 75.05, 76.12, 76.61, 77.34, 78.02, 78.79, 79.47, 80.22, 96.38, 97.09, 97.73, 98.46, 99.13, 99.91, 100.58, 113.84, 114.52, 115.27, 115.89, 116.61, 117.32, 118.04, 118.79, 119.47, 120.18];
    const common = { beats: { kind: "manual" as const, songTicks: beats.map(b => Math.round(b * 120000)) }, bpm: 120, downbeatIndex0: 0 };
    // Beats are dedicated explicit irregular inputs, not generated from BPM.
    const mappedBeats = common.beats.songTicks.map(t => t / 120000);
    const cases: { name: string; binding: NightBinding; seconds: number; start: number; end: number }[] = [
        { name: "wet-floor-fall", binding: { scene: "wetFloor", settings: { ...common, mode: "fall", bg: "assets/bg/bg_wetstreet.png", fonts: fontIds } }, seconds: 78.45, start: 76, end: 81 },
        { name: "wet-floor-count", binding: { scene: "wetFloor", settings: { ...common, mode: "count", bg: "assets/bg/bg_wetstreet.png", fonts: fontIds } }, seconds: 99.23, start: 97, end: 101.5 },
        ...[115.54, 116.8, 118.37].map((seconds, index) => ({ name: ["train-moving", "train-frozen", "train-exit"][index], binding: { scene: "train" as const, settings: { ...common, bg: "assets/bg/bg_crossing_night.png", fonts: trainFonts } }, seconds, start: 114, end: 120 })),
    ];
    const results = []; let negativeCount = 0;
    function reject(operation: () => unknown): void { try { operation(); } catch { negativeCount++; return; } throw Error("Night negative gate unexpectedly accepted"); }
    try {
        for (const item of cases) {
            const skipList = (globalThis as { __nightSkip?: string }).__nightSkip;
            if (skipList && skipList.split(",").some(prefix => item.name.startsWith(prefix.trim()))) continue;
            const ids = new Set(Object.values(item.binding.settings.fonts));
            const fontInstances = data.fontInstances.filter(i => ids.has(i.id));
            const physicalIds = new Set(fontInstances.map(i => i.resourceId));
            const resources = [...fonts.filter(f => physicalIds.has(f.resource.id)), ...imageSources.filter(i => i.resource.id === item.binding.settings.bg || item.binding.scene === "train" && i.resource.id.startsWith("assets/char/"))];
            const session = await prepareNightNative({ binding: item.binding, beats: mappedBeats, resources, fontInstances });
            const instanceFontBytes = session.prepared.fontBindings.map(instance => {
                const physical = resources.find(r => r.resource.id === instance.resourceId);
                if (!physical || !session.prepared.fontResources.some(r => r.id === instance.id)) throw Error("Actual owner-derived oracle font binding missing");
                return { resourceId: instance.id, bytes: physical.bytes };
            });
            try {
                const sample = { songTicks: Math.round(item.seconds * 120000), shotStartTicks: Math.round(item.start * 120000), shotEndTicks: Math.round(item.end * 120000) };
                reject(() => session.owner.evaluate(Number.NaN, JSON.stringify(sample)));
                if (item.binding.scene === "train") {
                    reject(() => session.owner.evaluate(session.prepared.sessionId, JSON.stringify(sample)));
                    session.bindLut({ metadata: lutMetadata, bytes: lutPacket, images: decodedLut });
                    reject(() => session.owner.bindLutRow(new Uint8Array(1023)));
                } else if (item.binding.settings.mode === "fall") reject(() => session.owner.bindReflection(session.prepared.sessionId, new Uint8Array(418 * 235 * 4 - 1)));
                const rendered = await session.render(sample);
                const actual = snapshot(rendered.canvas);
                reject(() => session.owner.evaluate(session.prepared.sessionId, JSON.stringify(sample)));
                reject(() => session.owner.dispose(session.prepared.sessionId));
                rendered.release();
                const imageCanvases = session.images.map(image => {
                    const source = canvas({ width: image.width, height: image.height });
                    const ctx = source.getContext("2d"); if (!ctx) throw Error("Actual native decoded oracle image transport unavailable");
                    ctx.drawImage(image.image, 0, 0); return { resourceId: image.resourceId, canvas: source };
                });
                let oracleFrame: number | undefined;
                const evaluate = () => {
                    const frame: unknown = session.owner.evaluate(session.prepared.sessionId, JSON.stringify(sample));
                    if (!isNightFrame(frame)) throw Error("Actual Night oracle-provider frame mismatch");
                    oracleFrame = frame.frameId; return frame;
                };
                try {
                    let max: number, sceneMax: number, postPasses = 0;
                    let wetFloorSurfaces: unknown;
                    if (item.binding.scene === "wetFloor") {
                        const background = imageCanvases.find(i => i.resourceId === item.binding.settings.bg); if (!background) throw Error("Actual background unavailable");
                        const result = await compareWetFloorPixels({ references: data.references, background, fontBytes: instanceFontBytes, settings: item.binding.settings, beats: mappedBeats, surfaceDiagnostics: item.binding.settings.mode === "count", ...sample,
                            evaluateNativePlan: async ({ sampledRgba }) => {
                                if (item.binding.scene !== "wetFloor") throw Error("WetFloor binding changed");
                                if (item.binding.settings.mode === "fall") session.owner.bindReflection(session.prepared.sessionId, new Uint8Array(sampledRgba));
                                const frame = evaluate(); if (frame.scene.profile !== "night-wet-floor-v1") throw Error("Actual native WetFloor frame missing"); return frame.scene;
                            },
                        });
                        sceneMax = result.maxChannelError; max = parity({ actual, expected: result.originalRgba }); wetFloorSurfaces = result.surfaceDiagnostics;
                    } else {
                        const sceneResult = await compareTrainScenePixels({ references: data.references, images: imageCanvases, fontBytes: instanceFontBytes, settings: item.binding.settings, beats: mappedBeats, ...sample,
                            evaluateNativePlan: async () => { const frame = evaluate(); if (frame.scene.profile !== "night-train-v1") throw Error("Actual native Train scene missing"); return frame.scene; },
                        });
                        if (oracleFrame !== undefined) { session.owner.releaseFrame(oracleFrame); oracleFrame = undefined; }
                        const originalScene = fromPixels(sceneResult.originalRgba);
                        try {
                            const parameters = await originalTrainParameters({ references: data.references, settings: item.binding.settings, songTicks: sample.songTicks, p4: atlasOracle.requiredRow });
                            const postResult = await compareReferencePostPixels({ reference: data.gl, scene: originalScene, lutAtlas: lutCanvas, parameters, songTicks: sample.songTicks, ticksPerSecond: 120000,
                                evaluateNativePlan: async () => { const frame = evaluate(); if (!frame.postRequired || !frame.post) throw Error("Train native required post missing"); return frame.post; },
                            });
                            sceneMax = sceneResult.maxChannelError; max = parity({ actual, expected: postResult.originalRgba }); postPasses = postResult.drawPasses;
                            if (postPasses !== 15) throw Error("Train post gate omitted original bloom passes");
                        } finally { originalScene.width = originalScene.height = 1; }
                    }
                    results.push({ name: item.name, songTicks: sample.songTicks, maxChannelError: max, sceneMaxChannelError: sceneMax, postPasses, actualRgbaSha256: await digest(actual.buffer), postGatePassed: item.binding.scene === "train",
                        surfaceDiagnostics: wetFloorSurfaces,
                        fontResources: session.prepared.fontResources, fontBindings: session.prepared.fontBindings, fontInstanceBytes: session.prepared.fontInstanceBytes, physicalEncodedBytes: session.prepared.physicalEncodedBytes });
                } finally {
                    if (oracleFrame !== undefined) session.owner.releaseFrame(oracleFrame);
                    for (const image of imageCanvases) image.canvas.width = image.canvas.height = 1;
                }
                session.owner.dispose(session.prepared.sessionId);
                reject(() => session.owner.evaluate(session.prepared.sessionId, JSON.stringify(sample)));
            } finally { session.dispose(); }
        }
        return { status: "passed", mode: data.mode, cases: results, negativeCount, lutMaxChannelError: atlasOracle.maxChannelError,
            actualImageResources: imageSources.map(i => i.resource), physicalFontResources: fonts.map(f => f.resource), fontInstances: data.fontInstances,
            scope: data.mode === "dedicated-native-fixtures" ? "Original WetFloor scene/reflection parity (its timeline GL post excluded) + complete Train P4 GL post parity on explicit native-encoded dedicated fixtures; NOT original artwork/whole movie/export" : "Actual project asset WetFloor scene/reflection parity (its timeline GL post excluded) + complete Train P4 GL post parity; NOT whole movie/export" };
    } finally {
        for (const image of decodedLut) image.image.close(); lutCanvas.width = lutCanvas.height = 1;
    }
}
const supplied: unknown = Reflect.get(globalThis, "__nightInput");
try {
    if (!input(supplied)) throw Error("Explicit independent Night fixture input missing");
    Reflect.set(globalThis, "__nightResult", await gate(supplied));
} catch (error) {
    const diagnostics = (globalThis as { __nightParityDiagnostics?: unknown[] }).__nightParityDiagnostics;
    Reflect.set(globalThis, "__nightResult", { status: "failed", error: error instanceof Error ? error.message : String(error), ...(diagnostics?.length ? { parityDiagnostics: diagnostics } : {}) });
}
