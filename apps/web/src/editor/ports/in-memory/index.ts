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
	LibraryRecord,
	MigrationContext,
	MigrationOutcome,
	ProjectAttachment,
	ProjectRecord,
	ProjectStore,
	ProjectStoreClearScope,
	ProjectStoreErrorCode,
	ProjectStoreErrorScope,
	ProjectStoreInspection,
	ProjectStoreOperation,
	ProjectSummary,
} from "../project-store";
import { ProjectStoreError } from "../project-store";
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
function clonePayload<Value>({
	value,
	failure,
}: {
	value: Value;
	failure?: {
		operation: ProjectStoreOperation;
		scope: ProjectStoreErrorScope;
	};
}): Value {
	try {
		if (typeof structuredClone !== "function") {
			throw new Error("This Host does not provide structured cloning");
		}
		return structuredClone(value);
	} catch {
		if (!failure) {
			throw new Error("Project store value cannot be cloned");
		}
		throw new ProjectStoreError({
			code: "corrupt",
			operation: failure.operation,
			scope: failure.scope,
			message: `Project store ${failure.operation} received an invalid opaque value`,
		});
	}
}

export interface InMemoryProjectStoreOptions {
	schemaVersion?: number;
	/** Supply to exercise the migration path; omit for a store with no legacy data. */
	migrate?: (ctx: MigrationContext) => Promise<MigrationOutcome>;
	/** Test/adapter conformance control; it is never visible through ProjectStore. */
	control?: InMemoryProjectStoreControl;
}

export interface InMemoryMutationPause {
	readonly entered: Promise<void>;
	release(): void;
}

interface PendingMutationPause {
	readonly operation: ProjectStoreOperation;
	readonly entered: () => void;
	readonly wait: Promise<void>;
}

/**
 * Fault and scheduling control for the reusable conformance matrix.
 *
 * This object is deliberately beside the implementation, not a member of the
 * public port. A real adapter fixture can offer the same structural controls by
 * instrumenting its own backing store without leaking them to editor callers.
 */
export class InMemoryProjectStoreControl {
	private inspection: ProjectStoreInspection = {
		availability: "available",
		capacity: null,
	};
	private readonly failures: Array<{
		operation: ProjectStoreOperation;
		code: ProjectStoreErrorCode;
	}> = [];
	private readonly pauses: PendingMutationPause[] = [];

	setInspection(inspection: ProjectStoreInspection): void {
		this.inspection = clonePayload({ value: inspection });
	}

	readInspection(): ProjectStoreInspection {
		return clonePayload({ value: this.inspection });
	}

	failNext(args: {
		operation: ProjectStoreOperation;
		code: ProjectStoreErrorCode;
	}): void {
		this.failures.push(args);
	}

	pauseNext(args: { operation: ProjectStoreOperation }): InMemoryMutationPause {
		let markEntered!: () => void;
		const entered = new Promise<void>((resolve) => {
			markEntered = resolve;
		});
		let release!: () => void;
		const wait = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.pauses.push({ operation: args.operation, entered: markEntered, wait });
		return { entered, release };
	}

	async beforeCommit(args: {
		operation: ProjectStoreOperation;
		scope: ProjectStoreErrorScope;
		signal?: AbortSignal;
	}): Promise<void> {
		throwIfAborted(args);
		const failureIndex = this.failures.findIndex(
			(item) => item.operation === args.operation,
		);
		if (failureIndex >= 0) {
			const [failure] = this.failures.splice(failureIndex, 1);
			throw new ProjectStoreError({
				code: failure.code,
				operation: args.operation,
				scope: args.scope,
			});
		}
		const pauseIndex = this.pauses.findIndex(
			(item) => item.operation === args.operation,
		);
		if (pauseIndex >= 0) {
			const [pause] = this.pauses.splice(pauseIndex, 1);
			pause.entered();
			await pause.wait;
			throwIfAborted(args);
		}
	}
}

function throwIfAborted(args: {
	operation: ProjectStoreOperation;
	scope: ProjectStoreErrorScope;
	signal?: AbortSignal;
}): void {
	if (!args.signal?.aborted) return;
	throw new ProjectStoreError({
		code: "aborted",
		operation: args.operation,
		scope: args.scope,
	});
}

type MutationIdentity =
	| { readonly kind: "project-record"; readonly projectId: ProjectId }
	| {
			readonly kind: "attachment";
			readonly projectId: ProjectId;
			readonly key: string;
	  }
	| { readonly kind: "project-tree"; readonly projectId: ProjectId }
	| { readonly kind: "all-projects" }
	| {
			readonly kind: "library-record";
			readonly namespace: string;
			readonly key: string;
	  }
	| { readonly kind: "library-namespace"; readonly namespace: string }
	| { readonly kind: "all" };

