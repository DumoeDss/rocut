import {
	consumeMvNativeRasterTicket,
	type MvNativeRasterTicket,
} from "./mv-native-admission";
import { MV_NATIVE_DOCUMENT } from "./mv-native-document";
import {
	MV_NATIVE_CONNECT,
	MV_NATIVE_PROTOCOL,
	isMvNativeEnvelope,
	type MvNativeDispose,
	type MvNativeRequest,
} from "./mv-native-protocol";
import {
	ImagePreprocessOwner,
	type ImagePreprocessAccess,
} from "./image-preprocess-owner";
import { prepareImagePreprocessPatches } from "./image-preprocess-patches";
import {
	hasFlamePlan,
	imagePreprocessRasterBytes,
} from "./image-preprocess-binding";

/** Only fresh canonical Rust admission can create a ticket. No source code,
 * caller-supplied frame or Worker message can select this DOM-backed seam.
 * The timeout is cooperative: a single synchronous Canvas call cannot be
 * hard-preempted on the iframe's event loop. The caller owns a returned bitmap.
 */
export async function runMvNativeRaster({
	ticket,
	signal,
	imagePreprocessOwner,
}: {
	ticket: MvNativeRasterTicket;
	signal?: AbortSignal;
	imagePreprocessOwner?: ImagePreprocessAccess;
}): Promise<ImageBitmap> {
	signal?.throwIfAborted();
	const input = consumeMvNativeRasterTicket(ticket);
	if (typeof document === "undefined")
		throw Error("Native MV rasterization requires a browser document");
	let releaseResidency: (() => void) | undefined;
	let releasePatches: (() => void) | undefined;
	const ownsPreprocessor = !imagePreprocessOwner;
	if (hasFlamePlan(input.frame.recipePlan)) {
		imagePreprocessOwner ??= new ImagePreprocessOwner();
		const encoded =
			input.resources.reduce((sum, item) => sum + item.body.byteLength, 0) +
			input.sequenceImages.reduce((sum, item) => sum + item.body.byteLength, 0);
		const releasePreparation = imagePreprocessOwner.reserve(encoded * 2);
		try {
			const prepared = await prepareImagePreprocessPatches({
				input,
				owner: imagePreprocessOwner,
				signal: signal ?? new AbortController().signal,
			});
			const { patches } = prepared;
			releasePatches = prepared.release;
			const rasterByteLimit = imagePreprocessRasterBytes({
				plan: input.frame.recipePlan,
				width: input.width,
				height: input.height,
			});
			const decoded =
				input.imageAdmissions.reduce(
					(sum, item) => sum + item.decodedBytes,
					0,
				) +
				(input.frame.sequenceImages ?? []).reduce(
					(sum, item) => sum + item.width * item.height * 4,
					0,
				);
			releasePreparation();
			releaseResidency = imagePreprocessOwner.reserve(
				encoded * 2 +
					decoded * 2 +
					rasterByteLimit +
					patches.reduce(
						(sum, patch) => sum + patch.envelope.byteLength * 3,
						0,
					),
			);
			input.preparedPatches = patches;
			input.rasterByteLimit = rasterByteLimit;
		} catch (error) {
			releasePatches?.();
			releasePatches = undefined;
			if (ownsPreprocessor) imagePreprocessOwner.dispose();
			throw error;
		} finally {
			releasePreparation();
		}
	}
	const requestId = crypto.randomUUID();
	let realmStarted = false;
	const releaseOwner = () => {
		releaseResidency?.();
		releaseResidency = undefined;
		releasePatches?.();
		releasePatches = undefined;
		if (ownsPreprocessor) imagePreprocessOwner?.dispose();
	};
	return new Promise<ImageBitmap>((resolve, reject) => {
		const iframe = document.createElement("iframe");
		iframe.sandbox.add("allow-scripts");
		iframe.hidden = true;
		iframe.setAttribute("aria-hidden", "true");
		const channel = new MessageChannel();
		let settled = false;
		let connected = false;
		let started = false;
		let disposing = false;
		let removed = false;
		let disposeTimer: ReturnType<typeof setTimeout> | undefined;
		const removeRealm = () => {
			if (removed) return;
			removed = true;
			clearTimeout(disposeTimer);
			channel.port1.close();
			channel.port2.close();
			iframe.onload = null;
			iframe.remove();
			releaseOwner();
		};
		realmStarted = true;
		const cleanup = () => {
			if (disposing) return;
			disposing = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			if (!connected) {
				removeRealm();
				return;
			}
			const dispose: MvNativeDispose = {
				protocol: MV_NATIVE_PROTOCOL,
				requestId,
				type: "dispose",
			};
			// Let the interpreter unwind at its next cooperative boundary. A lost
			// acknowledgement still destroys this private realm after a bounded
			// grace period; neither deadline can preempt one synchronous draw call.
			disposeTimer = setTimeout(removeRealm, 250);
			try {
				channel.port1.postMessage(dispose);
			} catch {
				removeRealm();
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
			() => fail(Error("Native MV frame timed out after 5000 ms")),
			5000,
		);
		signal?.addEventListener("abort", abort, { once: true });
		channel.port1.onmessageerror = () =>
			fail(Error("Invalid native MV message transport"));
		channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
			const bitmap =
				data && typeof data === "object" ? Reflect.get(data, "bitmap") : null;
			if (
				disposing &&
				isMvNativeEnvelope(data, requestId) &&
				data.type === "disposed"
			) {
				if (bitmap instanceof ImageBitmap) bitmap.close();
				removeRealm();
				return;
			}
			if (settled) {
				if (bitmap instanceof ImageBitmap) bitmap.close();
				return;
			}
			if (!isMvNativeEnvelope(data, requestId)) {
				if (bitmap instanceof ImageBitmap) bitmap.close();
				fail(Error("Invalid native MV response identity"));
				return;
			}
			if (
				data.type === "ready" &&
				!started &&
				!(bitmap instanceof ImageBitmap)
			) {
				started = true;
				const request: MvNativeRequest = {
					protocol: MV_NATIVE_PROTOCOL,
					requestId,
					type: "render",
					input,
				};
				try {
					channel.port1.postMessage(request);
				} catch (error) {
					fail(error);
				}
				return;
			}
			if (bitmap instanceof ImageBitmap) {
				if (
					!started ||
					data.type !== "rendered" ||
					bitmap.width !== input.width ||
					bitmap.height !== input.height
				) {
					bitmap.close();
					fail(Error("Invalid native MV output dimensions or operation"));
					return;
				}
				settled = true;
				cleanup();
				resolve(bitmap);
				return;
			}
			fail(
				Error(
					data.type === "error"
						? `Native MV frame failed: ${String(Reflect.get(data, "error")).slice(0, 2000)}`
						: "Invalid native MV response operation",
				),
			);
		};
		iframe.onload = () => {
			if (settled || connected) return;
			connected = true;
			try {
				if (!iframe.contentWindow) throw Error("Native MV iframe unavailable");
				iframe.contentWindow.postMessage(
					{ type: MV_NATIVE_CONNECT, requestId },
					"*",
					[channel.port2],
				);
			} catch (error) {
				fail(error);
			}
		};
		iframe.srcdoc = MV_NATIVE_DOCUMENT;
		try {
			if (signal?.aborted) abort();
			else document.body.appendChild(iframe);
		} catch (error) {
			fail(error);
		}
	}).finally(() => {
		if (!realmStarted) releaseOwner();
	});
}
