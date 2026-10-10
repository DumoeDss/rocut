import type { ProgrammaticResource } from "../../packages/editor-contracts/src";
import type {
	MvHeartPreparedImage,
	MvHeartBinding,
} from "../../packages/editor-contracts/src/mv-heart-prepared";

/** Private prototype seam only. Root owns actual native decoder admission and
 * dispatch registration. These facts must never be accepted from source JSON. */
export interface HeartOwnerApi {
	prepare(metadata: string, encoded: Uint8Array, rgba: Uint8Array): number;
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
interface Bitmap {
	readonly width: number;
	readonly height: number;
	close(): void;
}
interface Identity {
	readonly ownerId: number;
	readonly sessionId: number;
	readonly binding: MvHeartBinding;
	readonly background: unknown;
	readonly imagesManifestSha256: string;
}
interface Image {
	readonly index: number;
	readonly byteLength: number;
	readonly image: MvHeartPreparedImage;
}
interface Manifest {
	readonly identity: Identity;
	readonly images: readonly Image[];
	readonly reservedBytes: number;
}
function object(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}
function keys({
	value,
	expected,
}: {
	value: Record<string, unknown>;
	expected: readonly string[];
}) {
	return (
		Object.keys(value).length === expected.length &&
		expected.every((k) => Object.prototype.hasOwnProperty.call(value, k))
	);
}
function integer(v: unknown): v is number {
	return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}
function sha(v: unknown): v is string {
	return typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
}
function binding(v: unknown): v is MvHeartBinding {
	return (
		object(v) &&
		object(v.source) &&
		integer(v.decodedWidth) &&
		integer(v.decodedHeight) &&
		sha(v.decodedRgbaSha256) &&
		v.decoder === "canvas2d-srgb-unpremultiplied-rgba8-v1" &&
		v.algorithm === "heart-components-v1"
	);
}
function image(v: unknown): v is MvHeartPreparedImage {
	return (
		object(v) &&
		keys({
			value: v,
			expected: ["binding", "part", "width", "height", "rgbaSha256"],
		}) &&
		binding(v.binding) &&
		integer(v.width) &&
		integer(v.height) &&
		sha(v.rgbaSha256) &&
		object(v.part) &&
		((v.part.kind === "body" && keys({ value: v.part, expected: ["kind"] })) ||
			(v.part.kind === "chip" &&
				keys({ value: v.part, expected: ["kind", "label"] }) &&
				typeof v.part.label === "number" &&
				Number.isSafeInteger(v.part.label) &&
				v.part.label >= 0))
	);
}
function manifest(v: unknown): v is Manifest {
	return (
		object(v) &&
		keys({ value: v, expected: ["identity", "images", "reservedBytes"] }) &&
		object(v.identity) &&
		keys({
			value: v.identity,
			expected: [
				"ownerId",
				"sessionId",
				"binding",
				"background",
				"imagesManifestSha256",
			],
		}) &&
		integer(v.identity.ownerId) &&
		integer(v.identity.sessionId) &&
		binding(v.identity.binding) &&
		sha(v.identity.imagesManifestSha256) &&
		integer(v.reservedBytes) &&
		Array.isArray(v.images) &&
		v.images.length > 0 &&
		v.images.every(
			(i: unknown) =>
				object(i) &&
				keys({ value: i, expected: ["index", "byteLength", "image"] }) &&
				typeof i.index === "number" &&
				Number.isSafeInteger(i.index) &&
				i.index >= 0 &&
				integer(i.byteLength) &&
				image(i.image),
		)
	);
}
function canonical(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(canonical);
	if (object(v))
		return Object.fromEntries(
			Object.keys(v)
				.sort()
				.map((key) => [key, canonical(v[key])]),
		);
	return v;
}
const key = (v: unknown) => JSON.stringify(canonical(v));
async function digest(bytes: Uint8Array) {
	if (!(bytes.buffer instanceof ArrayBuffer))
		throw Error("Heart binary snapshot cannot use shared memory");
	return [
		...new Uint8Array(
			await crypto.subtle.digest(
				"SHA-256",
				new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
			),
		),
	]
		.map((v) => v.toString(16).padStart(2, "0"))
		.join("");
}

/** Actual native upload helper, not a test bitmap or image URL fallback. Typed
 * views share the one admitted upload buffer; no extra pixel-array copy. */
export async function createHeartNativeUploadBitmap({
	bytes,
	width,
	height,
}: {
	bytes: Uint8Array;
	width: number;
	height: number;
}) {
	if (
		!(bytes.buffer instanceof ArrayBuffer) ||
		bytes.byteLength !== width * height * 4
	)
		throw Error("Heart native upload binary shape mismatch");
	const view = new Uint8ClampedArray(
		bytes.buffer,
		bytes.byteOffset,
		bytes.byteLength,
	);
	return createImageBitmap(
		new ImageData(view, width, height, { colorSpace: "srgb" }),
	);
}

/** Snapshot packets synchronously before all awaits. No raw pixels/base64 enter
 * JSON. Exactly one Rust binary extraction and one upload bitmap per image.
 * Additional provider snapshot bytes are reported separately: final dispatch
 * must reserve them in Rust admission too, not call this whole-renderer memory. */
export async function createHeartOwnerProvider<B extends Bitmap>({
	owner,
	source,
	background,
	ceilingBytes,
	capabilityJson,
	createBitmap,
	signal,
}: {
	owner: HeartOwnerApi;
	source: HeartNativePixels;
	background?: HeartNativePixels;
	ceilingBytes: number;
	/** Obtained from the actual Rust MvHeartOwner.capabilityJson static method. */
	capabilityJson: () => string;
	createBitmap: (input: {
		bytes: Uint8Array;
		width: number;
		height: number;
	}) => Promise<B>;
	signal?: AbortSignal;
}) {
	signal?.throwIfAborted();
	const capability: unknown = JSON.parse(capabilityJson());
	if (
		!object(capability) ||
		!integer(capability.maxOwnerBytes) ||
		!integer(ceilingBytes) ||
		ceilingBytes > capability.maxOwnerBytes
	)
		throw Error("Heart Rust owner capability ceiling exceeded");
	const native = [source, ...(background ? [background] : [])].map((item) => ({
		resource: structuredClone(item.resource),
		width: item.width,
		height: item.height,
		encoded: item.encoded,
		rgba: item.rgba,
	}));
	if (
		!integer(ceilingBytes) ||
		native.some(
			(n) =>
				n.resource.kind !== "image" ||
				!(n.encoded instanceof ArrayBuffer) ||
				n.encoded.byteLength !== n.resource.byteLength ||
				!integer(n.width) ||
				!integer(n.height) ||
				n.rgba.byteLength !== n.width * n.height * 4,
		)
	)
		throw Error("Heart private native inputs malformed");
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
	const metadata = {
		source: descriptors[0]!.resource,
		binding: expectedBinding,
		background: facts[1],
		ceilingBytes,
		encodedLayout: {
			source: ranges[0]!.encoded,
			background: ranges[1]?.encoded,
		},
		decodedLayout: {
			source: ranges[0]!.decoded,
			background: ranges[1]?.decoded,
		},
	};
	let session: number;
	try {
		session = owner.prepare(JSON.stringify(metadata), encoded, rgba);
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
		const value: unknown = JSON.parse(owner.manifestJson(session));
		if (
			!manifest(value) ||
			value.identity.sessionId !== session ||
			key(value.identity.binding) !== key(expectedBinding) ||
			key(value.identity.background) !== key(facts[1] ?? null) ||
			value.reservedBytes !== ceilingBytes
		)
			throw Error("Heart full owner manifest identity mismatch");
		if (
			(await digest(new TextEncoder().encode(JSON.stringify(value.images)))) !==
			value.identity.imagesManifestSha256
		)
			throw Error("Heart image manifest digest mismatch");
		check();
		for (const [index, item] of value.images.entries()) {
			if (
				item.index !== index ||
				key(item.image.binding) !== key(expectedBinding) ||
				item.byteLength !== item.image.width * item.image.height * 4 ||
				bitmaps.has(key(item.image))
			)
				throw Error("Heart derived image manifest identity/length collision");
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
					if (
						!object(frame) ||
						key(frame.identity) !== key(value.identity) ||
						!object(frame.plan) ||
						!Array.isArray(frame.plan.commands)
					)
						throw Error("Heart frame owner identity mismatch");
					const inspect = (commands: unknown[]) => {
						for (const command of commands) {
							if (!object(command))
								throw Error("Heart owner command malformed");
							if (
								command.kind === "preparedImage" &&
								!bitmaps.has(key(command.image))
							)
								throw Error("Heart frame substituted derived image identity");
							if (Array.isArray(command.commands)) inspect(command.commands);
						}
					};
					inspect(frame.plan.commands);
					return frame;
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
