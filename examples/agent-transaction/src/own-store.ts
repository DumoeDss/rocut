// The example's own in-memory ProjectStore (S05 P6 task 3.2).
//
// Written from scratch rather than subclassing the reference in-memory store,
// because the point of this example is the adopter's side of the port: your
// store, your representation. This one keeps JSON-shaped records in Maps,
// deep-clones in both directions (a load must never hand back the live object
// the engine just wrote), and — the property the reopen half of the example
// depends on — serializes everything it holds to text an adopter could persist
// anywhere, and constructs a fresh instance from it again.
import type {
	LibraryRecord,
	ProjectAttachment,
	ProjectId,
	ProjectRecord,
	ProjectStore,
	ProjectStoreClearScope,
	ProjectStoreInspection,
	ProjectSummary,
} from "@opencut/editor-ports";

function clone<T>(value: T): T {
	return structuredClone(value);
}

interface Snapshot {
	readonly records: readonly ProjectRecord[];
	readonly summaries: readonly ProjectSummary[];
}

export class OwnInMemoryStore implements ProjectStore {
	/** No legacy data exists for this store; `migrate` stays absent (a conforming answer). */
	readonly schemaVersion = 1;

	private readonly records = new Map<string, ProjectRecord>();
	private readonly summaries = new Map<string, ProjectSummary>();
	private readonly attachments = new Map<string, ProjectAttachment>();
	private readonly library = new Map<string, LibraryRecord>();

	/** Cumulative successful saves — the durable-saves observation the ledger records. */
	saveCount = 0;

	async list(): Promise<readonly ProjectSummary[]> {
		return [...this.summaries.values()].map((summary) => clone(summary));
	}

	async load(args: { id: ProjectId }): Promise<ProjectRecord | null> {
		const record = this.records.get(String(args.id));
		return record ? clone(record) : null;
	}

	async save(args: {
		record: ProjectRecord;
		summary: ProjectSummary;
	}): Promise<void> {
		if (args.record.id !== args.summary.id) {
			throw new Error(
				`record.id ${String(args.record.id)} != summary.id ${String(args.summary.id)} — pre-commit conflict`,
			);
		}
		this.records.set(String(args.record.id), clone(args.record));
		this.summaries.set(String(args.summary.id), clone(args.summary));
		this.saveCount += 1;
	}

	async remove(args: { id: ProjectId }): Promise<void> {
		this.records.delete(String(args.id));
		this.summaries.delete(String(args.id));
	}

	async listAttachments(args: {
		projectId: ProjectId;
	}): Promise<readonly ProjectAttachment[]> {
		return [...this.attachments.values()]
			.filter(
				(attachment) => String(attachment.projectId) === String(args.projectId),
			)
			.map((attachment) => clone(attachment));
	}

	async loadAttachment(args: {
		projectId: ProjectId;
		key: string;
	}): Promise<ProjectAttachment | null> {
		const attachment = this.attachments.get(`${args.projectId}:${args.key}`);
		return attachment ? clone(attachment) : null;
	}

	async saveAttachment(args: {
		projectId: ProjectId;
		key: string;
		metadata: unknown;
		body: ArrayBuffer;
	}): Promise<void> {
		this.attachments.set(`${args.projectId}:${args.key}`, {
			projectId: args.projectId,
			key: args.key,
			metadata: clone(args.metadata),
			body: args.body,
		});
	}

	async removeAttachment(args: {
		projectId: ProjectId;
		key: string;
	}): Promise<void> {
		this.attachments.delete(`${args.projectId}:${args.key}`);
	}

	async listLibraryRecords(args: {
		namespace: string;
	}): Promise<readonly LibraryRecord[]> {
		return [...this.library.values()]
			.filter((record) => record.namespace === args.namespace)
			.map((record) => clone(record));
	}

	async loadLibraryRecord(args: {
		namespace: string;
		key: string;
	}): Promise<LibraryRecord | null> {
		const record = this.library.get(`${args.namespace}:${args.key}`);
		return record ? clone(record) : null;
	}

	async saveLibraryRecord(args: {
		namespace: string;
		key: string;
		schemaVersion: number;
		data: unknown;
	}): Promise<void> {
		this.library.set(`${args.namespace}:${args.key}`, {
			namespace: args.namespace,
			key: args.key,
			schemaVersion: args.schemaVersion,
			data: clone(args.data),
		});
	}

	async removeLibraryRecord(args: {
		namespace: string;
		key: string;
	}): Promise<void> {
		this.library.delete(`${args.namespace}:${args.key}`);
	}

	async inspect(): Promise<ProjectStoreInspection> {
		return { availability: "available", capacity: null };
	}

	async clear(args: { scope: ProjectStoreClearScope }): Promise<void> {
		if (args.scope.kind === "projects") {
			this.records.clear();
			this.summaries.clear();
			return;
		}
		if (args.scope.kind === "library") {
			for (const key of [...this.library.keys()]) {
				if (key.startsWith(`${args.scope.namespace}:`)) this.library.delete(key);
			}
			return;
		}
		this.records.clear();
		this.summaries.clear();
		this.attachments.clear();
		this.library.clear();
	}

	/** Everything the store holds, as the persisted form this example owns. */
	exportSnapshot(): string {
		const snapshot: Snapshot = {
			records: [...this.records.values()],
			summaries: [...this.summaries.values()],
		};
		return JSON.stringify(snapshot);
	}

	/** A genuinely fresh instance over the same persisted data. */
	static fromSnapshot(text: string): OwnInMemoryStore {
		const store = new OwnInMemoryStore();
		const snapshot = JSON.parse(text) as Snapshot;
		for (const record of snapshot.records) {
			store.records.set(String(record.id), record);
		}
		for (const summary of snapshot.summaries) {
			store.summaries.set(String(summary.id), summary);
		}
		return store;
	}
}
