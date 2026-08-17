/**
 * The local backend host (S06 C3) — the director-precedent host-start shape.
 *
 * `startHost` composes the automation core over the file SSOT on the EDITOR
 * plane (the dual-plane unification ruled 2026-08-17: `project.json` is the
 * full editor record with the `__opencutTransaction` envelope — the same file
 * the web surface's session reads and writes), serves the web surface
 * statically and a small token-authenticated HTTP API on one loopback origin,
 * and hands back the target id + editorUrl to print exactly once. The API is
 * "the HTTP the web surface itself needs" plus what a CLI client reconnecting
 * via `--target` needs — not a bespoke daemon protocol.
 *
 * One file, two writers, one authority: agent mutations flow through the
 * engine; the pane's editor session saves its record through `PUT
 * api/record`, gated by an envelope parent-chain check (a lost update is a
 * deterministic 409, never a silent clobber). An accepted external save
 * reopens the engine over the file — the resync the long-lived engine cannot
 * do in place — and clears open draft sessions, which were staged against the
 * record that just changed. All mutations serialize through one queue.
 */
import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { AutomationApi } from "@opencut/editor-automation";
import { projectId, revisionOf } from "@opencut/editor-contracts";
import { TransactionError } from "@opencut/editor-contracts";
import type { ProjectId, ProjectStore } from "@opencut/editor-ports";
import type { DraftEditingSession } from "@opencut/editor-contracts/draft";
import {
	CURRENT_PROJECT_VERSION,
	readOpenCutEnvelopeSummary,
} from "@opencut/editor-classic/transactions";
import { frameProofFromRecord } from "@opencut/editor-classic/frame-proof";
import {
	openEditorPlaneAutomation,
	prepareEditorProjectRecord,
	sameJson,
} from "./editor-plane";
import { FileProjectStore } from "./file-store";
import type { TargetEntry, TargetSecret } from "./target-registry";
import type { TargetRegistry } from "./target-registry";

const MIME: Readonly<Record<string, string>> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".wasm": "application/wasm",
	".woff2": "font/woff2",
	".map": "application/json",
	".txt": "text/plain; charset=utf-8",
};

/** Attachment metadata rides as base64 JSON (header values are latin1). */
const ATTACHMENT_METADATA_HEADER = "x-opencut-metadata";

function encodeAttachmentMetadata(metadata: unknown): string {
	return Buffer.from(JSON.stringify(metadata), "utf8").toString("base64");
}

function decodeAttachmentMetadata(raw: string | undefined): unknown {
	if (raw === undefined) return {};
	try {
		return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
	} catch {
		throw new Error("x-opencut-metadata is not base64 JSON");
	}
}

export interface StartHostArgs {
	/** Project directory (SSOT root for the FileProjectStore). */
	readonly projectRoot: string;
	/** Static web-surface dist directory; absent disables static serving. */
	readonly staticDir?: string;
	/** 0 (default) binds an ephemeral port. */
	readonly port?: number;
	readonly registry: TargetRegistry;
}

export interface RunningHost {
	readonly targetId: string;
	readonly port: number;
	readonly token: string;
	readonly editorUrl: string;
	/** Live view over the (rebuildable) editor-plane automation. */
	readonly automation: AutomationApi;
	readonly close: () => Promise<void>;
}

/**
 * The mutable host plane: the reopenable automation plus the serialization
 * every mutating route shares. Reads go through `automation()`; writes go
 * through `enqueue` so agent applies, draft verbs and external record saves
 * can never interleave.
 */
interface HostPlane {
	readonly projectId: ProjectId;
	readonly baseStore: ProjectStore;
	readonly draftSessions: Map<string, DraftEditingSession>;
	automation(): AutomationApi;
	/** Serialize a mutation (agent apply, draft verb, external save). */
	enqueue<T>(operation: () => Promise<T>): Promise<T>;
	/** Resync after an external record save: reopen over the file SSOT. */
	rebuild(): Promise<void>;
	watchRevision(callback: (revision: number) => void): () => void;
}

