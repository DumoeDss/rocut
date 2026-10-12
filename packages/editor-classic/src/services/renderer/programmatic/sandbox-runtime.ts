import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
	ResolvedSequenceImage,
	MvTunnelMeasurement,
} from "@opencut/editor-contracts";
import { PROGRAMMATIC_SANDBOX_DOCUMENT } from "./sandbox-document";
import type { ProgrammaticFrame } from "./frame";
import type { FontMeasurement } from "./font-metrics-contract";
import { verifyProgrammaticFontResources } from "./font-resources";
import {
	prepareImageAdmissions,
	snapshotImageResources,
} from "./image-dimensions-resources";
import type {
	ImageDecodeAdmission,
	ResourceMeasurements,
} from "./image-dimensions-contract";
import {
	sandboxFailure,
	type ProgrammaticSandboxOperation,
	type ProgrammaticSandboxPhase,
	SANDBOX_WORKER_STAGES,
	type SandboxStageEvent,
	type SandboxWorkerStage,
} from "./sandbox-failure";

interface SandboxRequest {
	signal?: AbortSignal;
	source: ProgrammaticSource;
	frame: ProgrammaticFrame;
	resources: readonly ResolvedProgrammaticResource[];
	sequenceImages?: readonly ResolvedSequenceImage[];
	imageAdmissions?: readonly ImageDecodeAdmission[];
	operation: ProgrammaticSandboxOperation;
	onStage?: (event: SandboxStageEvent) => void | Promise<void>;
}

/** Digests cannot be interrupted, but a cancelled preparation must not retain
 * the caller or advance into a new realm when its late result arrives. */
function awaitPreparation<T>(
	pending: Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	if (!signal) return pending;
	return new Promise((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener("abort", abort);
			reject(signal.reason);
		};
		signal.addEventListener("abort", abort, { once: true });
		void pending.then(
			(value) => {
				signal.removeEventListener("abort", abort);
				if (signal.aborted) reject(signal.reason);
				else resolve(value);
			},
			(error) => {
				signal.removeEventListener("abort", abort);
				reject(signal.aborted ? signal.reason : error);
			},
		);
		if (signal.aborted) abort();
	});
}

/** One private realm per operation, with the same cancellation and watchdog
 * rules for glyph measurement and rendering. The caller owns result bitmaps.
 */
export function runProgrammaticSandbox(
	request: SandboxRequest & { operation: "render" },
): Promise<ImageBitmap>;
export function runProgrammaticSandbox(
	request: SandboxRequest & { operation: "measure-fonts" },
): Promise<readonly FontMeasurement[]>;
export function runProgrammaticSandbox(
	request: SandboxRequest & { operation: "measure-tunnel-fonts" },
): Promise<readonly MvTunnelMeasurement[]>;
export function runProgrammaticSandbox(
	request: SandboxRequest & { operation: "measure-resources" },
): Promise<ResourceMeasurements>;
export async function runProgrammaticSandbox({
	signal,
	onStage,
	...request
}: SandboxRequest): Promise<
	| ImageBitmap
	| readonly FontMeasurement[]
	| readonly MvTunnelMeasurement[]
	| ResourceMeasurements
