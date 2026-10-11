import { isAbsolute } from "node:path";
import { statSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProgrammaticFrameRequest } from "@opencut/editor-contracts";
import { renderHtmlPng } from "./html-rasterizer";
import type { ProgrammaticResourceStore } from "./resources";
import type { NativeVideoDecoder } from "./video-decoder";
import { createProgrammaticFrameDeadline } from "./frame-service-deadline";
import {
	createFrameServiceAdmission,
	FrameAdmissionBusyError,
} from "./frame-service-admission";
import { ELECTRON_NATIVE_VIDEO_PROTOCOL } from "./electron-native-video-server";

/** Prefer the desktop's scoped connection; explicit Chromium is CLI fallback.
 * A configured but broken Electron service never silently launches a browser. */
export function createProgrammaticFrameService(
	executable = process.env.ROCUT_HTML_BROWSER_PATH,
	connectionFile = process.env.ELFTIA_HTML_FRAME_CONNECTION_FILE,
	resourceStore?: ProgrammaticResourceStore,
	nativeVideoDecoder: NativeVideoDecoder | undefined = process.env
		.ROCUT_NATIVE_FFMPEG_PATH && process.env.ROCUT_NATIVE_FFPROBE_PATH
		? {
				ffmpeg: process.env.ROCUT_NATIVE_FFMPEG_PATH,
				ffprobe: process.env.ROCUT_NATIVE_FFPROBE_PATH,
			}
		: undefined,
) {
	const configured = connectionFile
		? isAbsolute(connectionFile)
		: !!executable &&
			isAbsolute(executable) &&
			(() => {
				try {
					return statSync(executable).isFile();
				} catch {
					return false;
				}
			})();
	const active = new Set<AbortController>();
	const admission = createFrameServiceAdmission();
	const electronNativeVideo =
		!!connectionFile &&
		(() => {
			try {
				if (statSync(connectionFile).size > 4096) return false;
				const value = JSON.parse(readFileSync(connectionFile, "utf8"));
				return (
					value.capabilities?.nativeVideoCapture?.version === 1 &&
					value.capabilities.nativeVideoCapture.protocol ===
						ELECTRON_NATIVE_VIDEO_PROTOCOL
				);
			} catch {
				return false;
			}
		})();
	const nativeConfigured =
		(!connectionFile || electronNativeVideo) &&
		configured &&
		!!nativeVideoDecoder &&
		[nativeVideoDecoder.ffmpeg, nativeVideoDecoder.ffprobe].every((file) => {
			try {
				return isAbsolute(file) && statSync(file).isFile();
			} catch {
				return false;
			}
		});
	const drains = new Set<Promise<void>>();
	let disposed = false;
	return {
		configured,
		nativeVideoCapability: {
			version: 1,
			configured: nativeConfigured,
			availability: nativeConfigured
				? "configured-not-health-probed"
				: "unavailable",
			backend: connectionFile
				? "elftia-electron-native-video-callback"
				: "standalone-chromium-native-decoder",
			electron: electronNativeVideo
				? ELECTRON_NATIVE_VIDEO_PROTOCOL
				: "requires-media-request-transport",
			hdr: "pq-hlg-hable-to-bt709-sdr; requires-zscale-tonemap",
			hdrOutput: "unsupported-sdr-only",
			colorMetadata: "explicit-supported-hdr-tags-required",
			toneMapped: "native-default-true; false-disables-tone-mapping",
			audio: "separate-rocut-tracks",
		},
		async dispose() {
			disposed = true;
			for (const controller of active) controller.abort();
			await Promise.all(drains);
		},
		async handle(request: IncomingMessage, response: ServerResponse) {
			const startedAt = performance.now();
			const error = (status: number, message: string) => {
				if (!response.destroyed)
					response
						.writeHead(status, {
							"content-type": "application/json",
							"cache-control": "no-store",
						})
						.end(JSON.stringify({ error: message }));
			};
			if (!configured || disposed) {
				error(
					503,
					"HTML rasterizer unavailable; use Elftia Electron capture or configure ROCUT_HTML_BROWSER_PATH for standalone CLI",
				);
				return;
			}
			const controller = new AbortController();
			let drained!: () => void;
			const drain = new Promise<void>((resolve) => {
				drained = resolve;
			});
			drains.add(drain);
			active.add(controller);
			controller.signal.addEventListener(
				"abort",
				() => {
					if (!request.complete) request.destroy();
				},
				{ once: true },
			);
			const abort = () => controller.abort();
			request.once("aborted", abort);
			response.once("close", abort);
			const deadline = createProgrammaticFrameDeadline({
				controller,
				startedAt,
			});
			let release: (() => void) | undefined;
			try {
				release = await admission.acquire(controller.signal);
				controller.signal.throwIfAborted();
				let size = 0;
				const chunks: Buffer[] = [];
				for await (const chunk of request) {
					controller.signal.throwIfAborted();
					size += chunk.length;
					if (size > 2_000_000) {
						error(413, "HTML frame request too large");
						return;
					}
					chunks.push(Buffer.from(chunk));
				}
				const input = JSON.parse(
					Buffer.concat(chunks).toString("utf8"),
				) as ProgrammaticFrameRequest;
				deadline.acceptParsed(input, !!connectionFile);
				controller.signal.throwIfAborted();
				const png = await renderHtmlPng({
					executable,
					connectionFile,
					request: input,
					resourceStore,
					nativeVideoDecoder: nativeConfigured ? nativeVideoDecoder : undefined,
					signal: controller.signal,
				});
				controller.signal.throwIfAborted();
				response
					.writeHead(200, {
						"content-type": "image/png",
						"content-length": png.length,
						"cache-control": "no-store",
					})
					.end(png);
			} catch (cause) {
				error(
					controller.signal.aborted
						? 408
						: cause instanceof FrameAdmissionBusyError
							? 429
							: 422,
					controller.signal.aborted
						? "HTML frame cancelled or timed out"
						: cause instanceof Error
							? cause.message
							: "HTML frame failed",
				);
			} finally {
				deadline.dispose();
				release?.();
				active.delete(controller);
				drains.delete(drain);
				drained();
				request.removeListener("aborted", abort);
				response.removeListener("close", abort);
			}
		},
	};
}
