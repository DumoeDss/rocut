import { expect, test } from "bun:test";
import { createHeartOwnerProvider } from "./mv-heart-owner-provider";
import {
	FakeOwner,
	source,
	bitmap,
	capabilityJson,
} from "./mv-heart-owner-provider-test-fixture";
test("abort drains pending native digest before owner cancellation", async () => {
	const owner = new FakeOwner(),
		controller = new AbortController();
	let resume: () => void = () => {};
	let started: () => void = () => {};
	const barrier = new Promise<void>((resolve) => {
		resume = resolve;
	});
	const entered = new Promise<void>((resolve) => {
		started = resolve;
	});
	const nativeDigest = globalThis.crypto.subtle.digest.bind(
		globalThis.crypto.subtle,
	);
	let calls = 0,
		uploads = 0;
	const nativeWebCrypto = {
		subtle: {
			digest: async (...args: Parameters<SubtleCrypto["digest"]>) => {
				if (++calls === 4) {
					started();
					await barrier;
				}
				return nativeDigest(...args);
			},
		},
	};
	const pending = createHeartOwnerProvider({
		owner,
		source: source(),
		ceilingBytes: 64 * 1024 * 1024,
		capabilityJson,
		signal: controller.signal,
		nativeWebCrypto,
		createBitmap: async () => {
			uploads++;
			return bitmap();
		},
	});
	await entered;
	controller.abort();
	expect(owner.entries.size).toBe(1);
	expect(owner.cancelled).toEqual([]);
	resume();
	await expect(pending).rejects.toThrow();
	expect(owner.entries.size).toBe(0);
	expect(owner.cancelled).toEqual([1]);
	expect(uploads).toBe(0);
});

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
