import * as wasm from "/wasm-glue.mjs";
import {
	width,
	height,
	encode,
	read,
	layer,
	frame,
	complete,
} from "/canvas-capture-support.mjs";

const report = {
	ok: false,
	scope:
		"Real frozen WASM compositor requests and presentation Canvas captures. Optional direct-effects raw readback is separate. Not editor/Host, encoded export or an independent flame pixel oracle.",
	backend: "",
	checks: [],
	frames: [],
	sources: {},
	negatives: [],
	failure: null,
	disposed: false,
};
Reflect.set(globalThis, "__flameWrapProgress", report);
const handles = new Set();
const config = {
	amount: 1,
	boundaryWidth: 8,
	flameHeight: 24,
	flameOpacity: 0.9,
	sparkOpacity: 0.8,
	refraction: 0,
	speed: 1,
	wind: 0,
	seed: 17,
};
const frameRate = { numerator: 30, denominator: 1 };
const check = (id, passed, detail) =>
	report.checks.push({ id, passed, detail });
function compare(a, b) {
	let maximum = 0,
		changed = 0,
		total = 0;
	for (let index = 0; index < a.length; index++) {
		const delta = Math.abs(a[index] - b[index]);
		maximum = Math.max(maximum, delta);
		total += delta;
		changed += Number(delta > 0);
	}
	return { maximum, changedBytes: changed, mean: total / a.length };
}
function equal(id, a, b, tolerance = 0) {
	const metrics = compare(a, b);
	check(id, metrics.maximum <= tolerance, { ...metrics, tolerance });
}
function makeSource(kind) {
	const canvas = new OffscreenCanvas(width, height);
	const bytes = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const insideRectangle = x >= 20 && x < 76 && y >= 18 && y < 54;
			const insideHole = x >= 40 && x < 56 && y >= 30 && y < 42;
			const occupied =
				kind === "opaque" ||
				(kind === "hole" && insideRectangle && !insideHole);
			if (occupied)
				bytes.set(
					[35 + ((x * 3) % 80), 60 + ((y * 2) % 80), 145, 255],
					(y * width + x) * 4,
				);
		}
	canvas
		.getContext("2d")
		.putImageData(new ImageData(bytes, width, height), 0, 0);
	return { canvas, bytes: new Uint8Array(bytes), kind };
}
function resolve(params, ticks = 40000) {
	const dto = { effectType: "flame-wrap", params, localTime: ticks, frameRate };
	const resolved = JSON.parse(
		wasm.resolveStylizedEffectJson(JSON.stringify(dto)),
	);
	if (resolved.error || !Array.isArray(resolved.passes))
		throw Error(resolved.error ?? "Missing Flame Wrap passes");
	return { dto, resolved };
}
function alphaRegion(bytes, sourceBytes, region) {
	let visible = 0,
		maximumAlpha = 0;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4;
			if (!region(x, y) || sourceBytes[offset + 3] !== 0) continue;
			maximumAlpha = Math.max(maximumAlpha, bytes[offset + 3]);
			visible += Number(bytes[offset + 3] > 0);
		}
	return { visiblePixels: visible, maximumAlpha };
}
const outside = (x, y) => x < 20 || x >= 76 || y < 18 || y >= 54;
const hole = (x, y) => x >= 40 && x < 56 && y >= 30 && y < 42;
const distantTransparent = (x, y) =>
	x < 16 ||
	x >= 80 ||
	y < 14 ||
	y >= 58 ||
	(x >= 44 && x < 52 && y >= 34 && y < 38);