async function createHostPlane(args: {
	readonly baseStore: ProjectStore;
	readonly projectId: ProjectId;
}): Promise<HostPlane> {
	const draftSessions = new Map<string, DraftEditingSession>();
	let current = await openEditorPlaneAutomation({
		baseStore: args.baseStore,
		projectId: args.projectId,
	});
	const revisionWatchers = new Map<
		(revision: number) => void,
		() => void
	>();
	let queue: Promise<unknown> = Promise.resolve();

	function enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const run = queue.then(operation);
		queue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	async function rebuild(): Promise<void> {
		// The engine's in-memory committed state predates the record that just
		// landed; the file is the SSOT, so resync = reopen. Draft sessions
		// were staged against the replaced record and die with it — an agent's
		// next draft verb 404s deterministically instead of committing stale
		// work.
		draftSessions.clear();
		current = await openEditorPlaneAutomation({
			baseStore: args.baseStore,
			projectId: args.projectId,
		});
		for (const callback of revisionWatchers.keys()) {
			const previous = revisionWatchers.get(callback);
			previous?.();
			revisionWatchers.set(callback, current.automation.watch(callback));
		}
	}

	function watchRevision(callback: (revision: number) => void): () => void {
		const previous = revisionWatchers.get(callback);
		previous?.();
		revisionWatchers.set(callback, current.automation.watch(callback));
		return () => {
			const unsubscribe = revisionWatchers.get(callback);
			unsubscribe?.();
			revisionWatchers.delete(callback);
		};
	}

	return {
		projectId: args.projectId,
		baseStore: args.baseStore,
		draftSessions,
		automation: () => current.automation,
		enqueue,
		rebuild,
		watchRevision,
	};
}

export async function startHost(args: StartHostArgs): Promise<RunningHost> {
	const baseStore = new FileProjectStore({
		root: args.projectRoot,
		schemaVersion: CURRENT_PROJECT_VERSION,
	});
	const targetId = path
		.basename(path.resolve(args.projectRoot))
		.replace(/[^A-Za-z0-9._-]/g, "-");
	const projectIdentifier = projectId(targetId);
	await prepareEditorProjectRecord({
		store: baseStore,
		projectId: projectIdentifier,
		name: "Untitled project",
	});
	const plane = await createHostPlane({
		baseStore,
		projectId: projectIdentifier,
	});

	const token = randomBytes(24).toString("hex");
	const server = createServer((request, response) => {
		void handle(request, response, {
			token,
			plane,
			staticDir: args.staticDir,
		});
	});
	const port = await new Promise<number>((resolve, reject) => {
		server.once("error", reject);
		server.listen(args.port ?? 0, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") {
				reject(new Error("Could not determine the bound port"));
				return;
			}
			resolve(address.port);
		});
	});

	const entry: TargetEntry = {
		id: targetId,
		port,
		pid: process.pid,
		projectPath: path.resolve(args.projectRoot),
		startedAt: new Date().toISOString(),
	};
	const secret: TargetSecret = { id: targetId, port, token };
	await args.registry.register({ entry, secret });

	return {
		targetId,
		port,
		token,
		editorUrl: `http://127.0.0.1:${port}/${token}/`,
		get automation(): AutomationApi {
			return plane.automation();
		},
		close: async () => {
			await args.registry.remove(targetId).catch(() => undefined);
			await new Promise<void>((resolve) => {
				server.close(() => resolve());
				// SSE subscriptions and keep-alive fetches otherwise hold the
				// close callback forever; the agent owns the lifetime, so close
				// means close.
				server.closeAllConnections();
			});
		},
	};
}

interface HandleContext {
	readonly token: string;
	readonly plane: HostPlane;
	readonly staticDir: string | undefined;
}

async function handle(
	request: import("node:http").IncomingMessage,
	response: import("node:http").ServerResponse,
	context: HandleContext,
): Promise<void> {
	const url = new URL(request.url ?? "/", "http://127.0.0.1");
	const segments = url.pathname.split("/").filter((segment) => segment !== "");
	if (segments[0] !== context.token) {
		response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
		response.end("unauthorized\n");
		return;
	}
	const rest = segments.slice(1);

	if (rest[0] === "api") {
		await handleApi(request, response, rest.slice(1), context);
		return;
	}
	if (context.staticDir === undefined) {
		response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		response.end("no static surface configured\n");
		return;
	}
	await serveStatic(response, context.staticDir, rest);
}

