import type { ImagePreprocessAccess } from "./programmatic/image-preprocess-owner";
import type { TextureUploadDescriptor } from "./compositor/types";
import { RenderCancelledError } from "./compositor/render-request";
const COMPOSITOR_RESIDENCY_DOMAIN = Symbol("render-residency-domain");

export function getBoundRenderResidencyDomain(
	compositor: object,
): RenderResidencyDomain | undefined {
	const domain: unknown = Reflect.get(compositor, COMPOSITOR_RESIDENCY_DOMAIN);
	if (domain === undefined) return undefined;
	if (!(domain instanceof RenderResidencyDomain))
		throw Error("Invalid compositor raster residency owner");
	return domain;
}

export function resolveRenderResidencyDomain({
	compositor,
	domain,
	createOwner,
}: {
	compositor: object;
	domain?: RenderResidencyDomain;
	createOwner: () => RasterResidencyOwner;
}): RenderResidencyDomain {
	const existing = getBoundRenderResidencyDomain(compositor);
	const resolved =
		domain ??
		existing ??
		new RenderResidencyDomain({ preprocessor: createOwner() });
	resolved.bindCompositor(compositor);
	return resolved;
}

export type RasterResidencyOwner = ImagePreprocessAccess;

function canvasBytes({
	width,
	height,
}: {
	width: number;
	height: number;
}): number {
	const bytes = width * height * 4;
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1 ||
		!Number.isSafeInteger(bytes)
	)
		throw Error("Invalid raster surface dimensions");
	return bytes;
}

/** One reservation, retained independently by the node and GPU publication. */
export class RasterCanvasLease {
	private refs = 1;
	private nodeReleased = false;
	private source: CanvasImageSource | undefined;
	private readonly domain: RenderResidencyDomain;
	private readonly releaseBytes: () => void;
	private readonly untrack: () => void;
	constructor({
		domain,
		releaseBytes,
		untrack,
	}: {
		domain: RenderResidencyDomain;
		releaseBytes: () => void;
		untrack: () => void;
	}) {
		this.domain = domain;
		this.releaseBytes = releaseBytes;
		this.untrack = untrack;
	}
	attach(source: CanvasImageSource): void {
		if (this.nodeReleased || this.source)
			throw Error("Raster surface lease is no longer attachable");
		this.domain.trackSurface({ source, lease: this });
		this.source = source;
	}
	retain(): () => void {
		if (this.refs === 0) throw Error("Raster surface already released");
		this.refs++;
		let released = false;
		return () => {
			if (!released) {
				released = true;
				this.drop();
			}
		};
	}
	release(): void {
		if (this.nodeReleased) return;
		this.nodeReleased = true;
		this.untrack();
		this.drop();
	}
	private drop(): void {
		if (--this.refs !== 0) return;
		if (this.source)
			this.domain.untrackSurface({ source: this.source, lease: this });
		this.releaseBytes();
	}
}

/** A client owns cancellation and node-held surfaces, never the shared owner. */
export class RenderRasterClient {
	private readonly cancellation = new AbortController();
	private readonly canvases = new Set<RasterCanvasLease>();
	get signal(): AbortSignal {
		return this.cancellation.signal;
	}
	get preprocessor(): RasterResidencyOwner {
		return this.scope.domain.preprocessor;
	}
	belongsTo(scope: RenderTreeResidencyScope): boolean {
		return this.scope === scope;
	}
	private readonly scope: RenderTreeResidencyScope;
	private readonly untrack: () => void;
	constructor({
		scope,
		untrack,
	}: {
		scope: RenderTreeResidencyScope;
		untrack: () => void;
	}) {
		this.scope = scope;
		this.untrack = untrack;
	}
	reserveCanvas(size: { width: number; height: number }): RasterCanvasLease {
		this.scope.assertOpen();
		this.signal.throwIfAborted();
		const release = this.preprocessor.reserve(canvasBytes(size));
		const lease = new RasterCanvasLease({
			domain: this.scope.domain,
			releaseBytes: release,
			untrack: () => this.canvases.delete(lease),
		});
		this.canvases.add(lease);
		return lease;
	}
	close(): void {
		if (this.signal.aborted) return;
		this.cancellation.abort(new RenderCancelledError());
		for (const lease of [...this.canvases]) lease.release();
		this.preprocessor.releaseUnusedCache();
		this.untrack();
	}
}

