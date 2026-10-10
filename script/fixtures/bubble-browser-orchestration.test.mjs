import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

// Deliberately tiny synthetic dependency modules. This exercises orchestration
// and evidence labeling only: it never loads real WASM, a browser, or a GPU.
const sources = {
	"bubble-cases.mjs": `
		const common = {width:2,height:1,sourceSpec:{id:'test'},sourceId:'2x1:test',ticks:0,timelineTicks:0,timeOffsetTicks:0,trimStartTicks:0,frameRate:{numerator:30,denominator:1},enabled:true};
		export const bubbleCases = [
			{...common,id:'base',params:{output:31},equivalenceKey:'repeat'},
			{...common,id:'disabled',params:{output:31},enabled:false,expectedBypass:'disabled-fixture-stack'},
			{...common,id:'repeat',params:{output:31},equivalenceKey:'repeat'},
			{...common,id:'oat',params:{output:47},baselineId:'base'}];
		export const makeBubbleSource = () => Uint8Array.of(1,2,3,255,4,5,6,255);
		export const flattenBubbleParams = (value) => value.params;
		export const bubbleAdmissionCases = [
			{id:'reject-resolve',stage:'resolve',params:{invalid:true},ticks:0,frameRate:common.frameRate},
			{id:'skip-cpu-budget',stage:'work',cpuOnly:true},
			{id:'reject-work',stage:'work',params:{output:31},ticks:0,frameRate:common.frameRate,width:8193,height:1,expectedError:'Invalid output dimensions'}];
		export const bubbleSupplementalAdmissionCases = [{id:'safe-negative-boundary',params:{supplemental:true},ticks:-1,frameRate:common.frameRate,expectedFrameIndex:-1}];
	`,
	"bubble-oracle.mjs": `export function renderBubbleOracle(value, source) {
		return {rgba:value.enabled===false?new Uint8Array(source):Uint8Array.of(value.params.output,0,0,255,value.params.output,0,0,255),sampledTicks:0,elapsedTicks:0,centers:[],work:{},bypass:value.enabled===false?'disabled':null};
	}`,
	"bubble-metrics.mjs": `
		export const BUBBLE_NATIVE_GATES = Object.freeze({synthetic:0});
		export function compareBubbleRgba(a,b){return {changedBytes:a.reduce((n,v,i)=>n+Number(v!==b[i]),0)}}
		export function assessBubbleNative(value){return {ok:value.changedBytes===0,failures:[]}}
	`,
	"bubble-negatives.mjs": `
		export const BUBBLE_NEGATIVE_CONTROLS = [{id:'pixel',kind:'pixel'},{id:'invariant',kind:'exact-invariant'}];
		export function bubbleNegativesForCase(value,source,reference){return value.id==='base'?[{id:'pixel',caseId:'base',rejected:true,mutantRgba:source,referenceRgba:reference}]:[]}
		export function bubbleInvariantNegatives(){return [{id:'invariant',rejected:true}]}
	`,
};

async function runSynthetic(diagnostic, fault = "") {
	const counters = { ordinary: 0, diagnostic: 0, disposed: 0, freed: 0 };
	const events = [];
	let invalidAttempted = false;
	class Canvas {
		constructor(width, height) { this.width = width; this.height = height; this.bytes = new Uint8ClampedArray(width * height * 4); }
		getContext() { return {
			putImageData: (data) => { this.bytes = new Uint8ClampedArray(data.data); },
			drawImage: (canvas) => { this.bytes = new Uint8ClampedArray(canvas.bytes); },
			getImageData: () => ({ data: new Uint8ClampedArray(this.bytes) }),
		}; }
	}
	const result = (options) => {
		events.push(options.width === 8193 ? "invalid-size" : options.passes.length ? "valid" : "empty");
		if (invalidAttempted && fault === "poisoned") throw Error("BorrowMutError");
		if (!options.passes.length) throw Error("At least one effect pass is required");
		if (options.width === 8193) {
			invalidAttempted = true;
			throw Error(fault === "wrong-error" || fault === "poisoned" ? "wgpu panic: unreachable" : "Invalid output dimensions: 8193x1");
		}
		const value = options.passes[0].uniforms.find((uniform) => uniform.name === "output").value[0];
		const canvas = new Canvas(2, 1);
		const red = invalidAttempted && fault === "recovery-pixels" ? value + 1 : value;
		canvas.bytes = Uint8ClampedArray.of(red, 0, 0, 255, red, 0, 0, 255);
		return canvas;
	};
	const api = {
		initializeGpu: async () => {}, disposeGpu: () => {
			events.push("dispose"); counters.disposed++;
			if (fault === "poisoned" || fault === "dispose") throw Error("BorrowMutError");
		},
		WasmRuntimeGraphicsQuery: class { selectedBackend() { return "webgl"; } free() { counters.freed++; } },
		resolveStylizedEffectJson: (input) => {
			const { params } = JSON.parse(input);
			if (params.invalid && fault === "resolver-trap") throw Error("unreachable");
			if (params.invalid && fault === "resolver-empty-throw") throw "";
			if (params.supplemental && fault === "empty-throw") throw "";
			return JSON.stringify(params.invalid ? { error: "Invalid params" } : params.supplemental ? { frameIndex: -1, passes: [] } : { frameIndex: 0, passes: [{ shader: "bubble", uniforms: params }] });
		},
		applyEffectPasses: (options) => { counters.ordinary++; return result(options); },
		applyEffectPassesReadback: async (options) => {
			counters.diagnostic++;
			const canvas = result(options);
			return { canvas, rgba: new Uint8Array(canvas.bytes), width: 2, height: 1, format: "rgba8unorm", backend: "webgl" };
		},
	};
	const output = await build({ entryPoints: ["script/fixtures/bubble-browser-probe.mjs"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "BubbleSynthetic", logLevel: "silent", plugins: [{ name: "synthetic-fixture-only", setup(build) {
		build.onResolve({ filter: /^opencut-wasm$/ }, () => ({ path: "wasm", namespace: "synthetic" }));
		build.onResolve({ filter: /\.\/bubble-(cases|oracle|metrics|negatives)\.mjs$/ }, (args) => ({ path: args.path.slice(2), namespace: "synthetic" }));
		build.onLoad({ filter: /.*/, namespace: "synthetic" }, (args) => ({ contents: args.path === "wasm" ?
			`const api=globalThis.syntheticWasm; export const {initializeGpu,disposeGpu,WasmRuntimeGraphicsQuery,resolveStylizedEffectJson,applyEffectPasses${diagnostic ? ',applyEffectPassesReadback' : ''}}=api;` : sources[args.path], loader: "js" }));
	} }] });
	const context = {
		syntheticWasm: api, OffscreenCanvas: Canvas,
		ImageData: class { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } },
		Error, Uint8Array, Uint8ClampedArray, URL, setTimeout, btoa: (value) => Buffer.from(value, "binary").toString("base64"),
		location: { href: `http://127.0.0.1/?backend=webgl&diagnostic=${Number(diagnostic)}` },
	};
	runInNewContext(output.outputFiles[0].text, context);
	const report = await context.BubbleSynthetic.runBubbleProbe();
	return { report, raw: context.__bubbleRaw, counters, events };
}

