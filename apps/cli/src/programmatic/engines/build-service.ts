import { isAbsolute } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProgrammaticResourceStore } from "../resources";
import { compileProgrammaticProject } from "./compile-project";
import { ENGINE_VERSIONS } from "./engine-versions";
import { createRemotionInspectionSession } from "../remotion-inspection-service";
import { threeLiquidObjectCapability } from "./three-liquid-object-capability";

export function createProgrammaticBuildService(
	context: ProgrammaticResourceStore,
	enqueue: <T>(task: () => Promise<T>) => Promise<T>,
	toolchainDirectory = process.env.ROCUT_ENGINE_TOOLCHAIN_DIR,
	inspectionBrowser?: { executable?: string; connectionFile?: string },
) {
	const configured = !!toolchainDirectory && isAbsolute(toolchainDirectory);
	const active = new Map<AbortController, Promise<void>>();
	let disposed = false;
	const inspectionExecutable = inspectionBrowser?.executable ?? process.env.ROCUT_HTML_BROWSER_PATH;
	const inspectionConnection = inspectionBrowser?.connectionFile ?? process.env.ELFTIA_HTML_FRAME_CONNECTION_FILE;
	const inspection = configured && inspectionExecutable && isAbsolute(inspectionExecutable) && !inspectionConnection
		? createRemotionInspectionSession({ context, enqueue, toolchainDirectory: toolchainDirectory!, executable: inspectionExecutable }) : undefined;
	return {
		capability: {
			version: 1, configured, engines: configured ? Object.entries(ENGINE_VERSIONS).map(([engine, version]) => ({ engine, version })) : [],
			availability: configured ? "configured-not-health-probed" : "unavailable",
			threeLiquidObject: threeLiquidObjectCapability({ toolchainConfigured: configured,
				executable: inspectionExecutable, connectionFile: inspectionConnection }),
			compile: "programmatic/build/compile", rebuild: "programmatic/build/rebuild",
			revise: "programmatic/build/revise", reviseScope: "existing-text-files-and-input-props",
	reviseEngines: ["hyperframes", "remotion", "three"],
			remotionInspection: { configured: !!inspection, inspect: "programmatic/build/inspect", compile: "programmatic/build/compile-inspected",
				scope: "host-session-single-snapshot; no-project-mutation", metadataStability: "compile-inspected-runtime-geometry-and-props-pinned-v1; direct-compile-legacy-unpinned" },
			mutation: "prepares-source; attach-via-editing-transaction", downloads: false,
		},
		async dispose() {
			disposed = true;
			inspection?.clear();
			for (const controller of active.keys()) controller.abort();
			await Promise.all(active.values());
		},
		async handle(action: string, request: IncomingMessage, response: ServerResponse) {
			const json = (status: number, body: unknown) => {
				if (!response.destroyed) response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
			};
			if (action !== "compile" && action !== "rebuild" && action !== "revise" && action !== "inspect" && action !== "compile-inspected") { json(404, { error: "Unknown build operation" }); return; }
			if ((action === "inspect" || action === "compile-inspected") && !inspection) { json(503, { error: "Remotion inspection requires standalone browser and pinned toolchain" }); return; }
			if (!configured || disposed) { json(503, { error: "Engine compiler unavailable; configure a pinned local ROCUT_ENGINE_TOOLCHAIN_DIR" }); return; }
			if (active.size) { json(429, { error: "Engine compiler busy" }); return; }
			const controller = new AbortController();
			let drained!: () => void;
			active.set(controller, new Promise<void>(resolve => { drained = resolve; }));
			const abort = () => { controller.abort(); if (action === "inspect" || action === "compile-inspected") inspection?.clear(); if (!request.complete) request.destroy(); };
			request.once("aborted", abort); response.once("close", abort);
			const timeout = setTimeout(abort, 60000);
			try {
				const chunks: Buffer[] = [];
				let size = 0;
				for await (const chunk of request) {
					controller.signal.throwIfAborted(); size += chunk.length;
					if (size > 1000000) { if (action === "inspect" || action === "compile-inspected") inspection?.clear(); json(413, { error: "Engine build request too large" }); return; }
					chunks.push(Buffer.from(chunk));
				}
				const input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
				const result = action === "inspect" || action === "compile-inspected"
					? await inspection!.perform({ action:action, input:input, signal:controller.signal })
					: await compileProgrammaticProject({ action, input, toolchainDirectory: toolchainDirectory!, context, signal: controller.signal, enqueue });
				controller.signal.throwIfAborted();
				json(200, result);
			} catch (error) {
				if (action === "inspect" || action === "compile-inspected") inspection?.clear();
				json(controller.signal.aborted ? 408 : 422, { error: error instanceof Error ? error.message : "Engine build failed" });
			} finally {
				clearTimeout(timeout); request.removeListener("aborted", abort); response.removeListener("close", abort);
				active.delete(controller); drained();
			}
		},
	};
}
