import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runVideoDecoderProcess } from "../../apps/cli/src/programmatic/video-decoder-process";
import { HDR_LUMA_CODES, HDR_COLOR_CODES } from "./hdr-pixel-oracle";

export async function createHdrVideoFixture(root: string, ffmpeg: string, transfer: "smpte2084" | "arib-std-b67", alpha = false, colors = false) {
	const rawPath = join(root, `${transfer}-${alpha}-${colors}.raw`), file = join(root, `${transfer}-${alpha}-${colors}.webm`);
	const run = (args: string[], maxBytes = 1024) => runVideoDecoderProcess({ executable: ffmpeg,
		args: ["-v", "error", "-nostdin", "-threads", "1", ...args], signal: AbortSignal.timeout(10000), maxBytes });
	if (alpha) {
		// VP9's alpha path is 8-bit. Real encoded alpha is checked separately from
		// the authored plane because limited/full-range conversion can quantize it.
		const rgba = Buffer.alloc(64 * 32 * 4);
		for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
			const offset = (y * 64 + x) * 4;
			rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = 128;
			rgba[offset + 3] = x < 16 ? 0 : x < 32 ? 64 : x < 48 ? 128 : 255;
		}
		await writeFile(rawPath, rgba, { flag: "wx" });
		await run(["-f", "rawvideo", "-pix_fmt", "rgba", "-s", "64x32", "-r", "30", "-i", rawPath,
			"-c:v", "libvpx-vp9", "-lossless", "1", "-auto-alt-ref", "0", "-pix_fmt", "yuva420p", "-threads", "1",
			"-color_trc", transfer, "-color_primaries", "bt2020", "-colorspace", "bt2020nc", "-color_range", "tv", file]);
	} else {
		const raw = Buffer.alloc(64 * 32 * 3 * 2);
		for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
			const pixel = y * 64 + x;
			const band = Math.min(5, Math.floor(x / 10));
			raw.writeUInt16LE(colors ? HDR_COLOR_CODES[band][0] : HDR_LUMA_CODES[band], pixel * 2);
			raw.writeUInt16LE(colors ? HDR_COLOR_CODES[band][1] : 512, (64 * 32 + pixel) * 2);
			raw.writeUInt16LE(colors ? HDR_COLOR_CODES[band][2] : 512, (64 * 32 * 2 + pixel) * 2);
		}
		await writeFile(rawPath, raw, { flag: "wx" });
		await run(["-f", "rawvideo", "-pix_fmt", "yuv444p10le", "-s", "64x32", "-r", "30", "-i", rawPath,
			"-c:v", "libvpx-vp9", "-lossless", "1", "-pix_fmt", "yuv444p10le", "-threads", "1",
			"-color_trc", transfer, "-color_primaries", "bt2020", "-colorspace", "bt2020nc", "-color_range", "tv", file]);
	}
	return { file, body: await readFile(file), run };
}

export async function readHdrPixels(root: string, png: Buffer, ffmpeg: string): Promise<Buffer> {
	const file = join(root, "decoded.png");
	await writeFile(file, png);
	return runVideoDecoderProcess({ executable: ffmpeg, args: ["-v", "error", "-nostdin", "-i", file,
		"-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], signal: AbortSignal.timeout(8000), maxBytes: 64 * 64 * 4 });
}
