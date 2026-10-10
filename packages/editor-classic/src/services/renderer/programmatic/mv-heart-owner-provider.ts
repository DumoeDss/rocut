import type {
	ProgrammaticResource,
	MvHeartPreparedImage,
} from "@opencut/editor-contracts";
import { isProgrammaticResource } from "@opencut/editor-contracts";
import {
	object,
	integer,
	manifest,
	skyManifest,
	key,
} from "./mv-heart-owner-provider-protocol";
import type { MvHeartSkySettings } from "../../../../../editor-contracts/src/mv-heart";
import { readOwnerFrame } from "./mv-heart-owner-provider-frame";
import { digest as nativeDigest } from "./mv-heart-owner-provider-digest";
import { createHeartNativeUploadBitmap } from "./mv-heart-owner-provider-native";
export { createHeartNativeUploadBitmap };
/** Private native boundary only; never accept these decoded facts from authored JSON. */
export interface HeartOwnerApi {
	diagnosticJson(): string;
	prepare(metadata: string, encoded: Uint8Array, rgba: Uint8Array): number;
	prepareSky?(metadata: string, encoded: Uint8Array, rgba: Uint8Array): number;
	manifestJson(session: number): string;
	imageBytes(session: number, index: number): Uint8Array;
	frameJson(session: number, input: string): string;
	cancel(session: number): boolean;
}
export interface HeartNativePixels {
	readonly resource: ProgrammaticResource;
	readonly encoded: ArrayBuffer;
	readonly width: number;
	readonly height: number;
	readonly rgba: Uint8Array;
}
export interface HeartBitmap {
	readonly width: number;
	readonly height: number;
	close(): void;
}
/** Snapshot packets synchronously before all awaits. No raw pixels/base64 enter
 * JSON. Exactly one Rust binary extraction and one upload bitmap per image.
 * Rust owner admission charges provider packet and inbound WASM copies; the
 * snapshot byte report is diagnostic, not measured whole-renderer residency. */
