/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- This is the HTTP wire/port translation boundary: JSON payloads arrive as `unknown` and are narrowed to the port's shapes here, mirroring the adapter.ts precedent. */
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
import { ProjectStoreError } from "@opencut/editor-ports";
import { CURRENT_PROJECT_VERSION } from "@opencut/editor-classic/transactions";

/**
 * The host-served `ProjectStore` (S06 follow-on: web-surface wiring).
 *
 * When the CLI host serves this surface, the session's persistence routes to
 * the host's file SSOT over the authenticated same-origin API instead of
 * IndexedDB — one plane, one file: the pane's session and the agent's
 * automation read and write the same `project.json`. Saves carry the record
 * through `PUT api/record`; a revision the file has already moved past is a
 * typed `conflict` refusal (the host's envelope parent-chain check), never a
 * silent overwrite.
 *
 * `base` is the API prefix relative to the page — the host serves the surface
 * under `/<token>/`, so the default `"api"` resolves correctly and the token
 * never appears in this module. `fetchImpl` is injectable for tests.
 */
export interface HttpProjectStoreOptions {
	readonly base?: string;
	readonly fetchImpl?: typeof fetch;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** UTF-8-safe base64 (btoa/atob alone mangle multibyte metadata names). */
function encodeBase64Json(value: unknown): string {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function decodeBase64Json(raw: string): unknown {
	const binary = atob(raw);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return JSON.parse(new TextDecoder().decode(bytes));
}

export class HttpProjectStore implements ProjectStore {
	readonly schemaVersion = CURRENT_PROJECT_VERSION;
	private readonly base: string;
	private readonly fetchImpl: FetchLike;

	constructor(options: HttpProjectStoreOptions = {}) {
		this.base = options.base ?? "api";
		// Invoke the impl BARE (undefined `this`), never as a method of this
		// instance: the default is `window.fetch`, a native whose `this` must
		// be a Window — calling it as `this.fetchImpl(...)` throws
		// "Failed to execute 'fetch' on 'Window': Illegal invocation".
		const impl = options.fetchImpl ?? fetch;
		this.fetchImpl = (input, init) => impl(input, init);
	}

	private url(path: string): string {
		return `${this.base}/${path}`;
	}

	private unavailable(operation: string): never {
		throw new ProjectStoreError({
			code: "unavailable",
			operation: operation as never,
			scope: { kind: "store" },
			message: `Host-served storage does not expose ${operation}; the host owns the project root`,
		});
	}

	private async requestJson(
		operation: string,
		path: string,
		init?: RequestInit,
	): Promise<unknown> {
		const response = await this.fetchImpl(this.url(path), init);
		if (response.status === 404) return null;
		if (!response.ok) {
			const body = (await response.json().catch(() => null)) as {
				error?: string;
				storedRevision?: number;
				incomingRevision?: number;
			} | null;
			throw new ProjectStoreError({
				code:
					body?.error === "revision-conflict" ? "conflict" : "unavailable",
				operation: operation as never,
				scope: { kind: "store" },
				message: body?.error ?? `${operation} failed (${response.status})`,
			});
		}
		return (await response.json()) as unknown;
	}

	async list(): Promise<readonly ProjectSummary[]> {
		const payload = (await this.requestJson(
			"list-projects",
			"record",
		)) as { summary?: ProjectSummary } | null;
		return payload?.summary === undefined ? [] : [payload.summary];
	}

	async load(_args: {
		readonly id: ProjectId;
	}): Promise<ProjectRecord | null> {
		const payload = (await this.requestJson(
			"load-project",
			"record",
		)) as { record?: ProjectRecord } | null;
		return payload?.record ?? null;
	}

	async save(args: {
		readonly record: ProjectRecord;
		readonly summary: ProjectSummary;
	}): Promise<void> {
		await this.requestJson("save-project", "record", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ record: args.record, summary: args.summary }),
		});
	}

	async remove(): Promise<void> {
		this.unavailable("remove-project");
	}

	async listAttachments(args: {
		readonly projectId: ProjectId;
	}): Promise<readonly ProjectAttachment[]> {
		const payload = (await this.requestJson(
			"list-attachments",
			"attachments",
		)) as { key: string; metadata: unknown }[] | null;
		return (payload ?? []).map((entry) => ({
			projectId: args.projectId,
			key: entry.key,
			metadata: entry.metadata,
			body: new ArrayBuffer(0),
		}));
	}

	async loadAttachment(args: {
		readonly projectId: ProjectId;
		readonly key: string;
	}): Promise<ProjectAttachment | null> {
		const response = await this.fetchImpl(
			this.url(`attachment/${encodeURIComponent(args.key)}`),
		);
		if (response.status === 404) return null;
		if (!response.ok) {
			throw new ProjectStoreError({
				code: "unavailable",
				operation: "load-attachment" as never,
				scope: {
					kind: "attachment",
					projectId: args.projectId,
					key: args.key,
				},
			});
		}
		const metadataRaw = response.headers.get("x-opencut-metadata");
		const metadata =
			metadataRaw === null ? {} : decodeBase64Json(metadataRaw);
		const body = await response.arrayBuffer();
		return { projectId: args.projectId, key: args.key, metadata, body };
	}

	async saveAttachment(args: {
		readonly projectId: ProjectId;
		readonly key: string;
		readonly metadata: unknown;
		readonly body: ArrayBuffer;
	}): Promise<void> {
		const response = await this.fetchImpl(
			this.url(`attachment/${encodeURIComponent(args.key)}`),
			{
				method: "PUT",
				headers: {
					"x-opencut-metadata": encodeBase64Json(args.metadata),
				},
				body: args.body,
			},
		);
		if (!response.ok) {
			throw new ProjectStoreError({
				code: "unavailable",
				operation: "save-attachment" as never,
				scope: {
					kind: "attachment",
					projectId: args.projectId,
					key: args.key,
				},
			});
		}
	}

	async removeAttachment(args: {
		readonly projectId: ProjectId;
		readonly key: string;
	}): Promise<void> {
		const response = await this.fetchImpl(
			this.url(`attachment/${encodeURIComponent(args.key)}`),
			{ method: "DELETE" },
		);
		if (!response.ok) {
			throw new ProjectStoreError({
				code: "unavailable",
				operation: "remove-attachment" as never,
				scope: {
					kind: "attachment",
					projectId: args.projectId,
					key: args.key,
				},
			});
		}
	}

	async listLibraryRecords(args: {
		readonly namespace: string;
	}): Promise<readonly LibraryRecord[]> {
		const payload = (await this.requestJson(
			"list-library-records",
			`library/${encodeURIComponent(args.namespace)}`,
		)) as LibraryRecord[] | null;
		return payload ?? [];
	}

	async loadLibraryRecord(args: {
		readonly namespace: string;
		readonly key: string;
	}): Promise<LibraryRecord | null> {
		const payload = (await this.requestJson(
			"load-library-record",
			`library/${encodeURIComponent(args.namespace)}/${encodeURIComponent(args.key)}`,
		)) as LibraryRecord | null;
		return payload;
	}

	async saveLibraryRecord(args: {
		readonly namespace: string;
		readonly key: string;
		readonly schemaVersion: number;
		readonly data: unknown;
	}): Promise<void> {
		await this.requestJson(
			"save-library-record",
			`library/${encodeURIComponent(args.namespace)}/${encodeURIComponent(args.key)}`,
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					schemaVersion: args.schemaVersion,
					data: args.data,
				}),
			},
		);
	}

	async removeLibraryRecord(args: {
		readonly namespace: string;
		readonly key: string;
	}): Promise<void> {
		await this.requestJson(
			"remove-library-record",
			`library/${encodeURIComponent(args.namespace)}/${encodeURIComponent(args.key)}`,
			{ method: "DELETE" },
		);
	}

	async inspect(): Promise<ProjectStoreInspection> {
		return { availability: "available", capacity: null };
	}

	async clear(args: {
		readonly scope: ProjectStoreClearScope;
	}): Promise<void> {
		void args;
		this.unavailable("clear");
	}

	async persistedSchemaVersion(): Promise<number | null> {
		const payload = (await this.requestJson(
			"inspect",
			"record",
		)) as { record?: { schemaVersion: number } } | null;
		return payload?.record?.schemaVersion ?? null;
	}
}
