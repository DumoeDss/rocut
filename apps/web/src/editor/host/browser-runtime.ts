import type {
	AssetRef,
	AssetResolver,
	AudioContextHandle,
	AudioContextRequest,
	ObjectUrlHandle,
	RuntimeAssetLoader,
	RuntimeResourceHost,
	WorkerErrorEvent,
	WorkerHandle,
	WorkerMessageEvent,
	WorkerRequest,
} from "@opencut/editor-ports";

function assertLogicalPath(path: string): void {
	if (!path || path.startsWith("/") || path.startsWith("\\")) {
		throw new Error(`Asset path must be logical and relative: ${path || "<empty>"}`);
	}
	if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.includes("\\")) {
		throw new Error(`Asset path must not contain a scheme or backslash: ${path}`);
	}

	let decoded: string;
	try {
		decoded = decodeURIComponent(path);
	} catch (cause) {
		throw new Error(`Asset path has invalid encoding: ${path}`, { cause });
	}
	if (
		decoded
			.split("/")
			.some((segment) => segment === "." || segment === "..") ||
		decoded.includes("\\")
	) {
		throw new Error(`Asset path must not traverse outside the Host base: ${path}`);
	}
}

function stripQueryAndHash(value: string): string {
	return value.split(/[?#]/, 1)[0] ?? value;
}

/**
 * Immutable resolver for a Host-owned public base. Relative bases stay relative,
 * path bases stay origin-relative, and absolute/custom-scheme bases stay absolute.
 */
export class BrowserAssetResolver implements AssetResolver {
	readonly base: string;

	constructor(base: string) {
		const clean = stripQueryAndHash(base.trim() || "/");
		this.base = `${clean.replace(/\/+$/, "")}/`;
		Object.freeze(this);
	}

	resolve({ ref }: { ref: AssetRef }): string {
		assertLogicalPath(ref.path);
		return `${this.base}${ref.path}`;
	}
}

type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export class BrowserRuntimeAssetLoader implements RuntimeAssetLoader {
	constructor(
		private readonly resolver: AssetResolver,
		private readonly fetchImpl: FetchLike,
	) {}

	private async fetchAsset({
		ref,
		signal,
	}: {
		ref: AssetRef;
		signal?: AbortSignal;
	}): Promise<{ response: Response; location: string }> {
		const location = this.resolver.resolve({ ref });
		const response = await this.fetchImpl(location, { signal });
		if (!response.ok) {
			throw new Error(
				`Failed to load runtime asset ${ref.path} from ${location}: HTTP ${response.status}`,
			);
		}
		return { response, location };
	}

	async loadBytes({
		ref,
		signal,
	}: {
		ref: AssetRef;
		signal?: AbortSignal;
	}): Promise<ArrayBuffer> {
		const { response } = await this.fetchAsset({ ref, signal });
		return response.arrayBuffer();
	}

	async loadJson<T = unknown>({
		ref,
		signal,
	}: {
		ref: AssetRef;
		signal?: AbortSignal;
	}): Promise<T> {
		const { response, location } = await this.fetchAsset({ ref, signal });
		const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
		if (!/(?:application|text)\/(?:[\w.+-]*\+)?json\b/.test(contentType)) {
			throw new Error(
				`Runtime JSON asset ${ref.path} from ${location} has unexpected content type ${contentType || "<missing>"}`,
			);
		}
		try {
			return JSON.parse(await response.text()) as T;
		} catch (cause) {
			throw new Error(
				`Runtime JSON asset ${ref.path} from ${location} is malformed`,
				{ cause },
			);
		}
	}
}

export interface PlatformWorkerLike {
	postMessage(message: unknown, transfer?: Transferable[]): void;
	addEventListener(type: "message" | "error", listener: EventListener): void;
	removeEventListener(type: "message" | "error", listener: EventListener): void;
	terminate(): void;
}

export type BrowserWorkerFactory = (args: {
	request: WorkerRequest;
	url: URL;
}) => PlatformWorkerLike;

export type BrowserWorkerUrlRewriter = (args: {
	request: WorkerRequest;
}) => URL;

class BrowserWorkerHandle implements WorkerHandle {
	readonly resourceId: string;
	private terminated = false;
	private readonly removers = new Set<() => void>();

	constructor(
		readonly id: WorkerRequest["id"],
		private readonly worker: PlatformWorkerLike,
		sequence: number,
	) {
		this.resourceId = `browser-worker:${id}:${sequence}`;
	}

	postMessage({
		message,
		transfer,
	}: {
		message: unknown;
		transfer?: readonly Transferable[];
	}): void {
		if (this.terminated) return;
		this.worker.postMessage(message, transfer ? [...transfer] : undefined);
	}

	onMessage(listener: (event: WorkerMessageEvent) => void): () => void {
		return this.listen("message", (event) => {
			listener({ data: (event as MessageEvent).data });
		});
	}

	onError(listener: (event: WorkerErrorEvent) => void): () => void {
		return this.listen("error", (event) => {
			const error = event as ErrorEvent;
			listener({
				message: error.message,
				filename: error.filename || undefined,
				lineno: error.lineno || undefined,
			});
		});
	}

	private listen(type: "message" | "error", listener: EventListener): () => void {
		if (this.terminated) return () => {};
		this.worker.addEventListener(type, listener);
		let active = true;
		const remove = () => {
			if (!active) return;
			active = false;
			this.worker.removeEventListener(type, listener);
			this.removers.delete(remove);
		};
		this.removers.add(remove);
		return remove;
	}

	terminate(): void {
		if (this.terminated) return;
		this.terminated = true;
		for (const remove of [...this.removers]) remove();
		this.worker.terminate();
	}
}

export class BrowserRuntimeResourceHost implements RuntimeResourceHost {
	private sequence = 0;

	constructor(
		private readonly createPlatformWorker: BrowserWorkerFactory,
		private readonly rewriteWorkerUrl?: BrowserWorkerUrlRewriter,
	) {}

	createWorker({ request }: { request: WorkerRequest }): WorkerHandle {
		const url = this.rewriteWorkerUrl?.({ request }) ?? request.url;
		const worker = this.createPlatformWorker({ request, url });
		return new BrowserWorkerHandle(request.id, worker, (this.sequence += 1));
	}

	createAudioContext({
		request,
	}: {
		request: AudioContextRequest;
	}): AudioContextHandle {
		const context = new AudioContext(
			request.sampleRate ? { sampleRate: request.sampleRate } : undefined,
		);
		let closed = false;
		const resourceId = `browser-audio:${(this.sequence += 1)}`;
		return {
			resourceId,
			sampleRate: context.sampleRate,
			get state() {
				if (closed || context.state === "closed") return "closed" as const;
				return context.state === "running"
					? ("running" as const)
					: ("suspended" as const);
			},
			context,
			close: async () => {
				if (closed) return;
				closed = true;
				await context.close();
			},
		};
	}

	createObjectUrl({ blob }: { blob: Blob }): ObjectUrlHandle {
		const url = URL.createObjectURL(blob);
		let revoked = false;
		return {
			resourceId: `browser-object-url:${(this.sequence += 1)}`,
			url,
			revoke: () => {
				if (revoked) return;
				revoked = true;
				URL.revokeObjectURL(url);
			},
		};
	}
}

export interface BrowserRuntimePortsOptions {
	base: string;
	fetch?: FetchLike;
	workerFactory?: BrowserWorkerFactory;
	rewriteWorkerUrl?: BrowserWorkerUrlRewriter;
}

export function createBrowserRuntimePorts({
	base,
	fetch: fetchImpl = globalThis.fetch.bind(globalThis),
	workerFactory = ({ request, url }) => {
		if (request.id === "transcription") {
			if (request.type !== "module") {
				throw new Error("The bundled transcription Worker must use module type.");
			}
			return new Worker(
				new URL("../../services/transcription/worker.ts", import.meta.url),
				{ type: "module", name: request.name },
			);
		}
		return new Worker(url, { type: request.type, name: request.name });
	},
	rewriteWorkerUrl,
}: BrowserRuntimePortsOptions): {
	readonly assets: AssetResolver;
	readonly assetLoader: RuntimeAssetLoader;
	readonly runtimeResources: RuntimeResourceHost;
} {
	const assets = new BrowserAssetResolver(base);
	return Object.freeze({
		assets,
		assetLoader: new BrowserRuntimeAssetLoader(assets, fetchImpl),
		runtimeResources: new BrowserRuntimeResourceHost(
			workerFactory,
			rewriteWorkerUrl,
		),
	});
}

/** Resolve a Host service or navigation path without sending it through AssetResolver. */
export function resolveHostPath(base: string, path: string): string {
	if (!path || path.startsWith("/") || path.startsWith("\\")) {
		throw new Error(`Host path must be logical and relative: ${path || "<empty>"}`);
	}
	const normalizedBase = new BrowserAssetResolver(base).base;
	if (/^[a-z][a-z\d+.-]*:/i.test(normalizedBase)) {
		return new URL(path, normalizedBase).toString();
	}
	const resolved = `${normalizedBase}${path}`;
	return resolved.startsWith("//") ? resolved.slice(1) : resolved;
}
