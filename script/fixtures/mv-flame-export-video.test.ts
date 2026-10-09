import { expect, test } from "bun:test";
import {
	publishFlameExportVideo,
	validateFlameExportVideoSize,
	FLAME_EXPORT_VIDEO_MAX_BYTES,
} from "./mv-flame-export-video";

test("Flame binary transport validates bounds without allocating oversized media", () => {
	for (const size of [
		0,
		3,
		-1,
		1.2,
		Number.NaN,
		FLAME_EXPORT_VIDEO_MAX_BYTES + 1,
	])
		expect(() => validateFlameExportVideoSize(size)).toThrow();
	expect(() =>
		validateFlameExportVideoSize(FLAME_EXPORT_VIDEO_MAX_BYTES),
	).not.toThrow();
});
test("Flame download returns metadata only and revokes URL after host acknowledgement", async () => {
	const buffer = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]).buffer,
		calls: string[] = [];
	const result = await publishFlameExportVideo({
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
				expect(request.fileName).toBe("flame.webm");
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
test("Flame failed binary save acknowledgement still revokes owned object URL", async () => {
	const calls: string[] = [];
	await expect(
		publishFlameExportVideo({
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
