/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- isolated boundary doubles, never actual WASM/GPU acceptance. */
import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { FrameDescriptor } from "../compositor/types";
import type { RootNode } from "../nodes/root-node";
import type { VideoCache } from "../../video-cache/service";
import {
	isRenderCancelledError,
	RenderCancelledError,
	renderFrameRequest,
	yieldRenderTask,
} from "../compositor/render-request";

if (process.env.ROCUT_LIQUID_CANCEL_BOUNDARY_ISOLATED !== "1") {
	test("Liquid request boundary tests use isolated mocks (not real WASM/GPU)", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: { ...process.env, ROCUT_LIQUID_CANCEL_BOUNDARY_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw Error(result.stdout.toString() + result.stderr.toString());
	}, 15000);
} else {
	let nextHandle = 1,
		nextRequest = 1,
		released = 0,
		syncRenders = 0;
	const budgets = new WeakMap<FrameDescriptor, number>();
	const requests = new Map<
		number,
		{ handle: number; frame: FrameDescriptor; left: number }
	>();
	const owners = new Map<number, number>();
	const advances: number[] = [],
		commits: number[] = [],
		cancels: number[] = [];
	let onAdvance: ((request: number) => void) | undefined;
	let onCommit: (() => void) | undefined;
	let encodeFrame: () => Promise<void> = async () => {};
	let resolveTree: () => Promise<void> = async () => {};
	let encodedFrames = 0,
		cancelledOutputs = 0;
	const api = {
		// eslint-disable-next-line opencut/prefer-object-params -- mirrors the native positional request API.
		beginRenderFrameForHandle(handle: number, frame: FrameDescriptor) {
			const old = owners.get(handle);
			if (old !== undefined) requests.delete(old);
			const id = nextRequest++;
			owners.set(handle, id);
			requests.set(id, { handle, frame, left: budgets.get(frame) ?? 0 });
			return id;
		},
		// eslint-disable-next-line opencut/prefer-object-params -- mirrors the native positional request API.
		advanceRenderFrameForHandle(
			handle: number,
			request: number,
			maxSteps: number,
		) {
			const value = requests.get(request);
			if (!value || value.handle !== handle || owners.get(handle) !== request)
				throw new RenderCancelledError();
			advances.push(request);
			value.left = Math.max(0, value.left - maxSteps);
			onAdvance?.(request);
			return value.left === 0;
		},
		// eslint-disable-next-line opencut/prefer-object-params -- mirrors the native positional request API.
		commitRenderFrameForHandle(handle: number, request: number) {
			const value = requests.get(request);
			if (!value || value.handle !== handle || owners.get(handle) !== request)
				throw new RenderCancelledError();
			if (value.left) throw Error("not ready");
			commits.push(request);
			requests.delete(request);
			owners.delete(handle);
			onCommit?.();
		},
		// eslint-disable-next-line opencut/prefer-object-params -- mirrors the native positional request API.
		cancelRenderFrameForHandle(handle: number, request: number) {
			cancels.push(request);
			if (owners.get(handle) === request) {
				requests.delete(request);
				owners.delete(handle);
			}
		},
	};
	mock.module("opencut-wasm", () => ({
		...api,
		mediaTimeToSeconds: ({ time }: { time: number }) => time / 120000,
		resolveVideoExportJson: () => JSON.stringify({ bitrate: 6_000_000 }),
		createCompositor: () => nextHandle++,
		disposeCompositor: () => {},
		getCompositorCanvasForHandle: () => ({ width: 64, height: 36 }),
		getLastFrameProfile: () => [],
		releaseTextureForHandle: () => {},
		uploadTextureForHandle: () => {},
		resizeCompositorForHandle: () => {},
		renderFrameForHandle: () => {
			syncRenders++;
		},
	}));
	mock.module("../resolve", () => ({ resolveRenderTree: () => resolveTree() }));
	mock.module("../compositor/frame-descriptor", () => ({
		buildFrameDescriptor: async ({
			node,
		}: {
			node: { frame: FrameDescriptor };
		}) => ({ frame: node.frame, textures: [] }),
	}));
	mock.module("../canvas-utils", () => ({
		createCanvasSurface: () => ({ canvas: {}, context: {} }),
	}));
	mock.module("../../../wasm", () => ({ TICKS_PER_SECOND: 120000 }));
	mock.module("../../../fps/utils", () => ({ frameRateToFloat: () => 30 }));
	mock.module("mediabunny", () => ({
		Output: class {
			target = { buffer: new ArrayBuffer(4) };
			addVideoTrack() {}
			addAudioTrack() {}
			async start() {}
			async cancel() {
				cancelledOutputs++;
			}
			async finalize() {}
		},
		Mp4OutputFormat: class {},
		WebMOutputFormat: class {},
		BufferTarget: class {},
		CanvasSource: class {
			async add() {
				encodedFrames++;
				await encodeFrame();
			}
			close() {}
		},
		AudioBufferSource: class {},
		canEncodeVideo: async () => true,
		QUALITY_LOW: 1,
		QUALITY_MEDIUM: 2,
		QUALITY_HIGH: 3,
		QUALITY_VERY_HIGH: 4,
	}));
	const { WasmCompositor } = await import("../compositor/wasm-compositor");
	const { CanvasRenderer } = await import("../canvas-renderer");
	const { SceneExporter } = await import("../scene-exporter");
	const { createSessionResources } =
		await import("../../../editor/session/session-resources");
	const { InMemoryRuntimeResourceHost } =
		await import("@opencut/editor-ports/in-memory");
	const createResources = () => {
		let nextId = 0;
		return createSessionResources({
			runtimeResources: new InMemoryRuntimeResourceHost(),
			runtimeGpu: {
				liveHandles: () => [],
				release: () => {
					released++;
				},
			},
			nextId: ({ scope }) => `${scope}:${++nextId}`,
		});
	};
	const resources = createResources();
	const frame = (steps = 0): FrameDescriptor => {
		const value: FrameDescriptor = {
			width: 64,
			height: 36,
			clear: { color: [0, 0, 0, 1] },
			items: [],
		};
		budgets.set(value, steps);
		return value;
	};
	const node = (value: FrameDescriptor) =>
		({ frame: value }) as unknown as RootNode;
	const create = () => {
		const resources = createResources();
		const compositor = new WasmCompositor(resources);
		compositor.ensureInitialized({ width: 64, height: 36 });
		const renderer = new CanvasRenderer({
			width: 64,
			height: 36,
			fps: { numerator: 30, denominator: 1 },
			compositor,
			videoCache: {} as VideoCache,
		});
		return { compositor, renderer, resources };
	};
	test("task completion self-releases its tracked session timer", async () => {
		const resources = createResources();
		const pending = yieldRenderTask({ resources });
		expect(resources.inspect().timer).toEqual({ created: 1, released: 0 });
		await pending;
		expect(resources.inspect().timer).toEqual({ created: 1, released: 1 });
		await resources.disposeAll();
	});
	test("abort cancels and releases its tracked session timer before it fires", async () => {
		const resources = createResources();
		const controller = new AbortController();
		const pending = yieldRenderTask({ resources, signal: controller.signal });
		expect(resources.inspect().timer).toEqual({ created: 1, released: 0 });
		controller.abort();
		await expect(pending).rejects.toMatchObject({ code: "RENDER_CANCELLED" });
		expect(resources.inspect().timer).toEqual({ created: 1, released: 1 });
		await resources.disposeAll();
	});
	test("compositor completion and close leave no live replay timers", async () => {
		const { compositor, resources } = create();
		await compositor.renderAsync(frame(4));
		expect(resources.inspect().timer).toEqual({ created: 3, released: 3 });
		const pending = compositor.renderAsync(frame(100));
		expect(resources.inspect().timer).toEqual({ created: 4, released: 3 });
		const rejected = pending.then(
			() => null,
			(error) => error,
		);
		const [error] = await Promise.all([rejected, compositor.close()]);
		expect(error).toMatchObject({ code: "RENDER_CANCELLED" });
		expect(resources.inspect().timer).toEqual({ created: 4, released: 4 });
		await resources.disposeAll();
	});
	test("a real timer task cancels between chunks before replay completes or publishes", async () => {
		const resources = createResources();
		const signal = new AbortController(),
			value = frame(100),
			begin = advances.length,
			oldCommits = commits.length;
		let scheduled = false;
		onAdvance = () => {
			if (!scheduled) {
				scheduled = true;
				setTimeout(() => signal.abort(), 0);
			}
		};
		try {
			await expect(
				renderFrameRequest({
					api,
					resources,
					handle: 100,
					frame: value,
					signal: signal.signal,
				}),
			).rejects.toMatchObject({ name: "AbortError", code: "RENDER_CANCELLED" });
		} finally {
			onAdvance = undefined;
		}
		expect(advances.length - begin).toBe(1);
		expect(commits.length).toBe(oldCommits);
		expect(requests.size).toBe(0);
		expect(resources.inspect().timer).toEqual({ created: 1, released: 1 });
		await resources.disposeAll();
	});
	test("immediate-ready no-Liquid boundary does not wait for another task; sync API remains", async () => {
		let timerRan = false;
		const timer = setTimeout(() => {
			timerRan = true;
		}, 0);
		await renderFrameRequest({ api, resources, handle: 101, frame: frame() });
		expect(timerRan).toBe(false);
		clearTimeout(timer);
		const { compositor } = create(),
			before = syncRenders;
		compositor.render(frame());
		expect(syncRenders).toBe(before + 1);
		compositor.dispose();
	});
	test("old request finally cancels only its own id, leaving its replacement alive", async () => {
		let second: Promise<void> | undefined,
			started = false;
		const oldCommits = commits.length;
		onAdvance = () => {
			if (!started) {
				started = true;
				setTimeout(() => {
					second = renderFrameRequest({
						api,
						resources,
						handle: 102,
						frame: frame(4),
					});
				}, 0);
			}
		};
		try {
			await expect(
				renderFrameRequest({ api, resources, handle: 102, frame: frame(100) }),
			).rejects.toMatchObject({ code: "RENDER_CANCELLED" });
			await second;
		} finally {
			onAdvance = undefined;
		}
		expect(commits.length - oldCommits).toBe(1);
		expect(requests.size).toBe(0);
	});
	test("reset/reused owner id cannot turn old finally into an ABA cancellation", async () => {
		let fresh: Promise<void> | undefined,
			reset = false;
		const before = commits.length;
		onAdvance = () => {
			if (!reset) {
				reset = true;
				setTimeout(() => {
					requests.clear();
					owners.clear();
					fresh = renderFrameRequest({
						api,
						resources,
						handle: 103,
						frame: frame(3),
					});
				}, 0);
			}
		};
		try {
			await expect(
				renderFrameRequest({ api, resources, handle: 103, frame: frame(100) }),
			).rejects.toMatchObject({ code: "RENDER_CANCELLED" });
			await fresh;
		} finally {
			onAdvance = undefined;
		}
		expect(commits.length - before).toBe(1);
		expect(requests.size).toBe(0);
	});
	test("abort reaches native cancellation while the exclusive transaction is held", async () => {
		const { compositor, renderer } = create(),
			signal = new AbortController();
		const before = cancels.length;
		let observedLockedCancel = false,
			entered = false;
		onAdvance = () => {
			if (!entered) {
				entered = true;
				setTimeout(() => {
					signal.abort();
					observedLockedCancel = cancels.length > before;
				}, 0);
			}
		};
		try {
			await expect(
				renderer.render({
					node: node(frame(100)),
					time: 0,
					signal: signal.signal,
				}),
			).rejects.toMatchObject({ code: "RENDER_CANCELLED" });
		} finally {
			onAdvance = undefined;
		}
		expect(observedLockedCancel).toBe(true);
		await renderer.render({ node: node(frame(2)), time: 0 });
		await compositor.close();
	});
	test("cancelled render never reaches canvas capture, encoder or target draw", async () => {
		const { compositor, renderer } = create();
		let captures = 0,
			draws = 0;
		for (const kind of ["capture", "target"] as const) {
			const signal = new AbortController();
			let scheduled = false;
			onAdvance = () => {
				if (!scheduled) {
					scheduled = true;
					setTimeout(() => signal.abort(), 0);
				}
			};
			const value = node(frame(100));
			try {
				await expect(
					kind === "capture"
						? renderer.renderAndCapture({
								node: value,
								time: 0,
								signal: signal.signal,
								capture: () => {
									captures++;
								},
							})
						: renderer.renderToCanvas({
								node: value,
								time: 0,
								signal: signal.signal,
								targetCanvas: {
									getContext: () => ({
										drawImage: () => {
											draws++;
										},
									}),
								} as unknown as HTMLCanvasElement,
							}),
				).rejects.toMatchObject({ code: "RENDER_CANCELLED" });
			} finally {
				onAdvance = undefined;
			}
		}
		expect(captures).toBe(0);
		expect(draws).toBe(0);
		await compositor.close();
	});
	test("pre-commit publication guard invalidation cancels and never commits", async () => {
		const before = commits.length;
		let checks = 0;
		await expect(
			renderFrameRequest({
				api,
				resources,
				handle: 104,
				frame: frame(),
				assertCurrent: () => {
					if (++checks === 3) throw new RenderCancelledError();
				},
			}),
		).rejects.toMatchObject({ code: "RENDER_CANCELLED" });
		expect(commits.length).toBe(before);
		expect(requests.size).toBe(0);
	});
	test("post-commit abort cannot recall GPU work but still prevents capture and target draw", async () => {
		const { compositor, renderer } = create();
		let captures = 0,
			draws = 0;
		const before = commits.length;
		for (const kind of ["capture", "target"] as const) {
			const controller = new AbortController();
			onCommit = () => queueMicrotask(() => controller.abort());
			try {
				await expect(
					kind === "capture"
						? renderer.renderAndCapture({
								node: node(frame()),
								time: 0,
								signal: controller.signal,
								capture: () => {
									captures++;
								},
							})
						: renderer.renderToCanvas({
								node: node(frame()),
								time: 0,
								signal: controller.signal,
								targetCanvas: {
									getContext: () => ({
										drawImage: () => {
											draws++;
										},
									}),
								} as unknown as HTMLCanvasElement,
							}),
				).rejects.toMatchObject({ code: "RENDER_CANCELLED" });
			} finally {
				onCommit = undefined;
			}
		}
		expect(commits.length - before).toBe(2);
		expect(captures).toBe(0);
		expect(draws).toBe(0);
		await compositor.close();
	});
	test("close cancels queued and active work, drains resolve, then releases exactly once", async () => {
		const { compositor, renderer } = create();
		const before = released;
		let finish!: () => void,
			entered = false;
		resolveTree = () => {
			entered = true;
			return new Promise<void>((resolve) => {
				finish = resolve;
			});
		};
		const active = renderer.render({ node: node(frame(100)), time: 0 });
		for (let attempt = 0; !entered && attempt < 20; attempt++)
			await yieldRenderTask({ resources });
		expect(entered).toBe(true);
		const queued = renderer.render({ node: node(frame(100)), time: 1 });
		const activeCheck = active.then(
			() => null,
			(error) => error,
		);
		const queuedCheck = queued.then(
			() => null,
			(error) => error,
		);
		expect(() => compositor.dispose()).toThrow("await close()");
		const closing = compositor.close();
		expect(compositor.close()).toBe(closing);
		expect(released).toBe(before);
		await yieldRenderTask({ resources });
		expect(released).toBe(before);
		finish();
		resolveTree = async () => {};
		const [activeError, queuedError] = await Promise.all([
			activeCheck,
			queuedCheck,
			closing,
		]);
		expect(activeError).toMatchObject({ code: "RENDER_CANCELLED" });
		expect(queuedError).toMatchObject({ code: "RENDER_CANCELLED" });
		expect(released).toBe(before + 1);
		await expect(
			renderer.render({ node: node(frame()), time: 2 }),
		).rejects.toMatchObject({ code: "RENDER_CANCELLED" });
		compositor.dispose();
		expect(released).toBe(before + 1);
	});
	test("ordinary native failures remain distinct from typed cancellation", async () => {
		const failure = Object.assign(new Error("replay budget invalid"), {
			name: "RenderFrameError",
			code: "RENDER_FAILED",
		});
		await expect(
			renderFrameRequest({
				resources,
				api: {
					...api,
					advanceRenderFrameForHandle: () => {
						throw failure;
					},
				},
				handle: 105,
				frame: frame(2),
			}),
		).rejects.toBe(failure);
		expect(isRenderCancelledError(failure)).toBe(false);
		expect(isRenderCancelledError(new Error("RENDER_CANCELLED"))).toBe(false);
		expect(requests.size).toBe(0);
	});
	test("out-of-contract chunk sizes are rejected before entering WASM", async () => {
		const before = nextRequest;
		for (const maxSteps of [0, -1, 1.5, 65, 2 ** 32, Infinity])
			await expect(
				renderFrameRequest({
					api,
					resources,
					handle: 107,
					frame: frame(),
					maxSteps,
				}),
			).rejects.toBeInstanceOf(RangeError);
		expect(nextRequest).toBe(before);
	});
	test("queued cancellation returns without waiting for an unrelated lock owner", async () => {
		const { compositor } = create();
		let finish!: () => void,
			entered = false;
		const owner = compositor.runExclusive(() => {
			entered = true;
			return new Promise<void>((resolve) => {
				finish = resolve;
			});
		});
		for (let i = 0; !entered && i < 20; i++)
			await yieldRenderTask({ resources });
		expect(entered).toBe(true);
		const signal = new AbortController();
		let ran = false;
		const queued = compositor
			.runExclusive(
				async () => {
					ran = true;
				},
				{ signal: signal.signal },
			)
			.then(
				() => null,
				(error) => error,
			);
		signal.abort();
		expect(await queued).toMatchObject({ code: "RENDER_CANCELLED" });
		expect(ran).toBe(false);
		let nextRan = false;
		const next = compositor.runExclusive(async () => {
			nextRan = true;
		});
		await yieldRenderTask({ resources });
		expect(nextRan).toBe(false);
		finish();
		await Promise.all([owner, next]);
		expect(nextRan).toBe(true);
		await compositor.close();
	});
	test("all descriptor placements are delivered intact to the Rust-owned boundary", async () => {
		const pass = { shader: "liquid", uniforms: {} },
			layer = {
				type: "layer",
				textureId: "image",
				transform: {
					centerX: 0,
					centerY: 0,
					width: 64,
					height: 36,
					rotationDegrees: 0,
					flipX: false,
					flipY: false,
				},
				opacity: 1,
				blendMode: "normal",
				effectPassGroups: [[pass]],
				mask: null,
			} as const;
		const value = {
			...frame(),
			items: [
				layer,
				{
					type: "transition",
					outgoing: [layer],
					incoming: [layer],
					progress: 0.5,
				},
				{ type: "sceneEffect", effectPassGroups: [[pass]] },
			],
		} as unknown as FrameDescriptor;
		let received: FrameDescriptor | undefined;
		await renderFrameRequest({
			resources,
			api: {
				...api,
				beginRenderFrameForHandle: (handle, descriptor) => {
					received = descriptor;
					return api.beginRenderFrameForHandle(handle, descriptor);
				},
			},
			handle: 106,
			frame: value,
		});
		expect(received).toBe(value);
	});
	test("SceneExporter propagates cancel into actual CanvasRenderer before encoder.add", async () => {
		const { compositor } = create();
		const exporter = new SceneExporter({
			width: 64,
			height: 36,
			fps: { numerator: 30, denominator: 1 },
			format: "mp4",
			quality: "high",
			compositor,
			videoCache: {} as VideoCache,
		});
		const beforeEncoded = encodedFrames,
			beforeCancelled = cancelledOutputs,
			beforeCommits = commits.length;
		let scheduled = false;
		onAdvance = () => {
			if (!scheduled) {
				scheduled = true;
				setTimeout(() => {
					void exporter.cancel();
				}, 0);
			}
		};
		try {
			const result = await exporter.export({
				rootNode: node(frame(100)),
				range: { startTime: 0, endTime: 8000, duration: 8000 } as never,
			});
			expect(result).toBeNull();
		} finally {
			onAdvance = undefined;
		}
		expect(encodedFrames).toBe(beforeEncoded);
		expect(commits.length).toBe(beforeCommits);
		expect(cancelledOutputs).toBe(beforeCancelled + 1);
		await compositor.close();
	});
	test("export cancel returns promptly but compositor close waits for the actual encoder task", async () => {
		const { compositor } = create();
		const exporter = new SceneExporter({
			width: 64,
			height: 36,
			fps: { numerator: 30, denominator: 1 },
			format: "mp4",
			quality: "high",
			compositor,
			videoCache: {} as VideoCache,
		});
		let finish!: () => void,
			entered = false;
		encodeFrame = () => {
			entered = true;
			return new Promise<void>((resolve) => {
				finish = resolve;
			});
		};
		const beforeReleased = released,
			beforeCancelled = cancelledOutputs;
		const pending = exporter.export({
			rootNode: node(frame()),
			range: { startTime: 0, endTime: 8000, duration: 8000 } as never,
		});
		for (let attempt = 0; !entered && attempt < 20; attempt++)
			await yieldRenderTask({ resources });
		expect(entered).toBe(true);
		try {
			expect(await exporter.cancel()).toBeNull();
			expect(await pending).toBeNull();
			expect(cancelledOutputs).toBe(beforeCancelled + 1);
			let closed = false;
			const closing = compositor.close().then(() => {
				closed = true;
			});
			await yieldRenderTask({ resources });
			expect(closed).toBe(false);
			expect(released).toBe(beforeReleased);
			finish();
			await closing;
			expect(released).toBe(beforeReleased + 1);
		} finally {
			finish();
			encodeFrame = async () => {};
		}
	});
}
