import { expect, test } from "bun:test";
import {
	publishInkExportVideo,
	validateInkExportVideoSize,
	INK_EXPORT_VIDEO_MAX_BYTES,
} from "./mv-ink-export-video";

test("Ink binary transport validates bounds without allocating oversized media", () => {
	for (const size of [
		0,
		3,
		-1,
		1.2,
		Number.NaN,
		INK_EXPORT_VIDEO_MAX_BYTES + 1,
	])
		expect(() => validateInkExportVideoSize(size)).toThrow();
	expect(() =>
		validateInkExportVideoSize(INK_EXPORT_VIDEO_MAX_BYTES),
	).not.toThrow();
	expect(() => validateInkExportVideoSize(256 * 1024 * 1024 + 1)).not.toThrow();
});
test("Ink download returns metadata only and revokes URL after host acknowledgement", async () => {
	const buffer = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]).buffer,
		calls: string[] = [];
	const result = await publishInkExportVideo({
		buffer,
		host: {
			createUrl: (blob) => {
				expect(blob.size).toBe(8);
				expect(blob.type).toBe("video/webm");
				calls.push("blob");
				return "blob:fixture";
			},
			revokeUrl: (url) => {
				expect(url).toBe("blob:fixture");
				calls.push("revoke");
			},
			download: (request) => {
				expect(request.fileName).toBe("ink.webm");
				calls.push("download");
				return () => {
					calls.push("remove");
				};
			},
		},
		accept: async (metadata) => {
			expect(metadata.byteLength).toBe(8);
			expect(metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
			calls.push("ack");
		},
	});
	expect(calls).toEqual(["blob", "download", "ack", "remove", "revoke"]);
	expect(Object.keys(result).sort()).toEqual([
		"byteLength",
		"fileName",
		"mimeType",
		"sha256",
		"transport",
	]);
});
test("Ink failed binary save acknowledgement still revokes owned object URL", async () => {
	const calls: string[] = [];
	await expect(
		publishInkExportVideo({
			buffer: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]).buffer,
			host: {
				createUrl: () => "blob:fixture",
				revokeUrl: () => {
					calls.push("revoke");
				},
				download: () => () => {
					calls.push("remove");
				},
			},
			accept: async () => {
				throw Error("save failed");
			},
		}),
	).rejects.toThrow("save failed");
	expect(calls).toEqual(["remove", "revoke"]);
});
test("Ink still rejects non-EBML bytes before publishing any object URL", async () => {
	let created = false;
	await expect(
		publishInkExportVideo({
			buffer: new Uint8Array([0, 0, 0, 0]).buffer,
			host: {
				createUrl: () => {
					created = true;
					return "blob:fixture";
				},
				revokeUrl: () => {},
				download: () => () => {},
			},
			accept: async () => {
				throw Error("Unexpected invalid-binary acknowledgement");
			},
		}),
	).rejects.toThrow("EBML");
	expect(created).toBe(false);
});
