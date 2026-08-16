/**
 * The single-project file-backed ProjectStore (S06 C3).
 *
 * Layout — the project file is the SSOT (director-precedent calibration):
 *
 *   <root>/project.json            { wrapperVersion, record, summary }
 *   <root>/attachments/<key>/      metadata.json + body.bin
 *   <root>/library/<ns>/<key>.json schemaVersion + data envelope
 *
 * `project.json` is written atomically (tmp + rename) so a host killed
 * mid-save reopens from the last complete write — the crash-recovery
 * acceptance of S06 C4 rests on this property.
 */
import {
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
	readdir,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ProjectStoreError } from "@opencut/editor-ports";
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

const WRAPPER_VERSION = 1;

interface ProjectFileWrapper {
	readonly wrapperVersion: number;
	readonly record: ProjectRecord;
	readonly summary: ProjectSummary;
}

function storeError(
	code: string,
	operation: string,
	projectId: ProjectId,
	message: string,
): ProjectStoreError {
	return new ProjectStoreError({
		code: code as never,
		operation: operation as never,
		scope: { kind: "project", projectId },
		message,
	});
}

/** Path segments are key material, never trusted structure. */
function safeSegment(value: string): string {
	const clean = value.replace(/[^A-Za-z0-9._-]/g, "_");
	if (clean === "" || clean === "." || clean === "..") {
		throw new TypeError(`Unsafe store key segment: ${JSON.stringify(value)}`);
	}
	return clean;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
	return buffer.buffer.slice(
		buffer.byteOffset,
		buffer.byteOffset + buffer.byteLength,
	) as ArrayBuffer;
}

async function writeAtomic(filePath: string, contents: string): Promise<void> {
	const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(temp, contents, "utf8");
	await rename(temp, filePath);
}

export class FileProjectStore implements ProjectStore {
	readonly schemaVersion: number;
	private readonly root: string;

	constructor(args: { readonly root: string; readonly schemaVersion: number }) {
		this.root = args.root;
		this.schemaVersion = args.schemaVersion;
	}

	private get projectFile(): string {
		return path.join(this.root, "project.json");
	}

	async persistedSchemaVersion(): Promise<number | null> {
		if (!existsSync(this.projectFile)) return null;
		try {
			const parsed = JSON.parse(
				await readFile(this.projectFile, "utf8"),
			) as ProjectFileWrapper;
			return parsed.record.schemaVersion;
		} catch {
			return null;
		}
	}

	async list(): Promise<readonly ProjectSummary[]> {
		if (!existsSync(this.projectFile)) return [];
		const wrapper = await this.readWrapper("__listing__" as ProjectId);
		return wrapper === null ? [] : [wrapper.summary];
	}

	async load(args: { readonly id: ProjectId }): Promise<ProjectRecord | null> {
		const wrapper = await this.readWrapper(args.id);
		return wrapper === null ? null : wrapper.record;
	}

	async save(args: {
		readonly record: ProjectRecord;
		readonly summary: ProjectSummary;
	}): Promise<void> {
		if (args.record.id !== args.summary.id) {
			throw storeError(
				"conflict",
				"save-project",
				args.record.id,
				"record.id and summary.id must match",
			);
		}
		await mkdir(this.root, { recursive: true });
		const wrapper: ProjectFileWrapper = {
			wrapperVersion: WRAPPER_VERSION,
			record: args.record,
			summary: args.summary,
		};
		await writeAtomic(this.projectFile, JSON.stringify(wrapper));
	}

	async remove(args: { readonly id: ProjectId }): Promise<void> {
		if (existsSync(this.projectFile)) {
			await rm(this.projectFile, { force: true });
		}
	}