async function handleApi(
	request: import("node:http").IncomingMessage,
	response: import("node:http").ServerResponse,
	route: readonly string[],
	context: HandleContext,
): Promise<void> {
	const { plane } = context;
	const automation = plane.automation();
	const url = new URL(request.url ?? "/", "http://127.0.0.1");
	const respond = (status: number, body: unknown): void => {
		response.writeHead(status, { "content-type": "application/json" });
		response.end(JSON.stringify(body));
	};
	try {
		if (request.method === "GET" && route[0] === "context") {
			respond(200, {
				revision: await automation.revision(),
				capabilities: await automation.capabilities(),
				supportedOperations: await automation.supportedOperations(),
				project: await automation.project(),
			});
			return;
		}
		if (request.method === "GET" && route[0] === "tracks") {
			respond(200, await automation.tracks());
			return;
		}
		if (request.method === "GET" && route[0] === "clips") {
			respond(200, await automation.clips());
			return;
		}
		if (request.method === "GET" && route[0] === "assets") {
			respond(200, await automation.assets());
			return;
		}
		if (request.method === "GET" && route[0] === "markers") {
			respond(200, await automation.markers());
			return;
		}
		if (request.method === "GET" && route[0] === "record") {
			const record = await plane.baseStore.load({ id: plane.projectId });
			if (record === null) {
				respond(404, { error: "no-record" });
				return;
			}
			const summary = (await plane.baseStore.list()).find(
				(entry) => entry.id === plane.projectId,
			);
			respond(200, { record, summary });
			return;
		}
		if (request.method === "GET" && route[0] === "frame") {
			// The composed-frame proof (S07): canonical description of the
			// frame at a tick + its SHA-256 — deterministic across machines,
			// no renderer involved. Pixels stay the pane's domain.
			const at = Number(url.searchParams.get("at"));
			const record = await plane.baseStore.load({ id: plane.projectId });
			if (record === null || !Number.isFinite(at) || at < 0) {
				respond(404, { error: "no-frame" });
				return;
			}
			const engineAssets = await automation.assets();
			const proof = await frameProofFromRecord({
				record,
				assets: engineAssets.map((asset) => ({
					id: String(asset.id),
					kind: asset.kind,
					name: asset.name,
					...(asset.duration !== undefined && {
						duration: asset.duration,
					}),
					...(asset.width !== undefined && { width: asset.width }),
					...(asset.height !== undefined && { height: asset.height }),
				})),
				at,
				revision: Number(await automation.revision()),
			});
			respond(200, proof);
			return;
		}
		if (request.method === "GET" && route[0] === "events") {
			response.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			response.flushHeaders();
			// No initial snapshot: watch fires only on revision changes, and
			// the conformance driver counts callbacks exactly.
			const unsubscribe = plane.watchRevision((revision) => {
				response.write(`data: ${JSON.stringify({ revision })}\n\n`);
				// Streaming responses can buffer without an explicit flush on
				// some runtimes; flush is a runtime extension when present.
				const extended = response as { flush?: () => void };
				if (typeof extended.flush === "function") extended.flush();
			});
			request.once("close", unsubscribe);
			return;
		}
		if (request.method === "GET" && route[0] === "attachments") {
			const attachments = await plane.baseStore.listAttachments({
				projectId: plane.projectId,
			});
			respond(
				200,
				attachments.map((attachment) => ({
					key: attachment.key,
					metadata: attachment.metadata,
				})),
			);
			return;
		}
		if (route[0] === "attachment" && route.length === 2) {
			await handleAttachment(request, response, route[1], plane);
			return;
		}
		if (route[0] === "library" && route.length >= 2) {
			await handleLibrary(request, response, route.slice(1), plane);
			return;
		}
		if (
			request.method === "POST" &&
			route[0] === "drafts" &&
			route.length === 1
		) {
			const body = await readJsonBody(request);
			const opened = await plane.enqueue(() =>
				plane
					.automation()
					.openDraft({
						approvalMode: body.approvalMode === "auto" ? "auto" : "manual",
					}),
			);
			if (!opened.opened) {
				respond(409, { opened: false, error: opened.error });
				return;
			}
			plane.draftSessions.set(String(opened.session.id), opened.session);
			respond(200, { opened: true, draftId: opened.session.id });
			return;
		}
		if (
			request.method === "GET" &&
			route[0] === "drafts" &&
			route.length === 2
		) {
			const session = plane.draftSessions.get(route[1]);
			if (session === undefined) {
				respond(404, { error: "unknown-draft" });
				return;
			}
			respond(200, session.snapshot());
			return;
		}
		if (
			request.method === "POST" &&
			route[0] === "drafts" &&
			route.length === 3
		) {
			const [, draftId, action] = route;
			const session = plane.draftSessions.get(draftId);
			if (session === undefined) {
				respond(404, { error: "unknown-draft" });
				return;
			}
			if (action === "open") {
				// Registration endpoint used by clients that name their own ids:
				// the generic POST above generates ids, so route[2] === "open"
				// only arrives for an explicit re-key — reject it.
				respond(409, { error: "draft-already-open" });
				return;
			}
			if (action === "stage") {
				const body = await readJsonBody(request);
				respond(
					200,
					await plane.enqueue(() =>
						session.stage({ operations: body.operations }),
					),
				);
				return;
			}
			if (action === "approve") {
				respond(200, await plane.enqueue(() => session.approve()));
				return;
			}
			if (action === "reject") {
				respond(200, await plane.enqueue(() => session.reject()));
				return;
			}
			if (action === "discard") {
				respond(200, await plane.enqueue(() => session.discard()));
				return;
			}
			respond(404, { error: "unknown-draft-action" });
			return;
		}
		if (request.method === "POST" && route[0] === "apply") {
			const body = await readJsonBody(request);
			const result = await plane.enqueue(() =>
				plane.automation().apply({
					operations: body.operations,
					...(body.expectedRevision === undefined
						? {}
						: { expectedRevision: revisionOf(body.expectedRevision) }),
					...(body.idempotencyKey === undefined
						? {}
						: { idempotencyKey: body.idempotencyKey }),
				}),
			);
			respond(200, { accepted: true, ...result });
			return;
		}
		if (
			request.method === "PUT" &&
			route[0] === "record" &&
			route.length === 1
		) {
			const body = await readJsonBody(request);
			const outcome = await plane.enqueue(() =>
				acceptExternalRecord({
					plane,
					record: body.record,
					summary: body.summary,
				}),
			);
			if (outcome.accepted) {
				await plane.enqueue(() => plane.rebuild());
				respond(200, { accepted: true, revision: outcome.revision });
				return;
			}
			respond(409, outcome);
			return;
		}
		respond(404, { error: "unknown-api-route" });
	} catch (error) {
		if (error instanceof TransactionError) {
			respond(409, {
				accepted: false,
				name: "TransactionError",
				code: error.code,
				message: error.message,
				...(error.expectedRevision === undefined
					? {}
					: { expectedRevision: Number(error.expectedRevision) }),
				...(error.actualRevision === undefined
					? {}
					: { actualRevision: Number(error.actualRevision) }),
			});
			return;
		}
		respond(409, {
			accepted: false,
			name: error instanceof Error ? error.name : "Error",
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * The external editor save: the pane's session PUTs the record its own engine
 * produced. The envelope's parent chain decides — the save is accepted only
 * when it carries the store's exact idempotency history (a UI-field-only
 * save) or that history plus exactly one new commit, so a save built on a
 * revision the file has already moved past is a deterministic refusal, never
 * a silent overwrite of the agent's work (or vice versa). Runs inside the
 * plane's mutation queue; the caller rebuilds the engine on acceptance.
 */
async function acceptExternalRecord(args: {
	readonly plane: HostPlane;
	readonly record: unknown;
	readonly summary: unknown;
}): Promise<
	| { readonly accepted: true; readonly revision: number }
	| (Record<string, unknown> & { readonly accepted: false })
> {
	const { plane } = args;
	const invalid = (
		reason: string,
		extra: Record<string, unknown> = {},
	): Record<string, unknown> & { readonly accepted: false } => ({
		accepted: false,
		error: reason,
		...extra,
	});
	if (
		typeof args.record !== "object" ||
		args.record === null ||
		Array.isArray(args.record)
	) {
		return invalid("record-missing");
	}
	const record = args.record as {
		readonly id: unknown;
		readonly schemaVersion: unknown;
		readonly data: unknown;
	};
	if (record.id !== plane.projectId) {
		return invalid("project-mismatch", { recordId: String(record.id) });
	}
	if (record.schemaVersion !== CURRENT_PROJECT_VERSION) {
		return invalid("schema-version-mismatch", {
			recordSchemaVersion: record.schemaVersion,
			expected: CURRENT_PROJECT_VERSION,
		});
	}
	const stored = await plane.baseStore.load({ id: plane.projectId });
	if (stored === null) {
		return invalid("no-record");
	}
	const storedEnvelope = readOpenCutEnvelopeSummary(stored.data) ?? {
		revision: 0,
		idempotency: [],
	};
	let incomingEnvelope: ReturnType<typeof readOpenCutEnvelopeSummary>;
	try {
		incomingEnvelope = readOpenCutEnvelopeSummary(record.data);
	} catch {
		return invalid("envelope-malformed");
	}
	if (incomingEnvelope === null) {
		return invalid("envelope-missing");
	}
	const storedHistory = storedEnvelope.idempotency;
	const incomingHistory = incomingEnvelope.idempotency;
	const parentMatches =
		incomingHistory.length >= storedHistory.length &&
		sameJson(incomingHistory.slice(0, storedHistory.length), storedHistory);
	const uiFieldSave =
		incomingEnvelope.revision === storedEnvelope.revision &&
		incomingHistory.length === storedHistory.length &&
		parentMatches;
	const singleCommitOnTop =
		incomingEnvelope.revision === storedEnvelope.revision + 1 &&
		incomingHistory.length <= storedHistory.length + 1 &&
		parentMatches;
	if (!uiFieldSave && !singleCommitOnTop) {
		return invalid("revision-conflict", {
			storedRevision: storedEnvelope.revision,
			incomingRevision: incomingEnvelope.revision,
		});
	}
	const summary =
		typeof args.summary === "object" &&
		args.summary !== null &&
		!Array.isArray(args.summary)
			? (args.summary as { id: unknown })
			: undefined;
	const storedSummary = (await plane.baseStore.list()).find(
		(entry) => entry.id === plane.projectId,
	);
	const summaryToSave =
		summary !== undefined && summary.id === plane.projectId
			? (summary as Parameters<ProjectStore["save"]>[0]["summary"])
			: storedSummary;
	if (summaryToSave === undefined) {
		return invalid("summary-missing");
	}
	await plane.baseStore.save({
		record: record as unknown as Parameters<ProjectStore["save"]>[0]["record"],
		summary: summaryToSave,
	});
	return { accepted: true, revision: incomingEnvelope.revision };
}

async function handleAttachment(
	request: import("node:http").IncomingMessage,
	response: import("node:http").ServerResponse,
	encodedKey: string,
	plane: HostPlane,
): Promise<void> {
	const key = decodeURIComponent(encodedKey);
	if (request.method === "GET") {
		const attachment = await plane.baseStore.loadAttachment({
			projectId: plane.projectId,
			key,
		});
		if (attachment === null) {
			response.writeHead(404, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: "unknown-attachment" }));
			return;
		}
		response.writeHead(200, {
			"content-type": "application/octet-stream",
			[ATTACHMENT_METADATA_HEADER]: encodeAttachmentMetadata(
				attachment.metadata,
			),
		});
		response.end(Buffer.from(attachment.body));
		return;
	}
	if (request.method === "PUT") {
		const body = await readRawBody(request);
		const metadata = decodeAttachmentMetadata(
			request.headers[ATTACHMENT_METADATA_HEADER] as string | undefined,
		);
		await plane.enqueue(() =>
			plane.baseStore.saveAttachment({
				projectId: plane.projectId,
				key,
				metadata,
				body: body.buffer.slice(
					body.byteOffset,
					body.byteOffset + body.byteLength,
				) as ArrayBuffer,
			}),
		);
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify({ accepted: true }));
		return;
	}
	if (request.method === "DELETE") {
		await plane.enqueue(() =>
			plane.baseStore.removeAttachment({ projectId: plane.projectId, key }),
		);
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify({ accepted: true }));
		return;
	}
	response.writeHead(404, { "content-type": "application/json" });
	response.end(JSON.stringify({ error: "unknown-attachment-method" }));
}

