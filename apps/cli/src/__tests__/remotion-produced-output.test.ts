import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeRemotionProducedOutputs } from "../programmatic/remotion-produced-output";

async function withProject(run: (project: string) => Promise<void>) {
	const parent = resolve(tmpdir());
	const root = await mkdtemp(join(parent, "rocut-produced-output-"));
	try {
		await run(await realpath(root));
	} finally {
		if (dirname(resolve(root)) !== parent)
			throw Error("Unsafe produced-output test cleanup");
		await rm(root, { recursive: true, force: true });
	}
}

const pcm = Buffer.alloc(8);
pcm.writeFloatLE(0.25, 0);
pcm.writeFloatLE(-0.5, 4);
const soundtrack = {
	hasAudio: true,
	pcm,
	sampleRate: 48000 as const,
	frames: 1,
	sampleOrigin: 9600,
	firstFrame: 5,
	frameCount: 1,
};

test("produced output delivers audio-only bytes with source/sample origins", async () => {
	await withProject(async (projectDir) => {
		const wav = Buffer.from("owned Rust WAV fixture");
		let encoded = 0;
		const output = await writeRemotionProducedOutputs({
			projectDir,
			artifacts: [],
			soundtrack,
			signal: new AbortController().signal,
			encodeAudioWav(packet) {
				encoded++;
				const bytes = Buffer.from(packet),
					length = bytes.readUInt32LE(0);
				expect(
					JSON.parse(bytes.subarray(4, 4 + length).toString("utf8")),
				).toEqual({ version: 1, sampleRate: 48000, frames: 1 });
				expect(bytes.subarray(4 + length)).toEqual(pcm);
				return wav;
			},
		});
		expect(encoded).toBe(1);
		expect(output!.artifacts).toEqual([]);
		expect(output!.audio).toMatchObject({
			format: "wav-f32le",
			channels: 2,
			sampleRate: 48000,
			frames: 1,
			sampleOrigin: 9600,
			firstFrame: 5,
			frameCount: 1,
			byteLength: wav.length,
			sha256: createHash("sha256").update(wav).digest("hex"),
		});
		expect(output!.audio!.path.startsWith(output!.directory + "/")).toBe(true);
		expect(await readFile(join(projectDir, output!.audio!.path))).toEqual(wav);
	});
});

test("author artifacts stay distinct from the native soundtrack in one owned run", async () => {
	await withProject(async (projectDir) => {
		const body = Buffer.from("字幕");
		const output = await writeRemotionProducedOutputs({
			projectDir,
			soundtrack,
			signal: new AbortController().signal,
			artifacts: [
				{
					filename: "captions.txt",
					body,
					sha256: createHash("sha256").update(body).digest("hex"),
					collectionFrame: 0,
					nativeLocalFrame: -1,
					downloadBehavior: null,
				},
			],
			encodeAudioWav: () => Buffer.from("owned soundtrack"),
		});
		expect(output!.artifacts).toHaveLength(1);
		expect(output!.artifacts[0].filename).toBe("captions.txt");
		expect(output!.artifacts[0].nativeLocalFrame).toBe(-1);
		expect(output!.audio).not.toBeNull();
		expect(await readFile(join(projectDir, output!.artifacts[0].path))).toEqual(
			body,
		);
	});
});

test("silent and cancelled produced jobs do not encode or publish a fake soundtrack", async () => {
	await withProject(async (projectDir) => {
		const encodeAudioWav = () => {
			throw Error("must not encode");
		};
		expect(
			await writeRemotionProducedOutputs({
				projectDir,
				artifacts: [],
				soundtrack: { ...soundtrack, hasAudio: false },
				signal: new AbortController().signal,
				encodeAudioWav,
			}),
		).toBeUndefined();
		const controller = new AbortController();
		controller.abort(Error("cancelled"));
		await expect(
			writeRemotionProducedOutputs({
				projectDir,
				artifacts: [],
				soundtrack,
				signal: controller.signal,
				encodeAudioWav,
			}),
		).rejects.toThrow("cancelled");
	});
});

const wasmDirectory = process.env.ROCUT_TEST_WASM_DIRECTORY;
test.skipIf(!wasmDirectory)(
	"actual generated Rust WAV reaches the owned Host output without PCM conversion",
	async () => {
		if (!wasmDirectory || !isAbsolute(wasmDirectory))
			throw Error("Explicit absolute test WASM directory required");
		const runtime = await import(
			pathToFileURL(join(wasmDirectory, "opencut_wasm_sync.js")).href
		);
		if (typeof runtime.encodeRemotionProducedAudioWav !== "function")
			throw Error("Test WASM is missing the produced WAV export");
		await withProject(async (projectDir) => {
			const output = await writeRemotionProducedOutputs({
				projectDir,
				artifacts: [],
				soundtrack,
				signal: new AbortController().signal,
				encodeAudioWav: runtime.encodeRemotionProducedAudioWav,
			});
			const wav = await readFile(join(projectDir, output!.audio!.path));
			expect(wav.length).toBe(64);
			expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
			expect(wav.readUInt32LE(4)).toBe(56);
			expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
			expect(wav.readUInt16LE(20)).toBe(3);
			expect(wav.readUInt16LE(22)).toBe(2);
			expect(wav.readUInt32LE(24)).toBe(48000);
			expect(wav.toString("ascii", 36, 40)).toBe("fact");
			expect(wav.readUInt32LE(44)).toBe(1);
			expect(wav.toString("ascii", 48, 52)).toBe("data");
			expect(wav.subarray(56)).toEqual(pcm);
			expect(output!.audio!.sha256).toBe(
				createHash("sha256").update(wav).digest("hex"),
			);
		});
	},
);
