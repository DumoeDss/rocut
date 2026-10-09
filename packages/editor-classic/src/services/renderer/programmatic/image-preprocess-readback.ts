import type {
	MvImagePreprocessRequest,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { ImageDecodeAdmission } from "./image-dimensions-contract";
import { IMAGE_PREPROCESS_DOCUMENT } from "./image-preprocess-document";

export interface ImagePreprocessReadbackInput {
	request: MvImagePreprocessRequest;
	item: ResolvedProgrammaticResource;
	admission: ImageDecodeAdmission;
	limits: { readonly maxDimension: number; readonly maxDecodedBytes: number };
}

/** Fresh private realm for each readback, never a persistent decoded image cache. */
export function readImagePreprocessRgba({
	input,
	signal,
	onDisposed,
}: {
	input: ImagePreprocessReadbackInput;
	signal: AbortSignal;
	onDisposed?: () => void;
}): Promise<Uint8Array> {
	if (signal.aborted) {
		onDisposed?.();
		signal.throwIfAborted();
	}
	let realmCreated = false;
	return new Promise<Uint8Array>((resolve, reject) => {
		const iframe = document.createElement("iframe"),
			channel = new MessageChannel();
		const id = crypto.randomUUID();
		iframe.sandbox.add("allow-scripts");
		iframe.hidden = true;
		let settled = false,
			connected = false,
			started = false;
		let grace: ReturnType<typeof setTimeout> | undefined;
		let removed = false;
		const remove = () => {
			if (removed) return;
			removed = true;
			clearTimeout(grace);
			channel.port1.close();
			channel.port2.close();
			iframe.remove();
			onDisposed?.();
		};
		realmCreated = true;
		const finish = ({
			error,
			rgba,
		}: {
			error?: unknown;
			rgba?: Uint8Array;
		}) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			if (connected) {
				grace = setTimeout(remove, 250);
				try {
					channel.port1.postMessage({ id, type: "dispose" });
				} catch {
					remove();
				}
			} else remove();
			if (error !== undefined) reject(error);
			else resolve(rgba!);
		};
		const abort = () => finish({ error: signal.reason });
		const timer = setTimeout(
			() =>
				finish({
					error: Error("Image preprocessing readback timed out after 5000 ms"),
				}),
			5000,
		);
		signal.addEventListener("abort", abort, { once: true });
		channel.port1.onmessageerror = () =>
			finish({ error: Error("Invalid preprocessing transport") });
		channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
			if (!data || typeof data !== "object" || Reflect.get(data, "id") !== id) {
				finish({ error: Error("Invalid preprocessing response identity") });
				return;
			}
			const type = Reflect.get(data, "type");
			if (settled) {
				if (type === "disposed") remove();
				return;
			}
			if (type === "ready" && !started) {
				started = true;
				channel.port1.postMessage({ id, type: "readback", input });
				return;
			}
			const bytes: unknown = Reflect.get(data, "rgba"),
				{ binding, roi } = input.request;
			if (
				type === "rgba" &&
				started &&
				bytes instanceof ArrayBuffer &&
				bytes.byteLength === roi.width * roi.height * 4 &&
				Reflect.get(data, "width") === binding.width &&
				Reflect.get(data, "height") === binding.height
			)
				finish({ rgba: new Uint8Array(bytes) });
			else
				finish({
					error: Error(
						type === "error"
							? String(Reflect.get(data, "error"))
							: "Invalid preprocessing response",
					),
				});
		};
		iframe.onload = () => {
			if (settled || connected) return;
			connected = true;
			try {
				iframe.contentWindow!.postMessage(
					{ type: "rocut-image-preprocess-connect-v1", id },
					"*",
					[channel.port2],
				);
			} catch (error) {
				finish({ error });
			}
		};
		iframe.srcdoc = IMAGE_PREPROCESS_DOCUMENT;
		try {
			if (signal.aborted) abort();
			else document.body.appendChild(iframe);
		} catch (error) {
			finish({ error });
		}
	}).catch((error) => {
		if (!realmCreated) onDisposed?.();
		throw error;
	});
}
