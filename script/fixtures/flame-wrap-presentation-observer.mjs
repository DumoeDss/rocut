// Self-contained for page.addInitScript; observes existing publication calls only.
export function installFlameWrapPresentationObserver(options = {}) {
	const width = options.width ?? 192,
		height = options.height ?? 128;
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1 ||
		width * height > 16777216
	)
		throw new Error("Invalid presentation observer geometry");
	const key = "__flameWrapPresentationObserver";
	if (globalThis[key])
		throw new Error("Presentation observer already installed");
	const records = new WeakMap(),
		owned = new Set(),
		hooks = [];
	let active = true,
		serial = 0,
		errors = 0;
	const eligible = (canvas) =>
		active &&
		canvas &&
		canvas.ownerDocument === document &&
		document.contains(canvas) &&
		canvas.width === width &&
		canvas.height === height;
	const publish = (gl, method) => {
		const canvas = gl.canvas;
		if (
			!eligible(canvas) ||
			gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) !== null
		)
			return;
		let record = records.get(canvas);
		if (!record) {
			const scratch = document.createElement("canvas");
			scratch.width = width;
			scratch.height = height;
			const context = scratch.getContext("2d", { willReadFrequently: true });
			if (!context) throw new Error("Observer 2D scratch unavailable");
			record = { scratch, context, sample: null };
			records.set(canvas, record);
			owned.add(record);
		}
		record.context.clearRect(0, 0, width, height);
		record.context.drawImage(canvas, 0, 0);
		const data = record.context.getImageData(0, 0, width, height).data;
		let alphaPositive = false,
			opaque = true;
		for (let index = 3; index < data.length; index += 4) {
			alphaPositive ||= data[index] > 0;
			opaque &&= data[index] === 255;
		}
		// An empty idle drawing buffer must never overwrite a retained publication.
		if (!alphaPositive) return;
		record.sample = {
			serial: ++serial,
			width,
			height,
			rgba: new Uint8ClampedArray(data),
			opaque,
			method,
			contextAttributes: gl.getContextAttributes(),
			scope:
				"synchronous-copy-of-existing-production-default-framebuffer-canvas-publication",
		};
	};
	const prototype = globalThis.WebGL2RenderingContext?.prototype;
	if (prototype)
		for (const name of [
			"flush",
			"blitFramebuffer",
			"drawArrays",
			"drawElements",
		]) {
			const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
			if (
				!descriptor ||
				typeof descriptor.value !== "function" ||
				(!descriptor.configurable && !descriptor.writable)
			)
				continue;
			const original = descriptor.value;
			const wrapper = function (...args) {
				const result = Reflect.apply(original, this, args);
				if (active)
					try {
						publish(this, name);
					} catch {
						errors++;
					}
				return result;
			};
			Object.defineProperty(prototype, name, { ...descriptor, value: wrapper });
			hooks.push({ name, descriptor, wrapper });
		}
	const observer = {
		read(canvas) {
			if (!eligible(canvas)) return null;
			const sample = records.get(canvas)?.sample;
			return sample
				? {
						...sample,
						rgba: Array.from(sample.rgba),
						contextAttributes: sample.contextAttributes
							? { ...sample.contextAttributes }
							: null,
					}
				: null;
		},
		status() {
			return {
				active,
				serial,
				errors,
				hooks: hooks.map((hook) => hook.name),
				width,
				height,
				scope:
					"Observation only; no render calls, context flag/size changes, raw GPU readback, or screenshot normalization. Hook coverage is not proof of live presentation.",
			};
		},
		cleanup() {
			active = false;
			for (const hook of hooks)
				if (prototype[hook.name] === hook.wrapper)
					Object.defineProperty(prototype, hook.name, hook.descriptor);
			for (const record of owned) {
				record.sample = null;
				record.scratch.width = 0;
				record.scratch.height = 0;
			}
			owned.clear();
			if (globalThis[key] === observer) delete globalThis[key];
		},
	};
	globalThis[key] = observer;
}
