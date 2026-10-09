import { isAbsolute } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProgrammaticResourceStore } from "../resources";
import { compileProgrammaticProject } from "./compile-project";
import { ENGINE_VERSIONS } from "./engine-versions";

export function createProgrammaticBuildService(
	context: ProgrammaticResourceStore,
	enqueue: <T>(task: () => Promise<T>) => Promise<T>,
	toolchainDirectory = process.env.ROCUT_ENGINE_TOOLCHAIN_DIR,
) {
	const configured = !!toolchainDirectory && isAbsolute(toolchainDirectory);
	const active = new Map<AbortController, Promise<void>>();
	let disposed = false;
	return {
		capability: {
			version: 1, configured, engines: configured ? Object.entries(ENGINE_VERSIONS).map(([engine, version]) => ({ engine, version })) : [],
			availability: configured ? "configured-not-health-probed" : "unavailable",
			compile: "programmatic/build/compile", rebuild: "programmatic/build/rebuild",
			revise: "programmatic/build/revise", reviseScope: "existing-text-files-and-input-props",
			reviseEngines: ["hyperframes", "remotion"],
			mutation: "prepares-source; attach-via-editing-transaction", downloads: false,
		},
		async dispose() {
			disposed = true;
			for (const controller of active.keys()) controller.abort();
			await Promise.all(active.values());
		},
		async handle(action: string, request: IncomingMessage, response: ServerResponse) {
			const json = (status: number, body: unknown) => {
				if (!response.destroyed) response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
			};
			if (action !== "compile" && action !== "rebuild" && action !== "revise") { json(404, { error: "Unknown build operation" }); return; }
			if (!configured || disposed) { json(503, { error: "Engine compiler unavailable; configure a pinned local ROCUT_ENGINE_TOOLCHAIN_DIR" }); return; }
			if (active.size) { json(429, { error: "Engine compiler busy" }); return; }
			const controller = new AbortController();
			let drained!: () => void;
			active.set(controller, new Promise<void>(resolve => { drained = resolve; }));
			const abort = () => { controller.abort(); if (!request.complete) request.destroy(); };
			request.once("aborted", abort); response.once("close", abort);
			const timeout = setTimeout(abort, 60000);
			try {
				const chunks: Buffer[] = [];
				let size = 0;
				for await (const chunk of request) {
					controller.signal.throwIfAborted(); size += chunk.length;
					if (size > 1000000) { json(413, { error: "Engine build request too large" }); return; }
					chunks.push(Buffer.from(chunk));
				}
				const input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
				const result = await compileProgrammaticProject({ action, input, toolchainDirectory: toolchainDirectory!, context, signal: controller.signal, enqueue });
				controller.signal.throwIfAborted();
				json(200, result);
			} catch (error) {
				json(controller.signal.aborted ? 408 : 422, { error: error instanceof Error ? error.message : "Engine build failed" });
			} finally {
				clearTimeout(timeout); request.removeListener("aborted", abort); response.removeListener("close", abort);
				active.delete(controller); drained();
			}
		},
	};
}
