/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- isolated canvas/compositor boundary doubles; real pixels are covered by the browser pipeline. */
import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { WasmCompositor } from "../compositor/wasm-compositor";
import type { RootNode } from "../nodes/root-node";
import type { VideoCache } from "../../video-cache/service";

if (process.env.ROCUT_CANVAS_PUBLICATION_ISOLATED !== "1") {
	test("canvas publication tests run with isolated boundary doubles", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: { ...process.env, ROCUT_CANVAS_PUBLICATION_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw new Error(result.stdout.toString() + result.stderr.toString());
	}, 15000);
} else {
	mock.module("../resolve", () => ({ resolveRenderTree: async () => {} }));
	mock.module("../compositor/frame-descriptor", () => ({
		buildFrameDescriptor: async () => ({
			frame: {
				width: 96,
				height: 64,
				items: [],
				clear: { color: [0, 0, 0, 0] },
			},
			textures: [],
		}),
	}));
	mock.module("../canvas-utils", () => ({
		createCanvasSurface: () => ({ canvas: {}, context: {} }),
	}));
	const { CanvasRenderer } = await import("../canvas-renderer");

	function create({
		initialMode = "source-over",
		drawFailure,
		render = async () => {},
	}: {
		initialMode?: GlobalCompositeOperation;
		drawFailure?: Error;
		render?: () => Promise<void>;
	} = {}) {
		let mode = initialMode;
		const events: string[] = [];
		const source = { width: 96, height: 64 } as HTMLCanvasElement;
		const drawImage = mock((..._args: unknown[]) => {
			events.push(`draw:${mode}`);
			if (drawFailure) throw drawFailure;
		});
		const context = {
			get globalCompositeOperation() {
				return mode;
			},
			set globalCompositeOperation(value: GlobalCompositeOperation) {
				mode = value;
				events.push(`mode:${value}`);
			},
			drawImage,
		};
		const getContext = mock(() => context);
		const target = {
			width: 192,
			height: 128,
			getContext,
		} as unknown as HTMLCanvasElement;
		// eslint-disable-next-line opencut/prefer-object-params -- mirrors the production runExclusive callback/options signature.
		const runExclusive: WasmCompositor["runExclusive"] = (
			operation,
			{ signal } = {},
		) => Promise.resolve(operation(signal ?? new AbortController().signal));
		const renderAsync = mock(render);
		const compositor = {
			runExclusive,
			ensureInitialized() {},
			syncTextures() {},
			renderAsync,
			getCanvas: () => source,
		} as unknown as WasmCompositor;
		const renderer = new CanvasRenderer({
			width: 96,
			height: 64,
			fps: { numerator: 30, denominator: 1 },
			compositor,
			videoCache: {} as VideoCache,
		});
		const publish = (signal?: AbortSignal) =>
			renderer.renderToCanvas({
				node: {} as RootNode,
				time: 0,
				targetCanvas: target,
				signal,
			});
		return {
			publish,
			context,
			events,
			drawImage,
			getContext,
			renderAsync,
			source,
		};
	}

	test.each(["source-over", "destination-over", "multiply"] as const)(
		"publishes once with copy and restores %s after success",
		async (initialMode: GlobalCompositeOperation) => {
			const fixture = create({ initialMode });
			await fixture.publish();
			expect(fixture.events).toEqual([
				"mode:copy",
				"draw:copy",
				`mode:${initialMode}`,
			]);
			expect(fixture.drawImage).toHaveBeenCalledTimes(1);
			expect(fixture.drawImage).toHaveBeenCalledWith(
				fixture.source,
				0,
				0,
				192,
				128,
			);
			expect(fixture.context.globalCompositeOperation).toBe(initialMode);
		},
	);

	test("restores the original mode and propagates a draw failure", async () => {
		const failure = new Error("drawImage failed");
		const fixture = create({ initialMode: "multiply", drawFailure: failure });
		await expect(fixture.publish()).rejects.toBe(failure);
		expect(fixture.events).toEqual(["mode:copy", "draw:copy", "mode:multiply"]);
		expect(fixture.context.globalCompositeOperation).toBe("multiply");
		expect(fixture.drawImage).toHaveBeenCalledTimes(1);
	});

	test("a pre-aborted request never accesses or writes the target", async () => {
		const controller = new AbortController();
		controller.abort();
		const fixture = create();
		await expect(fixture.publish(controller.signal)).rejects.toMatchObject({
			code: "RENDER_CANCELLED",
		});
		expect(fixture.getContext).not.toHaveBeenCalled();
		expect(fixture.renderAsync).not.toHaveBeenCalled();
		expect(fixture.events).toEqual([]);
		expect(fixture.context.globalCompositeOperation).toBe("source-over");
	});

	test("an abort while rendering cannot change target pixels or mode", async () => {
		const controller = new AbortController();
		let entered!: () => void;
		let finish!: () => void;
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const blocked = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const fixture = create({
			initialMode: "destination-over",
			render: async () => {
				entered();
				await blocked;
			},
		});
		const pending = fixture.publish(controller.signal);
		try {
			await started;
			expect(fixture.getContext).not.toHaveBeenCalled();
			expect(fixture.events).toEqual([]);
			controller.abort();
		} finally {
			finish();
		}
		await expect(pending).rejects.toMatchObject({ code: "RENDER_CANCELLED" });
		expect(fixture.getContext).not.toHaveBeenCalled();
		expect(fixture.drawImage).not.toHaveBeenCalled();
		expect(fixture.events).toEqual([]);
		expect(fixture.context.globalCompositeOperation).toBe("destination-over");
	});
}
