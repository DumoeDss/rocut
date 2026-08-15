/**
 * s05-second-host — `NodeFsStoreBridge` (design E4): `ProjectStoreFiles` over
 * `node:fs` against a caller-supplied root.
 *
 * Used twice, deliberately: by `bun test` (conformance and migration evidence
 * — no Electron exists there) and by the Electron main process, whose IPC
 * handlers delegate to one instance that owns the storage root. The store
 * class the renderer composes is the same in both worlds; the seam is the
 * bridge, not the store.
 *
 * On-disk layout (design E4, fixed so probes can be Host-neutral):
 *
 * ```
 * <root>/projects/<id>/record.json
 * <root>/projects/<id>/attachments/<key>          (body bytes)
 * <root>/projects/<id>/attachments/<key>.meta.json
 * <root>/library/<namespace>/<key>.json
 * <root>/store.json                               (identity + inspection)
 * ```
 *
 * Every write is atomic: bytes land in a sibling temp file, then rename. A
 * crash mid-write leaves the previous record intact and a temp file the next
 * successful write of the same target replaces.
 *
 * Opaque payloads cross the disk boundary as `node:v8` structured-clone
 * serialization carried base64 inside a JSON envelope — the JSON stays
 * inspectable (identity, version, summary readable without decoding the
 * payload) while Dates, Maps, Sets and buffers round-trip exactly, which the
 * port's provider-private round-trip requirement demands.
 */