for (const diagnostic of [false, true]) test(`Bubble synthetic orchestration labels ${diagnostic ? "diagnostic-native" : "default-Canvas"}, bypass, skipped CPU and supplemental admission`, async () => {
	const { report, raw, counters, events } = await runSynthetic(diagnostic);
	assert.equal(report.ok, true, JSON.stringify(report.errors) + report.failure);
	assert.equal(report.completed, true);
	assert.equal(report.caught, false);
	assert.equal(report.nativeAcceptance, diagnostic ? true : null);
	assert.equal(report.nativeFrames, diagnostic ? 3 : 0);
	assert.equal(raw.frames.length, 4);
	assert.equal(raw.frames[1].nativeRgba, null);
	assert.equal(report.equivalences.length, 1);
	assert.equal(report.admissions.find((item) => item.id === "skip-cpu-budget").attempted, false);
	assert.equal(report.admissions.find((item) => item.id === "safe-negative-boundary").passed, true);
	assert.equal(counters.disposed, 1);
	assert.equal(counters.freed, 1);
	assert.equal(counters.diagnostic, diagnostic ? 5 : 0);
	assert.equal(counters.ordinary, diagnostic ? 2 : 7);
	assert.deepEqual(events.slice(-5), ["invalid-size", "valid", "empty", "valid", "dispose"]);
	assert.equal(report.recoveries.length, 2);
	for (const recovered of report.recoveries) {
		assert.equal(recovered.passed, true);
		assert.equal(recovered.sameCanvas, true);
		assert.equal(recovered.sameNative, diagnostic ? true : null);
		assert.deepEqual(Buffer.from(recovered.canvasRgba, "base64"), Buffer.from(recovered.expectedRgba, "base64"));
	}
	assert.equal(report.admissions.find((item) => item.id === "reject-work").semanticMatch, true);
	assert.equal(report.admissions.find((item) => item.id === "real-empty-pass-stack").semanticMatch, true);
});

for (const fault of ["wrong-error", "poisoned", "recovery-pixels", "dispose"])
	test(`Bubble orchestration refuses ${fault} as a successful rejection/recovery/disposal`, async () => {
		const { report, counters, events } = await runSynthetic(true, fault);
		assert.equal(report.ok, false);
		assert.equal(counters.disposed, 1);
		assert.equal(counters.freed, 1);
		assert.deepEqual(events.slice(-5), ["invalid-size", "valid", "empty", "valid", "dispose"]);
		if (fault === "wrong-error" || fault === "poisoned")
			assert.equal(report.admissions.find((item) => item.id === "reject-work").semanticMatch, false);
		if (fault === "poisoned")
			assert.equal(report.admissions.find((item) => item.id === "reject-work").recoveryError, "BorrowMutError");
		if (fault === "recovery-pixels") assert.equal(report.recoveries[0].passed, false);
		if (fault === "dispose" || fault === "poisoned") assert.equal(report.gpuDisposed, false);
	});

for (const diagnostic of [false, true]) {
	for (const fault of ["resolver-trap", "resolver-empty-throw", "empty-throw"])
		test(`Bubble ${diagnostic ? "diagnostic" : "default"} cannot pass after ${fault}`, async () => {
			const { report, raw, counters } = await runSynthetic(diagnostic, fault);
			assert.equal(report.ok, false);
			assert.equal(raw.frames.length, 4, "Visual completion alone must not pass the probe");
			assert.equal(counters.disposed, 1);
			assert.equal(counters.freed, 1);
			if (fault === "empty-throw") {
				assert.equal(report.caught, true);
				assert.equal(report.completed, false);
				assert.notEqual(report.failure, "");
				assert.equal(report.admissions.some((item) => item.id === "real-empty-pass-stack"), false);
			} else {
				const rejection = report.admissions.find((item) => item.id === "reject-resolve");
				assert.equal(rejection.rejected, false);
				assert.equal(rejection.unexpectedException, true);
				assert.notEqual(rejection.error, "");
				assert(report.errors.some((message) => message.startsWith("Unexpected Bubble resolver exception:")));
			}
		});
}