interface PendingMutation {
	readonly identity: MutationIdentity;
	readonly completion: Promise<void>;
}

type ProjectMutationIdentity = Extract<
	MutationIdentity,
	{ kind: "project-record" | "attachment" | "project-tree" | "all-projects" }
>;

type LibraryMutationIdentity = Extract<
	MutationIdentity,
	{ kind: "library-record" | "library-namespace" }
>;

function isProjectMutation(
	identity: MutationIdentity,
): identity is ProjectMutationIdentity {
	return (
		identity.kind === "project-record" ||
		identity.kind === "attachment" ||
		identity.kind === "project-tree" ||
		identity.kind === "all-projects"
	);
}

function isLibraryMutation(
	identity: MutationIdentity,
): identity is LibraryMutationIdentity {
	return (
		identity.kind === "library-record" ||
		identity.kind === "library-namespace"
	);
}

function mutationIdentitiesConflict(args: {
	left: MutationIdentity;
	right: MutationIdentity;
}): boolean {
	const { left, right } = args;
	if (left.kind === "all" || right.kind === "all") return true;
	if (left.kind === "all-projects" || right.kind === "all-projects") {
		return isProjectMutation(left) && isProjectMutation(right);
	}
	if (left.kind === "project-tree") {
		return (
			(right.kind === "project-record" ||
				right.kind === "attachment" ||
				right.kind === "project-tree") &&
			right.projectId === left.projectId
		);
	}
	if (right.kind === "project-tree") {
		return (
			(left.kind === "project-record" ||
				left.kind === "attachment") &&
			left.projectId === right.projectId
		);
	}
	if (left.kind === "project-record" && right.kind === "project-record") {
		return left.projectId === right.projectId;
	}
	if (left.kind === "attachment" && right.kind === "attachment") {
		return left.projectId === right.projectId && left.key === right.key;
	}
	if (left.kind === "library-namespace") {
		return isLibraryMutation(right) && left.namespace === right.namespace;
	}
	if (right.kind === "library-namespace") {
		return isLibraryMutation(left) && left.namespace === right.namespace;
	}
	if (left.kind === "library-record" && right.kind === "library-record") {
		return left.namespace === right.namespace && left.key === right.key;
	}
	return false;
}

export class InMemoryProjectStore implements ProjectStore {
	readonly schemaVersion: number;
	readonly migrate?: (ctx: MigrationContext) => Promise<MigrationOutcome>;

	private readonly records = new Map<ProjectId, ProjectRecord>();
	private readonly summaries = new Map<ProjectId, ProjectSummary>();
	private readonly attachments = new Map<
		ProjectId,
		Map<string, ProjectAttachment>
	>();
	private readonly libraries = new Map<string, Map<string, LibraryRecord>>();
	private readonly pendingMutations = new Set<PendingMutation>();
	private readonly control: InMemoryProjectStoreControl;

	constructor(options: InMemoryProjectStoreOptions = {}) {
		this.schemaVersion = options.schemaVersion ?? 1;
		if (options.migrate) this.migrate = options.migrate;
		this.control = options.control ?? new InMemoryProjectStoreControl();
		// Adapter callers frequently pass operations as callbacks. Keep the new
		// call families safe under the same ordinary JavaScript usage.
		this.loadAttachment = this.loadAttachment.bind(this);
		this.saveAttachment = this.saveAttachment.bind(this);
		this.loadLibraryRecord = this.loadLibraryRecord.bind(this);
		this.saveLibraryRecord = this.saveLibraryRecord.bind(this);
	}

	async list(
		args: { signal?: AbortSignal } = {},
	): Promise<readonly ProjectSummary[]> {
		throwIfAborted({
			operation: "list-projects",
			scope: { kind: "store" },
			signal: args.signal,
		});
		return [...this.summaries.values()]
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
			.map((summary) =>
				clonePayload({
					value: summary,
					failure: {
						operation: "list-projects",
						scope: { kind: "store" },
					},
				}),
			);
	}

	async load({
		id,
		signal,
	}: {
		id: ProjectId;
		signal?: AbortSignal;
	}): Promise<ProjectRecord | null> {
		throwIfAborted({
			operation: "load-project",
			scope: { kind: "project", projectId: id },
			signal,
		});
		const found = this.records.get(id);
		if (!found) return null;
		return clonePayload({
			value: found,
			failure: {
				operation: "load-project",
				scope: { kind: "project", projectId: id },
			},
		});
	}

