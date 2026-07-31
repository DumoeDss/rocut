/**
 * The in-memory reference implementation of every port.
 *
 * **Working, not stubbed.** The real hazard of a freeze child is that a
 * type-only contract compiles clean and proves nothing; the mitigation is that
 * this implementation actually does the thing, and that the conformance suite is
 * written to be pointed at a second implementation. A port that cannot be
 * implemented twice is not a port.
 *
 * It is also the only implementation available to a headless run and to a test,
 * which is what makes the no-rasterizer path reachable without special hardware
 * — S01 could never reach a configuration that rendered the degraded-renderer
 * banner.
 */
import type { AssetRef, AssetResolver, RuntimeAssetLoader } from "../assets";
import type { DiagnosticsPort, LogRecord, SessionEvent } from "../diagnostics";
import type {
	EnvironmentCapabilities,
	GraphicsDeclaration,
} from "../environment";
import type { ExportProvider } from "../export-provider";
import type { IdGenerator } from "../id-generator";
import type { ProjectId, SessionId } from "../identity";
import type {
	MigrationContext,
	MigrationOutcome,
	ProjectRecord,
	ProjectStore,
	ProjectSummary,
} from "../project-store";
import type {
	AudioContextHandle,
	AudioContextRequest,
	ObjectUrlHandle,
	RuntimeResourceHost,
	WorkerErrorEvent,
	WorkerHandle,
	WorkerMessageEvent,
	WorkerRequest,
} from "../runtime-resources";
import type { EditorHostPorts } from "../index";

/**
 * Deep-copy a payload the store does not interpret.
 *
 * `structuredClone` rather than a JSON round-trip: the payload is *opaque*, so
 * the store must not quietly narrow it to what JSON can express. Storing the
 * caller's object by reference would also let a later mutation change what was
 * "persisted", which would make a passing round-trip test meaningless.
 */
function clonePayload(value: unknown): unknown {
	if (typeof structuredClone === "function") return structuredClone(value);
	return JSON.parse(JSON.stringify(value ?? null)) as unknown;
}

export interface InMemoryProjectStoreOptions {
	schemaVersion?: number;
	/** Supply to exercise the migration path; omit for a store with no legacy data. */
	migrate?: (ctx: MigrationContext) => Promise<MigrationOutcome>;
}

export class InMemoryProjectStore implements ProjectStore {
	readonly schemaVersion: number;
	readonly migrate?: (ctx: MigrationContext) => Promise<MigrationOutcome>;

	private readonly records = new Map<ProjectId, ProjectRecord>();
	private readonly summaries = new Map<ProjectId, ProjectSummary>();

	constructor(options: InMemoryProjectStoreOptions = {}) {
		this.schemaVersion = options.schemaVersion ?? 1;
		if (options.migrate) this.migrate = options.migrate;
	}

	async list(): Promise<readonly ProjectSummary[]> {
		return [...this.summaries.values()].sort((a, b) =>
			b.updatedAt.localeCompare(a.updatedAt),
		);
	}

	async load({ id }: { id: ProjectId }): Promise<ProjectRecord | null> {
		const found = this.records.get(id);
		if (!found) return null;
		return { ...found, data: clonePayload(found.data) };
	}

	async save({
		record,
		summary,
	}: {
		record: ProjectRecord;
		summary: ProjectSummary;
	}): Promise<void> {
		this.records.set(record.id, {
			id: record.id,
			schemaVersion: record.schemaVersion,
			data: clonePayload(record.data),
		});
		this.summaries.set(summary.id, { ...summary });
	}

	async remove({ id }: { id: ProjectId }): Promise<void> {
		this.records.delete(id);
		this.summaries.delete(id);
	}
}

export class InMemoryAssetResolver implements AssetResolver {
	constructor(private readonly base: string = "assets/") {}

	resolve({ ref }: { ref: AssetRef }): string {
		return `${this.base}${ref.path}`;
	}
}

export class InMemoryRuntimeAssetLoader implements RuntimeAssetLoader {
	private readonly files = new Map<string, ArrayBuffer>();

	put(args: { path: string; bytes: ArrayBuffer }): void {
		this.files.set(args.path, args.bytes);
	}

	putJson(args: { path: string; value: unknown }): void {
		const encoded = new TextEncoder().encode(JSON.stringify(args.value));
		// `.slice()` yields a plain ArrayBuffer regardless of the view's offset.
		this.files.set(args.path, encoded.buffer.slice(0) as ArrayBuffer);
	}

	async loadBytes({ ref }: { ref: AssetRef }): Promise<ArrayBuffer> {
		const found = this.files.get(ref.path);
		if (!found) throw new Error(`No such asset: ${ref.path}`);
		// Copied, for the same reason `InMemoryProjectStore.load` clones: handing
		// back the stored buffer by reference lets a caller that mutates it corrupt
		// the "file" for every later read.
		return found.slice(0);
	}

	async loadJson<T = unknown>({ ref }: { ref: AssetRef }): Promise<T> {
		const bytes = await this.loadBytes({ ref });
		return JSON.parse(new TextDecoder().decode(bytes)) as T;
	}
}

/**
 * An in-memory worker.
 *
 * It does not execute the script at `request.url`; there is no script host in
 * memory. What it *does* implement is the part of the contract a Host is
 * responsible for — construction, message delivery, error delivery and
 * termination — so the conformance suite exercises the handle rather than
 * asserting a type.
 *
 * The default behaviour echoes messages back, which makes the round-trip
 * observable. `respond` replaces it for a caller that wants something else.
 */
