import type { TProject, TProjectMetadata } from "@/project/types";
import type {
	LibraryRecord,
	ProjectAttachment,
	ProjectRecord,
	ProjectStore,
	ProjectSummary,
} from "@/editor/ports";
import { ProjectMutationArbiter } from "@/editor/transactions/opencut/arbiter";
import { cloneOpaque, overlayOpaque } from "./opaque-value";
import { decodeProject, encodeProject } from "./project-codec";

type MutationListener = (event: {
	readonly kind: "project" | "attachment" | "library" | "remove" | "clear";
	readonly key: string;
}) => void;

type ProjectRecordListener = (record: ProjectRecord) => void;

interface DurableLibraryArbitration {
	readonly pending: Map<string, Promise<void>>;
}

/**
 * Cross-session ordering for compound library mutations on one injected store.
 *
 * A production Host supplies one stable ProjectStore object for its durable
 * identity. The WeakMap therefore coordinates sessions sharing that identity
 * without naming a browser mechanism or retaining any library payload. Pending
 * keys are removed after settlement and the weak entry is dropped when empty.
 */
const libraryArbitrationByStore = new WeakMap<
	ProjectStore,
	DurableLibraryArbitration
>();

function libraryArbitrationFor(store: ProjectStore): DurableLibraryArbitration {
	const existing = libraryArbitrationByStore.get(store);
	if (existing) return existing;
	const created = { pending: new Map<string, Promise<void>>() };
	libraryArbitrationByStore.set(store, created);
	return created;
}

/**
 * Per-editor-session translation and ordering above the Host-neutral store.
 * The object owns no browser mechanism and is intentionally cheap to recreate.
 */
export class SessionPersistenceCoordinator {
	private readonly projectSnapshots = new Map<string, unknown>();
	private readonly attachmentSnapshots = new Map<string, unknown>();
	private readonly librarySnapshots = new Map<string, unknown>();
	private readonly projectCache = new Map<string, TProject>();
	private readonly pending = new Map<string, Promise<void>>();
	private readonly listeners = new Set<MutationListener>();
	private readonly projectRecordListeners = new Set<ProjectRecordListener>();
	private destroyed = false;

	constructor(
		readonly store: ProjectStore,
		readonly projectMutationArbiter = new ProjectMutationArbiter(),
	) {}