	async save({
		record,
		summary,
		signal,
	}: {
		record: ProjectRecord;
		summary: ProjectSummary;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope = { kind: "project", projectId: record.id } as const;
		throwIfAborted({ operation: "save-project", scope, signal });
		if (record.id !== summary.id) {
			throw new ProjectStoreError({
				code: "conflict",
				operation: "save-project",
				scope,
				message: "Project record and summary identities do not match",
			});
		}
		const copiedRecord = clonePayload({
			value: record,
			failure: { operation: "save-project", scope },
		});
		const copiedSummary = clonePayload({
			value: summary,
			failure: { operation: "save-project", scope },
		});
		await this.enqueue({
			identity: { kind: "project-record", projectId: record.id },
			operation: async () => {
				await this.control.beforeCommit({
					operation: "save-project",
					scope,
					signal,
				});
				this.records.set(record.id, copiedRecord);
				this.summaries.set(summary.id, copiedSummary);
			},
		});
	}

	async remove({
		id,
		signal,
	}: {
		id: ProjectId;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope = { kind: "project", projectId: id } as const;
		throwIfAborted({ operation: "remove-project", scope, signal });
		await this.enqueue({
			identity: { kind: "project-tree", projectId: id },
			operation: async () => {
				await this.control.beforeCommit({
					operation: "remove-project",
					scope,
					signal,
				});
				this.records.delete(id);
				this.summaries.delete(id);
				this.attachments.delete(id);
			},
		});
	}

	async listAttachments(args: {
		projectId: ProjectId;
		signal?: AbortSignal;
	}): Promise<readonly ProjectAttachment[]> {
		throwIfAborted({
			operation: "list-attachments",
			scope: { kind: "project", projectId: args.projectId },
			signal: args.signal,
		});
		return [...(this.attachments.get(args.projectId)?.values() ?? [])]
			.sort((a, b) => a.key.localeCompare(b.key))
			.map((attachment) =>
				clonePayload({
					value: attachment,
					failure: {
						operation: "list-attachments",
						scope: { kind: "project", projectId: args.projectId },
					},
				}),
			);
	}

	async loadAttachment(args: {
		projectId: ProjectId;
		key: string;
		signal?: AbortSignal;
	}): Promise<ProjectAttachment | null> {
		const scope = {
			kind: "attachment",
			projectId: args.projectId,
			key: args.key,
		} as const;
		throwIfAborted({
			operation: "load-attachment",
			scope,
			signal: args.signal,
		});
		const found = this.attachments.get(args.projectId)?.get(args.key);
		return found
			? clonePayload({
					value: found,
					failure: { operation: "load-attachment", scope },
				})
			: null;
	}

	async saveAttachment(args: {
		projectId: ProjectId;
		key: string;
		metadata: unknown;
		body: ArrayBuffer;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope = {
			kind: "attachment",
			projectId: args.projectId,
			key: args.key,
		} as const;
		throwIfAborted({
			operation: "save-attachment",
			scope,
			signal: args.signal,
		});
		const attachment = clonePayload({
			value: {
				projectId: args.projectId,
				key: args.key,
				metadata: args.metadata,
				body: args.body,
			},
			failure: { operation: "save-attachment", scope },
		});
		await this.enqueue({
			identity: {
				kind: "attachment",
				projectId: args.projectId,
				key: args.key,
			},
			operation: async () => {
				await this.control.beforeCommit({
					operation: "save-attachment",
					scope,
					signal: args.signal,
				});
				const inspection = this.control.readInspection();
				if (
					inspection.availability === "available" &&
					inspection.capacity !== null &&
					attachment.body.byteLength > inspection.capacity.remainingBytes
				) {
					throw new ProjectStoreError({
						code: "quota-exceeded",
						operation: "save-attachment",
						scope,
					});
				}
				let projectAttachments = this.attachments.get(args.projectId);
				if (!projectAttachments) {
					projectAttachments = new Map();
					this.attachments.set(args.projectId, projectAttachments);
				}
				projectAttachments.set(args.key, attachment);
			},
		});
	}

	async removeAttachment(args: {
		projectId: ProjectId;
		key: string;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope = {
			kind: "attachment",
			projectId: args.projectId,
			key: args.key,
		} as const;
		throwIfAborted({
			operation: "remove-attachment",
			scope,
			signal: args.signal,
		});
		await this.enqueue({
			identity: {
				kind: "attachment",
				projectId: args.projectId,
				key: args.key,
			},
			operation: async () => {
				await this.control.beforeCommit({
					operation: "remove-attachment",
					scope,
					signal: args.signal,
				});
				this.attachments.get(args.projectId)?.delete(args.key);
			},
		});
	}

	async listLibraryRecords(args: {
		namespace: string;
		signal?: AbortSignal;
	}): Promise<readonly LibraryRecord[]> {
		throwIfAborted({
			operation: "list-library-records",
			scope: { kind: "library", namespace: args.namespace },
			signal: args.signal,
		});
		return [...(this.libraries.get(args.namespace)?.values() ?? [])]
			.sort((a, b) => a.key.localeCompare(b.key))
			.map((record) =>
				clonePayload({
					value: record,
					failure: {
						operation: "list-library-records",
						scope: { kind: "library", namespace: args.namespace },
					},
				}),
			);
	}

	async loadLibraryRecord(args: {
		namespace: string;
		key: string;
		signal?: AbortSignal;
	}): Promise<LibraryRecord | null> {
		const scope = {
			kind: "library",
			namespace: args.namespace,
			key: args.key,
		} as const;
		throwIfAborted({
			operation: "load-library-record",
			scope,
			signal: args.signal,
		});
		const found = this.libraries.get(args.namespace)?.get(args.key);
		return found
			? clonePayload({
					value: found,
					failure: { operation: "load-library-record", scope },
				})
			: null;
	}

	async saveLibraryRecord(args: {
		namespace: string;
		key: string;
		schemaVersion: number;
		data: unknown;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope = {
			kind: "library",
			namespace: args.namespace,
			key: args.key,
		} as const;
		throwIfAborted({
			operation: "save-library-record",
			scope,
			signal: args.signal,
		});
		const record = clonePayload({
			value: {
				namespace: args.namespace,
				key: args.key,
				schemaVersion: args.schemaVersion,
				data: args.data,
			},
			failure: { operation: "save-library-record", scope },
		});
		await this.enqueue({
			identity: {
				kind: "library-record",
				namespace: args.namespace,
				key: args.key,
			},
			operation: async () => {
				await this.control.beforeCommit({
					operation: "save-library-record",
					scope,
					signal: args.signal,
				});
				let namespace = this.libraries.get(args.namespace);
				if (!namespace) {
					namespace = new Map();
					this.libraries.set(args.namespace, namespace);
				}
				namespace.set(args.key, record);
			},
		});
	}

	async removeLibraryRecord(args: {
		namespace: string;
		key: string;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope = {
			kind: "library",
			namespace: args.namespace,
			key: args.key,
		} as const;
		throwIfAborted({
			operation: "remove-library-record",
			scope,
			signal: args.signal,
		});
		await this.enqueue({
			identity: {
				kind: "library-record",
				namespace: args.namespace,
				key: args.key,
			},
			operation: async () => {
				await this.control.beforeCommit({
					operation: "remove-library-record",
					scope,
					signal: args.signal,
				});
				this.libraries.get(args.namespace)?.delete(args.key);
			},
		});
	}

	async inspect(
		args: { signal?: AbortSignal } = {},
	): Promise<ProjectStoreInspection> {
		throwIfAborted({
			operation: "inspect",
			scope: { kind: "store" },
			signal: args.signal,
		});
		return this.control.readInspection();
	}

	async clear(args: {
		scope: ProjectStoreClearScope;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope =
			args.scope.kind === "library"
				? ({ kind: "library", namespace: args.scope.namespace } as const)
				: ({ kind: "store" } as const);
		throwIfAborted({ operation: "clear", scope, signal: args.signal });
		const identity: MutationIdentity =
			args.scope.kind === "projects"
				? { kind: "all-projects" }
				: args.scope.kind === "library"
					? { kind: "library-namespace", namespace: args.scope.namespace }
					: { kind: "all" };
		await this.enqueue({
			identity,
			operation: async () => {
				await this.control.beforeCommit({
					operation: "clear",
					scope,
					signal: args.signal,
				});
				if (args.scope.kind === "projects" || args.scope.kind === "all") {
					this.records.clear();
					this.summaries.clear();
					this.attachments.clear();
				}
				if (args.scope.kind === "library") {
					this.libraries.delete(args.scope.namespace);
				} else if (args.scope.kind === "all") {
					this.libraries.clear();
				}
			},
		});
	}

	private async enqueue<Result>({
		identity,
		operation,
	}: {
		identity: MutationIdentity;
		operation: () => Promise<Result>;
	}): Promise<Result> {
		const blockers = [...this.pendingMutations]
			.filter((pending) =>
				mutationIdentitiesConflict({ left: pending.identity, right: identity }),
			)
			.map((pending) => pending.completion);
		let complete!: () => void;
		const completion = new Promise<void>((resolve) => {
			complete = resolve;
		});
		const pending = { identity, completion };
		this.pendingMutations.add(pending);
		try {
			await Promise.all(blockers);
			return await operation();
		} finally {
			this.pendingMutations.delete(pending);
			complete();
		}
	}
}

export function createInMemoryProjectStoreFixture(
	options: Omit<InMemoryProjectStoreOptions, "control"> = {},
): {
	store: InMemoryProjectStore;
	control: InMemoryProjectStoreControl;
} {
	const control = new InMemoryProjectStoreControl();
	return {
		store: new InMemoryProjectStore({ ...options, control }),
		control,
	};
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
