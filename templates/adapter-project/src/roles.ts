/**
 * The adapter's own port roles (S05 P3, design E7).
 *
 * Every role here is this adapter's implementation, not the reference one:
 * different id shapes, a custom asset scheme, a counted diagnostics sink, a
 * forced answer of "no export". They exist to prove a third party can satisfy
 * the port contract without importing anything but the published entries --
 * and without inheriting the reference implementations by accident.
 */
import type {
	AudioContextHandle,
	AudioContextRequest,
	DiagnosticsPort,
	EditorHostPorts,
	EnvironmentCapabilities,
	ExportProvider,
	GraphicsDeclaration,
	IdGenerator,
	LogRecord,
	ObjectUrlHandle,
	RuntimeAssetLoader,
	AssetResolver,
	RuntimeResourceHost,
	SessionEvent,
	SessionId,
	WorkerErrorEvent,
	WorkerHandle,
	WorkerMessageEvent,
	WorkerRequest,
} from "@opencut/editor-ports";

/**
 * Assets under the adapter's own URI scheme. Deliberately neither a path nor a
 * root-absolute location: the port exists so a Host can mount assets wherever
 * it likes, and a custom scheme is the loudest way to exercise that.
 */
export class SchemeAssetResolver implements AssetResolver {
	constructor(private readonly scheme: string = "alien-asset") {}

	resolve({ ref }: { ref: { path: string } }): string {
		return `${this.scheme}://${ref.path}`;
	}
}

/** A byte-bucket asset loader; a miss is an error, never a silent 200. */
export class BytesAssetLoader implements RuntimeAssetLoader {
	private readonly files = new Map<string, ArrayBuffer>();

	put(args: { path: string; bytes: ArrayBuffer }): void {
		this.files.set(args.path, args.bytes);
	}

	async loadBytes({ ref }: { ref: { path: string } }): Promise<ArrayBuffer> {
		const found = this.files.get(ref.path);
		if (!found) throw new Error(`alien host has no such asset: ${ref.path}`);
		return found.slice(0);
	}

	async loadJson<T = unknown>({ ref }: { ref: { path: string } }): Promise<T> {
		const bytes = await this.loadBytes({ ref });
		return JSON.parse(new TextDecoder().decode(bytes)) as T;
	}
}

/**
 * The adapter's own worker: an echo over the same message-delivery contract.
 * It never reads the requested script URL -- the adapter decides what a worker
 * is, which is exactly the freedom the port grants.
 */
class EchoWorkerHandle implements WorkerHandle {
	readonly resourceId: string;
	private readonly listeners = new Set<(event: WorkerMessageEvent) => void>();
	private alive = true;

	constructor(readonly id: string) {
		this.resourceId = `alien-worker:${id}`;
	}

	postMessage({ message }: { message: unknown }): void {
		if (!this.alive) return;
		const data = message;
		queueMicrotask(() => {
			if (!this.alive) return;
			this.listeners.forEach((listener) => listener({ data }));
		});
	}

	onMessage(listener: (event: WorkerMessageEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	onError(_listener: (event: WorkerErrorEvent) => void): () => void {
		return () => {};
	}

	terminate(): void {
		this.alive = false;
		this.listeners.clear();
	}
}

/**
 * Runtime resources under this adapter: workers echo, audio is a counter with
 * no engine behind it, object URLs live in a private URL space. All three are
 * honest answers for a headless third-party host.
 */
export class AlienRuntimeResourceHost implements RuntimeResourceHost {
	readonly requestedWorkerUrls: string[] = [];
	readonly liveObjectUrls = new Set<string>();
	readonly openAudioContexts = new Set<string>();
	private counter = 0;

	createWorker({ request }: { request: WorkerRequest }): WorkerHandle {
		this.requestedWorkerUrls.push(request.url.toString());
		return new EchoWorkerHandle(request.id);
	}

	createAudioContext({
		request,
	}: {
		request: AudioContextRequest;
	}): AudioContextHandle {
		this.counter += 1;
		const id = `alien-audio:${this.counter}`;
		this.openAudioContexts.add(id);
		let closed = false;
		return {
			resourceId: id,
			sampleRate: request.sampleRate ?? 48_000,
			get state() {
				return closed ? ("closed" as const) : ("running" as const);
			},
			context: null,
			close: async () => {
				closed = true;
				this.openAudioContexts.delete(id);
			},
		};
	}

	createObjectUrl({ blob }: { blob: Blob }): ObjectUrlHandle {
		this.counter += 1;
		const url = `alien:object-url/${this.counter}/${blob.size}`;
		this.liveObjectUrls.add(url);
		return {
			resourceId: `alien-object-url:${this.counter}`,
			url,
			revoke: () => {
				this.liveObjectUrls.delete(url);
			},
		};
	}
}

/** This adapter does not export; it says so, with a reason, instead of failing. */
export class NoExportProvider implements ExportProvider {
	canExport(): boolean {
		return false;
	}

	async export() {
		return {
			status: "unsupported" as const,
			reason:
				"The alien adapter hosts no renderer, so it has no export path. " +
				"Export semantics belong to a host that can render.",
		};
	}
}

/** Diagnostics that tally rather than print -- observable, silent, cheap. */
export class TallyingDiagnostics implements DiagnosticsPort {
	readonly logCount: { [level: string]: number } = {};
	readonly eventKinds: { [kind: string]: number } = {};

	log({ record }: { record: LogRecord }): void {
		this.logCount[record.level] = (this.logCount[record.level] ?? 0) + 1;
	}

	event({ event }: { sessionId: SessionId; event: SessionEvent }): void {
		const kind = String(event.kind);
		this.eventKinds[kind] = (this.eventKinds[kind] ?? 0) + 1;
	}
}

/**
 * Ids shaped for this adapter: one random seed per instance, then
 * scope-local counting. Unique within a scope, independent across scopes, and
 * visibly not the reference generator's spelling.
 */
export class SeededCounterIdGenerator implements IdGenerator {
	private readonly seed: string;
	private readonly counters = new Map<string, number>();

	constructor(seed: string = `tp${Math.floor(Math.random() * 1e9).toString(36)}`) {
		this.seed = seed;
	}

	next({ scope }: { scope: string }): string {
		const n = (this.counters.get(scope) ?? 0) + 1;
		this.counters.set(scope, n);
		return `${this.seed}:${scope}:${n}`;
	}
}

/** The adapter's graphics declaration: this host detects, it never asserts. */
export class DetectingEnvironment implements EnvironmentCapabilities {
	constructor(private readonly declaration: GraphicsDeclaration = { mode: "detect" }) {}

	describeGraphics(): GraphicsDeclaration {
		return { ...this.declaration };
	}
}

/** Every adapter role assembled around the adapter's own store. */
export function createAlienPorts(args: {
	store: EditorHostPorts["store"];
}): EditorHostPorts {
	return {
		store: args.store,
		assets: new SchemeAssetResolver(),
		assetLoader: new BytesAssetLoader(),
		runtimeResources: new AlienRuntimeResourceHost(),
		exporter: new NoExportProvider(),
		diagnostics: new TallyingDiagnostics(),
		ids: new SeededCounterIdGenerator(),
		environment: new DetectingEnvironment(),
	};
}
