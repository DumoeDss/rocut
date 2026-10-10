import { expect, test } from "bun:test";
import {
	createHeartOwnerProvider,
	createHeartNativeUploadBitmap,
} from "./mv-heart-owner-provider";
import {
	FakeOwner,
	source,
	bitmap,
	capabilityJson,
	sha,
	type Record,
} from "./mv-heart-owner-provider-test-fixture";
test("production manifest validates positive owner identity, complete bindings and extra fields", async () => {
	const mutations: ((value: Omit<Record, "bytes">) => void)[] = [
		(v) => {
			v.identity.ownerId = 100;
		},
		(v) => {
			v.identity.binding = {
				...v.identity.binding,
				source: { ...v.identity.binding.source, attachmentKey: "substituted" },
			};
		},
		(v) => {
			Object.assign(v.identity.binding, { authoredFact: true });
		},
		(v) => {
			Object.assign(v.images[0]!.image.part, { extra: true });
		},
		(v) => {
			v.images[0]!.image = {
				...v.images[0]!.image,
				binding: { ...v.identity.binding, decodedWidth: 2 },
			};
		},
		(v) => {
			v.identity.imagesManifestSha256 = "0".repeat(64);
		},
		(v) => {
			v.images.push({ ...v.images[0]!, index: 1 });
		},
	];
	for (const mutation of mutations) {
		const owner = new FakeOwner();
		owner.manifestMutation = (value) => {
			mutation(value);
			if (value.identity.imagesManifestSha256 !== "0".repeat(64))
				value.identity.imagesManifestSha256 = sha(
					new TextEncoder().encode(JSON.stringify(value.images)),
				);
		};
		await expect(
			createHeartOwnerProvider({
				owner,
				source: source(),
				ceilingBytes: 64 * 1024 * 1024,
				capabilityJson,
				createBitmap: async () => bitmap(),
			}),
		).rejects.toThrow();
		expect(owner.entries.size).toBe(0);
		expect(owner.cancelled).toEqual([1]);
	}
});

test("native upload helper shares the one extracted array buffer", async () => {
	const previousData = globalThis.ImageData,
		previousBitmap = globalThis.createImageBitmap;
	const bytes = new Uint8Array([1, 2, 3, 4]),
		uploaded = bitmap();
	let calls = 0;
	class NativeImageData {
		// eslint-disable-next-line opencut/prefer-object-params -- Mirror the actual native ImageData constructor boundary.
		constructor(
			view: Uint8ClampedArray,
			width: number,
			height: number,
			options: ImageDataSettings,
		) {
			expect(view.buffer).toBe(bytes.buffer);
			expect(view.byteOffset).toBe(bytes.byteOffset);
			expect([width, height, options.colorSpace]).toEqual([1, 1, "srgb"]);
		}
	}
	try {
		Object.defineProperty(globalThis, "ImageData", {
			value: NativeImageData,
			configurable: true,
			writable: true,
		});
		Object.defineProperty(globalThis, "createImageBitmap", {
			value: async () => {
				calls++;
				return uploaded;
			},
			configurable: true,
			writable: true,
		});
		expect(
			await createHeartNativeUploadBitmap({ bytes, width: 1, height: 1 }),
		).toBe(uploaded);
		expect(calls).toBe(1);
		await expect(
			createHeartNativeUploadBitmap({ bytes, width: 2, height: 1 }),
		).rejects.toThrow("shape mismatch");
		expect(calls).toBe(1);
	} finally {
		globalThis.ImageData = previousData;
		globalThis.createImageBitmap = previousBitmap;
	}
});

test("background full native binding is snapshotted and cannot be substituted", async () => {
	for (const substitute of [false, true]) {
		const owner = new FakeOwner();
		const background = source();
		const nativeBackground = {
			...background,
			resource: { ...background.resource, id: "background" },
		};
		if (substitute)
			owner.manifestMutation = (value) => {
				value.identity.background = { substituted: true };
			};
		const pending = createHeartOwnerProvider({
			owner,
			source: source(),
			background: nativeBackground,
			ceilingBytes: 64 * 1024 * 1024,
			capabilityJson,
			createBitmap: async () => bitmap(),
		});
		new Uint8Array(nativeBackground.encoded).fill(0);
		nativeBackground.rgba.fill(0);
		if (substitute) {
			await expect(pending).rejects.toThrow("identity mismatch");
			expect(owner.entries.size).toBe(0);
		} else {
			const provider = await pending;
			expect(provider.providerSnapshotBytes).toBe(14);
			expect(provider.frame({}).identity).toEqual(provider.identity);
			provider.dispose();
		}
		expect(owner.cancelled).toEqual([1]);
	}
});

test("shared native pixels and pre-aborted creation cannot enter the owner", async () => {
	const owner = new FakeOwner();
	const controller = new AbortController();
	controller.abort();
	await expect(
		createHeartOwnerProvider({
			owner,
			source: source(),
			ceilingBytes: 64 * 1024 * 1024,
			capabilityJson,
			signal: controller.signal,
			createBitmap: async () => bitmap(),
		}),
	).rejects.toThrow();
	await expect(
		createHeartOwnerProvider({
			owner,
			source: { ...source(), rgba: new Uint8Array(new SharedArrayBuffer(4)) },
			ceilingBytes: 64 * 1024 * 1024,
			capabilityJson,
			createBitmap: async () => bitmap(),
		}),
	).rejects.toThrow("malformed");
	expect(owner.next).toBe(1);
	expect(owner.entries.size).toBe(0);
	expect(owner.cancelled).toEqual([]);
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

test("Rust capability rejection is explicit and cannot resize or manufacture images", async () => {
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
