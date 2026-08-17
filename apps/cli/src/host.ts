/**
 * The local backend host (S06 C3) — the director-precedent host-start shape.
 *
 * `startHost` composes the automation core over a FileProjectStore, serves the
 * web surface statically and a small token-authenticated HTTP API on one
 * loopback origin, and hands back the target id + editorUrl to print exactly
 * once. The API is "the HTTP the web surface itself needs" plus what a CLI
 * client reconnecting via `--target` needs — not a bespoke daemon protocol.
 */
import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createAutomation } from "@opencut/editor-automation";
import type { AutomationApi } from "@opencut/editor-automation";
import {
	createTransactionNativeDocumentAdapter,
	createTransactionNativeProjectSeed,
} from "@opencut/editor-contracts/engine";
import { frameRate, projectId, revisionOf } from "@opencut/editor-contracts";
import type { Project } from "@opencut/editor-contracts";
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
	readonly automation: AutomationApi;
	readonly close: () => Promise<void>;
}

function defaultProject(id: Project["id"]): Project {
	return {
		id,
		name: "Untitled project",
		frameRate: frameRate({ numerator: 30, denominator: 1 }),
		canvasWidth: 1920,
		canvasHeight: 1080,
	};
}

export async function startHost(args: StartHostArgs): Promise<RunningHost> {
	const store = new FileProjectStore({
		root: args.projectRoot,
		schemaVersion: 1,
	});
	const targetId = path
		.basename(path.resolve(args.projectRoot))
		.replace(/[^A-Za-z0-9._-]/g, "-");
	const projectIdentifier = projectId(targetId);
	if ((await store.list()).length === 0) {
		const seed = createTransactionNativeProjectSeed({
			projectId: projectIdentifier,
			project: defaultProject(projectIdentifier),
		});
		await store.save({ record: seed.record, summary: seed.summary });
	}
	const automation = await createAutomation({
		store,
		projectId: projectIdentifier,
		documentAdapter: createTransactionNativeDocumentAdapter(),
	});

	const token = randomBytes(24).toString("hex");
	const server = createServer((request, response) => {
		void handle(request, response, {
			token,
			automation,
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
		automation,
		close: async () => {
			await args.registry.remove(targetId).catch(() => undefined);
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

interface HandleContext {
	readonly token: string;
	readonly automation: AutomationApi;
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
	const { automation } = context;
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
		if (request.method === "GET" && route[0] === "events") {
			response.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			response.write(
				`data: ${JSON.stringify({ revision: await automation.revision() })}\n\n`,
			);
			const unsubscribe = automation.watch((revision) => {
				response.write(`data: ${JSON.stringify({ revision })}\n\n`);
			});
			request.once("close", unsubscribe);
			return;
		}
		if (request.method === "POST" && route[0] === "apply") {
			const body = await readJsonBody(request);
			const result = await automation.apply({
				operations: body.operations,
				...(body.expectedRevision === undefined
					? {}
					: { expectedRevision: revisionOf(body.expectedRevision) }),
				...(body.idempotencyKey === undefined
					? {}
					: { idempotencyKey: body.idempotencyKey }),
			});
			respond(200, { accepted: true, ...result });
			return;
		}
		respond(404, { error: "unknown-api-route" });
	} catch (error) {
		respond(409, {
			accepted: false,
			name: error instanceof Error ? error.name : "Error",
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

function readJsonBody(request: import("node:http").IncomingMessage): Promise<{
	operations: never[];
	expectedRevision?: number;
	idempotencyKey?: string;
}> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch (error) {
				reject(error);
			}
		});
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