async function render(handle, id, source, params, ticks = 40000) {
	report.currentCase = id;
	const resolution = params === null ? null : resolve(params, ticks);
	const passes = resolution?.resolved.passes ?? [];
	const descriptor = frame([layer(source.kind, passes.length ? [passes] : [])]);
	const request = wasm.beginRenderFrameForHandle(handle, descriptor);
	const result = await complete(handle, request);
	const receipt = {
		id,
		sourceId: source.kind,
		request,
		advanceCalls: result.calls,
		width,
		height,
		descriptor,
		dto: resolution?.dto ?? null,
		resolved: resolution?.resolved ?? null,
		actualBase64: encode(result.bytes),
		sourceBase64: encode(source.bytes),
		captureScope: "compositor-presentation-canvas",
		nativeCaptured: false,
	};
	report.frames.push(receipt);
	if (typeof wasm.applyEffectPassesReadback === "function" && passes.length) {
		const raw = await wasm.applyEffectPassesReadback({
			source: source.canvas,
			width,
			height,
			passes: passes.map((pass) => ({
				shader: pass.shader,
				uniforms: Object.entries(pass.uniforms).map(([name, value]) => ({
					name,
					value: [value],
				})),
			})),
		});
		receipt.directEffectsRaw = {
			captureScope: "direct-effects-native-readback",
			nativeCaptured: true,
			width: raw.width,
			height: raw.height,
			backend: raw.backend,
			format: raw.format,
			actualBase64: encode(raw.rgba),
			sourceBase64: encode(source.bytes),
		};
	}
	return result.bytes;
}
async function rejection(id, operation, pattern) {
	let error = null;
	try {
		await operation();
	} catch (caught) {
		error = { name: caught?.name, message: caught?.message ?? String(caught) };
	}
	report.negatives.push({ id, error });
	check(id, Boolean(error && pattern.test(error.message)), error);
}
async function run() {
	let graphics;
	try {
		const wasmBytes = await (await fetch("/wasm.wasm")).arrayBuffer();
		const wasmDigest = await crypto.subtle.digest("SHA-256", wasmBytes);
		report.loadedWasm = {
			bytes: wasmBytes.byteLength,
			sha256: Array.from(new Uint8Array(wasmDigest), (byte) =>
				byte.toString(16).padStart(2, "0"),
			).join(""),
		};
		const compiled = await WebAssembly.compile(wasmBytes);
		const imports = Object.fromEntries(
			WebAssembly.Module.imports(compiled).map(({ module }) => [module, wasm]),
		);
		const instance = await WebAssembly.instantiate(compiled, imports);
		wasm.__wbg_set_wasm(instance.exports);
		instance.exports.__wbindgen_start();
		report.currentCase = "initializeGpu";
		await wasm.initializeGpu();
		graphics = new wasm.WasmRuntimeGraphicsQuery();
		report.backend = graphics.selectedBackend();
		check(
			"selected-backend",
			report.backend === new URL(location.href).searchParams.get("backend"),
			report.backend,
		);
		report.rawReadback = {
			available: typeof wasm.applyEffectPassesReadback === "function",
			scope:
				"Optional direct-effects raw readback; compositor frame captures remain presentation-only.",
		};
		const handle = wasm.createCompositor(width, height);
		handles.add(handle);
		const sources = Object.fromEntries(
			["transparent", "hole", "opaque"].map((kind) => [kind, makeSource(kind)]),
		);
		for (const source of Object.values(sources)) {
			wasm.uploadTextureForHandle(handle, {
				id: source.kind,
				source: source.canvas,
				width,
				height,
			});
			report.sources[source.kind] = {
				width,
				height,
				sourceBase64: encode(source.bytes),
				definition:
					source.kind === "hole"
						? "Opaque rectangle [20,76)x[18,54), transparent hole [40,56)x[30,42)."
						: source.kind,
			};
			const baseline = await render(
				handle,
				`${source.kind}-baseline`,
				source,
				null,
			);
			equal(`${source.kind}-baseline-source`, baseline, source.bytes, 1);
			const neutral = await render(handle, `${source.kind}-neutral`, source, {
				...config,
				amount: 0,
			});
			equal(`${source.kind}-neutral-source`, neutral, source.bytes, 1);
			const neutralChannels = await render(
				handle,
				`${source.kind}-neutral-channels`,
				source,
				{ ...config, flameOpacity: 0, sparkOpacity: 0, refraction: 0 },
			);
			equal(
				`${source.kind}-neutral-channels-source`,
				neutralChannels,
				source.bytes,
				1,
			);
		}
		const fire = { ...config, sparkOpacity: 0 };
		const transparentFire = await render(
			handle,
			"transparent-flame",
			sources.transparent,
			fire,
		);
		equal(
			"transparent-source-no-flame",
			transparentFire,
			sources.transparent.bytes,
		);
		const flame = await render(handle, "hole-flame", sources.hole, fire);
		for (const [name, region] of [
			["outside", outside],
			["hole", hole],
		]) {
			const metrics = alphaRegion(flame, sources.hole.bytes, region);
			check(`flame-visible-${name}`, metrics.visiblePixels > 0, metrics);
		}
		const repeat = await render(
			handle,
			"hole-flame-repeat",
			sources.hole,
			fire,
		);
		equal("same-tick-repeat-bit-exact", repeat, flame);
		const late = await render(
			handle,
			"hole-flame-seek-late",
			sources.hole,
			fire,
			96000,
		);
		const timeChange = compare(late, flame);
		check(
			"different-phase-changes-flame",
			timeChange.changedBytes > 0,
			timeChange,
		);
		const seek = await render(
			handle,
			"hole-flame-seek-back",
			sources.hole,
			fire,
		);
		equal("reverse-seek-bit-exact", seek, flame);
		for (const [name, change] of [
			["seed", { seed: 29 }],
			["wind", { wind: 0.75 }],
		]) {
			const changed = await render(handle, `hole-flame-${name}`, sources.hole, {
				...fire,
				...change,
			});
			const metrics = compare(changed, flame);
			check(`${name}-changes-output`, metrics.changedBytes > 0, metrics);
		}
		const opaqueFlame = await render(
			handle,
			"opaque-canvas-boundary-flame",
			sources.opaque,
			fire,
		);
		let boundaryChanged = 0,
			middleChanged = 0;
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++) {
				const offset = (y * width + x) * 4;
				const changed = [0, 1, 2].some(
					(channel) =>
						Math.abs(
							opaqueFlame[offset + channel] -
								sources.opaque.bytes[offset + channel],
						) > 1,
				);
				if (x < 8 || x >= width - 8 || y < 8 || y >= height - 8)
					boundaryChanged += Number(changed);
				if (x >= 30 && x < 66 && y >= 28 && y < 36)
					middleChanged += Number(changed);
			}
		check(
			"fully-opaque-has-canvas-boundary-flame",
			boundaryChanged > 0 && middleChanged === 0,
			{ boundaryChanged, middleChanged },
		);
		const sparkConfig = { ...config, flameOpacity: 0, sparkOpacity: 1 };
		const sparkVisibility = { outside: 0, hole: 0 };
		const sparkFrames = new Set();
		for (const ticks of [0, 16000, 32000, 48000, 64000, 80000, 96000, 112000]) {
			const sparks = await render(
				handle,
				`hole-sparks-${ticks}`,
				sources.hole,
				sparkConfig,
				ticks,
			);
			sparkFrames.add(encode(sparks));
			sparkVisibility.outside += alphaRegion(
				sparks,
				sources.hole.bytes,
				outside,
			).visiblePixels;
			sparkVisibility.hole += alphaRegion(
				sparks,
				sources.hole.bytes,
				hole,
			).visiblePixels;
		}
		check(
			"sparks-visible-outside-over-cycle",
			sparkVisibility.outside > 0,
			sparkVisibility,
		);
		check(
			"sparks-visible-hole-over-cycle",
			sparkVisibility.hole > 0,
			sparkVisibility,
		);
		check("different-phases-change-sparks", sparkFrames.size > 1, {
			uniqueFrames: sparkFrames.size,
		});
		const emptySparks = await render(
			handle,
			"transparent-sparks",
			sources.transparent,
			sparkConfig,
		);
		equal(
			"transparent-source-no-sparks",
			emptySparks,
			sources.transparent.bytes,
		);
		const refraction = {
			...config,
			flameOpacity: 0,
			sparkOpacity: 0,
			refraction: 2,
		};
		const emptyRefraction = await render(
			handle,
			"transparent-refraction",
			sources.transparent,
			refraction,
		);
		equal(
			"transparent-refraction-no-alpha",
			emptyRefraction,
			sources.transparent.bytes,
		);
		const refracted = await render(
			handle,
			"hole-refraction",
			sources.hole,
			refraction,
		);
		let refractedVisibleRgb = 0;
		for (let offset = 0; offset < refracted.length; offset += 4)
			if (sources.hole.bytes[offset + 3] > 16 && refracted[offset + 3] > 16)
				for (let channel = 0; channel < 3; channel++)
					refractedVisibleRgb += Number(
						Math.abs(
							refracted[offset + channel] -
								sources.hole.bytes[offset + channel],
						) > 1,
					);
		check("refraction-changes-visible-source-rgb", refractedVisibleRgb > 0, {
			changedChannels: refractedVisibleRgb,
		});
		const distant = alphaRegion(
			refracted,
			sources.hole.bytes,
			distantTransparent,
		);
		check(
			"refraction-no-alpha-beyond-displacement-support",
			distant.maximumAlpha === 0,
			distant,
		);
		report.refractionBoundaryAlpha = alphaRegion(
			refracted,
			sources.hole.bytes,
			() => true,
		);
		await rejection(
			"invalid-author-parameter",
			() => resolve({ ...config, seed: 0.5 }),
			/invalid.*seed/i,
		);
		const malformed = resolve(config).resolved.passes.map((pass) => ({
			...pass,
			uniforms: { ...pass.uniforms, phase: 1 },
		}));
		await rejection(
			"invalid-pass-before-publication",
			async () => {
				const request = wasm.beginRenderFrameForHandle(
					handle,
					frame([layer("hole", [malformed])]),
				);
				await complete(handle, request);
			},
			/phase|invalid.*uniform/i,
		);
		const beforeWork = read(wasm.getCompositorCanvasForHandle(handle));
		const budgetPass = resolve({
			...config,
			boundaryWidth: 32,
			flameHeight: 128,
		}).resolved.passes;
		const budgetSource = new OffscreenCanvas(4096, 2560);
		const budgetContext = budgetSource.getContext("2d");
		if (!budgetContext)
			throw Error("Work-budget source 2D context unavailable");
		budgetContext.clearRect(0, 0, 4096, 2560);
		report.workNegative = {
			scope:
				"Direct effects admission with matching source and declared dimensions; compositor publication checked separately.",
			width: 4096,
			height: 2560,
			sourceWidth: 4096,
			sourceHeight: 2560,
			sourceSpec:
				"2D canvas uniformly transparent RGBA [0,0,0,0] after clearRect.",
			passes: budgetPass,
		};
		await rejection(
			"pass-work-budget-rejected",
			() =>
				wasm.applyEffectPasses({
					source: budgetSource,
					width: 4096,
					height: 2560,
					passes: budgetPass.map((pass) => ({
						shader: pass.shader,
						uniforms: Object.entries(pass.uniforms).map(([name, value]) => ({
							name,
							value: [value],
						})),
					})),
				}),
			/work|budget/i,
		);
		equal(
			"work-rejection-does-not-publish-compositor",
			read(wasm.getCompositorCanvasForHandle(handle)),
			beforeWork,
		);
		const recovery = await render(
			handle,
			"after-negative-recovery",
			sources.hole,
			fire,
		);
		equal("negative-recovery-bit-exact", recovery, flame);
	} catch (error) {
		report.failure = error?.stack ?? String(error);
	} finally {
		const cleanupFailures = [];
		for (const handle of handles)
			try {
				wasm.disposeCompositor(handle);
			} catch (error) {
				cleanupFailures.push(String(error));
			}
		try {
			graphics?.free();
		} catch (error) {
			cleanupFailures.push(String(error));
		}
		try {
			wasm.disposeGpu();
		} catch (error) {
			cleanupFailures.push(String(error));
		}
		report.cleanupFailures = cleanupFailures;
		report.disposed = cleanupFailures.length === 0;
		report.ok =
			!report.failure &&
			report.disposed &&
			report.checks.length > 0 &&
			report.checks.every((entry) => entry.passed);
		Reflect.set(globalThis, "__flameWrapResult", report);
	}
}
run();