	async listAttachments(args: {
		readonly projectId: ProjectId;
	}): Promise<readonly ProjectAttachment[]> {
		const dir = path.join(this.root, "attachments");
		if (!existsSync(dir)) return [];
		const entries = await readdir(dir, { withFileTypes: true });
		const attachments: ProjectAttachment[] = [];
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const metadataPath = path.join(dir, entry.name, "metadata.json");
			const bodyPath = path.join(dir, entry.name, "body.bin");
			if (!existsSync(metadataPath) || !existsSync(bodyPath)) continue;
			attachments.push({
				projectId: args.projectId,
				key: entry.name,
				metadata: JSON.parse(await readFile(metadataPath, "utf8")),
				body: toArrayBuffer(await readFile(bodyPath)),
			});
		}
		return attachments;
	}

	async loadAttachment(args: {
		readonly projectId: ProjectId;
		readonly key: string;
	}): Promise<ProjectAttachment | null> {
		const dir = path.join(this.root, "attachments", safeSegment(args.key));
		const metadataPath = path.join(dir, "metadata.json");
		const bodyPath = path.join(dir, "body.bin");
		if (!existsSync(metadataPath) || !existsSync(bodyPath)) return null;
		return {
			projectId: args.projectId,
			key: args.key,
			metadata: JSON.parse(await readFile(metadataPath, "utf8")),
			body: toArrayBuffer(await readFile(bodyPath)),
		};
	}

	async saveAttachment(args: {
		readonly projectId: ProjectId;
		readonly key: string;
		readonly metadata: unknown;
		readonly body: ArrayBuffer;
	}): Promise<void> {
		const dir = path.join(this.root, "attachments", safeSegment(args.key));
		await mkdir(dir, { recursive: true });
		await writeFile(
			path.join(dir, "metadata.json"),
			JSON.stringify(args.metadata),
			"utf8",
		);
		await writeFile(path.join(dir, "body.bin"), Buffer.from(args.body));
	}

	async removeAttachment(args: {
		readonly projectId: ProjectId;
		readonly key: string;
	}): Promise<void> {
		await rm(path.join(this.root, "attachments", safeSegment(args.key)), {
			recursive: true,
			force: true,
		});
	}

	async listLibraryRecords(args: {
		readonly namespace: string;
	}): Promise<readonly LibraryRecord[]> {
		const dir = path.join(this.root, "library", safeSegment(args.namespace));
		if (!existsSync(dir)) return [];
		const entries = await readdir(dir);
		const records: LibraryRecord[] = [];
		for (const entry of entries) {
			if (!entry.endsWith(".json")) continue;
			const parsed = JSON.parse(
				await readFile(path.join(dir, entry), "utf8"),
			) as Omit<LibraryRecord, "namespace" | "key">;
			records.push({
				namespace: args.namespace,
				key: entry.slice(0, -".json".length),
				...parsed,
			});
		}
		return records;
	}

	async loadLibraryRecord(args: {
		readonly namespace: string;
		readonly key: string;
	}): Promise<LibraryRecord | null> {
		const file = path.join(
			this.root,
			"library",
			safeSegment(args.namespace),
			`${safeSegment(args.key)}.json`,
		);
		if (!existsSync(file)) return null;
		const parsed = JSON.parse(await readFile(file, "utf8")) as Omit<
			LibraryRecord,
			"namespace" | "key"
		>;
		return { namespace: args.namespace, key: args.key, ...parsed };
	}

	async saveLibraryRecord(args: {
		readonly namespace: string;
		readonly key: string;
		readonly schemaVersion: number;
		readonly data: unknown;
	}): Promise<void> {
		const dir = path.join(this.root, "library", safeSegment(args.namespace));
		await mkdir(dir, { recursive: true });
		await writeAtomic(
			path.join(dir, `${safeSegment(args.key)}.json`),
			JSON.stringify({ schemaVersion: args.schemaVersion, data: args.data }),
		);
	}

	async removeLibraryRecord(args: {
		readonly namespace: string;
		readonly key: string;
	}): Promise<void> {
		await rm(
			path.join(
				this.root,
				"library",
				safeSegment(args.namespace),
				`${safeSegment(args.key)}.json`,
			),
			{ force: true },
		);
	}

	async inspect(): Promise<ProjectStoreInspection> {
		return { availability: "available", capacity: null };
	}

	async clear(args: { readonly scope: ProjectStoreClearScope }): Promise<void> {
		if (args.scope.kind === "all") {
			await rm(this.root, { recursive: true, force: true });
			return;
		}
		if (args.scope.kind === "library") {
			await rm(
				path.join(this.root, "library", safeSegment(args.scope.namespace)),
				{
					recursive: true,
					force: true,
				},
			);
			return;
		}
		await rm(this.projectFile, { force: true });
		await rm(path.join(this.root, "attachments"), {
			recursive: true,
			force: true,
		});
	}

	private async readWrapper(
		projectId: ProjectId,
	): Promise<ProjectFileWrapper | null> {
		if (!existsSync(this.projectFile)) return null;
		let parsed: unknown;
		try {
			parsed = JSON.parse(await readFile(this.projectFile, "utf8"));
		} catch (error) {
			throw storeError(
				"corrupt",
				"load-project",
				projectId,
				`project.json is not valid JSON: ${String(error)}`,
			);
		}
		const wrapper = parsed as ProjectFileWrapper;
		if (
			typeof wrapper !== "object" ||
			wrapper === null ||
			wrapper.wrapperVersion !== WRAPPER_VERSION ||
			typeof wrapper.record !== "object" ||
			typeof wrapper.summary !== "object"
		) {
			throw storeError(
				"corrupt",
				"load-project",
				projectId,
				"project.json does not match the wrapper shape",
			);
		}
		return wrapper;
	}
}