	subscribe(listener: MutationListener): () => void {
		this.assertAlive();
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	subscribeProjectRecords(listener: ProjectRecordListener): () => void {
		this.assertAlive();
		this.projectRecordListeners.add(listener);
		return () => this.projectRecordListeners.delete(listener);
	}

	async listProjects(
		args: { signal?: AbortSignal } = {},
	): Promise<TProjectMetadata[]> {
		this.assertAlive();
		const summaries = await this.store.list(args);
		const projects = await Promise.all(
			summaries.map(({ id }) => this.loadProject({ id, signal: args.signal })),
		);
		return projects.flatMap((project) =>
			project ? [cloneOpaque(project.metadata)] : [],
		);
	}

	async loadProject(args: {
		id: string;
		signal?: AbortSignal;
	}): Promise<TProject | null> {
		this.assertAlive();
		return this.projectMutationArbiter.run({
			projectId: args.id,
			operation: async () => {
				const record = await this.store.load(args);
				if (!record) {
					this.projectSnapshots.delete(args.id);
					this.projectCache.delete(args.id);
					return null;
				}
				const retained = cloneOpaque(record.data);
				const decoded = decodeProject(cloneOpaque(record.data));
				this.projectSnapshots.set(args.id, retained);
				this.projectCache.set(args.id, cloneOpaque(decoded));
				this.emitProjectRecord(record);
				return cloneOpaque(decoded);
			},
		});
	}

	readCachedProject({ id }: { id: string }): TProject | null {
		this.assertAlive();
		const project = this.projectCache.get(id);
		return project ? cloneOpaque(project) : null;
	}

	async saveProject(args: {
		project: TProject;
		summary?: ProjectSummary;
		signal?: AbortSignal;
	}): Promise<void> {
		this.assertAlive();
		const id = args.project.metadata.id;
		const schemaVersion = args.project.version;
		const known = encodeProject({ project: args.project, retained: {} });
		const summaryOverride = args.summary
			? cloneOpaque(args.summary)
			: undefined;
		const defaultSummary = this.summaryFor(args.project);
		return this.projectMutationArbiter.run({
			projectId: id,
			operation: () =>
				this.enqueue({
					key: `project:${id}`,
					operation: async () => {
						const retained = this.projectSnapshots.get(id) ?? {};
						const data = overlayOpaque({ retained, known });
						const summary = summaryOverride ?? defaultSummary;
						const record = { id, schemaVersion, data };
						await this.store.save({
							record,
							summary,
							signal: args.signal,
						});
						// No observable session success is published before the durable call.
						this.projectSnapshots.set(id, cloneOpaque(data));
						this.projectCache.set(id, decodeProject(data));
						this.emitProjectRecord(record);
						this.emit({ kind: "project", key: id });
					},
				}),
		});
	}

	async adoptCommittedProjectRecord({
		record,
	}: {
		record: ProjectRecord;
	}): Promise<TProject> {
		this.assertAlive();
		if (!record.id || !Number.isInteger(record.schemaVersion)) {
			throw new Error("Invalid committed project record identity or schema version");
		}
		const retained = cloneOpaque(record.data);
		const decoded = decodeProject(cloneOpaque(record.data));
		if (decoded.metadata.id !== record.id) {
			throw new Error("Committed project record identity does not match its payload");
		}
		this.projectSnapshots.set(record.id, retained);
		this.projectCache.set(record.id, cloneOpaque(decoded));
		this.emitProjectRecord(record);
		this.emit({ kind: "project", key: record.id });
		return cloneOpaque(decoded);
	}

	async removeProject(args: {
		id: string;
		signal?: AbortSignal;
	}): Promise<void> {
		this.assertAlive();
		return this.enqueue({
			key: `project:${args.id}`,
			operation: async () => {
				await this.store.remove(args);
				this.projectSnapshots.delete(args.id);
				this.projectCache.delete(args.id);
				for (const key of this.attachmentSnapshots.keys()) {
					if (key.startsWith(`${args.id}\u0000`))
						this.attachmentSnapshots.delete(key);
				}
				this.emit({ kind: "remove", key: args.id });
			},
		});
	}

	async loadAttachment(args: {
		projectId: string;
		key: string;
		signal?: AbortSignal;
	}): Promise<ProjectAttachment | null>;
	async loadAttachment<Metadata>(args: {
		projectId: string;
		key: string;
		decodeMetadata: (metadata: unknown) => Metadata;
		signal?: AbortSignal;
	}): Promise<
		(Omit<ProjectAttachment, "metadata"> & { metadata: Metadata }) | null
	>;
	async loadAttachment<Metadata>(args: {
		projectId: string;
		key: string;
		decodeMetadata?: (metadata: unknown) => Metadata;
		signal?: AbortSignal;
	}) {
		this.assertAlive();
		const found = await this.store.loadAttachment(args);
		const logical = this.attachmentKey({
			projectId: args.projectId,
			key: args.key,
		});
		if (!found) {
			this.attachmentSnapshots.delete(logical);
			return null;
		}
		this.attachmentSnapshots.set(logical, cloneOpaque(found.metadata));
		return {
			...found,
			metadata: args.decodeMetadata
				? args.decodeMetadata(cloneOpaque(found.metadata))
				: cloneOpaque(found.metadata),
			body: found.body.slice(0),
		};
	}

	async listAttachments(args: {
		projectId: string;
		signal?: AbortSignal;
	}): Promise<ProjectAttachment[]>;
	async listAttachments<Metadata>(args: {
		projectId: string;
		decodeMetadata: (metadata: unknown) => Metadata;
		signal?: AbortSignal;
	}): Promise<
		Array<Omit<ProjectAttachment, "metadata"> & { metadata: Metadata }>
	>;
	async listAttachments<Metadata>(args: {
		projectId: string;
		decodeMetadata?: (metadata: unknown) => Metadata;
		signal?: AbortSignal;
	}) {
		this.assertAlive();
		const found = await this.store.listAttachments(args);
		return found.map((attachment) => {
			const logical = this.attachmentKey({
				projectId: attachment.projectId,
				key: attachment.key,
			});
			this.attachmentSnapshots.set(logical, cloneOpaque(attachment.metadata));
			return {
				...attachment,
				metadata: args.decodeMetadata
					? args.decodeMetadata(cloneOpaque(attachment.metadata))
					: cloneOpaque(attachment.metadata),
				body: attachment.body.slice(0),
			};
		});
	}

	async saveAttachment<Metadata>(args: {
		projectId: string;
		key: string;
		metadata: Metadata;
		body: ArrayBuffer | Promise<ArrayBuffer>;
		signal?: AbortSignal;
	}): Promise<void> {
		this.assertAlive();
		const knownMetadata = cloneOpaque(args.metadata);
		const body = Promise.resolve(args.body).then((value) => value.slice(0));
		const logical = this.attachmentKey({
			projectId: args.projectId,
			key: args.key,
		});
		return this.enqueue({
			key: `attachment:${logical}`,
			operation: async () => {
				const resolvedBody = await body;
				const metadata = overlayOpaque({
					retained: this.attachmentSnapshots.get(logical),
					known: knownMetadata,
				});
				await this.store.saveAttachment({
					...args,
					metadata,
					body: resolvedBody,
				});
				this.attachmentSnapshots.set(logical, cloneOpaque(metadata));
				this.emit({ kind: "attachment", key: logical });
			},
		});
	}

	async removeAttachment(args: {
		projectId: string;
		key: string;
		signal?: AbortSignal;
	}): Promise<void> {
		this.assertAlive();
		const logical = this.attachmentKey({
			projectId: args.projectId,
			key: args.key,
		});
		return this.enqueue({
			key: `attachment:${logical}`,
			operation: async () => {
				await this.store.removeAttachment(args);
				this.attachmentSnapshots.delete(logical);
				this.emit({ kind: "remove", key: logical });
			},
		});
	}

	async loadLibraryRecord(args: {
		namespace: string;
		key: string;
		signal?: AbortSignal;
	}): Promise<LibraryRecord | null>;
	async loadLibraryRecord<Data>(args: {
		namespace: string;
		key: string;
		decode: (data: unknown) => Data;
		signal?: AbortSignal;
	}): Promise<(Omit<LibraryRecord, "data"> & { data: Data }) | null>;
	async loadLibraryRecord<Data>(args: {
		namespace: string;
		key: string;
		decode?: (data: unknown) => Data;
		signal?: AbortSignal;
	}) {
		this.assertAlive();
		const found = await this.store.loadLibraryRecord(args);
		const logical = this.libraryKey({
			namespace: args.namespace,
			key: args.key,
		});
		if (!found) {
			this.librarySnapshots.delete(logical);
			return null;
		}
		this.librarySnapshots.set(logical, cloneOpaque(found.data));
		return {
			...found,
			data: args.decode
				? args.decode(cloneOpaque(found.data))
				: cloneOpaque(found.data),
		};
	}

	async saveLibraryRecord<Data>(args: {
		namespace: string;
		key: string;
		schemaVersion: number;
		data: Data;
		signal?: AbortSignal;
	}): Promise<void> {
		this.assertAlive();
		const knownData = cloneOpaque(args.data);
		const logical = this.libraryKey({
			namespace: args.namespace,
			key: args.key,
		});
		return this.enqueueLibraryMutation({
			namespace: args.namespace,
			key: `library:${logical}`,
			operation: async () => {
				const data = overlayOpaque({
					retained: this.librarySnapshots.get(logical),
					known: knownData,
				});
				await this.store.saveLibraryRecord({ ...args, data });
				this.librarySnapshots.set(logical, cloneOpaque(data));
				this.emit({ kind: "library", key: logical });
			},
		});
	}

	async mutateLibraryRecord<Data>(args: {
		namespace: string;
		key: string;
		schemaVersion: number;
		decode: (data: unknown) => Data;
		encode: (data: Data) => unknown;
		mutate: (current: Data | null) => Data | Promise<Data>;
		signal?: AbortSignal;
	}): Promise<Data> {
		this.assertAlive();
		const logical = this.libraryKey({
			namespace: args.namespace,
			key: args.key,
		});
		return this.enqueueLibraryMutation({
			namespace: args.namespace,
			key: `library:${logical}`,
			operation: async () => {
				// The load is intentionally inside the shared durable-key critical
				// section. Serializing only saveLibraryRecord would still let two
				// sessions derive replacements from the same stale value.
				const found = await this.store.loadLibraryRecord({
					namespace: args.namespace,
					key: args.key,
					signal: args.signal,
				});
				const retained = found ? cloneOpaque(found.data) : undefined;
				const current = found ? args.decode(cloneOpaque(found.data)) : null;
				const next = cloneOpaque(
					await args.mutate(current === null ? null : cloneOpaque(current)),
				);
				const known = cloneOpaque(args.encode(cloneOpaque(next)));
				const data = overlayOpaque({ retained, known });
				await this.store.saveLibraryRecord({
					namespace: args.namespace,
					key: args.key,
					schemaVersion: args.schemaVersion,
					data,
					signal: args.signal,
				});
				this.librarySnapshots.set(logical, cloneOpaque(data));
				this.emit({ kind: "library", key: logical });
				return cloneOpaque(next);
			},
		});
	}

	async removeLibraryRecord(args: {
		namespace: string;
		key: string;
		signal?: AbortSignal;
	}): Promise<void> {
		this.assertAlive();
		const logical = this.libraryKey({
			namespace: args.namespace,
			key: args.key,
		});
		return this.enqueueLibraryMutation({
			namespace: args.namespace,
			key: `library:${logical}`,
			operation: async () => {
				await this.store.removeLibraryRecord(args);
				this.librarySnapshots.delete(logical);
				this.emit({ kind: "remove", key: logical });
			},
		});
	}

	async clearLibraryNamespace(args: {
		namespace: string;
		signal?: AbortSignal;
	}): Promise<void> {
		this.assertAlive();
		return this.enqueueLibraryMutation({
			namespace: args.namespace,
			key: `library-clear:${args.namespace}`,
			clearNamespace: true,
			operation: async () => {
				await this.store.clear({
					scope: { kind: "library", namespace: args.namespace },
					signal: args.signal,
				});
				const prefix = `${args.namespace}\u0000`;
				for (const key of this.librarySnapshots.keys()) {
					if (key.startsWith(prefix)) this.librarySnapshots.delete(key);
				}
				this.emit({ kind: "clear", key: args.namespace });
			},
		});
	}

	destroy(): void {
		this.destroyed = true;
		this.projectSnapshots.clear();
		this.attachmentSnapshots.clear();
		this.librarySnapshots.clear();
		this.projectCache.clear();
		this.listeners.clear();
		this.projectRecordListeners.clear();
	}

	private summaryFor(project: TProject): ProjectSummary {
		return {
			id: project.metadata.id,
			name: project.metadata.name,
			createdAt: project.metadata.createdAt.toISOString(),
			updatedAt: project.metadata.updatedAt.toISOString(),
		};
	}

	private attachmentKey({
		projectId,
		key,
	}: {
		projectId: string;
		key: string;
	}): string {
		return `${projectId}\u0000${key}`;
	}

	private libraryKey({
		namespace,
		key,
	}: {
		namespace: string;
		key: string;
	}): string {
		return `${namespace}\u0000${key}`;
	}

	private enqueue({
		key,
		operation,
		waitFor = [],
	}: {
		key: string;
		operation: () => Promise<void>;
		waitFor?: readonly Promise<void>[];
	}): Promise<void> {
		const predecessor = this.pending.get(key);
		const blockers = [predecessor, ...waitFor].filter(
			(value): value is Promise<void> => value !== undefined,
		);
		const result = Promise.all(
			blockers.map((blocker) => blocker.catch(() => undefined)),
		).then(async () => {
			this.assertAlive();
			await operation();
		});
		const settled = result.then(
			() => undefined,
			() => undefined,
		);
		this.pending.set(key, settled);
		void settled.then(() => {
			if (this.pending.get(key) === settled) this.pending.delete(key);
		});
		return result;
	}

	private enqueueLibraryMutation<Result>(args: {
		namespace: string;
		key: string;
		clearNamespace?: boolean;
		operation: () => Promise<Result>;
	}): Promise<Result> {
		const arbitration = libraryArbitrationFor(this.store);
		const recordPrefix = `library:${args.namespace}\u0000`;
		const clearKey = `library-clear:${args.namespace}`;
		const predecessor = arbitration.pending.get(args.key);
		const blockers = [...arbitration.pending.entries()]
			.filter(([pendingKey]) =>
				args.clearNamespace
					? pendingKey === clearKey || pendingKey.startsWith(recordPrefix)
					: pendingKey === clearKey,
			)
			.map(([, pending]) => pending);
		if (predecessor) blockers.push(predecessor);
		const result = Promise.all(
			blockers.map((blocker) => blocker.catch(() => undefined)),
		).then(async () => {
			this.assertAlive();
			return args.operation();
		});
		const settled = result.then(
			() => undefined,
			() => undefined,
		);
		arbitration.pending.set(args.key, settled);
		void settled.then(() => {
			if (arbitration.pending.get(args.key) === settled) {
				arbitration.pending.delete(args.key);
			}
			if (arbitration.pending.size === 0) {
				libraryArbitrationByStore.delete(this.store);
			}
		});
		return result;
	}

	private emit(event: Parameters<MutationListener>[0]): void {
		this.listeners.forEach((listener) => listener(event));
	}

	private emitProjectRecord(record: ProjectRecord): void {
		const snapshot = cloneOpaque(record);
		this.projectRecordListeners.forEach((listener) =>
			listener(cloneOpaque(snapshot)),
		);
	}

	private assertAlive(): void {
		if (this.destroyed) {
			throw new Error("Session persistence coordinator has been destroyed");
		}
	}
}
