import * as wasm from "opencut-wasm";
import type { MvRecipePlan } from "@opencut/editor-contracts";
import { createNativeHeartRecipeRuntime } from "./mv-heart-recipe-runtime";
import type { HeartOwnerApi } from "./mv-heart-owner-provider";
import {
	readHeartNativePixels,
	type HeartNativeImageInput,
} from "./mv-heart-native-pixels";
import {
	heartNativeRequests,
	heartNativePreparedImages,
	type HeartNativeFramePacket,
} from "./mv-heart-native-transport";
import { key, integer } from "./mv-heart-owner-provider-protocol";

interface NativeOwner extends HeartOwnerApi {
	dispose(): void;
	free(): void;
}
function nativeOwner(value: unknown): value is NativeOwner {
	return (
		!!value &&
		typeof value === "object" &&
		[
			"diagnosticJson",
			"prepare",
			"prepareSky",
			"manifestJson",
			"imageBytes",
			"frameJson",
			"cancel",
			"dispose",
			"free",
		].every((method) => typeof Reflect.get(value, method) === "function")
	);
}

/** One native raster lifetime. Freeing the Rust object is strictly after the
 * tracked decode/digest/upload factories settle and all providers dispose. */
export async function prepareHeartNativeFrames({
	plan,
	input,
	signal,
}: {
	plan: MvRecipePlan;
	input: HeartNativeImageInput;
	signal?: AbortSignal;
}) {
	signal?.throwIfAborted();
	const nodes = heartNativeRequests(plan.root);
	if (!nodes.length) return undefined;
	const reservation = nodes[0]!.request.reservation.host;
	if (
		!reservation ||
		nodes.some(
			(node) => key(node.request.reservation.host) !== key(reservation),
		) ||
		![
			reservation.recipeReservationBytes,
			reservation.sessionCeilingBytes,
			reservation.maxLiveSessions,
			reservation.rasterByteLimit,
		].every(integer) ||
		reservation.maxLiveSessions !== nodes.length
	)
		throw Error("Heart native host requires Rust complete graph reservation");
	const factory: unknown = Reflect.get(wasm, "MvHeartOwner");
	if (
		typeof factory !== "function" ||
		typeof Reflect.get(factory, "capabilityJson") !== "function"
	)
		throw Error("Heart native host requires rebuilt WASM owner capability");
	const capabilityJson = () => {
		const value: unknown = Reflect.apply(
			Reflect.get(factory, "capabilityJson"),
			factory,
			[],
		);
		if (typeof value !== "string")
			throw Error("Invalid Heart native owner capability");
		return value;
	};
	const cap: { maxOwnerBytes: number; maxOwnerSessions: number } =
		JSON.parse(capabilityJson());
	if (
		nodes.length > cap.maxOwnerSessions ||
		reservation.rasterByteLimit !== cap.maxOwnerBytes ||
		reservation.recipeReservationBytes +
			nodes.length * reservation.sessionCeilingBytes >
			cap.maxOwnerBytes
	)
		throw Error("Heart native host exceeds actual Rust joint capability");
	const owner: unknown = Reflect.construct(factory, []);
	if (!nativeOwner(owner)) throw Error("Invalid Heart native WASM owner API");
	const controller = new AbortController();
	const abort = () => controller.abort(signal?.reason);
	if (signal?.aborted) abort();
	else signal?.addEventListener("abort", abort, { once: true });
	let runtime: ReturnType<typeof createNativeHeartRecipeRuntime> | undefined;
	let disposal: Promise<void> | undefined;
	const dispose = () =>
		(disposal ??= (async () => {
			controller.abort();
			signal?.removeEventListener("abort", abort);
			try {
				await runtime?.dispose();
			} finally {
				try {
					owner.dispose();
				} finally {
					owner.free();
				}
			}
		})());
	try {
		runtime = createNativeHeartRecipeRuntime({
			owner,
			capabilityJson,
			signal: controller.signal,
			sessionCeilingBytes: reservation.sessionCeilingBytes,
			recipeReservationBytes: reservation.recipeReservationBytes,
			nativePixels: (resource) =>
				readHeartNativePixels({ input, resource, signal: controller.signal }),
		});
		await runtime.prepareFrame(nodes);
		signal?.throwIfAborted();
		const transfers = new Set<ImageBitmap>();
		const packets: HeartNativeFramePacket[] = [...runtime.readyFrames].map(
			([requestKey, ready]) => ({
				requestKey,
				frame: ready.frame,
				images: heartNativePreparedImages(ready.frame).map((image) => {
					const bitmap = ready.preparedImage(image);
					transfers.add(bitmap);
					return { image, bitmap };
				}),
			}),
		);
		return {
			packets,
			transfers: [...transfers],
			rasterByteLimit: reservation.rasterByteLimit,
			dispose,
		};
	} catch (error) {
		await dispose();
		throw error;
	}
}
