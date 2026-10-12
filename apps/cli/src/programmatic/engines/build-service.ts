import { isAbsolute } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProgrammaticResourceStore } from "../resources";
import { compileProgrammaticProject } from "./compile-project";
import { createRemotionInspectionSession } from "../remotion-inspection-service";
import { threeLiquidObjectCapability } from "./three-liquid-object-capability";
import { threeModelCapability } from "./three-model-capability";
import { pinElectronAudioSessionConnection, ELECTRON_AUDIO_SESSION_PROTOCOL } from "../electron-audio-session";
import { resolveEngineToolchain } from "./toolchain-resolver";

export function createProgrammaticBuildService(
	context: ProgrammaticResourceStore,
	enqueue: <T>(task: () => Promise<T>) => Promise<T>,
	toolchainDirectory = process.env.ROCUT_ENGINE_TOOLCHAIN_DIR,
	inspectionBrowser?: { executable?: string; connectionFile?: string },
) {
	const toolchain = resolveEngineToolchain({ explicit: toolchainDirectory });
	const configured = toolchain.configured;
	toolchainDirectory = toolchain.directory;
	const ready = (engine: string) => toolchain.probes.find(p => p.engine === engine)?.ready === true;
	const active = new Map<AbortController, Promise<void>>();
	let disposed = false;
	const inspectionExecutable =
		inspectionBrowser?.executable ?? process.env.ROCUT_HTML_BROWSER_PATH;
	const inspectionConnection =
		inspectionBrowser?.connectionFile ??
		process.env.ELFTIA_HTML_FRAME_CONNECTION_FILE;
	let electronInspection = false;
	if (inspectionConnection) {
		try { pinElectronAudioSessionConnection(inspectionConnection); electronInspection = true; } catch { /* No standalone fallback for an Electron selection. */ }
	}
	const inspection =
		ready("remotion") &&
		(inspectionConnection ? electronInspection : inspectionExecutable && isAbsolute(inspectionExecutable))
			? createRemotionInspectionSession({
					context,
					enqueue,
					toolchainDirectory: toolchainDirectory!,
					executable: inspectionExecutable,
					connectionFile: inspectionConnection,
				})
			: undefined;
	return {
		capability: {
			version: 1,
			configured,
			engines: toolchain.probes.filter(p => p.ready).map(({ engine, version }) => ({ engine, version })),
			toolchain: {
				source: toolchain.source,
				boundary: "dependency-metadata-and-compiler-files; not-compile-browser-or-GPU-health",
				diagnostics: toolchain.diagnostics,
				engines: toolchain.probes.map(({ engine, ready, diagnostics, requiredPackages }) => ({ engine, available: ready, diagnostics, requiredPackages })),
			},
			availability: configured ? "configured-not-health-probed" : "unavailable",
			threeLiquidObject: threeLiquidObjectCapability({
				toolchainConfigured: ready("three"),
				executable: inspectionExecutable,
				connectionFile: inspectionConnection,
			}),
			compile: "programmatic/build/compile",
			rebuild: "programmatic/build/rebuild",
			revise: "programmatic/build/revise",
			reviseScope: "text-file-add-delete-rename-replace-entry-and-input-props",
			reviseEngines: ["hyperframes", "remotion", "three"],
			threeModels: threeModelCapability(),
			remotionInspection: {
				configured: !!inspection,
				backend: inspectionConnection ? "elftia-electron-source-session" : "standalone-chromium",
				requiredProtocol: inspectionConnection ? ELECTRON_AUDIO_SESSION_PROTOCOL : undefined,
				availability: inspection ? "configured-not-health-probed" : "unavailable",
				inspect: "programmatic/build/inspect",
				compile: "programmatic/build/compile-inspected",
				scope: "host-session-single-snapshot; no-project-mutation",
				metadataStability:
					"compile-inspected-runtime-geometry-and-props-pinned-v1; direct-compile-legacy-unpinned",
			},
			mutation: "prepares-source; attach-via-editing-transaction",
			downloads: false,
		},
		async dispose() {
			disposed = true;
			inspection?.clear();
			for (const controller of active.keys()) controller.abort();
			await Promise.all(active.values());
		},
		async handle(
			action: string,
			request: IncomingMessage,
			response: ServerResponse,
		) {
			const json = (status: number, body: unknown) => {
				if (!response.destroyed)
					response
						.writeHead(status, {
							"content-type": "application/json",
							"cache-control": "no-store",
						})
						.end(JSON.stringify(body));
			};
			if (
				action !== "compile" &&
				action !== "rebuild" &&
				action !== "revise" &&
				action !== "inspect" &&
				action !== "compile-inspected"
			) {
				json(404, { error: "Unknown build operation" });
				return;
			}
			if (
				(action === "inspect" || action === "compile-inspected") &&
				!inspection
			) {
				json(503, {
					error:
						"Remotion inspection requires a standalone browser or Electron native audio session grant, and a pinned toolchain",
					diagnostics: toolchain.probes.find(p => p.engine === "remotion")?.diagnostics,
				});
				return;
			}
			if (!configured || disposed) {
				json(503, {
					error:
						"Engine compiler unavailable; install the bundled pinned toolchain or configure a pinned local ROCUT_ENGINE_TOOLCHAIN_DIR",
					diagnostics: toolchain.probes,
				});
				return;
			}
			if (active.size) {
				json(429, { error: "Engine compiler busy" });
				return;
			}
			const controller = new AbortController();
			let drained!: () => void;
			active.set(
				controller,
				new Promise<void>((resolve) => {
					drained = resolve;
				}),
			);
			const abort = () => {
				controller.abort();
				if (action === "inspect" || action === "compile-inspected")
					inspection?.clear();
				if (!request.complete) request.destroy();
			};
			request.once("aborted", abort);
			response.once("close", abort);
			const timeout = setTimeout(abort, 60000);
			try {
				const chunks: Buffer[] = [];
				let size = 0;
				for await (const chunk of request) {
					controller.signal.throwIfAborted();
					size += chunk.length;
					if (size > 1000000) {
						if (action === "inspect" || action === "compile-inspected")
							inspection?.clear();
						json(413, { error: "Engine build request too large" });
						return;
					}
					chunks.push(Buffer.from(chunk));
				}
				const input = JSON.parse(
					new TextDecoder("utf-8", { fatal: true }).decode(
						Buffer.concat(chunks),
					),
				);
				const engine = action === "inspect" || action === "compile-inspected"
					? "remotion" : action === "compile" ? input?.engine : action === "revise" ? input?.source?.build?.engine : input?.build?.engine;
				const probe = toolchain.probes.find(p => p.engine === engine);
				if (probe && !probe.ready) {
					json(503, { error: `Engine compiler unavailable for ${engine}; required pinned dependencies are missing or invalid`, engine, diagnostics: probe.diagnostics });
					return;
				}
				const result =
					action === "inspect" || action === "compile-inspected"
						? await inspection!.perform({
								action: action,
								input: input,
								signal: controller.signal,
							})
						: await compileProgrammaticProject({
								action,
								input,
								toolchainDirectory: toolchainDirectory!,
								context,
								signal: controller.signal,
								enqueue,
							});
				controller.signal.throwIfAborted();
				json(200, result);
			} catch (error) {
				if (action === "inspect" || action === "compile-inspected")
					inspection?.clear();
				json(controller.signal.aborted ? 408 : 422, {
					error: error instanceof Error ? error.message : "Engine build failed",
				});
			} finally {
				clearTimeout(timeout);
				request.removeListener("aborted", abort);
				response.removeListener("close", abort);
				active.delete(controller);
				drained();
			}
		},
	};
}
