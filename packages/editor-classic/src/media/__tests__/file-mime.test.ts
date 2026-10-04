import { describe, expect, test } from "bun:test";
import { getMediaTypeFromFile, normalizeMediaFile } from "../media-utils";

describe("platform file-picker MIME normalization", () => {
	for (const [extension, mime, kind] of [
		["mp4", "video/mp4", "video"],
		["mov", "video/quicktime", "video"],
		["mkv", "video/x-matroska", "video"],
		["webm", "video/webm", "video"],
		["wav", "audio/wav", "audio"],
		["mp3", "audio/mpeg", "audio"],
		["flac", "audio/flac", "audio"],
		["ogg", "audio/ogg", "audio"],
		["opus", "audio/ogg", "audio"],
		["m4a", "audio/mp4", "audio"],
		["png", "image/png", "image"],
		["jpg", "image/jpeg", "image"],
		["jpeg", "image/jpeg", "image"],
		["webp", "image/webp", "image"],
	]) {
		for (const type of ["", "application/octet-stream"]) {
			test(
				extension +
					" preserves exact bytes/name/mtime from " +
					(type || "empty MIME"),
				async () => {
					const file = new File(
						[new Uint8Array([0, 255, 17, 128])],
						"素材 file." + extension.toUpperCase(),
						{ type, lastModified: 123456 },
					);
					const normalized = normalizeMediaFile({ file });
					expect(normalized.type).toBe(mime);
					expect(normalized.name).toBe(file.name);
					expect(normalized.lastModified).toBe(file.lastModified);
					expect(new Uint8Array(await normalized.arrayBuffer())).toEqual(
						new Uint8Array(await file.arrayBuffer()),
					);
					expect(getMediaTypeFromFile({ file })).toBe(kind);
					expect(getMediaTypeFromFile({ file: normalized })).toBe(kind);
				},
			);
		}
	}
	test("recognized MIME is authoritative, even with a misleading extension", () => {
		const file = new File(["bytes"], "audio.mp4", { type: "audio/mpeg" });
		expect(normalizeMediaFile({ file })).toBe(file);
		expect(getMediaTypeFromFile({ file })).toBe("audio");
	});
	test("explicit non-media MIME is never overridden by an extension", () => {
		for (const type of ["text/html", "application/javascript", "text/plain"]) {
			const file = new File(["bytes"], "clip.mp4", { type });
			expect(normalizeMediaFile({ file })).toBe(file);
			expect(getMediaTypeFromFile({ file })).toBeNull();
		}
	});
	test("unknown, missing and misleading trailing extensions stay rejected", () => {
		for (const name of [
			"mp4",
			"clip",
			"clip.mp4.exe",
			"clip.unknown",
			"clip.",
			"clip.mp4 ",
			"clip.constructor",
			"clip.__proto__",
		]) {
			const file = new File(["bytes"], name, {
				type: "application/octet-stream",
			});
			expect(normalizeMediaFile({ file })).toBe(file);
			expect(getMediaTypeFromFile({ file })).toBeNull();
		}
	});
});
