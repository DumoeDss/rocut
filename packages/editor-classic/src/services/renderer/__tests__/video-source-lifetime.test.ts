import { afterEach, expect, test } from "bun:test";
import type { WrappedCanvas } from "mediabunny";
import { BaseNode } from "../nodes/base-node";
import { VideoNode } from "../nodes/video-node";
import { BlurBackgroundNode } from "../nodes/blur-background-node";
import { resolveRenderTree } from "../resolve";
import { createVideoFrameScope } from "../video-frame-scope";

class PixelCanvas {
	pixel = -1;
	width: number;
	height: number;
	constructor(...[width, height]: [number, number]) {
		this.width = width;
		this.height = height;
	}
	getContext() {
		return {
			drawImage: (source: PixelCanvas) => {
				this.pixel = source.pixel;
			},
		};
	}
}
const original = Object.getOwnPropertyDescriptor(globalThis, "OffscreenCanvas");
afterEach(() => {
	if (original) Object.defineProperty(globalThis, "OffscreenCanvas", original);
	else Reflect.deleteProperty(globalThis, "OffscreenCanvas");
});
function installCanvas() {
	Object.defineProperty(globalThis, "OffscreenCanvas", {
		configurable: true,
		value: PixelCanvas,
	});
}
const file = new File(["test"], "source.mp4");
function clip(trimStart: number) {
	return new VideoNode({
		mediaId: "shared",
		file,
		url: "blob:test",
		timeOffset: 0,
		duration: 1_200_000,
		trimStart: trimStart * 120_000,
		trimEnd: 0,
		opacity: 1,
		transform: { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 },
	});
}
function pooledCache({ cancel = false } = {}) {
	const canvas = new OffscreenCanvas(2, 2);
	if (!(canvas instanceof PixelCanvas))
		throw new Error("Canvas fixture missing");
	let generation = 0;
	const calls: number[] = [];
	return {
		canvas,
		calls,
		async getFrameAt({
			time,
		}: {
			time: number;
		}): Promise<WrappedCanvas | null> {
			calls.push(time);
			const current = ++generation;
			await Promise.resolve();
			if (cancel && current !== generation) return null;
			canvas.pixel = time;
			return {
				canvas,
				timestamp: time,
				duration: 1,
			};
		},
	};
}
async function resolve({
	nodes,
	cache,
	time = 1,
}: {
	nodes: Array<VideoNode | BlurBackgroundNode>;
	cache: ReturnType<typeof pooledCache>;
	time?: number;
}) {
	const node = new BaseNode();
	for (const child of nodes) node.add(child);
	await resolveRenderTree({
		node,
		renderer: { width: 100, height: 100 },
		time: time * 120_000,
		videoCache: cache,
	});
}
function pixel(node: VideoNode) {
	const source = node.resolved?.source;
	return source instanceof PixelCanvas ? source.pixel : undefined;
}

test("same-media layers cannot supersede one another's seeks", async () => {
	installCanvas();
	const cache = pooledCache({ cancel: true });
	const a = clip(0),
		b = clip(4);
	await resolve({ nodes: [a, b], cache });
	expect(pixel(a)).toBe(1);
	expect(pixel(b)).toBe(5);
});

test("every sampled frame survives pool reuse and later renders", async () => {
	installCanvas();
	const cache = pooledCache();
	const nodes = [clip(0), clip(2), clip(4), clip(6)];
	await resolve({ nodes, cache });
	const previous = nodes.map((node) => {
		const source = node.resolved?.source;
		if (!(source instanceof PixelCanvas)) throw new Error("Missing snapshot");
		return source;
	});
	expect(previous.map((canvas) => canvas.pixel)).toEqual([1, 3, 5, 7]);
	await resolve({ nodes, cache, time: 2 });
	expect(nodes.map(pixel)).toEqual([2, 4, 6, 8]);
	expect(previous.map((canvas) => canvas.pixel)).toEqual([1, 3, 5, 7]);
});

test("main picture and blur backdrop share one immutable sample", async () => {
	installCanvas();
	const cache = pooledCache({ cancel: true });
	const video = clip(0);
	const blur = new BlurBackgroundNode({
		...video.params,
		mediaType: "video",
		blurIntensity: 10,
	});
	await resolve({ nodes: [blur, video], cache });
	expect(cache.calls).toEqual([1]);
	expect(blur.resolved?.backdropSource.source).toBe(video.resolved?.source);
	expect(pixel(video)).toBe(1);
});

test("separate resolve calls sharing one decoder do not cancel queued samples", async () => {
	installCanvas();
	const cache = pooledCache({ cancel: true });
	const a = clip(0),
		b = clip(4);
	await Promise.all([
		resolve({ nodes: [a], cache }),
		resolve({ nodes: [b], cache }),
	]);
	expect([pixel(a), pixel(b)]).toEqual([1, 5]);
});

test("a failed sample does not poison queued or later render scopes", async () => {
	installCanvas();
	const underlying = pooledCache();
	const decoder = {
		async getFrameAt(request: { mediaId: string; file: File; time: number }) {
			if (request.time === 0) throw new Error("decode failed");
			return underlying.getFrameAt(request);
		},
	};
	const scope = createVideoFrameScope(decoder);
	const results = await Promise.allSettled(
		[0, 1].map((time) => scope.getFrameAt({ mediaId: "shared", file, time })),
	);
	expect(results[0]!.status).toBe("rejected");
	expect(results[1]!.status).toBe("fulfilled");
	expect(
		(
			await createVideoFrameScope(decoder).getFrameAt({
				mediaId: "shared",
				file,
				time: 2,
			})
		)?.timestamp,
	).toBe(2);
});

test("unavailable frames remain null and are retried in a fresh scope", async () => {
	installCanvas();
	const underlying = pooledCache();
	let available = false;
	const decoder = {
		async getFrameAt(request: { time: number }) {
			return available ? underlying.getFrameAt(request) : null;
		},
	};
	const request = { mediaId: "shared", file, time: 1 };
	const scope = createVideoFrameScope(decoder);
	expect(await scope.getFrameAt(request)).toBeNull();
	available = true;
	expect(await scope.getFrameAt(request)).toBeNull();
	expect(
		(await createVideoFrameScope(decoder).getFrameAt(request))?.timestamp,
	).toBe(1);
});

test("independent media are not serialized behind one stalled decoder", async () => {
	installCanvas();
	let release!: () => void;
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	const fast = pooledCache();
	const decoder = {
		async getFrameAt(request: { mediaId: string; time: number }) {
			if (request.mediaId === "slow") await wait;
			return fast.getFrameAt(request);
		},
	};
	const scope = createVideoFrameScope(decoder);
	const slow = scope.getFrameAt({ mediaId: "slow", file, time: 1 });
	try {
		expect(
			(await scope.getFrameAt({ mediaId: "fast", file, time: 2 }))?.timestamp,
		).toBe(2);
	} finally {
		release();
	}
	expect((await slow)?.timestamp).toBe(1);
});

test("invisible timeline intervals request no decoder work", async () => {
	installCanvas();
	const cache = pooledCache();
	const video = clip(0);
	await resolve({ nodes: [video], cache, time: 10 });
	expect(video.resolved).toBeNull();
	expect(cache.calls).toEqual([]);
});
