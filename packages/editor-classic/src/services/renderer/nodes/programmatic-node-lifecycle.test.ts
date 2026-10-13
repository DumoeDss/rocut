import { beforeEach, expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { ResolveContext } from "../resolve-context";
import type { ProgrammaticRenderRequest } from "../programmatic/canvas-runtime";
import { RenderResidencyDomain } from "../render-residency-domain";

if (process.env.ROCUT_PROGRAMMATIC_NODE_LIFECYCLE_ISOLATED !== "1") {
	test("node lifecycle doubles run in an isolated process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			env: { ...process.env, ROCUT_PROGRAMMATIC_NODE_LIFECYCLE_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw Error(result.stdout.toString() + result.stderr.toString());
	}, 15000);
} else {
	let visualActive = true;
	let frameResolutions = 0;
	let owners: TestOwner[] = [];
	let closes = 0;
	let holdResources = false;
	let finishResources: (() => void) | undefined;
	let domain: RenderResidencyDomain;
	const root = {};
	class TestOwner {
		used = 0;
		limit = 1024;
		disposed = false;
		private finish: (() => void) | undefined;
		private drain = new Promise<void>((resolve) => {
			this.finish = resolve;
		});
		constructor() {
			owners.push(this);
		}
		reserve(bytes: number) {
			if (this.used + bytes > this.limit) throw Error("joint budget");
			this.used += bytes;
			let released = false;
			return () => {
				if (!released) {
					released = true;
					this.used -= bytes;
				}
			};
		}
		async prepare(): Promise<never> {
			throw Error("No pixels in node doubles");
		}
		releaseUnusedCache() {}
		dispose() {
			this.disposed = true;
		}
		disposeAndDrain() {
			this.dispose();
			return this.drain;
		}
		completeDisposal() {
			this.finish?.();
		}
	}
	class TestCanvas {
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
	Reflect.set(globalThis, "OffscreenCanvas", TestCanvas);
	mock.module("../programmatic/image-preprocess-owner", () => ({
		ImagePreprocessOwner: TestOwner,
	}));
	mock.module("../programmatic/frame", () => ({
		resolveProgrammaticFrame: ({ timelineTime }: { timelineTime: number }) => {
			frameResolutions++;
			return timelineTime >= 0 && timelineTime < 1
				? { index: Math.floor(timelineTime * 60) }
				: null;
		},
	}));
	mock.module("../resolve-visual-state", () => ({
		resolveVisualState: () => (visualActive ? { opacity: 1 } : null),
	}));
	mock.module("../programmatic/resources", () => ({
		resolveCanvasResources: async () => {
			if (holdResources)
				await new Promise<void>((resolve) => {
					finishResources = resolve;
				});
			return [];
		},
	}));
	mock.module("../programmatic/canvas-runtime", () => ({
		renderProgrammaticCanvas: async () => {
			throw Error("Missing test rasterizer");
		},
	}));
	const { ProgrammaticNode } = await import("./programmatic-node");
	const context = (time: number): ResolveContext => ({
		rasterResidency: domain.tree(root),
		time,
		renderer: { width: 2, height: 2 },
		videoCache: { getFrameAt: async () => null },
	});
	const bitmap = (): ImageBitmap =>
		Reflect.construct(
			class {
				width = 2;
				height = 2;
				close() {
					closes++;
				}
			},
			[],
		);
	function fixture(
		renderFrame: (request: ProgrammaticRenderRequest) => Promise<ImageBitmap>,
	) {
		return new ProgrammaticNode({
			source: {
				version: 1,
				runtime: "canvas-worker",
				code: "",
				width: 2,
				height: 2,
				frameRate: { numerator: 60, denominator: 1 },
				durationFrames: 60,
				seed: 0,
			},
			duration: 1,
			timeOffset: 0,
			trimStart: 0,
			trimEnd: 0,
			transform: { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 },
			opacity: 1,
			renderFrame,
		});
	}
	beforeEach(() => {
		owners = [];
		domain = new RenderResidencyDomain({ preprocessor: new TestOwner() });
		closes = 0;
		visualActive = true;
		frameResolutions = 0;
		holdResources = false;
		finishResources = undefined;
	});
	test("visual-inactive sources never enter frame encoding, but active validation still runs", async () => {
		const node = fixture(async () => bitmap());
		visualActive = false;
		expect(await node.resolve(context(0))).toBeNull();
		expect(frameResolutions).toBe(0);
		visualActive = true;
		expect(await node.resolve(context(0))).not.toBeNull();
		expect(frameResolutions).toBe(1);
	});
	test("active cached frame reuses owner and canvas; inactive drops both references", async () => {
		let renders = 0;
		const node = fixture(async () => {
			renders++;
			return bitmap();
		});
		const first = await node.resolve(context(0));
		const second = await node.resolve(context(0));
		expect(second?.source).toBe(first?.source);
		expect(renders).toBe(1);
		expect(owners.length).toBe(1);
		await node.resolve(context(1));
		expect(owners[0].disposed).toBe(false);
		expect(owners[0].used).toBe(0);
		expect(Reflect.get(node, "cached")).toBeNull();
		expect(node.resolved).toBeNull();
	});
	test("visual inactivity and tree cancellation release persistent references without resizing old canvas", async () => {
		const node = fixture(async () => bitmap());
		const result = await node.resolve(context(0));
		visualActive = false;
		await node.resolve(context(0));
		expect(owners[0].used).toBe(0);
		expect(Reflect.get(node, "cached")).toBeNull();
		expect(result && Reflect.get(result.source, "width")).toBe(2);
		visualActive = true;
		const other = fixture(async () => bitmap());
		const live = await other.resolve(context(0));
		other.cancelPendingFrames();
		expect(other.resolved).toBeNull();
		expect(Reflect.get(other, "cached")).toBeNull();
		expect(owners[0].used).toBe(0);
		expect(live && Reflect.get(live.source, "width")).toBe(2);
	});
	test("reactivation reuses the shared owner and cannot bypass old grace residency", async () => {
		let renders = 0;
		const node = fixture(async () => {
			renders++;
			return bitmap();
		});
		await node.resolve(context(0));
		await node.resolve(context(1));
		owners[0].limit = 32;
		const grace = owners[0].reserve(24);
		await expect(node.resolve(context(0))).rejects.toThrow("budget");
		expect(owners.length).toBe(1);
		grace();
		await node.resolve(context(0));
		expect(renders).toBe(3);
		expect(owners.length).toBe(1);
	});
	test("late aborted bitmap cannot overwrite a newer cache", async () => {
		let finish: ((value: ImageBitmap) => void) | undefined;
		let renders = 0;
		const node = fixture(async () =>
			++renders === 1
				? new Promise((resolve) => {
						finish = resolve;
					})
				: bitmap(),
		);
		const stale = node.resolve(context(0));
		await Promise.resolve();
		const current = await node.resolve(context(0.1));
		finish?.(bitmap());
		await expect(stale).rejects.toThrow("cancelled");
		expect(Reflect.get(node, "cached").source).toBe(current?.source);
		expect(closes).toBe(2);
	});
	test("client cancellation aborts reactivation promptly without allocating another owner", async () => {
		let renders = 0;
		const node = fixture(async ({ signal }) =>
			++renders === 1
				? bitmap()
				: new Promise((_resolve, reject) =>
						signal?.addEventListener("abort", () => reject(signal.reason), {
							once: true,
						}),
					),
		);
		await node.resolve(context(0));
		node.cancelPendingFrames();
		const waiting = node.resolve(context(0.1));
		await Promise.resolve();
		node.cancelPendingFrames();
		await expect(waiting).rejects.toThrow("cancelled");
		expect(owners.length).toBe(1);
		expect(owners[0].used).toBe(0);
	});
	test("160 sequential single-frame nodes retain only the active canvas and owner", async () => {
		const nodes = Array.from({ length: 160 }, () =>
			fixture(async () => bitmap()),
		);
		for (const [index, active] of nodes.entries()) {
			if (index) {
				await nodes[index - 1].resolve(context(1));
			}
			await active.resolve(context(0));
			expect(
				nodes.filter((node) => Reflect.get(node, "cached") !== null).length,
			).toBe(1);
			expect(owners.filter((owner) => !owner.disposed).length).toBe(1);
			expect(owners[0].used).toBe(16);
		}
	});
	test("cancelled caller resource loading remains admitted until its underlying provider settles", async () => {
		owners[0].limit = 32;
		holdResources = true;
		const old = fixture(async () => bitmap());
		old.params.source = {
			...old.params.source,
			resources: [
				{
					id: "image",
					kind: "image",
					attachmentKey: "test",
					mimeType: "image/png",
					byteLength: 24,
					sha256: "a".repeat(64),
				},
			],
		};
		const pending = old.resolve(context(0));
		await Promise.resolve();
		expect(owners[0].used).toBe(24);
		old.cancelPendingFrames();
		holdResources = false;
		const next = fixture(async () => bitmap());
		await expect(next.resolve(context(0))).rejects.toThrow("budget");
		expect(owners[0].used).toBe(24);
		finishResources!();
		await expect(pending).rejects.toThrow("cancelled");
		await Promise.resolve();
		expect(owners[0].used).toBe(0);
	});
}
