import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { resolveProgrammaticFrameJson } from "opencut-wasm";
import { decodeNativeVideoFrame } from "../programmatic/video-decoder";
import { runVideoDecoderProcess } from "../programmatic/video-decoder-process";
import { nativeVideoFixture } from "../../../../script/fixtures/native-video-fixture.mjs";

const signal = () => new AbortController().signal;
const child = (script: string, extra = {}) => runVideoDecoderProcess({
	executable: process.execPath, args: ["--eval", script], signal: signal(), maxBytes: 1024, ...extra,
});
test("decoder subprocess bounds output/runtime, cancels and recovers without inheriting application env", async () => {
	await expect(child('process.stdout.write("x".repeat(2048))')).rejects.toThrow("output limit");
	await expect(child('while(true){}', { timeoutMs: 100 })).rejects.toThrow("timed out");
	const abort = new AbortController();
	const pending = child('while(true){}', { signal: abort.signal });
	setTimeout(() => abort.abort(), 100);
	await expect(pending).rejects.toThrow("cancelled");
	process.env.ROCUT_DECODER_TEST_SECRET = "synthetic-value";
	try { expect((await child('process.stdout.write(process.env.ROCUT_DECODER_TEST_SECRET || "absent")')).toString()).toBe("absent"); }
	finally { delete process.env.ROCUT_DECODER_TEST_SECRET; }
	expect((await child('process.stdout.write("recovered")')).toString()).toBe("recovered");
});

