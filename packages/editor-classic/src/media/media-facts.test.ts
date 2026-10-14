import { expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

if (process.env.OPENCUT_FACTS_COLLECTOR_TEST_ISOLATED !== "1") {
	test("media facts collector runs with isolated native/demux doubles", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			env: { ...process.env, OPENCUT_FACTS_COLLECTOR_TEST_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw new Error(result.stdout.toString() + result.stderr.toString());
	});
} else {
	let envelope: Uint8Array;
	let disposed = 0;
	let packetCount = 2;
	mock.module("opencut-wasm", () => ({
		inspectMediaFactsBytes: (input: Uint8Array) => {
			envelope = input;
			const size = new DataView(input.buffer, input.byteOffset).getUint32(
				0,
				true,
			);
			return JSON.stringify({
				schemaVersion: 1,
				source: "byte-probe",
				sha256: createHash("sha256")
					.update(input.subarray(4 + size))
					.digest("hex"),
				alpha: false,
			});
		},
		validateMediaFactsJson: (value: string) => value,
	}));
	mock.module("mediabunny", () => ({
		ALL_FORMATS: [],
		BufferSource: class {
			constructor(public bytes: Uint8Array) {}
		},
		EncodedPacketSink: class {
			async getFirstPacket(options: unknown) {
				expect(options).toEqual({ metadataOnly: true });
				return { timestamp: 0, duration: 1001 / 30000, index: 0 };
			}
			// Mirrors the demux library's positional method signature.
			// eslint-disable-next-line opencut/prefer-object-params
			async getNextPacket(packet: { index: number }, options: unknown) {
				expect(options).toEqual({ metadataOnly: true });
				const index = packet.index + 1;
				return index < packetCount
					? { timestamp: (index * 1001) / 30000, duration: 1001 / 30000, index }
					: null;
			}
		},
		Input: class {
			async getPrimaryVideoTrack() {
				return {
					getTimeResolution: async () => 30000,
					computePacketStats: async (limit: number) => {
						expect(limit).toBe(100);
						return { packetCount: 100, averagePacketRate: 30000 / 1001 };
					},
				};
			}
			async getPrimaryAudioTrack() {
				return { numberOfChannels: 2, sampleRate: 48000 };
			}
			dispose() {
				disposed++;
			}
		},
	}));
	const {
		decodeMediaFacts,
		probeSourceMediaFacts,
		sourceBytesSha256,
		supportsMediaFacts,
	} = await import("./media-facts");
	function header() {
		const size = new DataView(envelope.buffer).getUint32(0, true);
		return JSON.parse(new TextDecoder().decode(envelope.subarray(4, 4 + size)));
	}
	test("unserializable optional metadata remains unknown", () => {
		expect(decodeMediaFacts(undefined)).toBeUndefined();
		expect(decodeMediaFacts(1n)).toBeUndefined();
	});
	test("transports exact image bytes to native and independently fingerprints the source", async () => {
		const bytes = new Uint8Array([1, 2, 3]);
		expect(supportsMediaFacts()).toBe(true);
		const facts = await probeSourceMediaFacts({ bytes, mimeType: "image/png" });
		expect(facts?.alpha).toBe(false);
		expect(facts?.sha256).toBe(await sourceBytesSha256(bytes));
		expect(header()).toEqual({ mimeType: "image/png" });
		expect(disposed).toBe(0);
	});
	test("sends bounded demux observations, never authored fps, mode or inferred audio layout", async () => {
		await probeSourceMediaFacts({
			bytes: new Uint8Array([4]),
			mimeType: "video/mp4",
		});
		expect(header()).toEqual({
			mimeType: "video/mp4",
			packetCount: 100,
			averagePacketRate: 30000 / 1001,
			videoPackets: {
				timebase: 30000,
				timestampsSeconds: [0, 1001 / 30000],
				durationsSeconds: [1001 / 30000, 1001 / 30000],
				complete: true,
			},
			audio: { channels: 2, sampleRate: 48000 },
		});
		expect(disposed).toBe(1);
	});
	test("caps timing observations at 256 and uses the 257th packet only to disprove EOF", async () => {
		packetCount = 257;
		await probeSourceMediaFacts({
			bytes: new Uint8Array([4]),
			mimeType: "video/mp4",
		});
		expect(header().videoPackets.timestampsSeconds).toHaveLength(256);
		expect(header().videoPackets.durationsSeconds).toHaveLength(256);
		expect(header().videoPackets.complete).toBe(false);
	});
	test("attachment save and hydration bind facts to independently hashed actual bytes", async () => {
		const { savePersistedMediaAsset, mediaAssetFromAttachment } =
			await import("./persistence");
		const bytes = new Uint8Array([1, 2, 3]);
		const sha256 = await sourceBytesSha256(bytes);
		const mediaFacts = {
			schemaVersion: 1 as const,
			source: "byte-probe" as const,
			sha256,
			alpha: false,
		};
		let saved: unknown;
		const persistence = {
			saveAttachment: async (value: unknown) => {
				saved = value;
			},
		} satisfies Parameters<typeof savePersistedMediaAsset>[0]["persistence"];
		const asset = {
			id: "media",
			name: "image.png",
			type: "image" as const,
			file: new File([bytes], "image.png", { type: "image/png" }),
			sourceSha256: sha256,
			mediaFacts,
		};
		await savePersistedMediaAsset({ persistence, projectId: "project", asset });
		expect(saved).toMatchObject({
			metadata: { sourceSha256: sha256, mediaFacts },
		});
		await expect(
			savePersistedMediaAsset({
				persistence,
				projectId: "project",
				asset: { ...asset, file: new File([new Uint8Array([9])], "image.png") },
			}),
		).rejects.toThrow("fingerprint");
		const resources = {
			createObjectUrl: () => {
				throw new Error("must validate bytes before object URL creation");
			},
		} satisfies Parameters<typeof mediaAssetFromAttachment>[0]["resources"];
		await expect(
			mediaAssetFromAttachment({
				attachment: {
					projectId: "project",
					key: "media",
					body: new Uint8Array([9]).buffer,
					metadata: {
						id: "media",
						name: "image.png",
						type: "image",
						mimeType: "image/png",
						lastModified: 0,
						sourceSha256: sha256,
						mediaFacts,
					},
				},
				resources,
			}),
		).rejects.toThrow("fingerprint");
	});
}
