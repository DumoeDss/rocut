import { expect, test } from "bun:test";
import {
	RenderResidencyDomain,
	type RasterResidencyOwner,
} from "./render-residency-domain";
import type { ImagePreprocessLease } from "./programmatic/image-preprocess-owner";
import type { ExternalTextureDescriptor } from "./compositor/types";

class TestOwner implements RasterResidencyOwner {
	used = 0;
	disposed = false;
	freed = false;
	private finish: (() => void) | undefined;
	private drain: Promise<void> | undefined;
	constructor(private readonly limit: number) {}
	reserve(bytes: number): () => void {
		if (this.disposed || this.used + bytes > this.limit)
			throw Error("Rust admission rejected joint residency");
		this.used += bytes;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.used -= bytes;
			this.complete();
		};
	}
	async prepare(): Promise<ImagePreprocessLease> {
		throw Error("No pixels in domain lifecycle doubles");
	}
	dispose(): void {
		this.disposed = true;
		this.complete();
	}
	releaseUnusedCache(): void {}
	disposeAndDrain(): Promise<void> {
		this.drain ??= new Promise((resolve) => {
			this.finish = resolve;
		});
		this.disposed = true;
		this.complete();
		return this.drain;
	}
	private complete(): void {
		if (this.disposed && this.used === 0) {
			this.freed = true;
			this.finish?.();
		}
	}
}
function fixture(limit = 1024) {
	const owner = new TestOwner(limit);
	const domain = new RenderResidencyDomain({ preprocessor: owner });
	domain.bindCompositor({});
	return { owner, domain };
}
function source(): CanvasImageSource {
	return Reflect.construct(
		class {
			width = 2;
			height = 2;
			close() {}
		},
		[],
	);
}
function texture(input: {
	source: CanvasImageSource;
	id?: string;
	version?: string;
}): ExternalTextureDescriptor {
	return {
		kind: "external",
		id: input.id ?? "node:source",
		source: input.source,
		sourceVersion: input.version ?? "1",
		width: 2,
		height: 2,
	};
}
test("different roots/clients share one admission owner and closing one cannot reset old grace", () => {
	const { owner, domain } = fixture(32);
	const rootA = {},
		rootB = {};
	const a = domain.tree(rootA).client({});
	const b = domain.tree(rootB).client({});
	expect(a.preprocessor).toBe(b.preprocessor);
	const grace = owner.reserve(24);
	domain.closeTree(rootA);
	expect(a.signal.aborted).toBe(true);
	expect(b.signal.aborted).toBe(false);
	expect(() => b.reserveCanvas({ width: 2, height: 2 })).toThrow("admission");
	grace();
	const canvas = b.reserveCanvas({ width: 2, height: 2 });
	expect(owner.used).toBe(16);
	canvas.release();
	expect(owner.used).toBe(0);
});
test("overlapping branches jointly fail admission before allocation; active client is reused", () => {
	const { owner, domain } = fixture(24);
	const tree = domain.tree({}),
		nodeA = {},
		nodeB = {};
	const a = tree.client(nodeA);
	expect(tree.client(nodeA)).toBe(a);
	a.reserveCanvas({ width: 2, height: 2 });
	expect(() =>
		tree.client(nodeB).reserveCanvas({ width: 2, height: 2 }),
	).toThrow("admission");
	expect(owner.used).toBe(16);
	a.close();
	tree.client(nodeB).reserveCanvas({ width: 2, height: 2 });
	expect(owner.used).toBe(16);
	tree.close();
	expect(owner.used).toBe(0);
});
test("published canvas and GPU storage survive node/tree close until successful texture replacement", () => {
	const { owner, domain } = fixture();
	const scope = domain.tree({}),
		client = scope.client({}),
		canvas = source();
	client.reserveCanvas({ width: 2, height: 2 }).attach(canvas);
	const publish = domain.preparePublication({
		scope,
		textures: [texture({ source: canvas })],
	});
	publish.commitAfterTextureSync();
	expect(owner.used).toBe(32);
	scope.close();
	expect(owner.used).toBe(32);
	const next = domain.tree({});
	domain
		.preparePublication({ scope: next, textures: [] })
		.commitAfterTextureSync();
	expect(owner.used).toBe(0);
	expect(domain.isPublishedScope(scope)).toBe(false);
});
test("cache-hit publication does not double count; failed partial sync retains old and new reservations", () => {
	const { owner, domain } = fixture();
	const scope = domain.tree({}),
		client = scope.client({});
	const first = source(),
		second = source();
	const firstLease = client.reserveCanvas({ width: 2, height: 2 });
	firstLease.attach(first);
	const descriptor = texture({ source: first });
	domain
		.preparePublication({ scope, textures: [descriptor] })
		.commitAfterTextureSync();
	domain
		.preparePublication({ scope, textures: [descriptor] })
		.commitAfterTextureSync();
	expect(owner.used).toBe(32);
	const secondLease = client.reserveCanvas({ width: 2, height: 2 });
	secondLease.attach(second);
	const failed = domain.preparePublication({
		scope,
		textures: [texture({ source: second, version: "2" })],
	});
	failed.discard({ textureSyncStarted: true });
	firstLease.release();
	secondLease.release();
	expect(owner.used).toBe(64);
	domain.releasePublishedAfterClear();
	expect(owner.used).toBe(0);
});
test("failure before sync releases speculative reservations; cancelled domain waits for real published clear", async () => {
	const { owner, domain } = fixture();
	const scope = domain.tree({}),
		canvas = source();
	scope.client({}).reserveCanvas({ width: 2, height: 2 }).attach(canvas);
	const unused = domain.preparePublication({
		scope,
		textures: [texture({ source: canvas })],
	});
	unused.discard({ textureSyncStarted: false });
	expect(owner.used).toBe(16);
	domain
		.preparePublication({ scope, textures: [texture({ source: canvas })] })
		.commitAfterTextureSync();
	const drain = domain.disposeAndDrain();
	expect(owner.freed).toBe(false);
	expect(() => domain.tree({})).toThrow("cancelled");
	domain.releasePublishedAfterClear();
	await drain;
	expect(owner.freed).toBe(true);
	expect(domain.disposeAndDrain()).toBe(drain);
});
test("160 sequential clips remain bounded while last GPU publication is explicitly retained", () => {
	const { owner, domain } = fixture(64);
	const scope = domain.tree({});
	let previous: ReturnType<typeof scope.client> | undefined;
	for (let index = 0; index < 160; index++) {
		previous?.close();
		const client = scope.client({}),
			canvas = source();
		client.reserveCanvas({ width: 2, height: 2 }).attach(canvas);
		domain
			.preparePublication({
				scope,
				textures: [texture({ source: canvas, version: String(index) })],
			})
			.commitAfterTextureSync();
		expect(owner.used).toBe(32);
		previous = client;
	}
	scope.close();
	expect(owner.used).toBe(32);
	domain.releasePublishedAfterClear();
	expect(owner.used).toBe(0);
});
test("explicit domain rejects another compositor and closes only the requested root", () => {
	const owner = new TestOwner(64),
		domain = new RenderResidencyDomain({ preprocessor: owner }),
		compositor = {};
	domain.bindCompositor(compositor);
	domain.bindCompositor(compositor);
	expect(() => domain.bindCompositor({})).toThrow("different compositors");
	const root = {},
		old = domain.tree(root),
		a = old.client({});
	domain.closeTree(root);
	const resumed = domain.tree(root);
	expect(resumed).not.toBe(old);
	expect(a.signal.aborted).toBe(true);
	expect(resumed.client({}).signal.aborted).toBe(false);
});
