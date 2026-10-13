import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	lstat,
	mkdtemp,
	readFile,
	readdir,
	stat,
	rm,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoPoster, type VideoPosterInput } from "../video-poster";
import { runVideoPosterCli } from "../video-poster-cli";
import { posterDigest, posterPaths } from "../video-poster-files";
import { runVideoDecoderProcess } from "../programmatic/video-decoder-process";

const decoder = {
	ffmpeg: process.env.ROCUT_TEST_FFMPEG_PATH ?? "",
	ffprobe: process.env.ROCUT_TEST_FFPROBE_PATH ?? "",
};
const ownedRoots: string[] = [];
const ownedLinks: string[] = [];
async function ownedFixture(prefix: string) {
	const root = await mkdtemp(join(tmpdir(), prefix));
	ownedRoots.push(root);
	return root;
}
afterEach(async () => {
	for (const link of ownedLinks.splice(0)) {
		if (
			!ownedRoots.some((root) => dirname(link) === root) ||
			!(await lstat(link)).isSymbolicLink()
		)
			throw Error("Unsafe fixture link cleanup");
		await unlink(link);
	}
	for (const root of ownedRoots.splice(0)) {
		if (
			dirname(root) !== resolve(tmpdir()) ||
			!(await lstat(root)).isDirectory() ||
			(await lstat(root)).isSymbolicLink()
		)
			throw Error("Unsafe fixture cleanup");
		await rm(root, { recursive: true });
	}
});
async function fixture(width = 1280, height = 720) {
	const projectRoot = await ownedFixture("rocut-poster-synthetic-"),
		sourceRelativePath = "source.mp4";
	const args = [
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"lavfi",
		"-i",
		`color=c=red:s=${width}x${height}:r=10:d=0.1`,
		"-f",
		"lavfi",
		"-i",
		`color=c=blue:s=${width}x${height}:r=10:d=0.1`,
		"-filter_complex",
		"[0:v][1:v]concat=n=2:v=1:a=0",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-threads",
		"1",
		join(projectRoot, sourceRelativePath),
	];
	const result = spawnSync(decoder.ffmpeg, args, {
		windowsHide: true,
		timeout: 10000,
	});
	if (result.status !== 0)
		throw Error(result.stderr?.toString() ?? "Synthetic ffmpeg fixture failed");
	const sourceSha256 = createHash("sha256")
		.update(await readFile(join(projectRoot, sourceRelativePath)))
		.digest("hex");
	return {
		projectRoot,
		sourceRelativePath,
		sourceSha256,
		destinationRelativePath: `.elftia/creator/posters/${sourceSha256}/frame-0.png`,
	} satisfies VideoPosterInput;
}
describe.skipIf(!decoder.ffmpeg || !decoder.ffprobe)(
	"offline first-frame poster",
	() => {
		it("really extracts red frame zero at 512x288 and reuses verified immutable output", async () => {
			const input = await fixture();
			const result = await createVideoPoster(input, { decoder });
			expect(result).toMatchObject({
				status: "completed",
				width: 512,
				height: 288,
				sourceTime: 0,
				sourceSha256: input.sourceSha256,
				mimeType: "image/png",
			});
			if (result.status !== "completed") throw Error("Missing real poster");
			const file = join(input.projectRoot, result.relativePath),
				bytes = await readFile(file),
				before = await stat(file);
			expect(result.sha256).toBe(posterDigest(bytes));
			expect(result.sizeBytes).toBe(bytes.length);
			const pixels = spawnSync(
				decoder.ffmpeg,
				[
					"-hide_banner",
					"-loglevel",
					"error",
					"-i",
					file,
					"-frames:v",
					"1",
					"-f",
					"rawvideo",
					"-pix_fmt",
					"rgb24",
					"pipe:1",
				],
				{ windowsHide: true, maxBuffer: 1024 * 1024, timeout: 10000 },
			);
			expect(pixels.status).toBe(0);
			expect(pixels.stdout[0]).toBeGreaterThan(240);
			expect(pixels.stdout[1]).toBeLessThan(10);
			expect(pixels.stdout[2]).toBeLessThan(10);
			expect(
				await createVideoPoster(input, {
					decoder: { ffmpeg: process.execPath, ffprobe: process.execPath },
				}),
			).toEqual(result);
			expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);
			expect(
				(
					await readdir(
						join(
							input.projectRoot,
							`.elftia/creator/posters/${input.sourceSha256}`,
						),
					)
				).sort(),
			).toEqual(["frame-0.png", "frame-0.png.proof.json"]);
		});
		it("does not upscale a 64x32 source", async () => {
			expect(
				await createVideoPoster(await fixture(64, 32), { decoder }),
			).toMatchObject({ status: "completed", width: 64, height: 32 });
		});
		it("missing decoder is unavailable and no output directory is created", async () => {
			const input = await fixture();
			expect(await createVideoPoster(input)).toMatchObject({
				status: "unavailable",
			});
			expect(await readdir(input.projectRoot)).toEqual(["source.mp4"]);
			expect(
				await createVideoPoster(input, {
					decoder: {
						ffmpeg: join(input.projectRoot, "missing-ffmpeg.exe"),
						ffprobe: decoder.ffprobe,
					},
				}),
			).toMatchObject({ status: "unavailable" });
		});
		it("refuses a changed source pin and never overwrites an existing corrupted poster", async () => {
			const input = await fixture();
			await expect(
				createVideoPoster(
					{
						...input,
						sourceSha256: "a".repeat(64),
						destinationRelativePath: `.elftia/creator/posters/${"a".repeat(64)}/frame-0.png`,
					},
					{ decoder },
				),
			).rejects.toThrow("SHA256");
			await createVideoPoster(input, { decoder });
			const file = join(input.projectRoot, input.destinationRelativePath);
			const corrupted = Buffer.from("wrong bytes");
			await writeFile(file, corrupted);
			await expect(createVideoPoster(input, { decoder })).rejects.toThrow(
				"PNG",
			);
			expect(await readFile(file)).toEqual(corrupted);
		});
		it.each([
			"../source.mp4",
			"C:/secret.mp4",
			"https://evil/video.mp4",
			"a\\b.mp4",
			"./source.mp4",
		])("rejects uncontained source %s", async (sourceRelativePath) => {
			const input = await fixture(64, 32);
			await expect(
				posterPaths({ ...input, sourceRelativePath }),
			).rejects.toThrow();
		});
		it("rejects redirected source and destination directories", async () => {
			const input = await fixture(64, 32),
				outside = await ownedFixture("rocut-poster-outside-");
			await symlink(outside, join(input.projectRoot, "redirected"), "junction");
			ownedLinks.push(join(input.projectRoot, "redirected"));
			await expect(
				posterPaths({ ...input, sourceRelativePath: "redirected/source.mp4" }),
			).rejects.toThrow("redirected");
			await symlink(outside, join(input.projectRoot, ".elftia"), "junction");
			ownedLinks.push(join(input.projectRoot, ".elftia"));
			await expect(createVideoPoster(input, { decoder })).rejects.toThrow(
				"redirected",
			);
			expect(await readdir(outside)).toEqual([]);
		});
		it("fixed stdin CLI handles capabilities/create without any live target and rejects runtime flags", async () => {
			vi.stubEnv("ROCUT_NATIVE_FFMPEG_PATH", decoder.ffmpeg);
			vi.stubEnv("ROCUT_NATIVE_FFPROBE_PATH", decoder.ffprobe);
			try {
				const output = vi.fn();
				await runVideoPosterCli(["capabilities"], { output });
				expect(JSON.parse(output.mock.calls[0][0])).toEqual({
					status: "available",
					capability: "offline-video-poster-v1",
				});
				output.mockClear();
				const input = await fixture(64, 32);
				await runVideoPosterCli(["create"], {
					input: Readable.from([Buffer.from(JSON.stringify(input) + "\n")]),
					output,
				});
				expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
					status: "completed",
					width: 64,
				});
				await expect(
					runVideoPosterCli(["create", "--ffmpeg", decoder.ffmpeg]),
				).rejects.toThrow("usage");
				await expect(
					createVideoPoster(
						{ ...input, decoder: "forged" } as VideoPosterInput,
						{
							decoder,
						},
					),
				).rejects.toThrow("fixed");
			} finally {
				vi.unstubAllEnvs();
			}
		});
		it("real decoder child cancellation waits for exit and bounded service timeout leaves no temp output", async () => {
			const controller = new AbortController();
			setTimeout(() => controller.abort(), 50);
			await expect(
				runVideoDecoderProcess({
					executable: process.execPath,
					args: ["-e", "setTimeout(()=>{},20000)"],
					signal: controller.signal,
					maxBytes: 1024,
				}),
			).rejects.toThrow("cancelled");
			const input = await fixture();
			await expect(
				createVideoPoster(input, { decoder, timeoutMs: 1 }),
			).rejects.toThrow();
			const dirs = await readdir(input.projectRoot, { recursive: true });
			expect(
				dirs.some(
					(file) =>
						String(file).endsWith(".tmp") ||
						String(file).endsWith("frame-0.png"),
				),
			).toBe(false);
		});
	},
);
