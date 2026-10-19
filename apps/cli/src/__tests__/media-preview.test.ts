import { expect, test } from "bun:test";
import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rm,
	writeFile,
	truncate,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMediaPreviewService } from "../media-preview";
import { posterDigest, posterPng } from "../video-poster-files";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

const fixture = (name: string) =>
	fileURLToPath(
		new URL(`../../../vite-example/tests/fixtures/${name}`, import.meta.url),
	);
const parent = resolve(process.env.ROCUT_TEST_OUTPUT_ROOT ?? tmpdir());
const fakeDecoder = { ffmpeg: process.execPath, ffprobe: process.execPath };
const signal = () => new AbortController().signal;

async function withFixture(
	run: (value: {
		root: string;
		directory: string;
		body: Buffer;
		png: Buffer;
		input: { mediaId: string; sourceSha256: string; timeSeconds: number };
	}) => Promise<void>,
) {
	const root = await mkdtemp(join(parent, "rocut-preview-test-"));
	try {
		const directory = join(root, "attachments", "media-test");
		await mkdir(directory, { recursive: true });
		const body = await readFile(fixture("fixture-video.mp4"));
		const png = await readFile(fixture("fixture-image.png"));
		await writeFile(join(directory, "body.bin"), body);
		await writeFile(
			join(directory, "metadata.json"),
			JSON.stringify({
				id: "media-test",
				type: "video",
				mimeType: "video/mp4",
			}),
		);
		await writeFile(join(root, "project.json"), "unchanged-project-marker");
		await run({
			root,
			directory,
			body,
			png,
			input: {
				mediaId: "media-test",
				sourceSha256: posterDigest(body),
				timeSeconds: 0.5,
			},
		});
	} finally {
		if (dirname(root) !== parent) throw Error("Unsafe preview fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
}

test("native previews bind actual attachment bytes/time and never rewrite project or import metadata", async () => {
	await withFixture(async ({ root, directory, png, input }) => {
		const before = await readFile(join(directory, "metadata.json"));
		let calls = 0;
		const service = createMediaPreviewService({
			projectRoot: root,
			decoder: fakeDecoder,
			decodeFrame: async (args) => {
				calls++;
				expect(args.seconds).toBe(0.5);
				expect(args.selection).toBe("containing");
				expect(posterDigest(args.body)).toBe(input.sourceSha256);
				expect(args.thumbnail).toEqual({
					maxDimension: 512,
					maxBytes: 1024 * 1024,
				});
				return { png, index: 15, sourceTime: 0.5, width: 320, height: 180 };
			},
		});
		try {
			expect((await service.capability()).available).toBe(true);
			expect(await service.render({ input, signal: signal() })).toEqual(png);
			expect(calls).toBe(1);
			expect(await readFile(join(root, "project.json"), "utf8")).toBe(
				"unchanged-project-marker",
			);
			expect(await readFile(join(directory, "metadata.json"))).toEqual(before);
			expect((await readdir(root)).sort()).toEqual([
				"attachments",
				"project.json",
			]);
		} finally {
			await service.dispose();
		}
	});
});

test("native preview rejects arbitrary paths, extra decoder options, changed content and oversized sources before decoding", async () => {
	await withFixture(async ({ root, directory, input }) => {
		let calls = 0;
		const service = createMediaPreviewService({
			projectRoot: root,
			decoder: fakeDecoder,
			decodeFrame: async () => {
				calls++;
				throw Error("must not decode");
			},
		});
		try {
			for (const bad of [
				{ ...input, mediaId: "../outside" },
				{ ...input, ffmpeg: process.execPath },
				{ ...input, timeSeconds: -1 },
				{ ...input, sourceSha256: "not-a-pin" },
			])
				await expect(
					service.render({ input: bad, signal: signal() }),
				).rejects.toMatchObject({ status: 400 });
			await expect(
				service.render({
					input: { ...input, sourceSha256: "0".repeat(64) },
					signal: signal(),
				}),
			).rejects.toMatchObject({ status: 409 });
			await truncate(join(directory, "body.bin"), 64 * 1024 * 1024 + 1);
			await expect(service.render({ input, signal: signal() })).rejects.toThrow(
				"bounds",
			);
			expect(calls).toBe(0);
		} finally {
			await service.dispose();
		}
	});
});

test("native preview slots remain bounded until actual cancelled decoders settle; dispose closes admission", async () => {
	await withFixture(async ({ root, png, input }) => {
		let started = 0;
		let resolveStarted!: () => void;
		const bothStarted = new Promise<void>((done) => {
			resolveStarted = done;
		});
		let release!: () => void;
		const gate = new Promise<void>((done) => {
			release = done;
		});
		const service = createMediaPreviewService({
			projectRoot: root,
			decoder: fakeDecoder,
			decodeFrame: async () => {
				started++;
				if (started === 2) resolveStarted();
				await gate;
				return { png, index: 0, sourceTime: 0, width: 320, height: 180 };
			},
		});
		const controller = new AbortController();
		const first = service.render({ input, signal: controller.signal });
		const second = service.render({ input, signal: signal() });
		try {
			await bothStarted;
			await expect(
				service.render({ input, signal: signal() }),
			).rejects.toMatchObject({ status: 429 });
			controller.abort();
			expect(started).toBe(2);
			release();
			expect(
				(await Promise.allSettled([first, second])).map((item) => item.status),
			).toEqual(["rejected", "fulfilled"]);
		} finally {
			release();
			await service.dispose();
		}
		await expect(
			service.render({ input, signal: signal() }),
		).rejects.toMatchObject({ status: 503 });
	});
});

test("native preview HTTP capability is token-protected and explicitly unavailable without configured decoder", async () => {
	const root = await mkdtemp(join(parent, "rocut-preview-host-"));
	const host = await startHost({
		projectRoot: join(root, "project"),
		registry: new TargetRegistry(join(root, "registry")),
	});
	try {
		const endpoint = `http://127.0.0.1:${host.port}/${host.token}/api/media/preview`;
		expect(
			(await fetch(endpoint.replace(host.token, "wrong-token"))).status,
		).toBe(401);
		expect(await (await fetch(endpoint)).json()).toMatchObject({
			version: 1,
			available: false,
		});
		expect(
			(
				await fetch(endpoint, {
					method: "POST",
					body: JSON.stringify({
						mediaId: "media",
						sourceSha256: "0".repeat(64),
						timeSeconds: 0,
					}),
				})
			).status,
		).toBe(501);
	} finally {
		await host.close();
		if (dirname(root) !== parent)
			throw Error("Unsafe preview host fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
});

test.skipIf(
	!process.env.ROCUT_TEST_FFMPEG_PATH || !process.env.ROCUT_TEST_FFPROBE_PATH,
)(
	"configured native adapter really decodes an imported attachment at the requested source time",
	async () => {
		await withFixture(async ({ root, input }) => {
			// Replace only this fixture marker with the host's actual seeded project.
			await rm(join(root, "project.json"));
			const host = await startHost({
				projectRoot: root,
				registry: new TargetRegistry(join(root, "registry")),
				nativeVideoDecoder: {
					ffmpeg: process.env.ROCUT_TEST_FFMPEG_PATH!,
					ffprobe: process.env.ROCUT_TEST_FFPROBE_PATH!,
				},
			});
			const service = createMediaPreviewService({
				projectRoot: root,
				decoder: {
					ffmpeg: process.env.ROCUT_TEST_FFMPEG_PATH!,
					ffprobe: process.env.ROCUT_TEST_FFPROBE_PATH!,
				},
			});
			try {
				const recordBefore = await readFile(join(root, "project.json"));
				const result = posterPng(
					await service.render({ input, signal: signal() }),
				);
				expect(result.width).toBe(512);
				expect(result.height).toBe(288);
				expect(result.sizeBytes).toBeGreaterThan(100);
				const endpoint = `http://127.0.0.1:${host.port}/${host.token}/api/media/preview`;
				const response = await fetch(endpoint, {
					method: "POST",
					body: JSON.stringify(input),
				});
				expect(response.status).toBe(200);
				expect(response.headers.get("x-rocut-source-sha256")).toBe(
					input.sourceSha256,
				);
				expect(response.headers.get("x-rocut-preview-version")).toBe("1");
				expect(
					posterPng(Buffer.from(await response.arrayBuffer())).sha256,
				).toBe(result.sha256);
				expect(await readFile(join(root, "project.json"))).toEqual(
					recordBefore,
				);
			} finally {
				await service.dispose();
				await host.close();
			}
		});
	},
	30000,
);
