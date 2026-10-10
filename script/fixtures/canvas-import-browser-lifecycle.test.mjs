// Exact fixture orchestration with CPU Canvas/WASM lifecycle doubles only.
// Pixel/oracle helpers are inert here: this is NOT browser/GPU pixel acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as contract from "./canvas-import-browser-contract.mjs";

const probeSource = await readFile(new URL("./canvas-import-browser-probe.mjs", import.meta.url), "utf8");
const supportSource = await readFile(new URL("./canvas-import-browser-support.mjs", import.meta.url), "utf8");
async function exercise({ diagnostic = false, fault = null } = {}) {
	class Context {
		constructor(canvas) { this.canvas = canvas; }
		putImageData() {}
		getImageData(_x, _y, width, height) {
			if (!width || !height) { const error = Error("Native empty rectangle"); error.name = "IndexSizeError"; throw error; }
			return { data: new Uint8ClampedArray(width * height * 4) };
		}
	}
	class Canvas {
		constructor(width, height) { this.width = width; this.height = height; this.context = new Context(this); this.mode = null; }
		getContext(mode) { if (this.mode && this.mode !== mode) return null; this.mode = mode; return mode === "2d" ? this.context : {}; }
	}
	const live = new Set(fault === "foreign-handle" ? [999] : []), events = [], disposed = [];
	let nextHandle = 1, initialized = false, creates = 0, gpuAttempts = 0;
	const validate = (options, caller) => {
		const { width, height, source = options.mask } = options;
		if (caller === "effects" && (!width || !height || width > 4096 || height > 4096)) throw Error(`Invalid output dimensions: ${width}x${height}; each dimension must be in 1..=4096 (device max_texture_dimension_2d)`);
		if (!width || !height) throw Error("Canvas texture import requires nonzero width and height");
		if (width > 4096 || height > 4096) throw Error("Canvas texture import exceeds the device texture dimension limit");
		if (width > source.width || height > source.height) throw Error("Canvas texture import rectangle exceeds the source canvas dimensions");
		const context = source.getContext("2d"); if (!context) throw Error("Canvas texture import requires an available 2d context");
		context.getImageData(0, 0, width, height);
		return new Canvas(width, height);
	};
	const wasm = {
		initializeGpu: async () => { initialized = true; events.push("initializeGpu"); },
		WasmRuntimeGraphicsQuery: class { selectedBackend() { return "webgl"; } free() {} },
		disposeGpu() { gpuAttempts++; events.push(`disposeGpu:${live.size}`); if (live.size) throw Error("Cannot dispose GPU with live compositor handles"); initialized = false; },
		resolveStylizedEffectJson: () => JSON.stringify({ passes: [{ shader: "CPU-lifecycle-only", uniforms: {} }] }),
		applyEffectPasses(options) { const output = validate(options, "effects"); assert.equal(live.size, fault === "foreign-handle" ? 1 : 0, "owned compositor must be gone before valid recovery"); return output; },
		applyMaskFeather: (options) => validate(options, "masks"),
		createCompositor() { if (fault === "create-failure") throw Error("Injected create failure"); const handle = nextHandle++; live.add(handle); creates++; events.push(`create:${handle}`); return handle; },
		uploadTextureForHandle(handle, options) { assert(live.has(handle)); events.push(`upload:${handle}`); if (fault === "unexpected-upload-success" && !options.width) return; if (fault === "legal-upload-failure" && options.id === "subrectangle") throw Error("Injected legal upload failure"); validate(options, "upload"); },
		disposeCompositor(handle) { assert(live.has(handle), "never release an unknown handle"); assert.notEqual(handle, 999, "never release foreign ownership"); events.push(`release:${handle}`); if (fault === "dispose-failure") throw Error("Injected compositor release failure"); live.delete(handle); disposed.push(handle); },
	};
	if (diagnostic) wasm.applyEffectPassesReadback = async (options) => ({ canvas: wasm.applyEffectPasses(options), backend: "webgl", format: "rgba8unorm", width: options.width, height: options.height, rgba: new Uint8Array(options.width * options.height * 4) });
	const globals = { Error, ArrayBuffer, Uint8Array, Uint8ClampedArray, OffscreenCanvas: Canvas, OffscreenCanvasRenderingContext2D: Context,
		ImageData: class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } } };
	const context = vm.createContext(globals), modules = new Map();
	const synthetic = (name, exports) => new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context, identifier: name });
	modules.set("./canvas-import-browser-contract.mjs", synthetic("contract", contract));
	modules.set("./bubble-cases.mjs", synthetic("cases", { makeBubbleSource: (_spec, width, height) => new Uint8Array(width * height * 4), flattenBubbleParams: () => ({}) }));
	modules.set("./bubble-oracle.mjs", synthetic("oracle", { renderBubbleOracle: (_sample, canonical) => ({ rgba: canonical }) }));
	modules.set("./bubble-metrics.mjs", synthetic("metrics", { compareBubbleRgba: () => ({}), assessBubbleNative: () => ({ ok: true }) }));
	modules.set("./bubble-browser-support.mjs", synthetic("canvas", { bubbleReadCanvas: (canvas) => new Uint8Array(canvas.width * canvas.height * 4), bubbleEncode: () => "CPU-lifecycle-only" }));
	modules.set("./canvas-import-browser-support.mjs", new vm.SourceTextModule(supportSource, { context }));
	const entry = new vm.SourceTextModule(probeSource, { context }); await entry.link((name) => { assert(modules.has(name), name); return modules.get(name); }); await entry.evaluate();
	const report = await entry.namespace.runCanvasImportBrowserProbe(wasm, { backend: "webgl", diagnostic });
	assert.equal(Context.prototype.getImageData.name, "getImageData", "prototype restored after fault matrix");
	return { report, live, disposed, creates, events, initialized, gpuAttempts };
}
for (const diagnostic of [false, true]) test(`owned upload handles released before all recoveries/reinitializations; diagnostic=${diagnostic}`, async () => {
	const result = await exercise({ diagnostic }), { report } = result;
	assert.equal(report.ok, true); assert.equal(report.admissions.length, 24); assert.equal(report.normals.length, 9); assert.equal(report.recoveries.length, 54); assert.equal(report.subrectangles.length, 3);
	assert.equal(report.disposeCount, 28); assert.equal(report.reinitializeCount, 27); assert.equal(report.compositorCreateCount, 9); assert.equal(report.compositorDisposeCount, 9); assert.equal(report.ownedCompositorsRemaining, 0);
	assert.equal(result.creates, 9); assert.equal(result.disposed.length, 9); assert.equal(new Set(result.disposed).size, 9); assert.equal(result.live.size, 0); assert.equal(result.initialized, false);
	assert(result.events.filter((event) => event.startsWith("disposeGpu:")).every((event) => event === "disposeGpu:0"));
});
for (const fault of ["unexpected-upload-success", "create-failure", "legal-upload-failure"]) test(`${fault} cannot pass; cleanup still releases only owned handles`, async () => {
	const result = await exercise({ fault }); assert.equal(result.report.ok, false); assert.equal(result.live.size, 0); assert.equal(result.creates, result.disposed.length); assert(result.gpuAttempts > 0); assert.equal(result.initialized, false);
});
test("release failure remains owned, final cleanup reports failure and GPU dispose is still attempted", async () => {
	const result = await exercise({ fault: "dispose-failure" }); assert.equal(result.report.ok, false); assert.equal(result.report.ownedCompositorsRemaining, 1); assert(result.report.errors.some((error) => error.stage === "disposeCompositor")); assert(result.report.errors.some((error) => error.stage === "disposeGpu")); assert(result.events.filter((event) => event === "release:1").length >= 2); assert(result.gpuAttempts >= 2);
});
test("foreign compositor is never cleaned by the fixture or mistaken for its ownership", async () => {
	const result = await exercise({ fault: "foreign-handle" }); assert.equal(result.report.ok, false); assert(result.live.has(999)); assert.equal(result.report.ownedCompositorsRemaining, 0); assert.equal(result.disposed.length, 0); assert(result.gpuAttempts > 0);
});
