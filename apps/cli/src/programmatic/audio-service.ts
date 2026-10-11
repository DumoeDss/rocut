import { isAbsolute } from "node:path";
import { statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	NativeAudioUnavailableError,
	performProgrammaticAudio,
} from "./audio-operation";
import { createNativeAudioSlots } from "./audio-job-slots";
import type { ProgrammaticResourceStore } from "./resources";
import type { NativeVideoDecoder } from "./video-decoder";
import { writeRemotionArtifactOutputs } from "./remotion-artifact-output";
import { writeRemotionProducedOutputs } from "./remotion-produced-output";
import { pinElectronAudioSessionConnection } from "./electron-audio-session";
import * as wasm from "opencut-wasm";
import { pinElectronAudioConnection } from "./electron-audio-transport";

/** Auth/project scoping is supplied by the owning Host router. Electron uses
 * its independent native observation grant; Rust still admits facts and PCM.
 */
export function createProgrammaticAudioService({
	resourceStore,
	projectDir,
	executable = process.env.ROCUT_HTML_BROWSER_PATH,
	connectionFile = process.env.ELFTIA_HTML_FRAME_CONNECTION_FILE,
	toolchainDirectory = process.env.ROCUT_ENGINE_TOOLCHAIN_DIR,
	decoder = process.env.ROCUT_NATIVE_FFMPEG_PATH &&
	process.env.ROCUT_NATIVE_FFPROBE_PATH
		? {
				ffmpeg: process.env.ROCUT_NATIVE_FFMPEG_PATH,
				ffprobe: process.env.ROCUT_NATIVE_FFPROBE_PATH,
			}
		: undefined,
}: {
	resourceStore: ProgrammaticResourceStore;
	projectDir?: string;
	executable?: string;
	connectionFile?: string;
	decoder?: NativeVideoDecoder;
	toolchainDirectory?: string;
}) {
	const exists = (path?: string) => {
		try {
			return !!path && isAbsolute(path) && statSync(path).isFile();
		} catch {
			return false;
		}
	};
	const configuration = () => {
		let electronConfigured = false;
		let electronSessionConfigured = false;
		if (connectionFile) {
			try {
				pinElectronAudioConnection(connectionFile);
				electronConfigured = true;
			} catch {
				/* unavailable named grant */
			}
			try {
				pinElectronAudioSessionConnection(connectionFile);
				electronSessionConfigured = true;
			} catch {
				/* basic-only host */
			}
		}
		const configured =
			(connectionFile ? electronConfigured : exists(executable)) &&
			exists(decoder?.ffmpeg) &&
			exists(decoder?.ffprobe);
		const advancedConfigured =
			configured && (!connectionFile || electronSessionConfigured);
		return {
			configured,
			electronSessionConfigured,
			graphConfigured:
				advancedConfigured &&
				!!toolchainDirectory &&
				isAbsolute(toolchainDirectory),
			producedConfigured:
				advancedConfigured && !!projectDir && isAbsolute(projectDir),
		};
	};
	const sessionNonce = randomBytes(32).toString("hex");
	const active = new Map<AbortController, Promise<void>>();
	const slots = createNativeAudioSlots();
	let disposed = false;
	return {
		get capability() {
			const {
				configured,
				electronSessionConfigured,
				graphConfigured,
				producedConfigured,
			} = configuration();
			return {
				version: 1,
				configured,
				backend: connectionFile
					? "elftia-electron-native-decoder"
					: "standalone-chromium-native-decoder",
				availability: configured
					? "configured-not-health-probed"
					: "unavailable",
				engines: ["remotion", "hyperframes"],
				format: "stereo-f32le",
				sampleRates: [44100, 48000],
				remotionProduced: {
					configured: producedConfigured,
					availability: producedConfigured
						? "configured-not-health-probed"
						: "unavailable",
					endpoint: "programmatic/produced",
					history: "persistent-native-root-canonical-from-zero",
					outputs: [
						"native-mixed-wav-f32le",
						"text",
						"binary",
						"exact-frame-png",
					],
					destination: "host-owned-project-exports/programmatic",
					unsupported: ["active-css-animation-thumbnail"],
				},
				hyperframesGraph: {
					profile: "hyperframes-graph-v1",
					configured: graphConfigured,
					availability: graphConfigured
						? "configured-not-health-probed"
						: "unavailable",
					identity: "programmatic/audio/identity",
					history: "canonical-from-zero",
					fxAutomation: "native-parameters-and-preset-mix-v1",
					timing: {
						selection: "source.audio.timing",
						default: "sample-aligned",
						optionalModes: ["native-exporter"],
						nativeExporter: "final-track-trim-and-ms-placement-v1",
					},
					requires: [
						"archived-dsp-identity",
						"normalized-volume-envelope-or-native-author-write-history",
						"full-history-native-prepare-and-resolved-decoder-geometry",
					],
					unsupported: ["webaudio-fractional-start-phase"],
				},
				electron: connectionFile
					? "html-frames-native-audio-v1"
					: "requires-native-audio-analysis-transport",
				electronSession: {
					configured: !!connectionFile && electronSessionConfigured,
					protocol: "html-frames-native-audio-session-v1",
					profiles: ["source", "dsp"],
				},
			};
		},
		async dispose() {
			disposed = true;
			for (const controller of active.keys()) controller.abort();
			await Promise.all(active.values());
		},
		async handle(
			request: IncomingMessage,
			response: ServerResponse,
			action: "render" | "identity" | "produced" = "render",
		) {
			const error = (status: number, message: string) => {
				if (!response.destroyed)
					response
						.writeHead(status, {
							"content-type": "application/json",
							"cache-control": "no-store",
						})
						.end(JSON.stringify({ error: message }));
			};
			if (!["render", "identity", "produced"].includes(action)) {
				error(400, "Invalid native audio action");
				return;
			}
			const {
				configured,
				electronSessionConfigured,
				graphConfigured,
				producedConfigured,
			} = configuration();
			if (!configured || disposed) {
				error(
					503,
					"Native programmatic audio rendering is unavailable on this host",
				);
				return;
			}
			if (action === "produced" && (!projectDir || !isAbsolute(projectDir))) {
				error(
					503,
					"Native produced outputs require a Host-owned project destination",
				);
				return;
			}
			if (connectionFile && action !== "render" && !electronSessionConfigured) {
				error(
					503,
					"Electron advanced audio requires its persistent session grant",
				);
				return;
			}
			if (
				(action === "identity" && !graphConfigured) ||
				(action === "produced" && !producedConfigured)
			) {
				error(503, "Native advanced audio is unavailable on this host");
				return;
			}
			const controller = new AbortController();
			let release: (() => void) | null = null;
			let drained!: () => void;
			active.set(
				controller,
				new Promise<void>((resolve) => {
					drained = resolve;
				}),
			);
			const abort = () => controller.abort();
			// A controller alone cannot interrupt IncomingMessage's async iterator.
			const stopBody = () => {
				if (!request.complete) request.destroy();
			};
			controller.signal.addEventListener("abort", stopBody, { once: true });
			request.once("aborted", abort);
			response.once("close", abort);
			const timer = setTimeout(abort, 30 * 60 * 1000);
			try {
				release = await slots.acquire(controller.signal);
				if (!release) {
					error(429, "Native audio renderer is busy");
					return;
				}
				controller.signal.throwIfAborted();
				const chunks: Buffer[] = [];
				let size = 0;
				for await (const chunk of request) {
					controller.signal.throwIfAborted();
					size += chunk.length;
					if (size > 2_000_000) {
						error(413, "Native audio request exceeds the limit");
						return;
					}
					chunks.push(Buffer.from(chunk));
				}
				const outcome = await performProgrammaticAudio({
					action,
					input: JSON.parse(
						new TextDecoder("utf-8", { fatal: true }).decode(
							Buffer.concat(chunks),
						),
					),
					resourceStore,
					executable,
					connectionFile,
					decoder: decoder!,
					toolchainDirectory,
					graphConfigured,
					sessionNonce,
					signal: controller.signal,
				});
				if (outcome.kind === "identity") {
					controller.signal.throwIfAborted();
					response
						.writeHead(200, {
							"content-type": "application/json",
							"cache-control": "no-store",
						})
						.end(JSON.stringify(outcome.identity));
					return;
				}
				const { result, identity } = outcome;
				controller.signal.throwIfAborted();
				const artifacts = "artifacts" in result ? result.artifacts : [];
				if (artifacts.length && !projectDir)
					throw Error(
						"Native artifacts require a Host-owned project destination",
					);
				if (outcome.kind === "produced") {
					const output = await writeRemotionProducedOutputs({
						projectDir: projectDir!,
						artifacts,
						soundtrack: outcome.result,
						signal: controller.signal,
						encodeAudioWav: (packet) => {
							const encode = (wasm as unknown as Record<string, unknown>)[
								"encodeRemotionProducedAudioWav"
							];
							if (typeof encode !== "function")
								throw Error(
									"Remotion soundtrack output requires rebuilt WASM export encodeRemotionProducedAudioWav",
								);
							return encode(packet) as Uint8Array;
						},
					});
					controller.signal.throwIfAborted();
					response
						.writeHead(200, {
							"content-type": "application/json",
							"cache-control": "no-store",
						})
						.end(
							JSON.stringify({
								version: 1,
								output: output ?? null,
								hasAudio: result.hasAudio,
								sampleRate: result.sampleRate,
								frames: result.frames,
							}),
						);
					return;
				}
				const output = projectDir
					? await writeRemotionArtifactOutputs({
							projectDir,
							artifacts,
							signal: controller.signal,
						})
					: undefined;
				controller.signal.throwIfAborted();
				response
					.writeHead(200, {
						"content-type": "application/vnd.rocut.audio-pcm",
						"content-length": result.pcm.byteLength,
						"cache-control": "no-store",
						"x-rocut-audio-version": "1",
						"x-rocut-sample-rate": result.sampleRate,
						...(identity
							? {
									"x-rocut-audio-profile": identity.profile,
									"x-rocut-audio-identity": identity.id,
								}
							: {}),
						"x-rocut-channels": 2,
						"x-rocut-frames": result.frames,
						"x-rocut-sample-origin": result.sampleOrigin,
						"x-rocut-has-audio": result.hasAudio ? "1" : "0",
						...(output
							? { "x-rocut-artifact-directory": output.directory }
							: {}),
					})
					.end(result.pcm);
			} catch (cause) {
				error(
					controller.signal.aborted
						? 408
						: cause instanceof NativeAudioUnavailableError
							? 503
							: 422,
					controller.signal.aborted
						? "Native audio cancelled or timed out"
						: cause instanceof Error
							? cause.message
							: "Native audio failed",
				);
			} finally {
				clearTimeout(timer);
				request.removeListener("aborted", abort);
				response.removeListener("close", abort);
				controller.signal.removeEventListener("abort", stopBody);
				active.delete(controller);
				drained();
				release?.();
			}
		},
	};
}
