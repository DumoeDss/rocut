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

interface SandboxRequest {
	signal?: AbortSignal;
	source: ProgrammaticSource;
	frame: ProgrammaticFrame;
	resources: readonly ResolvedProgrammaticResource[];
	sequenceImages?: readonly ResolvedSequenceImage[];
	imageAdmissions?: readonly ImageDecodeAdmission[];
	operation:
		| "render"
		| "measure-fonts"
		| "measure-resources"
		| "measure-tunnel-fonts";
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
	const imageAdmissions = await prepareImageAdmissions({
		...request,
		operation:
			request.operation === "measure-tunnel-fonts"
				? "measure-fonts"
				: request.operation,
		sequenceImages: request.sequenceImages ?? [],
		signal,
	});
	request = {
		...request,
		imageAdmissions,
		resources: await verifyProgrammaticFontResources({
			resources: request.resources,
			signal,
		}),
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
		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			channel.port1.postMessage("dispose");
			channel.port1.close();
			channel.port2.close();
			iframe.remove();
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
			() => fail(Error("Programmatic frame timed out after 5000 ms")),
			5000,
		);
		signal?.addEventListener("abort", abort, { once: true });
		channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
			if (data === "ready") {
				if (!settled) channel.port1.postMessage(request);
				return;
			}
			if (!data || typeof data !== "object") {
				fail(Error("Invalid programmatic frame response"));
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
					fail(Error("Invalid programmatic frame dimensions or operation"));
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
				Error(
					`Programmatic frame failed: ${String(Reflect.get(data, "error")).slice(0, 2000)}`,
				),
			);
		};
		iframe.onload = () => {
			if (!settled)
				iframe.contentWindow?.postMessage("rocut-frame-v1", "*", [
					channel.port2,
				]);
		};
		iframe.srcdoc = PROGRAMMATIC_SANDBOX_DOCUMENT;
		try {
			document.body.appendChild(iframe);
		} catch (error) {
			fail(error);
		}
	});
}