> {
	signal?.throwIfAborted();
	request = {
		...request,
		source: structuredClone(request.source),
		frame: structuredClone(request.frame),
		resources: snapshotImageResources(request.resources),
		sequenceImages: snapshotImageResources(request.sequenceImages ?? []),
	};
	const imageAdmissions = await awaitPreparation(
		prepareImageAdmissions({
			...request,
			operation:
				request.operation === "measure-tunnel-fonts"
					? "measure-fonts"
					: request.operation,
			sequenceImages: request.sequenceImages ?? [],
			signal,
		}),
		signal,
	);
	request = {
		...request,
		imageAdmissions,
		resources: await awaitPreparation(
			verifyProgrammaticFontResources({
				resources: request.resources,
				signal,
			}),
			signal,
		),
	};
	return new Promise((resolve, reject) => {
		if (request.source.runtime !== "canvas-worker") {
			reject(Error("Canvas rasterizer requires canvas-worker source"));
			return;
		}
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}
		if (typeof document === "undefined") {
			reject(Error("Programmatic canvas requires a browser rasterizer"));
			return;
		}
		const iframe = document.createElement("iframe");
		iframe.sandbox.add("allow-scripts");
		iframe.hidden = true;
		iframe.setAttribute("aria-hidden", "true");
		const channel = new MessageChannel();
		let settled = false;
		let connected = false;
		let dispatched = false;
		let phase: ProgrammaticSandboxPhase = "iframe-load";
		const startedAt = performance.now();
		let workerStage: SandboxWorkerStage | undefined;
		let workerElapsedMs: number | undefined;
		let elapsedMs = 0;
		const diagnostics = () => {
			const elapsed = performance.now() - startedAt;
			if (Number.isFinite(elapsed) && elapsed >= 0)
				elapsedMs = Math.max(elapsedMs, elapsed);
			return {
				elapsedMs,
				...(workerStage ? { workerStage } : {}),
				...(workerElapsedMs !== undefined ? { workerElapsedMs } : {}),
			};
		};
		const failure = (message: string) =>
			sandboxFailure({
				...request,
				phase,
				message,
				diagnostics: diagnostics(),
			});
		const cleanup = () => {
			// Teardown must not replace the operation result/reason or strand its
			// promise. Attempt every independent release even if one API fails.
			for (const release of [
				() => clearTimeout(timer),
				() => signal?.removeEventListener("abort", abort),
				() => channel.port1.postMessage("dispose"),
				() => channel.port1.close(),
				() => channel.port2.close(),
				() => iframe.remove(),
			]) {
				try {
					release();
				} catch {
					/* Continue releasing the remaining realm resources. */
				}
			}
		};
		const fail = (error: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const abort = () =>
			fail(signal?.reason ?? new DOMException("Frame cancelled", "AbortError"));
		const timer = setTimeout(
			() => fail(failure("Programmatic frame timed out after 5000 ms")),
			5000,
		);
		signal?.addEventListener("abort", abort, { once: true });
		channel.port1.onmessageerror = () =>
			fail(failure("Programmatic response deserialization failed"));
		channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
			if (data === "ready") {
				if (!settled && connected && !dispatched) {
					dispatched = true;
					phase = "worker-start";
					try {
						channel.port1.postMessage(request);
					} catch {
						fail(failure("Programmatic request dispatch failed"));
					}
				}
				return;
			}
			if (!data || typeof data !== "object") {
				fail(failure("Invalid programmatic frame response"));
				return;
			}
			if (Reflect.has(data, "sandboxStage")) {
				const bitmap = Reflect.get(data, "bitmap");
				if (bitmap instanceof ImageBitmap) {
					try {
						bitmap.close();
					} catch {
						/* Retain the transport failure. */
					}
					fail(failure("Invalid programmatic progress"));
					return;
				}
				const stage = Reflect.get(data, "sandboxStage");
				const elapsed = Reflect.get(data, "workerElapsedMs");
				const legacy =
					workerStage === undefined &&
					stage === "worker-started" &&
					Object.keys(data).length === 1;
				const timed =
					Object.keys(data).length === 2 &&
					typeof elapsed === "number" &&
					Number.isFinite(elapsed) &&
					elapsed >= 0 &&
					(workerElapsedMs === undefined || elapsed >= workerElapsedMs);
				if (
					!settled &&
					dispatched &&
					SANDBOX_WORKER_STAGES.includes(stage) &&
					(legacy || timed)
				) {
					phase = "worker-result";
					workerStage = stage;
					if (timed) workerElapsedMs = elapsed;
					const event = Object.freeze({ phase, ...diagnostics() });
					try {
						void Promise.resolve(onStage?.(event)).catch(() => {
							/* A late observer rejection is observational too. */
						});
					} catch {
						/* Diagnostics must not change the operation or bitmap ownership. */
					}
				}
				return;
			}
			const bitmap: unknown = Reflect.get(data, "bitmap");
			if (bitmap instanceof ImageBitmap) {
				if (
					settled ||
					request.operation !== "render" ||
					bitmap.width !== request.source.width ||
					bitmap.height !== request.source.height
				) {
					bitmap.close();
					fail(failure("Invalid programmatic frame dimensions or operation"));
					return;
				}
				settled = true;
				cleanup();
				resolve(bitmap);
				return;
			}
			const metrics: unknown = Reflect.get(data, "fontMetrics");
			const tunnelMetrics: unknown = Reflect.get(
				data,
				"tunnelFontMeasurements",
			);
			if (
				!settled &&
				request.operation === "measure-tunnel-fonts" &&
				Array.isArray(tunnelMetrics)
			) {
				settled = true;
				cleanup();
				resolve(tunnelMetrics);
				return;
			}
			const imageDimensions: unknown = Reflect.get(data, "imageDimensions");
			if (
				!settled &&
				request.operation === "measure-resources" &&
				Array.isArray(metrics) &&
				Array.isArray(imageDimensions)
			) {
				settled = true;
				cleanup();
				resolve({ fontMetrics: metrics, imageDimensions });
				return;
			}
			if (
				!settled &&
				request.operation === "measure-fonts" &&
				Array.isArray(metrics)
			) {
				// Rust validates identities, cardinality, scalars and numerical bounds.
				settled = true;
				cleanup();
				resolve(metrics);
				return;
			}
			fail(
				failure(
					`Programmatic frame failed: ${String(Reflect.get(data, "error")).slice(0, 2000)}`,
				),
			);
		};
		iframe.onload = () => {
			if (settled || connected) return;
			connected = true;
			phase = "sandbox-ready";
			try {
				if (!iframe.contentWindow)
					throw Error("Missing programmatic sandbox window");
				iframe.contentWindow.postMessage("rocut-frame-v1", "*", [
					channel.port2,
				]);
			} catch {
				fail(failure("Programmatic sandbox connection failed"));
			}
		};
		try {
			iframe.srcdoc = PROGRAMMATIC_SANDBOX_DOCUMENT;
			document.body.appendChild(iframe);
		} catch (error) {
			fail(error);
		}
	});
}
