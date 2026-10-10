import {
	createHeartOwnerProvider,
	createHeartNativeUploadBitmap,
	type HeartOwnerApi,
	type HeartNativePixels,
} from "./mv-heart-owner-provider";
import type { MvHeartPreparedImage } from "../../packages/editor-contracts/src/mv-heart-prepared";

interface CapacityOwner extends HeartOwnerApi {
	diagnosticJson(): string;
	dispose(): void;
	free(): void;
}
interface CapacityProvider {
	session: number;
	frame(input: unknown): Record<string, unknown>;
	preparedImage(image: MvHeartPreparedImage): ImageBitmap;
	dispose(): void;
}
const MAX = 256 * 1024 * 1024;
function facts(owner: CapacityOwner) {
	const v: unknown = JSON.parse(owner.diagnosticJson());
	if (!v || typeof v !== "object") throw Error("Capacity diagnostics missing");
	return {
		sessions: Reflect.get(v, "sessions"),
		reservedBytes: Reflect.get(v, "reservedBytes"),
		globalReservedBytes: Reflect.get(v, "globalReservedBytes"),
	};
}
function requireFact({ valid, name }: { valid: boolean; name: string }) {
	if (!valid) throw Error(`Heart capacity fixture failed: ${name}`);
}
/** Real-owner caller runs this before any other session takes the global cap.
 * Injected dependencies exist solely for lightweight orchestration tests. */
export async function probeExclusiveHeartCapacity({
	createOwner, capabilityJson, nativePng, render, frame,
	onEvidence,
	prepareProvider = createHeartOwnerProvider,
	upload = createHeartNativeUploadBitmap,
}: {
	createOwner: () => CapacityOwner;
	capabilityJson: () => string;
	nativePng: (size: number) => Promise<{ source: HeartNativePixels; bitmap: ImageBitmap }>;
	render: (input: { plan: unknown; preparedImage: (image: MvHeartPreparedImage) => ImageBitmap }) => Uint8ClampedArray;
	frame: (input: { ticks: number; burn: boolean }) => unknown;
	onEvidence?: (evidence: unknown) => void;
	prepareProvider?: (input: Parameters<typeof createHeartOwnerProvider<ImageBitmap>>[0]) => Promise<CapacityProvider>;
	upload?: typeof createHeartNativeUploadBitmap;
}) {
	const owner = createOwner();
	let fixture: Awaited<ReturnType<typeof nativePng>> | undefined;
	let provider: CapacityProvider | undefined;
	let uploaded = 0, closed = 0;
	try {
		const before = facts(owner);
		requireFact({ valid: before.sessions === 0 && before.globalReservedBytes === 0, name: "exclusive global reservation" });
		fixture = await nativePng(1024);
		requireFact({ valid: fixture.source.width === 1024 && fixture.source.height === 1024 &&
			fixture.source.rgba.byteLength === 1024 * 1024 * 4 &&
			fixture.bitmap.width === 1024 && fixture.bitmap.height === 1024, name: "exact native source dimensions" });
		provider = await prepareProvider({ owner, source: fixture.source, ceilingBytes: MAX, capabilityJson,
			createBitmap: async (input) => {
				const bitmap = await upload(input), close = bitmap.close.bind(bitmap);
				if (bitmap.width !== 1024 || bitmap.height !== 1024) {
					close(); throw Error("Heart capacity fixture failed: exact derived native bitmap dimensions");
				}
				uploaded++;
				bitmap.close = () => { closed++; close(); };
				return bitmap;
			} });
		const live = facts(owner);
		requireFact({ valid: live.sessions === 1 && live.reservedBytes === MAX && uploaded === 1, name: "actual prepared session and body bitmap" });
		onEvidence?.({ phase: "prepared", exactSourceSize: [1024, 1024], uploadedNativeBitmaps: uploaded, ceilingBytes: MAX });
		const frames = [];
		for (const ticks of [0, 120000, 128041]) {
			const value = provider.frame(frame({ ticks, burn: false }));
			const plan = value.plan;
			requireFact({ valid: !!plan && typeof plan === "object", name: "actual frame plan" });
			if (!plan || typeof plan !== "object") throw Error("Capacity frame plan missing");
			const budget: unknown = Reflect.get(plan, "rasterBudgetBytes");
			requireFact({ valid: typeof budget === "number" && budget > 0 && budget <= MAX, name: "actual Rust frame budget" });
			const pixels = render({ plan, preparedImage: image => provider!.preparedImage(image) });
			requireFact({ valid: pixels.length === 1920 * 1080 * 4 && pixels.some(value => value !== 0), name: "actual native full frame raster" });
			frames.push({ ticks, rasterBudgetBytes: budget, rgbaBytes: pixels.byteLength });
			onEvidence?.({ phase: "nativeFrames", exactSourceSize: [1024, 1024], frames: frames.slice() });
		}
		provider.dispose(); provider = undefined;
		const released = facts(owner);
		requireFact({ valid: released.sessions === 0 && released.reservedBytes === 0 &&
			released.globalReservedBytes === before.globalReservedBytes && closed === uploaded, name: "session and bitmap release" });
		return { scope: "prototype exact1024 native PNG/WASM preparation and three native frames; not oracle pixel/public/full-MV/export acceptance",
			exactSourceSize: [1024, 1024], sourceRgbaBytes: fixture.source.rgba.byteLength,
			ceilingBytes: MAX, uploadedNativeBitmaps: uploaded, closedNativeBitmaps: closed,
			frames, released, resizingOrFallback: false };
	} finally {
		try { provider?.dispose(); }
		finally {
			fixture?.bitmap.close();
			try { owner.dispose(); } finally { owner.free(); }
		}
	}
}

/** This is an aggregate reservation negative case, not image-size rejection. */
export async function probeHeartAggregateCapacity({ owner, capabilityJson, nativePng,
	prepareProvider = createHeartOwnerProvider,
}: {
	owner: CapacityOwner;
	capabilityJson: () => string;
	nativePng: (size: number) => Promise<{ source: HeartNativePixels; bitmap: ImageBitmap }>;
	prepareProvider?: (input: Parameters<typeof createHeartOwnerProvider<ImageBitmap>>[0]) => Promise<CapacityProvider>;
}) {
	const before = facts(owner), fixture = await nativePng(1024);
	let error = "", unexpected: CapacityProvider | undefined;
	try {
		requireFact({ valid: before.reservedBytes === 64 * 1024 * 1024, name: "existing 64MiB reservation" });
		try {
			unexpected = await prepareProvider({ owner, source: fixture.source,
				ceilingBytes: MAX, capabilityJson, createBitmap: createHeartNativeUploadBitmap });
		} catch (failure) { error = String(failure); }
		finally { unexpected?.dispose(); }
		const after = facts(owner);
		requireFact({ valid: error.includes("Heart owner aggregate ceiling exceeded") &&
			after.sessions === before.sessions && after.reservedBytes === before.reservedBytes &&
			after.globalReservedBytes === before.globalReservedBytes, name: "64+256MiB aggregate rejection preserves existing session" });
		return { scope: "aggregate reservation negative case, not source-resolution capacity",
			existingReservationBytes: before.reservedBytes, attemptedReservationBytes: MAX,
			exactSourceSize: [1024, 1024], error, retainedSessionUnchanged: true };
	} finally { fixture.bitmap.close(); }
}