const ffmpeg = process.env.ROCUT_TEST_FFMPEG;
const ffprobe = process.env.ROCUT_TEST_FFPROBE;
test.skipIf(!ffmpeg || !ffprobe)("native frame decode uses exact PTS, reverse/random access, EOF hold and bounded input", async () => {
	const root = await mkdtemp(join(tmpdir(), "rocut-decoder-test-"));
	const before = new Set((await readdir(tmpdir())).filter(n => n.startsWith("rocut-native-decode-")));
	const source = { version: 1, runtime: "html-document", code: "<div></div>", width: 64, height: 64,
		frameRate: { numerator: 100, denominator: 1 }, durationFrames: 200, seed: 7 };
	const { frame } = JSON.parse(resolveProgrammaticFrameJson(JSON.stringify({ source, clipStart: 0, clipDuration: 240000, trimStart: 0, timelineTime: 0 })));
	const limits = frame.videoLimits;
	const body = await nativeVideoFixture(100);
	const decode = (seconds: number, extra = {}) => decodeNativeVideoFrame({
		decoder: { ffmpeg: ffmpeg!, ffprobe: ffprobe! }, body, mimeType: "video/webm", seconds,
		transparent: true, signal: signal(), limits, ...extra,
	});
	try {
		for (const [time, expected] of [[.235, 23], [.01, 1], [.07999999999999999, 8], [.599, 59], [10, 59], [0, 0], [.235, 23]]) {
			const result = await decode(time);
			expect(result).toMatchObject({ index: expected, sourceTime: expected / 100, width: 64, height: 32 });
			const png = join(root, "frame.png");
			await writeFile(png, result.png);
			const raw = await runVideoDecoderProcess({ executable: ffmpeg!, signal: signal(), maxBytes: 8192,
				args: ["-v", "error", "-nostdin", "-i", png, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"] });
			let actual = 0;
			for (let bit = 0; bit < 6; bit++) {
				const offset = (8 * 64 + bit * 8 + 4) * 4;
				expect(raw[offset + 3]).toBe(255);
				if (raw[offset] > 230) actual |= 1 << bit;
			}
			expect(actual).toBe(expected);
		}
		await expect(decode(-1)).rejects.toThrow("finite and nonnegative");
		await expect(decode(NaN)).rejects.toThrow("finite and nonnegative");
		await expect(decode(Number.MAX_VALUE)).rejects.toThrow("not representable");
		await expect(decode(0, { selection: "unknown" })).rejects.toThrow("selection");
		await expect(decode(0, { limits: { ...limits, maxBytes: 1 } })).rejects.toThrow("byte limit");
		await expect(decode(0, { limits: { ...limits, maxDimension: 16 } })).rejects.toThrow("decode limits");
		await expect(decode(0, { body: new Uint8Array([1, 2, 3]) })).rejects.toThrow("decoder failed");
		await expect(decode(0, { body: new TextEncoder().encode("#EXTM3U\nfile:///private.mp4") })).rejects.toThrow("decoder failed");
		const abort = new AbortController(); abort.abort();
		await expect(decode(0, { signal: abort.signal })).rejects.toThrow();
		expect((await decode(.12)).index).toBe(12);
		expect((await readdir(tmpdir())).filter(n => n.startsWith("rocut-native-decode-") && !before.has(n))).toEqual([]);
	} finally {
		if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith("rocut-decoder-test-")) throw Error("Unsafe fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
}, 30000);

test.skipIf(!ffmpeg || !ffprobe)("native decoder preserves VFR intervals, VP9 alpha and MP4 display rotation", async () => {
	const root = await mkdtemp(join(tmpdir(), "rocut-decoder-test-"));
	const run = (args: string[], maxBytes = 1024) => runVideoDecoderProcess({
		executable: ffmpeg!, args: ["-v", "error", "-nostdin", "-threads", "1", ...args], signal: signal(), maxBytes,
	});
	const { frame } = JSON.parse(resolveProgrammaticFrameJson(JSON.stringify({
		source: { version: 1, runtime: "html-document", code: "<div></div>", width: 64, height: 64,
			frameRate: { numerator: 100, denominator: 1 }, durationFrames: 200, seed: 7 },
		clipStart: 0, clipDuration: 240000, trimStart: 0, timelineTime: 0,
	})));
	const decode = (body: Uint8Array, seconds: number, mimeType: "video/webm" | "video/mp4" = "video/webm", selection: "containing" | "nearest" = "containing") => decodeNativeVideoFrame({
		decoder: { ffmpeg: ffmpeg!, ffprobe: ffprobe! }, body, mimeType, seconds,
		transparent: true, signal: signal(), limits: frame.videoLimits, selection,
	});
	try {
		const fast = join(root, "fast.webm"), vfr = join(root, "vfr.webm");
		await writeFile(fast, await nativeVideoFixture(100));
		await run(["-i", fast, "-vf", "select=lt(n\\,3),setpts=if(eq(N\\,0)\\,0\\,if(eq(N\\,1)\\,0.1/TB\\,0.4/TB))",
			"-fps_mode", "vfr", "-c:v", "libvpx-vp9", "-lossless", "1", "-threads", "1", vfr]);
		const vfrBody = await readFile(vfr);
		const offsetPath = join(root, "offset.webm");
		await run(["-i", fast, "-c", "copy", "-output_ts_offset", "2", offsetPath]);
		const offsetFrame = await decode(await readFile(offsetPath), .01);
		expect({ index: offsetFrame.index, sourceTime: offsetFrame.sourceTime }).toEqual({ index: 1, sourceTime: .01 });
		const containing = [[.05, 0, 0], [.1, 1, .1], [.35, 1, .1], [.4, 2, .4], [2, 2, .4]];
		const nearest = [[0, 0, 0], [.049, 0, 0], [.05, 1, .1], [.249, 1, .1], [.25, 2, .4], [.35, 2, .4], [2, 2, .4]];
		for (const selection of ["containing", "nearest"] as const) for (const [time, index, sourceTime] of selection === "nearest" ? nearest : containing) {
			const decoded = await decode(vfrBody, time, "video/webm", selection);
			expect(decoded).toMatchObject({ index, sourceTime });
			const png = join(root, "vfr.png"); await writeFile(png, decoded.png);
			const raw = await run(["-i", png, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], 8192);
			let actual = 0;
			for (let bit = 0; bit < 6; bit++) if (raw[(8 * 64 + bit * 8 + 4) * 4] > 230) actual |= 1 << bit;
			expect(actual).toBe(index);
		}
		const rgbaPath = join(root, "alpha.rgba"), alphaPath = join(root, "alpha.webm");
		const rgba = Buffer.alloc(64 * 32 * 4);
		for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
			const offset = (y * 64 + x) * 4;
			rgba[offset] = 255; rgba[offset + 3] = x < 32 ? 0 : 128;
		}
		await writeFile(rgbaPath, rgba);
		await run(["-f", "rawvideo", "-pix_fmt", "rgba", "-s", "64x32", "-r", "30", "-i", rgbaPath,
			"-c:v", "libvpx-vp9", "-lossless", "1", "-auto-alt-ref", "0", "-pix_fmt", "yuva420p", "-threads", "1", alphaPath]);
		const alpha = await decode(await readFile(alphaPath), 0);
		const pngPath = join(root, "alpha.png"); await writeFile(pngPath, alpha.png);
		const pixels = await run(["-i", pngPath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], 8192);
		const alphaReference = await run(["-c:v", "libvpx-vp9", "-i", alphaPath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], 8192);
		// The actual encoded alpha plane, not pre-encode RGBA, is the oracle.
		// This codec's limited/full-range conversion can turn authored 128 into 129.
		expect(pixels.equals(alphaReference)).toBe(true);
		expect(pixels[(16 * 64 + 8) * 4 + 3]).toBe(0);
		expect(Math.abs(pixels[(16 * 64 + 48) * 4 + 3] - 128)).toBeLessThanOrEqual(1);
		expect(pixels[(16 * 64 + 48) * 4]).toBeGreaterThan(245);
		const mp4 = join(root, "landscape.mp4"), portrait = join(root, "portrait.mp4");
		await run(["-i", fast, "-frames:v", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-threads", "1", mp4]);
		await run(["-i", mp4, "-c", "copy", "-metadata:s:v:0", "rotate=90", portrait]);
		expect(await decode(await readFile(portrait), .01, "video/mp4")).toMatchObject({ width: 32, height: 64, index: 1 });
		const hdr = join(root, "tagged-hdr.webm");
		await run(["-i", fast, "-frames:v", "1", "-c:v", "libvpx-vp9", "-color_trc", "smpte2084",
			"-color_primaries", "2", "-colorspace", "2", "-threads", "1", hdr]);
		await expect(decode(await readFile(hdr), 0)).rejects.toThrow("explicit supported primaries");
	} finally {
		if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith("rocut-decoder-test-")) throw Error("Unsafe fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
}, 30000);
