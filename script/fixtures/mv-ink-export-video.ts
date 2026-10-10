import { validateInkExportVideoSize } from "./mv-ink-export-video-policy.mjs";
export {
	INK_EXPORT_VIDEO_MAX_BYTES,
	validateInkExportVideoSize,
} from "./mv-ink-export-video-policy.mjs";
export interface InkExportVideoMetadata {
	fileName: "ink.webm";
	mimeType: "video/webm";
	byteLength: number;
	sha256: string;
	transport: "blob-download";
}
interface DownloadHost {
	createUrl: (blob: Blob) => string;
	revokeUrl: (url: string) => void;
	download: (request: { url: string; fileName: string }) => () => void;
}

function browserDownloadHost(): DownloadHost {
	return {
		createUrl: (blob) => URL.createObjectURL(blob),
		revokeUrl: (url) => URL.revokeObjectURL(url),
		download: ({ url, fileName }) => {
			const link = document.createElement("a");
			link.href = url;
			link.download = fileName;
			link.hidden = true;
			document.body.append(link);
			try {
				link.click();
			} catch (error) {
				link.remove();
				throw error;
			}
			return () => link.remove();
		},
	};
}

/** Encoded binary never becomes a number[] or a JSON/base64 media payload.
 * The host acknowledges saveAs plus independent stream hash before URL release.
 */
export async function publishInkExportVideo({
	buffer,
	accept,
	host = browserDownloadHost(),
}: {
	buffer: ArrayBuffer;
	accept: (metadata: InkExportVideoMetadata) => Promise<void>;
	host?: DownloadHost;
}): Promise<InkExportVideoMetadata> {
	if (!(buffer instanceof ArrayBuffer))
		throw Error("Ink export requires encoded ArrayBuffer, not JSON bytes");
	validateInkExportVideoSize(buffer.byteLength);
	const signature = new Uint8Array(buffer, 0, 4);
	if (
		signature[0] !== 0x1a ||
		signature[1] !== 0x45 ||
		signature[2] !== 0xdf ||
		signature[3] !== 0xa3
	)
		throw Error("Ink export is not an EBML/WebM binary");
	const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
	const sha256 = Array.from(hash, (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	const metadata: InkExportVideoMetadata = {
		fileName: "ink.webm",
		mimeType: "video/webm",
		byteLength: buffer.byteLength,
		sha256,
		transport: "blob-download",
	};
	const url = host.createUrl(new Blob([buffer], { type: metadata.mimeType }));
	let remove: (() => void) | undefined;
	try {
		remove = host.download({ url, fileName: metadata.fileName });
		await accept(metadata);
		return metadata;
	} finally {
		remove?.();
		host.revokeUrl(url);
	}
}