export class RenderTreeResidencyScope {
	private closed = false;
	private readonly clients = new Map<object, RenderRasterClient>();
	readonly domain: RenderResidencyDomain;
	readonly root: object;
	constructor({
		domain,
		root,
	}: {
		domain: RenderResidencyDomain;
		root: object;
	}) {
		this.domain = domain;
		this.root = root;
	}
	assertOpen(): void {
		this.domain.assertOpen();
		if (this.closed) throw new RenderCancelledError();
	}
	client(node: object): RenderRasterClient {
		this.assertOpen();
		let client = this.clients.get(node);
		if (!client) {
			client = new RenderRasterClient({
				scope: this,
				untrack: () => {
					if (this.clients.get(node) === client) this.clients.delete(node);
				},
			});
			this.clients.set(node, client);
		}
		return client;
	}
	close(): void {
		if (this.closed) return;
		this.closed = true;
		for (const client of [...this.clients.values()]) client.close();
		this.domain.retireTree(this);
	}
}

interface PublicationEntry {
	scope: RenderTreeResidencyScope;
	texture: Extract<TextureUploadDescriptor, { kind: "external" }>;
	releaseSurface(): void;
	releaseGpu(): void;
}

export interface RasterPublicationTransaction {
	/** Invoke only after the whole existing syncTextures call succeeds. */
	commitAfterTextureSync(): void;
	/** A partial sync may retain sources/textures: keep its reservations. */
	discard(args: { textureSyncStarted: boolean }): void;
}

/** Explicit session/compositor domain: all roots share Rust's joint admission.
 * This accounts owned raster surfaces and published textures, not driver-hidden
 * allocations or arbitrary JS heap. It contains no platform budget policy. */
