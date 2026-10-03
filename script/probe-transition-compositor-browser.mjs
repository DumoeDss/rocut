import * as api from "./opencut_wasm_bg.js";

export async function runTransitionCompositorProbe() {
	const { instance } = await WebAssembly.instantiateStreaming(
		fetch("./opencut_wasm_bg.wasm"),
		{
			"./opencut_wasm_bg.js": api,
		},
	);
	api.__wbg_set_wasm(instance.exports);
	instance.exports.__wbindgen_start();
	await api.initializeGpu();
	const query = new api.WasmRuntimeGraphicsQuery();
	const backend = query.selectedBackend();
	query.free();
	const handle = api.createCompositor(64, 64);
	const checks = [];
	const source = (rgba) => {
		const canvas = new OffscreenCanvas(1, 1);
		canvas
			.getContext("2d")
			.putImageData(new ImageData(new Uint8ClampedArray(rgba), 1, 1), 0, 0);
		return canvas;
	};
	const upload = (id, rgba) =>
		api.uploadTextureForHandle(handle, {
			id,
			source: source(rgba),
			width: 1,
			height: 1,
		});
	const layer = (textureId) => ({
		textureId,
		transform: {
			centerX: 32,
			centerY: 32,
			width: 64,
			height: 64,
			rotationDegrees: 0,
			flipX: false,
			flipY: false,
		},
		opacity: 1,
		blendMode: "normal",
		effectPassGroups: [],
		mask: null,
	});
	const transition = (progress) => ({
		type: "transition",
		outgoing: [layer("red")],
		incoming: [layer("blue")],
		progress,
	});
	const render = (items) => {
		api.renderFrameForHandle(handle, {
			width: 64,
			height: 64,
			clear: { color: [0, 1, 0, 1] },
			items,
		});
		const output = new OffscreenCanvas(64, 64);
		const ctx = output.getContext("2d");
		ctx.drawImage(api.getCompositorCanvasForHandle(handle), 0, 0);
		return Array.from(ctx.getImageData(32, 32, 1, 1).data);
	};
	const expectPixel = (name, actual, expected) => {
		if (!actual.every((v, i) => Math.abs(v - expected[i]) <= 3))
			throw Error(name + ": " + JSON.stringify({ actual, expected }));
		checks.push({ name, actual, expected, pass: true });
	};
	try {
		upload("red", [255, 0, 0, 255]);
		upload("blue", [0, 0, 255, 255]);
		for (const [progress, expected] of [
			[0, [255, 0, 0, 255]],
			[0.25, [191, 0, 64, 255]],
			[0.5, [128, 0, 128, 255]],
			[1, [0, 0, 255, 255]],
		]) {
			expectPixel(
				"opaque dissolve " + progress,
				render([transition(progress)]),
				expected,
			);
		}
		upload("red", [255, 0, 0, 128]);
		upload("blue", [0, 0, 255, 64]);
		expectPixel(
			"independent translucent pictures over green",
			render([transition(0.5)]),
			[64, 159, 32, 255],
		);
		const multiply = transition(0.5);
		multiply.outgoing[0].blendMode = "multiply";
		multiply.incoming[0].blendMode = "multiply";
		expectPixel(
			"both branch blend modes use original backdrop",
			render([multiply]),
			[0, 159, 0, 255],
		);
		for (const progress of [-0.1, 1.1, NaN, Infinity]) {
			let rejected = false;
			try {
				render([transition(progress)]);
			} catch (error) {
				rejected = String(error).includes("Transition progress");
			}
			if (!rejected)
				throw Error("Invalid progress was not rejected: " + progress);
		}
		checks.push({
			name: "invalid progress rejected by shipped WASM",
			pass: true,
		});
		expectPixel(
			"render resumes after rejected frames",
			render([transition(0.5)]),
			[64, 159, 32, 255],
		);
		return { backend, checks, passed: true };
	} finally {
		api.disposeCompositor(handle);
		const resources = new api.WasmRuntimeGpuResourceQuery();
		try {
			if (resources.liveHandles().length !== 0)
				throw Error("Probe leaked compositor handles");
			checks.push({
				name: "probe releases every compositor handle",
				pass: true,
			});
		} finally {
			resources.free();
			api.disposeGpu();
		}
	}
}