export async function createHeartOwnerProvider<B extends HeartBitmap>({
	owner,
	source,
	background,
	character,
	sky,
	ceilingBytes,
	capabilityJson,
	nativeWebCrypto = globalThis.crypto,
	createBitmap,
	signal,
}: {
	owner: HeartOwnerApi;
	source: HeartNativePixels;
	background?: HeartNativePixels;
	character?: HeartNativePixels;
	/** Presence selects the independent Sky producer; source is its background. */
	sky?: MvHeartSkySettings;
	ceilingBytes: number;
	/** Obtained from the actual Rust MvHeartOwner.capabilityJson static method. */
	capabilityJson: () => string;
	/** Captured host native API; opaque workers must not use a digest fallback. */
	nativeWebCrypto?: { readonly subtle: Pick<SubtleCrypto, "digest"> };
	createBitmap: (input: {
		bytes: Uint8Array;
		width: number;
		height: number;
	}) => Promise<B>;
	signal?: AbortSignal;
}) {
	signal?.throwIfAborted();
	if (!nativeWebCrypto?.subtle)
		throw Error("Heart native WebCrypto unavailable");
	const digest = (bytes: Uint8Array) =>
		nativeDigest({ bytes, nativeWebCrypto });
	const skySettings = sky === undefined ? undefined : structuredClone(sky);
	const expectedSkySettings = skySettings
		? {
				bg: skySettings.bg,
				char: skySettings.char,
				night: skySettings.night ?? null,
				seed: skySettings.seed ?? null,
				impact: skySettings.impact ?? null,
				releaseBeat: skySettings.releaseBeat ?? null,
				bands: skySettings.bands ?? null,
				charX: skySettings.charX ?? null,
				charH: skySettings.charH ?? null,
			}
		: undefined;
	if (skySettings && (!character || background || !owner.prepareSky))
		throw Error(
			"Sky requires its native character and dedicated owner capability",
		);
	const diagnostics: unknown = JSON.parse(owner.diagnosticJson());
	if (
		!object(diagnostics) ||
		!integer(diagnostics.ownerId) ||
		diagnostics.disposed !== false
	)
		throw Error("Heart native owner identity unavailable");
	const expectedOwnerId = diagnostics.ownerId;
	const capability: unknown = JSON.parse(capabilityJson());
	if (
		!object(capability) ||
		!integer(capability.maxOwnerBytes) ||
		!integer(ceilingBytes) ||
		ceilingBytes > capability.maxOwnerBytes
	)
		throw Error("Heart Rust owner capability ceiling exceeded");
	const native = [
		source,
		...(background ? [background] : []),
		...(character ? [character] : []),
	].map((item) => ({
		resource: structuredClone(item.resource),
		width: item.width,
		height: item.height,
		encoded: item.encoded,
		rgba: item.rgba,
	}));
	const backgroundIndex = background ? 1 : undefined;
	const characterIndex = character ? (background ? 2 : 1) : undefined;
	if (
		!integer(ceilingBytes) ||
		native.some(
			(n) =>
				!isProgrammaticResource(n.resource) ||
				n.resource.kind !== "image" ||
				!(n.encoded instanceof ArrayBuffer) ||
				n.encoded.byteLength !== n.resource.byteLength ||
				!integer(n.width) ||
				!integer(n.height) ||
				n.width > 4096 ||
				n.height > 4096 ||
				!(n.rgba instanceof Uint8Array) ||
				!(n.rgba.buffer instanceof ArrayBuffer) ||
				!Number.isSafeInteger(n.width * n.height * 4) ||
				n.rgba.byteLength !== n.width * n.height * 4,
		)
	)
		throw Error("Heart private native inputs malformed");
	if (new Set(native.map((n) => n.resource.id)).size !== native.length)
		throw Error("Heart native resource identity collision");
	if (
		native.reduce((n, v) => n + v.encoded.byteLength + v.rgba.byteLength, 0) >
		ceilingBytes
	)
		throw Error(
			"Heart native packet snapshots exceed owner capability before allocation",
		);
	const encoded = new Uint8Array(
		native.reduce((n, v) => n + v.encoded.byteLength, 0),
	);
	const rgba = new Uint8Array(
		native.reduce((n, v) => n + v.rgba.byteLength, 0),
	);
	const ranges = native.map((v, index) => ({
		index,
		encoded: { offset: 0, length: v.encoded.byteLength },
		decoded: { offset: 0, length: v.rgba.byteLength },
	}));
	let encodedOffset = 0,
		decodedOffset = 0;
	for (const [index, n] of native.entries()) {
		ranges[index]!.encoded.offset = encodedOffset;
		ranges[index]!.decoded.offset = decodedOffset;
		encoded.set(new Uint8Array(n.encoded), encodedOffset);
		rgba.set(n.rgba, decodedOffset);
		encodedOffset += n.encoded.byteLength;
		decodedOffset += n.rgba.byteLength;
	}
	// Drop borrowed mutable input references; only private packets cross awaits.
	const descriptors = native.map(({ resource, width, height }) => ({
		resource,
		width,
		height,
	}));
	native.length = 0;
	const facts = [];
	for (const [index, n] of descriptors.entries()) {
		const range = ranges[index]!;
		if (
			(await digest(
				encoded.subarray(
					range.encoded.offset,
					range.encoded.offset + range.encoded.length,
				),
			)) !== n.resource.sha256
		)
			throw Error("Heart encoded snapshot digest mismatch");
		facts.push({
			source: n.resource,
			decodedWidth: n.width,
			decodedHeight: n.height,
			decodedRgbaSha256: await digest(
				rgba.subarray(
					range.decoded.offset,
					range.decoded.offset + range.decoded.length,
				),
			),
			decoder: "canvas2d-srgb-unpremultiplied-rgba8-v1" as const,
		});
	}
	signal?.throwIfAborted();
	const expectedBinding = {
		...facts[0]!,
		algorithm: "heart-components-v1" as const,
	};
	const backgroundFact =
		backgroundIndex === undefined ? undefined : facts[backgroundIndex];
	const characterFact =
		characterIndex === undefined ? undefined : facts[characterIndex];
	const metadata = {
		source: descriptors[0]!.resource,
		binding: skySettings ? facts[0]! : expectedBinding,
		background: backgroundFact,
		character: characterFact,
		settings: skySettings,
		ceilingBytes,
		encodedLayout: {
			source: ranges[0]!.encoded,
			background:
				backgroundIndex === undefined
					? undefined
					: ranges[backgroundIndex]?.encoded,
			character:
				characterIndex === undefined
					? undefined
					: ranges[characterIndex]?.encoded,
		},
		decodedLayout: {
			source: ranges[0]!.decoded,
			background:
				backgroundIndex === undefined
					? undefined
					: ranges[backgroundIndex]?.decoded,
			character:
				characterIndex === undefined
					? undefined
					: ranges[characterIndex]?.decoded,
		},
	};
	let session: number;
	try {
		if (skySettings) {
			if (!owner.prepareSky) throw Error("Sky owner capability unavailable");
			session = owner.prepareSky(JSON.stringify(metadata), encoded, rgba);
		} else session = owner.prepare(JSON.stringify(metadata), encoded, rgba);
	} catch (error) {
		throw Error(
			`Heart Rust owner capability/admission failed (no resizing or fallback): ${String(error)}`,
		);
	}
	const bitmaps = new Map<string, B>();
	let disposed = false,
		preparing = true,
		released = false;
	const releaseOwner = () => {
		if (!preparing && !released) {
			released = true;
			owner.cancel(session);
		}
	};
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		signal?.removeEventListener("abort", dispose);
		for (const bitmap of bitmaps.values()) bitmap.close();
		bitmaps.clear();
		releaseOwner();
	};
	signal?.addEventListener("abort", dispose, { once: true });
	const check = () => {
		signal?.throwIfAborted();
		if (disposed) throw Error("Heart prepared owner disposed");
	};
	try {
		check();
		if (!integer(session))
			throw Error("Heart Rust owner returned an invalid session identity");
		const value: unknown = JSON.parse(owner.manifestJson(session));
		if (!manifest(value) && !skyManifest(value))
			throw Error("Heart full owner manifest identity mismatch");
		if (
			(skySettings ? !skyManifest(value) : !manifest(value)) ||
			value.identity.ownerId !== expectedOwnerId ||
			value.identity.sessionId !== session ||
			key(value.identity.binding) !==
				key(skySettings ? facts[0]! : expectedBinding) ||
			(manifest(value) &&
				key(value.identity.background) !== key(backgroundFact ?? null)) ||
			key(value.identity.character) !== key(characterFact) ||
			(skyManifest(value) &&
				key(value.identity.settings) !== key(expectedSkySettings)) ||
			value.reservedBytes !== ceilingBytes
		)
			throw Error("Heart full owner manifest identity mismatch");
		if (
			(await digest(new TextEncoder().encode(JSON.stringify(value.images)))) !==
			value.identity.imagesManifestSha256
		)
			throw Error("Heart image manifest digest mismatch");
		check();
		const parts = new Set<string>();
		for (const [index, item] of value.images.entries()) {
			if (
				item.index !== index ||
				key(item.image.binding) !== key(expectedBinding) ||
				item.byteLength !== item.image.width * item.image.height * 4 ||
				bitmaps.has(key(item.image)) ||
				parts.has(key(item.image.part))
			)
				throw Error("Heart derived image manifest identity/length collision");
			parts.add(key(item.image.part));
			const bytes = owner.imageBytes(session, index);
			if (
				!(bytes instanceof Uint8Array) ||
				bytes.byteLength !== item.byteLength ||
				(await digest(bytes)) !== item.image.rgbaSha256
			)
				throw Error("Heart derived binary SHA/length mismatch");
			check();
			const bitmap = await createBitmap({
				bytes,
				width: item.image.width,
				height: item.image.height,
			});
			if (disposed || signal?.aborted) {
				bitmap.close();
				check();
			}
			if (
				bitmap.width !== item.image.width ||
				bitmap.height !== item.image.height
			) {
				bitmap.close();
				throw Error("Heart admitted native bitmap dimensions mismatch");
			}
			bitmaps.set(key(item.image), bitmap);
		}
		return {
			identity: structuredClone(value.identity),
			session,
			providerSnapshotBytes: encoded.byteLength + rgba.byteLength,
			frame(input: unknown) {
				try {
					check();
					const frame: unknown = JSON.parse(
						owner.frameJson(session, JSON.stringify(input)),
					);
					return readOwnerFrame({
						value: frame,
						identity: value.identity,
						sky: skySettings !== undefined,
						hasPreparedImage: (image) => bitmaps.has(key(image)),
						resources: new Set(descriptors.map((d) => d.resource.id)),
					});
				} catch (error) {
					dispose();
					throw error;
				}
			},
			preparedImage(image: MvHeartPreparedImage) {
				try {
					check();
					const bitmap = bitmaps.get(key(image));
					if (!bitmap)
						throw Error("Heart prepared image not owned by current session");
					return bitmap;
				} catch (error) {
					dispose();
					throw error;
				}
			},
			dispose,
		};
	} catch (error) {
		dispose();
		throw error;
	} finally {
		preparing = false;
		if (disposed) releaseOwner();
	}
}

/** Native-host convenience entry. The caller must wait for this factory promise
 * to settle after abort before disposing/freeing the shared Rust owner. Native
 * digest/upload promises are deliberately drained before cancelling its lease. */
export function createNativeHeartOwnerProvider(
	input: Omit<
		Parameters<typeof createHeartOwnerProvider<ImageBitmap>>[0],
		"createBitmap"
	>,
) {
	return createHeartOwnerProvider({
		...input,
		createBitmap: createHeartNativeUploadBitmap,
	});
}
