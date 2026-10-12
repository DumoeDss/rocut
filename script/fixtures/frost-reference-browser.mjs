import * as api from "./api.mjs";

const input = await (await fetch("./inputs.json")).json();
const report = {
	ok: false,
	diagnostic: input.diagnostic,
	records: [],
	recovery: [],
	seek: [],
};
const require = (condition, message) => {
	if (!condition) throw Error(message);
};
const encode = (bytes) => {
	let value = "";
	for (let i = 0; i < bytes.length; i += 8192)
		value += String.fromCharCode(...bytes.subarray(i, i + 8192));
	return btoa(value);
};
const equal = (a, b) =>
	a.length === b.length && a.every((value, i) => value === b[i]);
const pixels = (canvas) => {
	const copy = new OffscreenCanvas(input.width, input.height);
	const context = copy.getContext("2d", { willReadFrequently: true });
	context.drawImage(canvas, 0, 0);
	return new Uint8Array(
		context.getImageData(0, 0, input.width, input.height).data,
	);
};
const source = new Uint8Array(input.source);
const canvas = new OffscreenCanvas(input.width, input.height);
canvas
	.getContext("2d")
	.putImageData(
		new ImageData(new Uint8ClampedArray(source), input.width, input.height),
		0,
		0,
	);
report.canonicalSource = encode(pixels(canvas));
const query = new api.WasmRuntimeGraphicsQuery();
const normal = (passes) =>
	pixels(
		api.applyEffectPasses({
			source: canvas,
			width: input.width,
			height: input.height,
			passes,
		}),
	);
const raw = (passes, rgba = source) =>
	api.applyEffectPassesRgbaReadback({
		rgba,
		width: input.width,
		height: input.height,
		passes,
	});
const options = (passes) => ({
	source: canvas,
	width: input.width,
	height: input.height,
	passes,
});
const passesFor = (response) =>
	response.passes.map((pass) => ({
		shader: pass.shader,
		uniforms: Object.entries(pass.uniforms).map(([name, value]) => ({
			name,
			value: Array.isArray(value) ? value : [value],
		})),
	}));
const native = new Map(),
	normalFrames = new Map(),
	resolved = new Map();
try {
	require(typeof api.applyEffectPassesRgbaReadback ===
		(input.diagnostic ? "function" : "undefined"), "Unexpected raw ABI");
	require(typeof api.applyEffectPassesReadback ===
		(input.diagnostic
			? "function"
			: "undefined"), "Unexpected Canvas readback ABI");
	await api.initializeGpu();
	report.backend = query.selectedBackend();
	require(report.backend === "webgl", "Expected the identified WebGL backend");
	for (const item of input.cases) {
		const response = JSON.parse(
			api.resolveStylizedEffectJson(JSON.stringify(item.input)),
		);
		require(!response.error &&
			Array.isArray(response.passes), `Resolver failed: ${item.id}`);
		require(JSON.stringify(response) ===
			JSON.stringify(item.expectedResolution), `Resolver drift: ${item.id}`);
		const passes = passesFor(response);
		resolved.set(item.id, passes);
		const record = {
			id: item.id,
			passCount: passes.length,
			actualResolution: response,
		};
		if (!passes.length) record.fixtureRgba = encode(source);
		else {
			const output = normal(passes);
			normalFrames.set(item.id, output);
			record.canvasRgba = encode(output);
			if (input.diagnostic) {
				const canonical = await api.applyEffectPassesReadback(options(passes));
				const direct = await raw(passes);
				for (const result of [canonical, direct]) {
					require(result.backend === report.backend &&
						result.width === input.width &&
						result.height === input.height, "Readback identity mismatch");
					require(["rgba8unorm", "bgra8unorm"].includes(
						result.format,
					), "Unexpected readback format");
				}
				record.format = direct.format;
				record.canonicalFormat = canonical.format;
				record.nativeRgba = encode(direct.rgba);
				record.canonicalNativeRgba = encode(canonical.rgba);
				record.rawCanvasRgba = encode(pixels(direct.canvas));
				record.readbackCanvasRgba = encode(pixels(canonical.canvas));
				native.set(item.id, new Uint8Array(direct.rgba));
			}
		}
		report.records.push(record);
	}
	for (const id of [
		"recovered",
		"stamp-full",
		"seed-variant",
		"static-ice",
		"recover-half",
		"stamp-full",
	]) {
		const actual = normal(resolved.get(id));
		require(equal(actual, normalFrames.get(id)), `Seek order changed ${id}`);
		report.seek.push({ id, exact: true });
	}
	if (input.diagnostic) {
		const valid = resolved.get("static-ice");
		for (const [label, invoke] of [
			["truncated-rgba", () => raw(valid, new Uint8Array(3))],
			["empty-passes", () => raw([])],
			[
				"unknown-shader",
				() => raw([{ shader: "unknown-frost-v2-shader", uniforms: [] }]),
			],
		]) {
			let error;
			try {
				await invoke();
			} catch (reason) {
				error = String(reason);
			}
			require(error &&
				!error.includes(
					"Only one diagnostic readback may be pending",
				), `Rejection missing or guard leaked: ${label}`);
			const recovered = await raw(valid);
			require(equal(
				new Uint8Array(recovered.rgba),
				native.get("static-ice"),
			), `Recovery changed pixels: ${label}`);
			report.recovery.push({ label, error, exactRecovery: true });
		}
	}
	report.ok = true;
} catch (error) {
	report.failure = String(error.stack ?? error);
} finally {
	try {
		api.disposeGpu();
		report.gpuDisposed = query.selectedBackend() === null;
	} catch (error) {
		report.disposeFailure = String(error);
		report.ok = false;
	}
	query.free();
	report.queryFreed = true;
	globalThis.__frostReferenceCapture = report;
}
