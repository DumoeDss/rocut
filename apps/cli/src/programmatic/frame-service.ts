import { isAbsolute } from "node:path";
import { statSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProgrammaticFrameRequest } from "@opencut/editor-contracts";
import { renderHtmlPng } from "./html-rasterizer";
import type { ProgrammaticResourceStore } from "./resources";
import type { NativeVideoDecoder } from "./video-decoder";
import {
	createProgrammaticFrameDeadline,
	type FrameRouteClock,
} from "./frame-service-deadline";
import { createNativeFrameSlots } from "./frame-job-slots";
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
	options: { renderFrame?: typeof renderHtmlPng; clock?: FrameRouteClock } = {},
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
	// Route owners include queued replacements; native admission is separate.
	const controllers = new Set<AbortController>();
	const slots = createNativeFrameSlots();
	const renderFrame = options.renderFrame ?? renderHtmlPng;
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
			for (const controller of controllers) controller.abort();
			await Promise.all(drains);
		},
		async handle(request: IncomingMessage, response: ServerResponse) {
			const startedAt = options.clock?.now() ?? performance.now();
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
			let release: (() => void) | null = null;
			let drained!: () => void;
			const drain = new Promise<void>((resolve) => {
				drained = resolve;
			});
			drains.add(drain);
			controllers.add(controller);
			const stopBody = () => {
				if (!request.complete) request.destroy();
			};
			controller.signal.addEventListener("abort", stopBody, { once: true });
			const abort = () => controller.abort();
			request.once("aborted", abort);
			response.once("close", abort);
			const deadline = createProgrammaticFrameDeadline({
				controller,
				startedAt,
				clock: options.clock,
			});
			try {
				release = await slots.acquire(controller.signal);
				if (!release) {
					error(
						429,
						"HTML rasterizer busy; retry after the active frame finishes",
					);
					return;
				}
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
				const png = await renderFrame({
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
					controller.signal.aborted ? 408 : 422,
					controller.signal.aborted
						? "HTML frame cancelled or timed out"
						: cause instanceof Error
							? cause.message
							: "HTML frame failed",
				);
			} finally {
				deadline.dispose();

				request.removeListener("aborted", abort);
				response.removeListener("close", abort);
				controller.signal.removeEventListener("abort", stopBody);
				controllers.delete(controller);
				drains.delete(drain);
				drained();
				// renderFrame includes native cleanup; abort alone never frees a slot.
				release?.();
			}
		},
	};
}
