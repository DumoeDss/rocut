import * as wasm from "opencut-wasm";
import type { MvRecipePlan, ProgrammaticResource } from "@opencut/editor-contracts";
import type { MemoriesOwnerApi, MemoriesOwnerStatics } from "./mv-memories-owner-protocol";
import { digest } from "./mv-memories-owner-protocol";
import { key } from "./mv-heart-owner-provider-protocol";
import type { HeartNativeImageInput } from "./mv-heart-native-pixels";
import { createMemoriesNativePlatform } from "./mv-memories-owner-native";
import { memoriesNativeReplay } from "./mv-memories-native-replay";
import { createMemoriesRecipeRuntime } from "./mv-memories-recipe-runtime";
import { memoriesNativeRequests, type MemoriesNativeFramePacket } from "./mv-memories-native-transport";
interface NativeOwner extends MemoriesOwnerApi { dispose(): void; free(): void }
export async function prepareMemoriesNativeFrames({ plan, input, signal }: {
	plan: MvRecipePlan; input: HeartNativeImageInput; signal?: AbortSignal;
}) {
	signal?.throwIfAborted();
	const nodes = memoriesNativeRequests(plan.root);
	if (!nodes.length) return undefined;
	const reservation = nodes[0]!.request.reservation.host;
	if (!reservation || nodes.some(n => key(n.request.reservation.host) !== key(reservation))
		|| reservation.maxLiveSessions !== nodes.length)
		throw Error("Memories native host requires complete Rust graph reservation");
	const factory: unknown = Reflect.get(wasm, "MvMemoriesOwner");
	if (typeof factory !== "function") throw Error("Memories native host requires rebuilt WASM owner");
	const invoke = (name: string, args: unknown[]) => {
		const fn: unknown = Reflect.get(factory, name);
		if (typeof fn !== "function") throw Error("Memories native statics unavailable");
		const value: unknown = Reflect.apply(fn, factory, args);
		if (typeof value !== "string") throw Error("Invalid Memories native static output");
		return value;
	};
	const statics: MemoriesOwnerStatics = {
		capabilityJson: () => invoke("capabilityJson", []),
		sourceRequestsJson: (a, r) => invoke("sourceRequestsJson", [a, r]),
		sourceAdmissionJson: (a, r, b) => invoke("sourceAdmissionJson", [a, r, b]),
	};
	const value: unknown = Reflect.construct(factory, []);
	const methods = ["reserve", "diagnosticJson", "prepareReserved", "beginStage", "acceptStage",
		"cancelStage", "preparedJson", "preparedBytes", "frame", "finishFrame", "cancel", "dispose", "free"];
	if (!value || typeof value !== "object" || methods.some(m => typeof Reflect.get(value, m) !== "function"))
		throw Error("Invalid Memories native WASM owner API");
	const owner = value as NativeOwner;
	const controller = new AbortController(), transfers: ImageBitmap[] = [];
	const abort = () => controller.abort(signal?.reason);
	if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
	let runtime: ReturnType<typeof createMemoriesRecipeRuntime> | undefined, disposal: Promise<void> | undefined;
	const dispose = () => disposal ??= (async () => {
		controller.abort(); signal?.removeEventListener("abort", abort);
		try { await runtime?.dispose(); } finally {
			for (const bitmap of transfers) bitmap.close();
			try { owner.dispose(); } finally { owner.free(); }
		}
	})();
	try {
		const loadBytes = async (resource: ProgrammaticResource) => {
			controller.signal.throwIfAborted();
			const selected = input.resources.filter(r => key(r.resource) === key(resource));
			if (selected.length !== 1 || !(selected[0]!.body instanceof ArrayBuffer)
				|| selected[0]!.body.byteLength !== resource.byteLength)
				throw Error("Memories native source requires exact admitted binary descriptor");
			if (resource.kind === "image") {
				const matches = input.imageAdmissions.filter(r => key(r.resource) === key(resource)), limits = input.imageDecodeLimits;
				if (matches.length !== 1 || !limits) throw Error("Memories native image admission missing");
				const a = matches[0]!;
				if (![a.width, a.height, a.decodedBytes].every(Number.isSafeInteger)
					|| a.width < 1 || a.height < 1 || a.width > limits.maxDimension || a.height > limits.maxDimension
					|| a.decodedBytes !== a.width * a.height * 4 || a.decodedBytes > limits.maxDecodedBytes)
					throw Error("Memories native source decode limit mismatch");
			}
			return new Uint8Array(selected[0]!.body);
		};
		runtime = createMemoriesRecipeRuntime({ owner, statics, loadBytes,
			sessionCeilingBytes: reservation.sessionCeilingBytes, recipeReservationBytes: reservation.recipeReservationBytes,
			maxLiveSessions: reservation.maxLiveSessions, signal: controller.signal,
			createNative: () => createMemoriesNativePlatform({ replay: memoriesNativeReplay,
				fontSet: document.fonts, makeSurface: (w, h) => { const s = document.createElement("canvas"); s.width = w; s.height = h; return s; } }),
		});
		const packets: MemoriesNativeFramePacket[] = [];
		await runtime.retainFrame(nodes);
		const emitted = new Set<string>();
		for (const node of nodes) {
			const requestKey = JSON.stringify(node);
			if (emitted.has(requestKey)) continue;
			emitted.add(requestKey);
			const canvas = document.createElement("canvas"); canvas.width = 1920; canvas.height = 1080;
			try {
				const ctx = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
				if (!ctx) throw Error("Memories native Canvas2D unavailable");
				await runtime.drawFrame(node, ctx); controller.signal.throwIfAborted();
				const rgbaSha256 = await digest(new Uint8Array(ctx.getImageData(0, 0, 1920, 1080).data.buffer));
				controller.signal.throwIfAborted();
				const bitmap = await createImageBitmap(canvas); transfers.push(bitmap); controller.signal.throwIfAborted();
				packets.push({ requestKey, bitmap, width: 1920, height: 1080, rgbaSha256 });
			} finally { canvas.width = canvas.height = 1; }
		}
		return { packets, transfers, rasterByteLimit: reservation.rasterByteLimit, dispose };
	} catch (error) { await dispose(); throw error; }
}
