/**
 * The runtime-resource port — the platform objects the editor cannot construct
 * for itself without deciding something that belongs to the Host.
 *
 * ## Why the Host constructs the worker
 *
 * E0 measured a packaged-Elftia refusal as `SecurityError … cannot be accessed
 * from origin 'app://bundle'`. That is the **same-origin rule**, and **no CSP
 * token can fix it** — only the serving origin can. So a port shaped
 * `createWorker(url): Worker` implemented by the editor, or a
 * `worker: { baseUrl }` the editor resolves against, both leave construction at
 * the editor's own origin, which is fixed and wrong for the one Host this
 * workstream exists to serve. The failure would be frozen into the contract and
 * discovered only at the Spike.
 *
 * So: the editor supplies its bundler-resolved location and a stable logical id,
 * and the **Host returns a constructed handle**. The supplied location is a
 * *request the Host may rewrite* — fetching the script and constructing from a
 * same-origin `blob:` URL, or serving it from the Host's own origin, is
 * conforming behaviour, not a workaround.
 *
 * ## Why the handle is not a `Worker`
 *
 * A Host that had to hand back a live `Worker` could not proxy one across a
 * process boundary, and the contract could not be implemented in memory — which
 * would mean the conformance suite could never exercise it. The handle exposes
 * what the editor's single existing call site actually uses.
 */
import type { ResourceId, WorkerId } from "./identity";

export interface WorkerMessageEvent {
	readonly data: unknown;
}

export interface WorkerErrorEvent {
	readonly message: string;
	readonly filename?: string;
	readonly lineno?: number;
}

export interface WorkerRequest {
	/** Stable logical identity, independent of where the script is served from. */
	readonly id: WorkerId;
	/**
	 * Where the editor's bundler resolved the script to.
	 *
	 * A **request, not a guarantee**. A Host may serve the same script from
	 * somewhere else; see this file's header.
	 */
	readonly url: URL;
	readonly type: "module" | "classic";
	readonly name?: string;
}

export interface WorkerHandle {
	readonly id: WorkerId;
	readonly resourceId: ResourceId;
	postMessage(args: {
		message: unknown;
		transfer?: readonly Transferable[];
	}): void;
	onMessage(listener: (event: WorkerMessageEvent) => void): () => void;
	onError(listener: (event: WorkerErrorEvent) => void): () => void;
	terminate(): void;
}

export interface AudioContextRequest {
	readonly sampleRate?: number;
}

export interface AudioContextHandle {
	readonly resourceId: ResourceId;
	readonly sampleRate: number;
	readonly state: "running" | "suspended" | "closed";
	/**
	 * The platform audio context, when the Host has one.
	 *
	 * `null` is conforming and is not a stub: a headless run (C7) and an
	 * in-memory implementation genuinely have no Web Audio implementation, and
	 * the disposal accounting this registry exists for is unaffected by its
	 * absence. A caller that needs the platform object checks for it.
	 */
	readonly context: AudioContext | null;
	close(): Promise<void>;
}

export interface ObjectUrlHandle {
	readonly resourceId: ResourceId;
	/** Opaque to the editor: `blob:`, a custom scheme, or a Host-served URL. */
	readonly url: string;
	revoke(): void;
}

/**
 * What the **Host** implements. Acquisition is mediated by the session's
 * resource registry (see `../session/resources.ts`), which delegates
 * construction here and records what it handed out. The two layers are not the
 * same thing: this one decides *how* a resource comes into existence, the
 * registry decides that nothing comes into existence unobserved.
 */
export interface RuntimeResourceHost {
	createWorker(args: { request: WorkerRequest }): WorkerHandle;
	createAudioContext(args: {
		request: AudioContextRequest;
	}): AudioContextHandle;
	createObjectUrl(args: { blob: Blob }): ObjectUrlHandle;
}
