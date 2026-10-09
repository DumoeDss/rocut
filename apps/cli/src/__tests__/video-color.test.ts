import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { resolveProgrammaticFrameJson } from "opencut-wasm";
import { decodeNativeVideoFrame } from "../programmatic/video-decoder";
import { nativeVideoColorFilters } from "../programmatic/video-color";
import { createHdrVideoFixture, readHdrPixels } from "../../../../script/fixtures/hdr-video-fixture";
import { HDR_LUMA_CODES, hdrReference, HDR_COLOR_CODES, hdrColorReference } from "../../../../script/fixtures/hdr-pixel-oracle";

const ffmpeg = process.env.ROCUT_TEST_FFMPEG, ffprobe = process.env.ROCUT_TEST_FFPROBE;

test("HDR conversion requires explicit metadata, while SDR and explicit opt-out retain their original path", () => {
	expect(() => nativeVideoColorFilters({ color_transfer: "smpte2084" }, true)).toThrow("explicit supported primaries");
	expect(nativeVideoColorFilters({ color_transfer: "smpte2084" }, false)).toEqual([]);
	expect(nativeVideoColorFilters({ color_transfer: "bt709" }, true)).toEqual([]);
	expect(() => nativeVideoColorFilters({ color_transfer: "arib-std-b67", color_primaries: "bt2020", color_space: "bt2020nc" }, true)).toThrow("range metadata");
});

test.skipIf(!ffmpeg || !ffprobe)("real PQ/HLG video maps to bounded SDR pixels, honors toneMapped=false and preserves encoded alpha", async () => {
	const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, "rocut-hdr-test-"));
	try {
		const { frame } = JSON.parse(resolveProgrammaticFrameJson(JSON.stringify({
			source: { version: 1, runtime: "html-document", code: "<div></div>", width: 64, height: 64,
				frameRate: { numerator: 30, denominator: 1 }, durationFrames: 60, seed: 7 },
			clipStart: 0, clipDuration: 240000, trimStart: 0, timelineTime: 0,
		})));
		const decode = (body: Uint8Array, toneMapped: boolean, transparent = true) => decodeNativeVideoFrame({
			decoder: { ffmpeg: ffmpeg!, ffprobe: ffprobe! }, body, mimeType: "video/webm", seconds: 0, transparent, toneMapped,
			limits: frame.videoLimits, signal: AbortSignal.timeout(15000), selection: "nearest",
		});
		for (const transfer of ["smpte2084", "arib-std-b67"] as const) {
			const fixture = await createHdrVideoFixture(root, ffmpeg!, transfer);
			const mapped = await readHdrPixels(root, (await decode(fixture.body, true)).png, ffmpeg!);
			const raw = await readHdrPixels(root, (await decode(fixture.body, false)).png, ffmpeg!);
			const levels = HDR_LUMA_CODES.map((_, band) => mapped[(8 * 64 + band * 10 + 5) * 4]);
			const unmapped = HDR_LUMA_CODES.map((_, band) => raw[(8 * 64 + band * 10 + 5) * 4]);
			console.log(`HDR ${transfer}: mapped ${levels}; unmapped ${unmapped}`);
			expect(levels[0]).toBeLessThanOrEqual(1); expect(levels[5]).toBeGreaterThanOrEqual(250);
			expect(levels.every((v, i) => i === 0 || v >= levels[i - 1])).toBe(true);
			expect(levels.some((v, i) => Math.abs(v - unmapped[i]) > (transfer === "smpte2084" ? 20 : 1))).toBe(true);
			for (const [i, code] of HDR_LUMA_CODES.entries()) expect(Math.abs(levels[i] - hdrReference(code, transfer))).toBeLessThanOrEqual(2);
			expect(mapped.every((value, i) => i % 4 !== 3 || value === 255)).toBe(true);
			const opaque = await readHdrPixels(root, (await decode(fixture.body, true, false)).png, ffmpeg!);
			expect(opaque.equals(mapped)).toBe(true);
			const alphaFixture = await createHdrVideoFixture(root, ffmpeg!, transfer, true);
			const alpha = await readHdrPixels(root, (await decode(alphaFixture.body, true)).png, ffmpeg!);
			const reference = await alphaFixture.run(["-c:v", "libvpx-vp9", "-i", alphaFixture.file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], 8192);
			expect(alpha.every((value, i) => i % 4 !== 3 || value === reference[i])).toBe(true);
			expect(alpha[(8 * 64 + 40) * 4 + 3]).toBeGreaterThan(120); expect(alpha[(8 * 64 + 40) * 4 + 3]).toBeLessThan(140);
			const colorFixture = await createHdrVideoFixture(root, ffmpeg!, transfer, false, true);
			for (const toneMapped of [false, true]) {
				const rgb = await readHdrPixels(root, (await decode(colorFixture.body, toneMapped)).png, ffmpeg!);
				for (const [band, codes] of HDR_COLOR_CODES.entries()) {
					const expected = hdrColorReference(codes, transfer, toneMapped), offset = (8 * 64 + band * 10 + 5) * 4;
					for (let channel = 0; channel < 3; channel++) expect(Math.abs(rgb[offset + channel] - expected[channel])).toBeLessThanOrEqual(2);
				}
			}
		}
	} finally {
		if (dirname(root) !== parent || !basename(root).startsWith("rocut-hdr-test-")) throw Error("Unsafe HDR fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
}, 30000);