import {
	closeSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import { deserialize, serialize } from "node:v8";
import type {
	LibraryRecord,
	ProjectAttachment,
	ProjectId,
	ProjectStoreClearScope,
	ProjectSummary,
} from "@opencut/editor-ports";
import {
	StoreBridgeError,
	type BridgeRecordListing,
	type BridgeStoredRecord,
	type ProjectStoreFiles,
} from "./project-store-files";

interface RecordEnvelope {
	readonly kind: "opencut-project-record";
	readonly schemaVersion: number;
	readonly summary: ProjectSummary;
	readonly payload: string;
}

interface AttachmentMetadataEnvelope {
	readonly kind: "opencut-attachment-metadata";
	readonly payload: string;
}

interface LibraryRecordEnvelope {
	readonly kind: "opencut-library-record";
	readonly key: string;
	readonly schemaVersion: number;
	readonly payload: string;
}

interface StoreFileEnvelope {
	readonly kind: "opencut-store";
	readonly identity: string;
	readonly inspection: {
		readonly usedBytes: number;
		readonly capturedAt: string;
	};
}

const UNENCODED_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Map an identifier (project id, key, namespace) onto one safe path segment.
 * Ordinary ids — UUIDs, slugs — pass through readable; anything else (path
 * separators, `..`, `a:b`-style keys) is base64url-prefixed. `~` cannot occur
 * in an unencoded segment, so encoded and plain names never collide: the
 * conformance suite's `a:b` vs `a`/`b:c` identities stay distinct trees.
 */
function segmentOf(identifier: string): string {
	if (
		UNENCODED_SEGMENT.test(identifier) &&
		identifier !== "." &&
		identifier !== ".."
	) {
		return identifier;
	}
	return `~${Buffer.from(identifier, "utf8").toString("base64url")}`;
}

/** Inverse of `segmentOf` — a directory entry back to its true identifier. */
function identifierOf(segment: string): string {
	if (!segment.startsWith("~")) return segment;
	return Buffer.from(segment.slice(1), "base64url").toString("utf8");
}

function encodeOpaque(value: unknown): string {
	return serialize(value).toString("base64");
}

function decodeOpaque(payload: string): unknown {
	return deserialize(Buffer.from(payload, "base64"));
}

/** Sanitize an fs error into a path-free bridge failure. */
function ioFailure(operation: string, error: unknown): StoreBridgeError {
	const reason = error instanceof Error ? error.name : String(error);
	return new StoreBridgeError(
		`Store bridge ${operation} could not reach its backing files (${reason})`,
	);
}

function isAbsent(error: unknown): boolean {
	return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

export class NodeFsStoreBridge implements ProjectStoreFiles {
	private readonly root: string;
	private readonly identity: string;
	private tempCounter = 0;

	constructor(args: { root: string; identity: string }) {
		this.root = args.root;
		this.identity = args.identity;
	}

	/**
	 * Atomic write: write a temp sibling, then rename over the target. A same-
	 * directory rename replaces atomically on POSIX and via
	 * MoveFileEx(REPLACE_EXISTING) semantics on Windows, which a sibling temp
	 * file always satisfies.
	 */
	private writeAtomic(target: string, bytes: Uint8Array | string): void {
		const temp = `${target}.tmp-${process.pid}-${this.tempCounter++}`;
		let descriptor: number | undefined;
		try {
			descriptor = openSync(temp, "w");
			const buffer =
				typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
			let written = 0;
			while (written < buffer.length) {
				written += writeSync(descriptor, buffer, written, buffer.length - written);
			}
			closeSync(descriptor);
			descriptor = undefined;
			renameSync(temp, target);
		} catch (error) {
			if (descriptor !== undefined) {
				try {
					closeSync(descriptor);
				} catch {
					// The original failure is the one that matters.
				}
			}
			try {
				unlinkSync(temp);
			} catch {
				// Absent temp is fine; a stale one is replaced by the next write.
			}
			throw ioFailure("write", error);
		}
	}

	private readJson<T>(target: string): T | null {
		let text: string;
		try {
			text = readFileSync(target, "utf8");
		} catch (error) {
			if (isAbsent(error)) return null;
			throw ioFailure("read", error);
		}
		try {
			return JSON.parse(text) as T;
		} catch (error) {
			throw ioFailure("read", error);
		}
	}

	private readBytes(target: string): Uint8Array | null {
		try {
			return readFileSync(target);
		} catch (error) {
			if (isAbsent(error)) return null;
			throw ioFailure("read", error);
		}
	}

	private ensureDirectory(target: string): void {
		try {
			mkdirSync(target, { recursive: true });
		} catch (error) {
			throw ioFailure("prepare", error);
		}
	}

	private projectDir(id: ProjectId): string {
		return `${this.root}/projects/${segmentOf(id)}`;
	}

	private attachmentDir(projectId: ProjectId): string {
		return `${this.projectDir(projectId)}/attachments`;
	}

	private attachmentBodyPath(projectId: ProjectId, key: string): string {
		return `${this.attachmentDir(projectId)}/${segmentOf(key)}`;
	}

	private attachmentMetaPath(projectId: ProjectId, key: string): string {
		return `${this.attachmentBodyPath(projectId, key)}.meta.json`;
	}

	private libraryDir(namespace: string): string {
		return `${this.root}/library/${segmentOf(namespace)}`;
	}

	private libraryRecordPath(namespace: string, key: string): string {
		return `${this.libraryDir(namespace)}/${segmentOf(key)}.json`;
	}

	async listRecords(): Promise<readonly BridgeRecordListing[]> {
		let projectSegments: string[];
		try {
			projectSegments = readdirSync(`${this.root}/projects`);
		} catch (error) {
			if (isAbsent(error)) return [];
			throw ioFailure("read", error);
		}
		const listings: BridgeRecordListing[] = [];
		for (const segment of projectSegments) {
			const envelope = this.readJson<RecordEnvelope>(
				`${this.root}/projects/${segment}/record.json`,
			);
			if (envelope?.kind !== "opencut-project-record") continue;
			listings.push({
				id: envelope.summary.id,
				schemaVersion: envelope.schemaVersion,
				summary: envelope.summary,
			});
		}
		listings.sort((left, right) =>
			right.summary.updatedAt.localeCompare(left.summary.updatedAt),
		);
		return listings;
	}

	async loadRecord(id: ProjectId): Promise<BridgeStoredRecord | null> {
		const envelope = this.readJson<RecordEnvelope>(
			`${this.projectDir(id)}/record.json`,
		);
		if (envelope?.kind !== "opencut-project-record") return null;
		let data: unknown;
		try {
			data = decodeOpaque(envelope.payload);
		} catch (error) {
			throw ioFailure("decode", error);
		}
		return {
			record: { id, schemaVersion: envelope.schemaVersion, data },
			summary: envelope.summary,
		};
	}

	async saveRecord(stored: BridgeStoredRecord): Promise<void> {
		const dir = this.projectDir(stored.record.id);
		this.ensureDirectory(dir);
		const envelope: RecordEnvelope = {
			kind: "opencut-project-record",
			schemaVersion: stored.record.schemaVersion,
			summary: stored.summary,
			payload: encodeOpaque(stored.record.data),
		};
		this.writeAtomic(`${dir}/record.json`, JSON.stringify(envelope, null, "\t"));
	}

	async removeRecord(id: ProjectId): Promise<void> {
		try {
			rmSync(this.projectDir(id), { recursive: true, force: true });
		} catch (error) {
			throw ioFailure("remove", error);
		}
	}

	async listAttachments(
		projectId: ProjectId,
	): Promise<readonly ProjectAttachment[]> {
		let entries: string[];
		try {
			entries = readdirSync(this.attachmentDir(projectId));
		} catch (error) {
			if (isAbsent(error)) return [];
			throw ioFailure("read", error);
		}
		const attachments: ProjectAttachment[] = [];
		for (const entry of entries) {
			if (entry.endsWith(".meta.json") || entry.includes(".tmp-")) continue;
			// The directory entry is a path segment; recover the true key before
			// asking for it, or the lookup would encode the segment a second time.
			const attachment = await this.loadAttachment(
				projectId,
				identifierOf(entry),
			);
			if (attachment) attachments.push(attachment);
		}
		attachments.sort((left, right) => left.key.localeCompare(right.key));
		return attachments;
	}

	async loadAttachment(
		projectId: ProjectId,
		key: string,
	): Promise<ProjectAttachment | null> {
		const meta = this.readJson<AttachmentMetadataEnvelope>(
			this.attachmentMetaPath(projectId, key),
		);
		const body = this.readBytes(this.attachmentBodyPath(projectId, key));
		if (meta?.kind !== "opencut-attachment-metadata" || body === null) return null;
		let metadata: unknown;
		try {
			metadata = decodeOpaque(meta.payload);
		} catch (error) {
			throw ioFailure("decode", error);
		}
		const copy = new Uint8Array(body.byteLength);
		copy.set(body);
		return { projectId, key, metadata, body: copy.buffer };
	}

	async saveAttachment(
		projectId: ProjectId,
		key: string,
		metadata: unknown,
		body: ArrayBuffer,
	): Promise<void> {
		this.ensureDirectory(this.attachmentDir(projectId));
		// Buffer.from(Uint8Array) copies element-wise: the durable write is a
		// snapshot, not a view the caller could mutate afterwards.
		const bodySnapshot = Buffer.from(new Uint8Array(body));
		this.writeAtomic(this.attachmentBodyPath(projectId, key), bodySnapshot);
		this.writeAtomic(
			this.attachmentMetaPath(projectId, key),
			JSON.stringify({
				kind: "opencut-attachment-metadata",
				payload: encodeOpaque(metadata),
			} satisfies AttachmentMetadataEnvelope),
		);
	}

	async removeAttachment(projectId: ProjectId, key: string): Promise<void> {
		for (const target of [
			this.attachmentBodyPath(projectId, key),
			this.attachmentMetaPath(projectId, key),
		]) {
			try {
				unlinkSync(target);
			} catch (error) {
				if (!isAbsent(error)) throw ioFailure("remove", error);
			}
		}
	}

	async listLibraryRecords(namespace: string): Promise<readonly LibraryRecord[]> {
		let entries: string[];
		try {
			entries = readdirSync(this.libraryDir(namespace));
		} catch (error) {
			if (isAbsent(error)) return [];
			throw ioFailure("read", error);
		}
		const records: LibraryRecord[] = [];
		for (const entry of entries) {
			if (!entry.endsWith(".json") || entry.includes(".tmp-")) continue;
			const envelope = this.readJson<LibraryRecordEnvelope>(
				`${this.libraryDir(namespace)}/${entry}`,
			);
			if (envelope?.kind !== "opencut-library-record") continue;
			try {
				records.push({
					namespace,
					key: envelope.key,
					schemaVersion: envelope.schemaVersion,
					data: decodeOpaque(envelope.payload),
				});
			} catch (error) {
				throw ioFailure("decode", error);
			}
		}
		records.sort((left, right) => left.key.localeCompare(right.key));
		return records;
	}

	async loadLibraryRecord(
		namespace: string,
		key: string,
	): Promise<LibraryRecord | null> {
		const envelope = this.readJson<LibraryRecordEnvelope>(
			this.libraryRecordPath(namespace, key),
		);
		if (envelope?.kind !== "opencut-library-record") return null;
		try {
			return {
				namespace,
				key: envelope.key,
				schemaVersion: envelope.schemaVersion,
				data: decodeOpaque(envelope.payload),
			};
		} catch (error) {
			throw ioFailure("decode", error);
		}
	}

	async saveLibraryRecord(record: LibraryRecord): Promise<void> {
		this.ensureDirectory(this.libraryDir(record.namespace));
		this.writeAtomic(
			this.libraryRecordPath(record.namespace, record.key),
			JSON.stringify(
				{
					kind: "opencut-library-record",
					key: record.key,
					schemaVersion: record.schemaVersion,
					payload: encodeOpaque(record.data),
				} satisfies LibraryRecordEnvelope,
				null,
				"\t",
			),
		);
	}

	async removeLibraryRecord(namespace: string, key: string): Promise<void> {
		try {
			unlinkSync(this.libraryRecordPath(namespace, key));
		} catch (error) {
			if (!isAbsent(error)) throw ioFailure("remove", error);
		}
	}

	async inspectFiles(): Promise<{ usedBytes: number }> {
		let usedBytes = 0;
		const walk = (directory: string): void => {
			let entries: string[];
			try {
				entries = readdirSync(directory);
			} catch {
				return;
			}
			for (const entry of entries) {
				const target = `${directory}/${entry}`;
				let stats;
				try {
					stats = statSync(target);
				} catch {
					continue;
				}
				if (stats.isDirectory()) walk(target);
				else usedBytes += stats.size;
			}
		};
		walk(this.root);
		this.writeStoreFile(usedBytes);
		return { usedBytes };
	}

	private writeStoreFile(usedBytes: number): void {
		const envelope: StoreFileEnvelope = {
			kind: "opencut-store",
			identity: this.identity,
			inspection: { usedBytes, capturedAt: new Date().toISOString() },
		};
		try {
			this.ensureDirectory(this.root);
			this.writeAtomic(
				`${this.root}/store.json`,
				JSON.stringify(envelope, null, "\t"),
			);
		} catch {
			// The inspection snapshot is advisory; a failed refresh must not fail
			// the operation that asked for it.
		}
	}

	async clearFiles(scope: ProjectStoreClearScope): Promise<void> {
		const targets =
			scope.kind === "all"
				? [`${this.root}/projects`, `${this.root}/library`]
				: scope.kind === "projects"
					? [`${this.root}/projects`]
					: [this.libraryDir(scope.namespace)];
		for (const target of targets) {
			try {
				rmSync(target, { recursive: true, force: true });
			} catch (error) {
				throw ioFailure("clear", error);
			}
		}
		if (scope.kind === "all") {
			try {
				unlinkSync(`${this.root}/store.json`);
			} catch {
				// An absent store file is already clear.
			}
		}
	}
}