export class RenderResidencyDomain {
	readonly preprocessor: RasterResidencyOwner;
	private readonly trees = new Map<object, RenderTreeResidencyScope>();
	private readonly surfaces = new WeakMap<
		CanvasImageSource,
		RasterCanvasLease
	>();
	private publication = new Map<string, PublicationEntry>();
	private publishedTree: RenderTreeResidencyScope | undefined;
	private committedTextures: TextureUploadDescriptor[] = [];
	private readonly uncertain = new Set<PublicationEntry>();
	private compositor: object | undefined;
	private closed = false;
	private disposalDrain: Promise<void> | undefined;
	constructor({ preprocessor }: { preprocessor: RasterResidencyOwner }) {
		this.preprocessor = preprocessor;
	}
	assertOpen(): void {
		if (this.closed) throw new RenderCancelledError();
	}
	bindCompositor(compositor: object): void {
		this.assertOpen();
		const attached: unknown = Reflect.get(
			compositor,
			COMPOSITOR_RESIDENCY_DOMAIN,
		);
		if (attached && attached !== this)
			throw Error("Compositor already belongs to another raster domain");
		if (this.compositor && this.compositor !== compositor)
			throw Error("Raster domain cannot span different compositors");
		this.compositor = compositor;
		if (
			!attached &&
			!Reflect.defineProperty(compositor, COMPOSITOR_RESIDENCY_DOMAIN, {
				value: this,
			})
		)
			throw Error("Cannot bind compositor raster residency");
	}
	tree(root: object): RenderTreeResidencyScope {
		this.assertOpen();
		let scope = this.trees.get(root);
		if (!scope) {
			scope = new RenderTreeResidencyScope({ domain: this, root });
			this.trees.set(root, scope);
		}
		return scope;
	}
	retireTree(scope: RenderTreeResidencyScope): void {
		if (this.trees.get(scope.root) === scope) this.trees.delete(scope.root);
	}
	closeTree(root: object): RenderTreeResidencyScope | undefined {
		const scope = this.trees.get(root);
		scope?.close();
		return (
			scope ??
			(this.publishedTree?.root === root
				? this.publishedTree
				: [...this.uncertain].find((entry) => entry.scope.root === root)?.scope)
		);
	}
	trackSurface({
		source,
		lease,
	}: {
		source: CanvasImageSource;
		lease: RasterCanvasLease;
	}): void {
		if (this.surfaces.has(source))
			throw Error("Raster surface already has a reservation");
		this.surfaces.set(source, lease);
	}
	untrackSurface({
		source,
		lease,
	}: {
		source: CanvasImageSource;
		lease: RasterCanvasLease;
	}): void {
		if (this.surfaces.get(source) === lease) this.surfaces.delete(source);
	}
	preparePublication({
		scope,
		textures,
	}: {
		scope: RenderTreeResidencyScope;
		textures: readonly TextureUploadDescriptor[];
	}): RasterPublicationTransaction {
		scope.assertOpen();
		if (scope.domain !== this)
			throw Error("Raster publication belongs to another domain");
		const next = new Map<string, PublicationEntry>();
		const created = new Set<PublicationEntry>();
		const release = (entry: PublicationEntry) => {
			entry.releaseGpu();
			entry.releaseSurface();
		};
		try {
			for (const texture of textures) {
				if (texture.kind !== "external") continue;
				const surface = this.surfaces.get(texture.source);
				if (!surface) continue;
				if (next.has(texture.id))
					throw Error("Duplicate published raster texture");
				const previous = this.publication.get(texture.id);
				if (
					previous &&
					previous.texture.source === texture.source &&
					previous.texture.sourceVersion === texture.sourceVersion &&
					previous.texture.width === texture.width &&
					previous.texture.height === texture.height
				) {
					next.set(texture.id, previous);
					continue;
				}
				const releaseSurface = surface.retain();
				let releaseGpu: (() => void) | undefined;
				try {
					releaseGpu = this.preprocessor.reserve(canvasBytes(texture));
				} catch (error) {
					releaseSurface();
					throw error;
				}
				const entry = {
					scope,
					texture: { ...texture },
					releaseSurface,
					releaseGpu,
				};
				created.add(entry);
				next.set(texture.id, entry);
			}
		} catch (error) {
			for (const entry of created) release(entry);
			throw error;
		}
		let settled = false;
		return {
			commitAfterTextureSync: () => {
				if (settled) throw Error("Raster publication already settled");
				settled = true;
				for (const [id, previous] of this.publication)
					if (next.get(id) !== previous) release(previous);
				for (const entry of this.uncertain) release(entry);
				this.uncertain.clear();
				this.publication = next;
				this.publishedTree = scope;
				this.committedTextures = textures.map((texture) => ({ ...texture }));
			},
			discard: ({ textureSyncStarted }) => {
				if (settled) return;
				settled = true;
				for (const entry of created) {
					if (textureSyncStarted) this.uncertain.add(entry);
					else release(entry);
				}
			},
		};
	}
	isPublishedScope(scope: RenderTreeResidencyScope): boolean {
		return (
			(this.publication.size > 0 && this.publishedTree === scope) ||
			[...this.uncertain].some((entry) => entry.scope === scope)
		);
	}
	/** Run inside compositor exclusivity. A failed other-root sync may have
	 * corrupted the cache: restore the complete committed set, not just rasters. */
	retirePublication({
		scope,
		syncTextures,
	}: {
		scope: RenderTreeResidencyScope;
		syncTextures: (textures: TextureUploadDescriptor[]) => void;
	}): void {
		if (!this.isPublishedScope(scope)) return;
		if (this.publishedTree === scope) {
			syncTextures([]);
			this.releasePublishedAfterClear();
			return;
		}
		syncTextures(this.committedTextures);
		// Only a complete successful replacement proves uncertain storage gone.
		for (const entry of this.uncertain) {
			entry.releaseGpu();
			entry.releaseSurface();
		}
		this.uncertain.clear();
	}
	/** Acknowledgement from successful syncTextures([]), or completed close().
	 * cancelAndDrain alone is NOT sufficient: it retains the compositor cache. */
	releasePublishedAfterClear(): void {
		for (const entry of this.publication.values()) {
			entry.releaseGpu();
			entry.releaseSurface();
		}
		for (const entry of this.uncertain) {
			entry.releaseGpu();
			entry.releaseSurface();
		}
		this.publication.clear();
		this.uncertain.clear();
		this.publishedTree = undefined;
		this.committedTextures = [];
	}
	disposeAndDrain(): Promise<void> {
		if (this.disposalDrain) return this.disposalDrain;
		this.closed = true;
		for (const scope of [...this.trees.values()]) scope.close();
		// Outstanding publication pins intentionally block the real owner drain.
		this.disposalDrain = this.preprocessor.disposeAndDrain();
		return this.disposalDrain;
	}
}
