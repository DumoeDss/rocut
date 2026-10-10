// Self-contained for page.addInitScript. Diagnostic only, not an encoder replacement.
export function installFlameWrapPreencodeObserver(options) {
	const { timestamp, width = 192, height = 128 } = options ?? {};
	if (
		![timestamp, width, height].every(Number.isSafeInteger) ||
		timestamp < 0 ||
		width < 1 ||
		height < 1 ||
		width * height > 16777216
	)
		throw new Error("Invalid preencode observer target");
	const key = "__flameWrapPreencodeObserver";
	if (globalThis[key]) throw new Error("Preencode observer already installed");
	const prototype = globalThis.VideoEncoder?.prototype;
	const descriptor =
		prototype && Object.getOwnPropertyDescriptor(prototype, "encode");
	const configureDescriptor =
		prototype && Object.getOwnPropertyDescriptor(prototype, "configure");
	const framePrototype = globalThis.VideoFrame?.prototype;
	if (
		!descriptor ||
		typeof descriptor.value !== "function" ||
		(!descriptor.configurable && !descriptor.writable) ||
		!configureDescriptor ||
		typeof configureDescriptor.value !== "function" ||
		(!configureDescriptor.configurable && !configureDescriptor.writable) ||
		!["clone", "copyTo", "close"].every(
			(name) => typeof framePrototype?.[name] === "function",
		)
	)
		throw new Error("Native WebCodecs observation point unavailable");
	const nativeEncode = descriptor.value,
		apply = Reflect.apply;
	const configurations = new WeakMap(),
		nativeConfigure = configureDescriptor.value;
	const nativeClone = framePrototype.clone,
		nativeCopy = framePrototype.copyTo,
		nativeClose = framePrototype.close;
	let active = true,
		matches = 0,
		phase = "waiting",
		error = null,
		sample = null,
		task = Promise.resolve();
	const fail = (cause) => {
		error ??= String(cause?.message ?? cause);
		phase = "failed";
		sample = null;
	};
	const release = (clone) => {
		try {
			apply(nativeClose, clone, []);
		} catch (cause) {
			fail(cause);
		}
	};
	const configureWrapper = function (...args) {
		const result = apply(nativeConfigure, this, args);
		if (active)
			try {
				configurations.set(this, structuredClone(args[0]));
			} catch (cause) {
				fail(cause);
			}
		return result;
	};
	const wrapper = function (...args) {
		let clone, metadata;
		if (active) {
			try {
				if (args[0]?.timestamp === timestamp) {
					matches++;
					if (matches !== 1)
						throw new Error("Ambiguous repeated target encode");
					clone = apply(nativeClone, args[0], []);
					const rect = clone.visibleRect;
					if (
						!rect ||
						rect.width !== width ||
						rect.height !== height ||
						clone.displayWidth !== width ||
						clone.displayHeight !== height
					)
						throw new Error("Preencode frame geometry mismatch");
					metadata = {
						width,
						height,
						timestamp: clone.timestamp,
						duration: clone.duration,
						format: clone.format,
						codedWidth: clone.codedWidth,
						codedHeight: clone.codedHeight,
						displayWidth: clone.displayWidth,
						displayHeight: clone.displayHeight,
						visibleRect: {
							x: rect.x,
							y: rect.y,
							width: rect.width,
							height: rect.height,
						},
						colorSpace: clone.colorSpace.toJSON(),
						encoderConfig: configurations.get(this) ?? null,
						encodeOptions: structuredClone(args[1] ?? null),
						copyFormat: "RGBA",
						copyColorSpace: "srgb",
						scope:
							"actual-VideoEncoder.encode-input-clone-copyTo-RGBA; not raw GPU readback or encoded bytes",
					};
				}
			} catch (cause) {
				fail(cause);
				if (clone) release(clone);
				clone = undefined;
			}
		}
		let result;
		try {
			result = apply(nativeEncode, this, args);
		} catch (cause) {
			if (clone) {
				fail(cause);
				release(clone);
			}
			throw cause;
		}
		if (clone) {
			phase = "copying";
			const owned = clone;
			task = (async () => {
				try {
					const rgba = new Uint8Array(width * height * 4);
					const layout = await apply(nativeCopy, owned, [
						rgba,
						{
							format: "RGBA",
							colorSpace: "srgb",
							rect: metadata.visibleRect,
							layout: [{ offset: 0, stride: width * 4 }],
						},
					]);
					if (
						layout.length !== 1 ||
						layout[0].offset !== 0 ||
						layout[0].stride !== width * 4
					)
						throw new Error("Unexpected preencode RGBA copy layout");
					if (!error) sample = { ...metadata, rgba: Array.from(rgba) };
				} catch (cause) {
					fail(cause);
				} finally {
					release(owned);
				}
				if (!error) phase = "complete";
			})();
		}
		return result;
	};
	Object.defineProperty(prototype, "encode", { ...descriptor, value: wrapper });
	Object.defineProperty(prototype, "configure", {
		...configureDescriptor,
		value: configureWrapper,
	});
	const observer = {
		status() {
			return { active, phase, matches, error, timestamp, width, height };
		},
		read() {
			return phase === "complete" && sample
				? {
						...sample,
						rgba: [...sample.rgba],
						colorSpace: { ...sample.colorSpace },
						visibleRect: { ...sample.visibleRect },
					}
				: null;
		},
		async cleanup() {
			active = false;
			if (prototype.encode === wrapper)
				Object.defineProperty(prototype, "encode", descriptor);
			if (prototype.configure === configureWrapper)
				Object.defineProperty(prototype, "configure", configureDescriptor);
			await task;
			if (phase === "waiting")
				fail(new Error("Target encode was not observed"));
			return observer.status();
		},
	};
	globalThis[key] = observer;
}
