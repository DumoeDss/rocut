import { renderThumbnailDataUrl } from "./thumbnail";

/** Native results remain disposable derived bytes, never project attachments. */
export async function nativePreviewDataUrl({
	frame,
	signal,
}: {
	frame: { body: ArrayBuffer; mimeType: "image/png" };
	signal: AbortSignal;
}): Promise<string> {
	signal.throwIfAborted();
	const bytes = new Uint8Array(frame.body);
	const view = new DataView(frame.body);
	if (
		frame.mimeType !== "image/png" ||
		bytes.length < 24 ||
		bytes.length > 1024 * 1024 ||
		view.getUint32(0) !== 0x89504e47 ||
		view.getUint32(4) !== 0x0d0a1a0a ||
		view.getUint32(12) !== 0x49484452
	)
		throw new Error("Invalid native preview payload");
	const width = view.getUint32(16),
		height = view.getUint32(20);
	if (!width || !height || width > 512 || height > 512)
		throw new Error("Native preview dimensions exceed the bounded profile");
	const bitmap = await createImageBitmap(
		new Blob([frame.body], { type: "image/png" }),
	);
	try {
		signal.throwIfAborted();
		return renderThumbnailDataUrl({
			width: Math.min(240, width),
			height: (Math.min(240, width) * height) / width,
			draw: ({ context, width: outputWidth, height: outputHeight }) =>
				context.drawImage(bitmap, 0, 0, outputWidth, outputHeight),
		});
	} finally {
		bitmap.close();
	}
}
