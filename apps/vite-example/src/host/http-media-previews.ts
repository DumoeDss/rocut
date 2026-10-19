import type { MediaPreviewProvider } from "@opencut/editor-ports/host";

const MAX_BYTES = 1024 * 1024;
type PreviewFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Capability-gated transport; an older/static host never receives frame requests. */
export function createHttpMediaPreviews({
	base = "api",
	fetchImpl = fetch,
}: {
	base?: string;
	fetchImpl?: PreviewFetch;
} = {}): MediaPreviewProvider {
	const endpoint = `${base.replace(/\/$/, "")}/media/preview`;
	let capability: Promise<boolean> | undefined;
	return {
		async renderFrame({ mediaId, sourceSha256, timeSeconds, signal }) {
			signal.throwIfAborted();
			capability ??= fetchImpl(endpoint, { signal: AbortSignal.timeout(5000) })
				.then(async (response) => {
					if (!response.ok) return false;
					const value: unknown = await response.json();
					return (
						!!value &&
						typeof value === "object" &&
						"version" in value &&
						value.version === 1 &&
						"available" in value &&
						value.available === true
					);
				})
				.catch(() => {
					capability = undefined;
					return false;
				});
			if (!(await capability)) return null;
			signal.throwIfAborted();
			const response = await fetchImpl(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ mediaId, sourceSha256, timeSeconds }),
				signal,
			});
			if (!response.ok) {
				await response.body?.cancel();
				throw Error(`Native media preview returned ${response.status}`);
			}
			const length = Number(response.headers.get("content-length"));
			if (
				response.headers.get("content-type") !== "image/png" ||
				response.headers.get("x-rocut-preview-version") !== "1" ||
				response.headers.get("x-rocut-source-sha256") !== sourceSha256 ||
				!Number.isSafeInteger(length) ||
				length < 33 ||
				length > MAX_BYTES
			) {
				await response.body?.cancel();
				throw Error("Invalid native media preview response");
			}
			const reader = response.body?.getReader();
			if (!reader) throw Error("Missing native media preview body");
			const body = new Uint8Array(length);
			let size = 0;
			try {
				while (true) {
					const next = await reader.read();
					signal.throwIfAborted();
					if (next.done) break;
					if (size + next.value.byteLength > length)
						throw Error("Oversized native media preview");
					body.set(next.value, size);
					size += next.value.byteLength;
				}
				if (size !== length) throw Error("Truncated native media preview");
				return { body: body.buffer, mimeType: "image/png" };
			} finally {
				await reader.cancel().catch(() => undefined);
				reader.releaseLock();
			}
		},
	};
}
