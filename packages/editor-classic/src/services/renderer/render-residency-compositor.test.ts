/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- isolated host/GPU boundary doubles around the real compositor/domain/renderer classes. */
import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { SessionResources } from "../../editor/session/resources";
import type { VideoCache } from "../video-cache/service";

if (process.env.ROCUT_RESIDENCY_COMPOSITOR_ISOLATED !== "1") {
	test("compositor residency lifecycle runs in an isolated process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			env: { ...process.env, ROCUT_RESIDENCY_COMPOSITOR_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw Error(result.stdout.toString() + result.stderr.toString());
	}, 15000);
} else {
	let resourceFailure = false,
		textureClearFailure = false,
		nativeFrees = 0;
	class NativeAdmission {
		request() {
			throw Error("No preparation in compositor lifetime test");
		}
		key() {
			return "opaque";
		}
		admit(bytes: number) {
			if (bytes > 1024) throw Error("native budget");
		}
		begin() {
			return 1n;
		}
		step() {
			return true;
		}
		take() {
			return new Uint8Array();
		}
		dispose() {}
		free() {
			nativeFrees++;
		}
	}
	mock.module("opencut-wasm", () => ({
		MvImagePreprocessOwner: NativeAdmission,
		createCompositor: () => 1,
		disposeCompositor: () => {},
		getCompositorCanvasForHandle: () => ({ width: 2, height: 2 }),
		getLastFrameProfile: () => [],
		releaseTextureForHandle: () => {
			if (textureClearFailure) throw Error("texture clear failed");
		},
		renderFrameForHandle: () => {},
		resizeCompositorForHandle: () => {},
		uploadTextureForHandle: () => {},
	}));
	mock.module("./canvas-utils", () => ({
		createCanvasSurface: () => ({ canvas: {}, context: {} }),
	}));
	mock.module("./resolve", () => ({ resolveRenderTree: async () => {} }));
	mock.module("./compositor/frame-descriptor", () => ({
		buildFrameDescriptor: async () => ({ frame: {}, textures: [] }),
	}));
	class Canvas {
		width: number;
		height: number;
		constructor(...[width, height]: [number, number]) {
			this.width = width;
			this.height = height;
		}
		getContext() {
			return { drawImage() {} };
		}
	}
	Reflect.set(globalThis, "OffscreenCanvas", Canvas);
	const { WasmCompositor } = await import("./compositor/wasm-compositor");
	const { CanvasRenderer } = await import("./canvas-renderer");
	const { RootNode } = await import("./nodes/root-node");
	function fixture() {
		resourceFailure = false;
		textureClearFailure = false;
		const resources = {
			trackGpuResource: ({ handle }: { handle: number }) => ({
				handle,
				release: () => {
					if (resourceFailure) throw Error("resource clear failed");
				},
			}),
		} as unknown as SessionResources;
		const compositor = new WasmCompositor(resources);
		const params = {
			width: 2,
			height: 2,
			fps: { numerator: 60, denominator: 1 },
			compositor,
			videoCache: {} as VideoCache,
		};
		const renderer = new CanvasRenderer(params);
		return { compositor, renderer, params };
	}
	function publish(input: ReturnType<typeof fixture>) {
		const domain = input.renderer.rasterResidencyDomain,
			root = new RootNode({ duration: 1 }),
			scope = domain.tree(root),
			client = scope.client({});
		const canvas = new OffscreenCanvas(2, 2);
		client.reserveCanvas({ width: 2, height: 2 }).attach(canvas);
		const textures = [
			{
				kind: "external" as const,
				id: "x",
				source: canvas,
				sourceVersion: "1",
				width: 2,
				height: 2,
			},
		];
		const transaction = domain.preparePublication({ scope, textures });
		input.compositor.ensureInitialized({ width: 2, height: 2 });
		input.compositor.syncTextures(textures);
		transaction.commitAfterTextureSync();
		client.close();
		return { domain, root };
	}
	test("default two renderers reuse exactly one compositor-owned domain", async () => {
		const input = fixture(),
			other = new CanvasRenderer(input.params);
		expect(other.rasterResidencyDomain).toBe(
			input.renderer.rasterResidencyDomain,
		);
		await input.compositor.close();
	});
	test("synchronous dispose releases final published canvas/GPU pins and close awaits remaining grace", async () => {
		const input = fixture(),
			{ domain } = publish(input),
			before = nativeFrees;
		expect(Reflect.get(domain.preprocessor, "externalBytes")).toBe(32);
		const grace = domain.preprocessor.reserve(8);
		input.compositor.dispose();
		expect(Reflect.get(domain.preprocessor, "externalBytes")).toBe(8);
		expect(nativeFrees).toBe(before);
		let closed = false;
		const closing = input.compositor.close().then(() => {
			closed = true;
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(closed).toBe(false);
		grace();
		await closing;
		expect(nativeFrees).toBe(before + 1);
	});
	test("failed real resource clear preserves final publication residency and reports close failure", async () => {
		const input = fixture(),
			{ domain } = publish(input),
			before = nativeFrees;
		resourceFailure = true;
		await expect(input.compositor.close()).rejects.toThrow(
			"resource clear failed",
		);
		expect(Reflect.get(domain.preprocessor, "externalBytes")).toBe(32);
		expect(nativeFrees).toBe(before);
	});
	test("failed syncTextures clear retains charged publication until actual close", async () => {
		const input = fixture(),
			{ domain, root } = publish(input);
		textureClearFailure = true;
		await expect(input.renderer.retireTree(root)).rejects.toThrow(
			"texture clear failed",
		);
		expect(Reflect.get(domain.preprocessor, "externalBytes")).toBe(32);
		textureClearFailure = false;
		await input.compositor.close();
		expect(Reflect.get(domain.preprocessor, "externalBytes")).toBe(0);
	});
	test("sync dispose observes cleanup rejection and close propagates that same failure", async () => {
		const input = fixture(),
			domain = input.renderer.rasterResidencyDomain,
			reason = Error("native owner drain failed");
		Reflect.set(domain.preprocessor, "disposeAndDrain", () =>
			Promise.reject(reason),
		);
		input.compositor.dispose();
		await expect(input.compositor.close()).rejects.toBe(reason);
	});
	test("retiring failed old-root sync restores new-root publication and retains charges on recovery failure", async () => {
		const input = fixture(),
			{ domain, root: currentRoot } = publish(input),
			oldRoot = new RootNode({ duration: 1 }),
			oldScope = domain.tree(oldRoot),
			oldCanvas = new OffscreenCanvas(2, 2);
		oldScope
			.client({})
			.reserveCanvas({ width: 2, height: 2 })
			.attach(oldCanvas);
		const textures = [
			{
				kind: "external" as const,
				id: "old",
				source: oldCanvas,
				sourceVersion: "1",
				width: 2,
				height: 2,
			},
		];
		const failed = domain.preparePublication({ scope: oldScope, textures });
		// Native sync can change the cache before a later upload/release fails.
		input.compositor.syncTextures(textures);
		failed.discard({ textureSyncStarted: true });
		expect(Reflect.get(domain.preprocessor, "externalBytes")).toBe(64);
		textureClearFailure = true;
		await expect(input.renderer.retireTree(oldRoot)).rejects.toThrow(
			"texture clear failed",
		);
		expect(Reflect.get(domain.preprocessor, "externalBytes")).toBe(64);
		textureClearFailure = false;
		await input.renderer.retireTree(oldRoot);
		expect(Reflect.get(domain.preprocessor, "externalBytes")).toBe(32);
		expect(domain.isPublishedScope(domain.tree(currentRoot))).toBe(true);
		expect(domain.isPublishedScope(oldScope)).toBe(false);
		const cache = Reflect.get(input.compositor, "cache") as Map<
			string,
			unknown
		>;
		expect([...cache.keys()]).toEqual(["x"]);
		await input.renderer.retireTree(currentRoot);
		expect(Reflect.get(domain.preprocessor, "externalBytes")).toBe(0);
		await input.compositor.close();
	});
}