export class InMemoryWorkerHandle implements WorkerHandle {
	readonly resourceId: string;
	private readonly messageListeners = new Set<
		(event: WorkerMessageEvent) => void
	>();
	private readonly errorListeners = new Set<
		(event: WorkerErrorEvent) => void
	>();
	private terminated = false;

	constructor(
		readonly id: string,
		readonly request: WorkerRequest,
		private respond: (message: unknown) => unknown = (m) => m,
	) {
		this.resourceId = `worker:${id}`;
	}

	setResponder(respond: (message: unknown) => unknown): void {
		this.respond = respond;
	}

	postMessage({ message }: { message: unknown }): void {
		if (this.terminated) return;
		const data = this.respond(message);
		queueMicrotask(() => {
			if (this.terminated) return;
			this.messageListeners.forEach((listener) => {
				listener({ data });
			});
		});
	}

	emitError(event: WorkerErrorEvent): void {
		this.errorListeners.forEach((listener) => {
			listener(event);
		});
	}

	onMessage(listener: (event: WorkerMessageEvent) => void): () => void {
		this.messageListeners.add(listener);
		return () => {
			this.messageListeners.delete(listener);
		};
	}

	onError(listener: (event: WorkerErrorEvent) => void): () => void {
		this.errorListeners.add(listener);
		return () => {
			this.errorListeners.delete(listener);
		};
	}

	get isTerminated(): boolean {
		return this.terminated;
	}

	terminate(): void {
		this.terminated = true;
		this.messageListeners.clear();
		this.errorListeners.clear();
	}
}

export class InMemoryRuntimeResourceHost implements RuntimeResourceHost {
	readonly workers: InMemoryWorkerHandle[] = [];
	readonly objectUrls: { url: string; revoked: boolean }[] = [];
	readonly audioContexts: { closed: boolean }[] = [];
	private counter = 0;

	/**
	 * The URL the *editor* asked for, recorded so a test can assert that the Host
	 * — not the editor — decided what to do with it. A Host rewriting it is
	 * conforming behaviour; see `runtime-resources.ts`.
	 */
	readonly requestedWorkerUrls: string[] = [];

	createWorker({ request }: { request: WorkerRequest }): WorkerHandle {
		this.requestedWorkerUrls.push(request.url.toString());
		const handle = new InMemoryWorkerHandle(request.id, request);
		this.workers.push(handle);
		return handle;
	}

	createAudioContext({
		request,
	}: {
		request: AudioContextRequest;
	}): AudioContextHandle {
		const entry = { closed: false };
		this.audioContexts.push(entry);
		return {
			resourceId: `audio:${(this.counter += 1)}`,
			sampleRate: request.sampleRate ?? 48_000,
			get state() {
				return entry.closed ? ("closed" as const) : ("running" as const);
			},
			// No Web Audio implementation exists in memory. `null` is a conforming
			// answer, not a stub — a headless run is genuinely in this position.
			context: null,
			close: async () => {
				entry.closed = true;
			},
		};
	}

	createObjectUrl({ blob }: { blob: Blob }): ObjectUrlHandle {
		const entry = {
			url: `memory:blob/${(this.counter += 1)}/${blob.size}`,
			revoked: false,
		};
		this.objectUrls.push(entry);
		return {
			resourceId: `object-url:${this.counter}`,
			url: entry.url,
			revoke: () => {
				entry.revoked = true;
			},
		};
	}
}

export class UnsupportedExportProvider implements ExportProvider {
	canExport(): boolean {
		return false;
	}

	async export() {
		return {
			status: "unsupported" as const,
			reason:
				"The in-memory reference host does not export. Export semantics are S08's; " +
				"the role is declared here so a Host author sees the whole surface.",
		};
	}
}

export class RecordingDiagnostics implements DiagnosticsPort {
	readonly logs: LogRecord[] = [];
	readonly events: { sessionId: SessionId; event: SessionEvent }[] = [];

	log({ record }: { record: LogRecord }): void {
		this.logs.push(record);
	}

	event(args: { sessionId: SessionId; event: SessionEvent }): void {
		this.events.push(args);
	}
}

/**
 * A deterministic id generator, which is the whole reason the role exists: a
 * headless (C7) or automation (S03) run is reproducible only if a Host can
 * supply determinism. Per-scope counters, so adding a call of one kind does not
 * renumber another.
 */
export class DeterministicIdGenerator implements IdGenerator {
	private readonly counters = new Map<string, number>();

	next({ scope }: { scope: string }): string {
		const n = (this.counters.get(scope) ?? 0) + 1;
		this.counters.set(scope, n);
		return `${scope}-${n}`;
	}
}

export class StaticEnvironmentCapabilities implements EnvironmentCapabilities {
	constructor(
		private readonly declaration: GraphicsDeclaration = { mode: "detect" },
	) {}

	describeGraphics(): GraphicsDeclaration {
		return this.declaration;
	}
}

/** Every port, assembled. */
export function createInMemoryPorts(options: {
	graphics?: GraphicsDeclaration;
	store?: ProjectStore;
} = {}): EditorHostPorts {
	return {
		store: options.store ?? new InMemoryProjectStore(),
		assets: new InMemoryAssetResolver(),
		assetLoader: new InMemoryRuntimeAssetLoader(),
		runtimeResources: new InMemoryRuntimeResourceHost(),
		exporter: new UnsupportedExportProvider(),
		diagnostics: new RecordingDiagnostics(),
		ids: new DeterministicIdGenerator(),
		environment: new StaticEnvironmentCapabilities(options.graphics),
	};
}
