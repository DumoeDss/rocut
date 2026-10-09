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

/** Only fresh canonical Rust admission can create a ticket. No source code,
 * caller-supplied frame or Worker message can select this DOM-backed seam.
 * The timeout is cooperative: a single synchronous Canvas call cannot be
 * hard-preempted on the iframe's event loop. The caller owns a returned bitmap.
 */
export async function runMvNativeRaster({
	ticket,
	signal,
}: {
	ticket: MvNativeRasterTicket;
	signal?: AbortSignal;
}): Promise<ImageBitmap> {
	signal?.throwIfAborted();
	const input = consumeMvNativeRasterTicket(ticket);
	if (typeof document === "undefined")
		throw Error("Native MV rasterization requires a browser document");
	const requestId = crypto.randomUUID();
	return new Promise((resolve, reject) => {
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
		};
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
	});
}