interface JsonBody {
	operations: never[];
	expectedRevision?: number;
	idempotencyKey?: string;
	approvalMode?: string;
	record?: unknown;
	summary?: unknown;
	schemaVersion?: number;
	data?: unknown;
}

/** Library records: `api/library/<ns>` and `api/library/<ns>/<key>`. */
async function handleLibrary(
	request: import("node:http").IncomingMessage,
	response: import("node:http").ServerResponse,
	route: readonly string[],
	plane: HostPlane,
): Promise<void> {
	const respond = (status: number, body: unknown): void => {
		response.writeHead(status, { "content-type": "application/json" });
		response.end(JSON.stringify(body));
	};
	const namespace = decodeURIComponent(route[0]);
	if (route.length === 1) {
		if (request.method !== "GET") {
			respond(404, { error: "unknown-library-method" });
			return;
		}
		respond(
			200,
			await plane.baseStore.listLibraryRecords({ namespace }),
		);
		return;
	}
	const key = decodeURIComponent(route[1]);
	if (request.method === "GET") {
		const record = await plane.baseStore.loadLibraryRecord({
			namespace,
			key,
		});
		if (record === null) {
			respond(404, { error: "unknown-library-record" });
			return;
		}
		respond(200, record);
		return;
	}
	if (request.method === "PUT") {
		const body = await readJsonBody(request);
		if (typeof body.schemaVersion !== "number") {
			respond(409, { accepted: false, error: "schema-version-missing" });
			return;
		}
		await plane.enqueue(() =>
			plane.baseStore.saveLibraryRecord({
				namespace,
				key,
				schemaVersion: body.schemaVersion as number,
				data: body.data,
			}),
		);
		respond(200, { accepted: true });
		return;
	}
	if (request.method === "DELETE") {
		await plane.enqueue(() =>
			plane.baseStore.removeLibraryRecord({ namespace, key }),
		);
		respond(200, { accepted: true });
		return;
	}
	respond(404, { error: "unknown-library-method" });
}

async function readJsonBody(
	request: import("node:http").IncomingMessage,
): Promise<JsonBody> {
	const buffer = await readRawBody(request);
	return JSON.parse(buffer.toString("utf8")) as JsonBody;
}

function readRawBody(
	request: import("node:http").IncomingMessage,
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => resolve(Buffer.concat(chunks)));
		request.on("error", reject);
	});
}

async function serveStatic(
	response: import("node:http").ServerResponse,
	staticDir: string,
	segments: readonly string[],
): Promise<void> {
	const relative = segments.join("/");
	const resolved = path.resolve(staticDir, relative);
	if (!resolved.startsWith(path.resolve(staticDir))) {
		response.writeHead(403).end("forbidden\n");
		return;
	}
	const candidates =
		relative === ""
			? [path.join(resolved, "index.html")]
			: [resolved, path.join(resolved, "index.html")];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		const info = await stat(candidate).catch(() => null);
		if (info === null || !info.isFile()) continue;
		response.writeHead(200, {
			"content-type":
				MIME[path.extname(candidate).toLowerCase()] ??
				"application/octet-stream",
			"content-length": info.size,
		});
		createReadStream(candidate).pipe(response);
		return;
	}
	response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
	response.end("not found\n");
}
