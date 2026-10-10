import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	createHeartOwnerProvider,
	type HeartOwnerApi,
	type HeartNativePixels,
} from "./mv-heart-owner-provider";
import type {
	MvHeartPreparedImage,
	MvHeartBinding,
} from "../../packages/editor-contracts/src/mv-heart-prepared";
const sha = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const capabilityJson = () =>
	JSON.stringify({ maxOwnerBytes: 256 * 1024 * 1024 });
function source(): HeartNativePixels {
	const bytes = new Uint8Array([1, 2, 3]);
	const digest = sha(bytes);
	return {
		resource: {
			id: "heart",
			kind: "image",
			mimeType: "image/png",
			byteLength: 3,
			sha256: digest,
			attachmentKey: `programmatic-sha256-${digest}`,
		},
		encoded: bytes.buffer,
		width: 1,
		height: 1,
		rgba: new Uint8Array([255, 255, 255, 255]),
	};
}
interface Record {
	identity: {
		ownerId: number;
		sessionId: number;
		binding: MvHeartBinding;
		background: unknown;
		imagesManifestSha256: string;
	};
	images: { index: number; byteLength: number; image: MvHeartPreparedImage }[];
	reservedBytes: number;
	bytes: Uint8Array;
}
/** Synthetic protocol owner. Actual Rust/header/segmentation gates are separate;
 * these tests prove only snapshot, full-identity, upload and cancellation seams. */
