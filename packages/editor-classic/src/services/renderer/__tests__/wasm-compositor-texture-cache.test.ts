import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.OPENCUT_COMPOSITOR_TEXTURE_TEST_ISOLATED !== "1") {
	test("rendered-texture cache suite runs with an isolated wasm mock", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_COMPOSITOR_TEXTURE_TEST_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated compositor texture suite failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	}, 15_000);
} else {
	class TestOffscreenCanvas {
		readonly width: number;
		readonly height: number;

		// eslint-disable-next-line opencut/prefer-object-params -- mirrors the platform OffscreenCanvas constructor.
		constructor(width: number, height: number) {
			this.width = width;
			this.height = height;
		}

		getContext() {
			return {
				clearRect() {},
				fillRect() {},
				fillStyle: "",
			};
		}
	}

	Object.defineProperty(globalThis, "OffscreenCanvas", {
		configurable: true,
		value: TestOffscreenCanvas,
	});

	const { wasmTestControl } =
		await import("../../../editor/session/__tests__/wasm-test-mock");
	const { createSessionResources } =
		await import("../../../editor/session/session-resources");
	const { InMemoryRuntimeResourceHost } =
		await import("@opencut/editor-ports/in-memory");
	const { WasmCompositor } = await import("../compositor/wasm-compositor");

	function createCompositor() {
		let released = 0;
		let nextId = 0;
		const resources = createSessionResources({
			runtimeResources: new InMemoryRuntimeResourceHost(),
			runtimeGpu: {
				liveHandles: () => [],
				release: () => {
					released += 1;
				},
			},
			nextId: ({ scope }) => `${scope}:${++nextId}`,
		});
		const compositor = new WasmCompositor(resources);
		compositor.ensureInitialized({ width: 64, height: 36 });
		return { compositor, getReleaseCount: () => released };
	}

	describe("WasmCompositor rendered texture cache", () => {
		test("hash changes redraw and upload through one bounded backing surface", () => {
			const uploadStart = wasmTestControl.textureUploads().length;
			const releaseStart = wasmTestControl.textureReleases().length;
			const { compositor, getReleaseCount } = createCompositor();
			let draws = 0;
			const texture = (contentHash: string) => ({
				kind: "rendered" as const,
				id: "motion-text:stable",
				contentHash,
				width: 64,
				height: 36,
				draw: (context: OffscreenCanvasRenderingContext2D) => {
					draws += 1;
					context.fillStyle = contentHash;
					context.fillRect(0, 0, 64, 36);
				},
			});

			compositor.syncTextures([texture("frame:0")]);
			compositor.syncTextures([texture("frame:0")]);
			compositor.syncTextures([texture("frame:1")]);

			const initialUploads = wasmTestControl
				.textureUploads()
				.slice(uploadStart);
			expect(draws).toBe(2);
			expect(initialUploads).toHaveLength(2);
			expect(initialUploads[0]?.id).toBe("motion-text:stable");
			expect(initialUploads[1]?.source).toBe(initialUploads[0]?.source);

			for (let frame = 2; frame < 1_002; frame += 1) {
				compositor.syncTextures([texture(`frame:${frame}`)]);
			}

			const stressUploads = wasmTestControl.textureUploads().slice(uploadStart);
			expect(stressUploads).toHaveLength(1_002);
			expect(draws).toBe(1_002);
			expect(new Set(stressUploads.map(({ source }) => source)).size).toBe(1);

			compositor.syncTextures([]);
			expect(wasmTestControl.textureReleases().slice(releaseStart)).toEqual([
				expect.objectContaining({ id: "motion-text:stable" }),
			]);
			compositor.dispose();
			expect(getReleaseCount()).toBe(1);
		});
	});
}
