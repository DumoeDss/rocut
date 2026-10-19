import { expect, test } from "bun:test";
import { nativePreviewDataUrl } from "../preview-native-frame";

test("rejects unbounded or malformed native PNG before any browser allocation", async () => {
	for (const body of [
		new ArrayBuffer(0),
		new ArrayBuffer(1024 * 1024 + 1),
		new ArrayBuffer(24),
	]) {
		await expect(
			nativePreviewDataUrl({
				frame: { body, mimeType: "image/png" },
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("Invalid native preview payload");
	}
	const body = new ArrayBuffer(24),
		view = new DataView(body);
	view.setUint32(0, 0x89504e47);
	view.setUint32(4, 0x0d0a1a0a);
	view.setUint32(12, 0x49484452);
	view.setUint32(16, 513);
	view.setUint32(20, 1);
	await expect(
		nativePreviewDataUrl({
			frame: { body, mimeType: "image/png" },
			signal: new AbortController().signal,
		}),
	).rejects.toThrow("dimensions");
});
