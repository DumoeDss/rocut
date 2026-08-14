/**
 * s05-second-host — `ElectronRuntimeResources` (design E3/E6): the one port
 * role this Host owns outright, for the exact origin problem the port was
 * frozen around.
 *
 * `createWorker` rewrites the request onto the renderer's own scheme origin
 * (`opencut://app`): a script the editor's bundler resolved anywhere else is
 * served same-origin by construction, which is what a `file://` page can never
 * offer. The request URL is a *request, not a guarantee* (the port's header);
 * an explicit rewriter (the evidence harnesses) takes precedence over the
 * scheme mapping.
 *
 * Audio contexts and object URLs are the generic semantics the browser
 * reference host implements; they are re-implemented here rather than
 * delegated so the owned role owns all three decisions — nothing quietly
 * falls back to a browser or in-memory implementation.
 */
import type {
	AudioContextHandle,
	AudioContextRequest,
	ObjectUrlHandle,
	RuntimeResourceHost,
	WorkerErrorEvent,
	WorkerHandle,
	WorkerMessageEvent,
	WorkerRequest,
} from "@opencut/editor-ports";

/** Same seam `createBrowserRuntimePorts` exposes; the harnesses thread it. */
export type ElectronWorkerUrlRewriter = (args: {
	request: WorkerRequest;
}) => URL;

class ElectronWorkerHandle implements WorkerHandle {
	readonly resourceId: string;
	private terminated = false;
	private readonly removers = new Set<() => void>();

	constructor(
		readonly id: WorkerRequest["id"],
		private readonly worker: Worker,
		sequence: number,
	) {
		this.resourceId = `electron-worker:${id}:${sequence}`;
	}

	postMessage({
		message,
		transfer,
	}: {
		message: unknown;
		transfer?: readonly Transferable[];
	}): void {
		if (this.terminated) return;
		if (transfer) {
			this.worker.postMessage(message, [...transfer]);
		} else {
			this.worker.postMessage(message);
		}
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

export class ElectronRuntimeResources implements RuntimeResourceHost {
	private sequence = 0;

	constructor(private readonly rewriteWorkerUrl?: ElectronWorkerUrlRewriter) {}

	/**
	 * Design E6: onto the scheme origin. A URL already on this origin passes
	 * through untouched; anything else keeps its path and query but is served
	 * from `opencut://app`, same-origin by construction.
	 */
	private schemeUrl(request: WorkerRequest): URL {
		const origin = globalThis.location?.origin;
		if (!origin || request.url.origin === origin) return request.url;
		return new URL(`${request.url.pathname}${request.url.search}`, origin);
	}

	createWorker({ request }: { request: WorkerRequest }): WorkerHandle {
		const url = this.rewriteWorkerUrl?.({ request }) ?? this.schemeUrl(request);
		const worker = new Worker(url, { type: request.type, name: request.name });
		return new ElectronWorkerHandle(request.id, worker, (this.sequence += 1));
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
		const resourceId = `electron-audio:${(this.sequence += 1)}`;
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
			resourceId: `electron-object-url:${(this.sequence += 1)}`,
			url,
			revoke: () => {
				if (revoked) return;
				revoked = true;
				URL.revokeObjectURL(url);
			},
		};
	}
}
