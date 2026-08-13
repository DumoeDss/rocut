import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.OPENCUT_PROCESSING_CAPACITY_TEST_ISOLATED !== "1") {
	test("media capacity test runs with the wasm test double", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_PROCESSING_CAPACITY_TEST_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated processing capacity suite failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	await import("../../editor/session/__tests__/wasm-test-mock");
	const { InMemoryProjectStore, InMemoryProjectStoreControl } =
		await import("@opencut/editor-ports/in-memory");
	const { createInMemoryHost } = await import("@opencut/editor-ports/in-memory/host");
	const { UNIMPLEMENTED_RUNTIME_GPU } =
		await import("@opencut/editor-ports");
	const { createSessionResources } =
		await import("../../editor/session/session-resources");
	const { inspectMediaCapacity, processMediaAssets } =
		await import("../processing");

	test("distinguishes unavailable, unknown and zero remaining capacity", async () => {
		const control = new InMemoryProjectStoreControl();
		const store = new InMemoryProjectStore({ control });

		control.setInspection({
			availability: "unavailable",
			capacity: null,
			reason: "offline",
		});
		expect(await inspectMediaCapacity({ store, requiredBytes: 1 })).toEqual({
			canStore: false,
			availableBytes: null,
		});

		control.setInspection({ availability: "available", capacity: null });
		expect(await inspectMediaCapacity({ store, requiredBytes: 1 })).toEqual({
			canStore: true,
			availableBytes: null,
		});

		control.setInspection({
			availability: "available",
			capacity: { usedBytes: 10, totalBytes: 10, remainingBytes: 0 },
		});
		expect(await inspectMediaCapacity({ store, requiredBytes: 1 })).toEqual({
			canStore: false,
			availableBytes: 0,
		});
	});

	test("image transient URLs revoke on success, error, and suspended cancellation", async () => {
		const windowDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"window",
		);
		const documentDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"document",
		);
		const imageDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"Image",
		);
		const images: Array<{
			naturalWidth: number;
			naturalHeight: number;
			emit(type: "load" | "error"): void;
		}> = [];
		class ControlledImage {
			naturalWidth = 16;
			naturalHeight = 9;
			src = "";
			private readonly listeners = new Map<string, () => void>();

			constructor() {
				images.push(this);
			}

			// eslint-disable-next-line opencut/prefer-object-params -- implements the DOM EventTarget API
			addEventListener(type: string, listener: () => void): void {
				this.listeners.set(type, listener);
			}

			remove(): void {}

			emit(type: "load" | "error"): void {
				this.listeners.get(type)?.();
			}
		}
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: globalThis,
		});
		Object.defineProperty(globalThis, "Image", {
			configurable: true,
			value: ControlledImage,
		});
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: {
				createElement: (tag: string) => {
					if (tag !== "canvas") throw new Error(`Unexpected element ${tag}`);
					return {
						width: 0,
						height: 0,
						getContext: () => ({ drawImage() {} }),
						toDataURL: () => "data:image/jpeg;base64,fixture",
					};
				},
			},
		});

		const run = async ({
			terminal,
		}: {
			terminal: "load" | "error" | "suspend";
		}) => {
			const host = createInMemoryHost();
			const rawCreateObjectUrl = host.runtimeResources.createObjectUrl.bind(
				host.runtimeResources,
			);
			const urls: Array<{ revokeCalls: number }> = [];
			host.runtimeResources.createObjectUrl = ({ blob }) => {
				const raw = rawCreateObjectUrl({ blob });
				const state = { revokeCalls: 0 };
				urls.push(state);
				return {
					...raw,
					revoke: () => {
						state.revokeCalls += 1;
						raw.revoke();
					},
				};
			};
			let sequence = 0;
			const resources = createSessionResources({
				runtimeResources: host.runtimeResources,
				runtimeGpu: UNIMPLEMENTED_RUNTIME_GPU,
				nextId: ({ scope }) => `${scope}-${++sequence}`,
			});
			const imageIndex = images.length;
			const processing = processMediaAssets({
				files: [
					new File([Uint8Array.of(1)], `${terminal}.png`, {
						type: "image/png",
					}),
				],
				store: {
					inspect: async () => ({
						availability: "available" as const,
						capacity: null,
					}),
				},
				resources,
				reportPersistenceFailure: () => {},
			});
			for (
				let attempt = 0;
				attempt < 16 && images.length === imageIndex;
				attempt += 1
			) {
				await Promise.resolve();
			}
			const image = images[imageIndex];
			if (!image) throw new Error("Image processing did not create an Image.");
			if (terminal === "suspend") {
				resources.beginActivitySuspend();
				await resources.drainActivityResources();
				image.emit("load");
			} else {
				image.emit(terminal);
			}
			const assets = await processing;
			await resources.disposeAll();
			return { assets, urls };
		};

		try {
			const successful = await run({ terminal: "load" });
			expect(successful.assets).toHaveLength(1);
			expect(successful.urls.map((url) => url.revokeCalls)).toEqual([1, 1]);

			const failed = await run({ terminal: "error" });
			expect(failed.assets).toEqual([]);
			expect(failed.urls.map((url) => url.revokeCalls)).toEqual([1, 1]);

			const cancelled = await run({ terminal: "suspend" });
			expect(cancelled.assets).toEqual([]);
			expect(cancelled.urls.map((url) => url.revokeCalls)).toEqual([1, 1]);
		} finally {
			if (windowDescriptor) {
				Object.defineProperty(globalThis, "window", windowDescriptor);
			} else {
				Reflect.deleteProperty(globalThis, "window");
			}
			if (documentDescriptor) {
				Object.defineProperty(globalThis, "document", documentDescriptor);
			} else {
				Reflect.deleteProperty(globalThis, "document");
			}
			if (imageDescriptor) {
				Object.defineProperty(globalThis, "Image", imageDescriptor);
			} else {
				Reflect.deleteProperty(globalThis, "Image");
			}
		}
	});
}