class FakeOwner implements HeartOwnerApi {
	next = 1;
	entries = new Map<number, Record>();
	extractions = 0;
	cancelled: number[] = [];
	badManifest = false;
	badFrame = false;
	badBytes = false;
	rejectPrepare = false;
	// eslint-disable-next-line opencut/prefer-object-params -- Preserve actual WASM class binary boundary.
	prepare(metadata: string, encoded: Uint8Array, rgba: Uint8Array) {
		if (this.rejectPrepare)
			throw Error("Heart joint preparation ceiling exceeded");
		const input: {
			binding: MvHeartBinding;
			background?: unknown;
			ceilingBytes: number;
		} = JSON.parse(metadata);
		expect(sha(encoded)).toBe(input.binding.source.sha256);
		expect(sha(rgba)).toBe(input.binding.decodedRgbaSha256);
		const session = this.next++;
		const image: MvHeartPreparedImage = {
			binding: input.binding,
			part: { kind: "body" },
			width: 1,
			height: 1,
			rgbaSha256: sha(rgba),
		};
		const images = [{ index: 0, byteLength: 4, image }];
		this.entries.set(session, {
			identity: {
				ownerId: 99,
				sessionId: session,
				binding: input.binding,
				background: input.background ?? null,
				imagesManifestSha256: sha(
					new TextEncoder().encode(JSON.stringify(images)),
				),
			},
			images,
			reservedBytes: input.ceilingBytes,
			bytes: rgba.slice(),
		});
		return session;
	}
	manifestJson(session: number) {
		const record = this.entries.get(session);
		if (!record) throw Error("stale");
		return JSON.stringify({
			images: record.images,
			reservedBytes: record.reservedBytes,
			identity: { ...record.identity, ownerId: this.badManifest ? 0 : 99 },
		});
	}
	imageBytes(session: number) {
		this.extractions++;
		const bytes = this.entries.get(session)!.bytes.slice();
		if (this.badBytes) bytes[0] ^= 1;
		return bytes;
	}
	frameJson(session: number) {
		const record = this.entries.get(session)!;
		return JSON.stringify({
			identity: {
				...record.identity,
				sessionId: this.badFrame ? 999 : session,
			},
			plan: {
				commands: [{ kind: "preparedImage", image: record.images[0]!.image }],
			},
		});
	}
	cancel(session: number) {
		this.cancelled.push(session);
		return this.entries.delete(session);
	}
}
function bitmap() {
	return {
		width: 1,
		height: 1,
		closed: 0,
		close() {
			this.closed++;
		},
	};
}
test("private provider atomically snapshots bytes and reuses one admitted bitmap across seeks", async () => {
	const owner = new FakeOwner(),
		input = source(),
		image = bitmap();
	const promise = createHeartOwnerProvider({
		owner,
		source: input,
		ceilingBytes: 64 * 1024 * 1024,
		capabilityJson,
		createBitmap: async () => image,
	});
	new Uint8Array(input.encoded).fill(0);
	input.rgba.fill(0);
	const provider = await promise;
	for (let i = 0; i < 4; i++) {
		const frame = provider.frame({ songTicks: i });
		expect(frame.identity).toEqual(provider.identity);
	}
	const prepared = owner.entries.get(provider.session)!.images[0]!.image;
	expect(provider.preparedImage(prepared)).toBe(image);
	expect(owner.extractions).toBe(1);
	expect(provider.providerSnapshotBytes).toBe(7);
	provider.dispose();
	provider.dispose();
	expect(image.closed).toBe(1);
	expect(owner.cancelled).toEqual([provider.session]);
});
test("manifest/frame/derived binary replacement fail closed without clearing another session", async () => {
	for (const mode of ["badManifest", "badBytes", "badFrame"] as const) {
		const owner = new FakeOwner();
		const independent = await createHeartOwnerProvider({
			owner,
			source: source(),
			ceilingBytes: 64 * 1024 * 1024,
			capabilityJson,
			createBitmap: async () => bitmap(),
		});
		owner[mode] = true;
		const image = bitmap();
		const start = () =>
			createHeartOwnerProvider({
				owner,
				source: source(),
				ceilingBytes: 64 * 1024 * 1024,
				capabilityJson,
				createBitmap: async () => image,
			});
		if (mode === "badFrame") {
			const provider = await start();
			expect(() => provider.frame({})).toThrow("identity mismatch");
			expect(image.closed).toBe(1);
		} else {
			await expect(start()).rejects.toThrow();
		}
		expect(owner.entries.has(independent.session)).toBe(true);
		expect(owner.entries.size).toBe(1);
		expect(owner.cancelled).toEqual([2]);
		independent.dispose();
	}
});
test("abort during bitmap upload closes late result and only its own session", async () => {
	const owner = new FakeOwner(),
		controller = new AbortController(),
		image = bitmap();
	let resolveUpload: (value: ReturnType<typeof bitmap>) => void = () => {
		throw Error("upload not started");
	};
	let signalStarted: () => void = () => {};
	const started = new Promise<void>((resolve) => {
		signalStarted = resolve;
	});
	const pending = createHeartOwnerProvider({
		owner,
		source: source(),
		ceilingBytes: 64 * 1024 * 1024,
		capabilityJson,
		signal: controller.signal,
		createBitmap: () => {
			signalStarted();
			return new Promise<ReturnType<typeof bitmap>>((resolve) => {
				resolveUpload = resolve;
			});
		},
	});
	await started;
	controller.abort();
	expect(owner.entries.size).toBe(1);
	expect(owner.cancelled).toEqual([]);
	resolveUpload(image);
	await expect(pending).rejects.toThrow();
	expect(image.closed).toBe(1);
	expect(owner.entries.size).toBe(0);
	expect(owner.cancelled).toEqual([1]);
});
test("common-size Rust capability rejection is explicit and cannot resize or manufacture images", async () => {
	const owner = new FakeOwner();
	owner.rejectPrepare = true;
	let uploads = 0;
	const input = {
		...source(),
		width: 1024,
		height: 1024,
		rgba: new Uint8Array(1024 * 1024 * 4),
	};
	await expect(
		createHeartOwnerProvider({
			owner,
			source: input,
			ceilingBytes: 256 * 1024 * 1024,
			capabilityJson,
			createBitmap: async () => {
				uploads++;
				return bitmap();
			},
		}),
	).rejects.toThrow("no resizing or fallback");
	expect(uploads).toBe(0);
	expect(owner.entries.size).toBe(0);
});
test("substituted command identities and bitmap dimensions cannot yield a prepared asset", async () => {
	const owner = new FakeOwner(),
		preparedBitmap = bitmap();
	const provider = await createHeartOwnerProvider({
		owner,
		source: source(),
		ceilingBytes: 64 * 1024 * 1024,
		capabilityJson,
		createBitmap: async () => preparedBitmap,
	});
	const image = {
		...structuredClone(owner.entries.get(provider.session)!.images[0]!.image),
		width: 2,
	};
	expect(() => provider.preparedImage(image)).toThrow("not owned");
	expect(preparedBitmap.closed).toBe(1);
	expect(owner.entries.size).toBe(0);
	const wrong = { ...bitmap(), width: 2 };
	await expect(
		createHeartOwnerProvider({
			owner,
			source: source(),
			ceilingBytes: 64 * 1024 * 1024,
			capabilityJson,
			createBitmap: async () => wrong,
		}),
	).rejects.toThrow("dimensions mismatch");
	expect(wrong.closed).toBe(1);
	expect(owner.entries.size).toBe(0);
});
