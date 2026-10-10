import type {
	MvHeartRecipeRequestNode,
	MvHeartNativeOwnerFrame,
	MvHeartPreparedImage,
} from "@opencut/editor-contracts";
import {
	createHeartOwnerProvider,
	createHeartNativeUploadBitmap,
	type HeartOwnerApi,
	type HeartNativePixels,
	type HeartBitmap,
} from "./mv-heart-owner-provider";
import { key, integer } from "./mv-heart-owner-provider-protocol";

export interface HeartRecipeReadyFrame<B extends HeartBitmap> {
	readonly status: "readyNativeOwner";
	readonly frame: MvHeartNativeOwnerFrame;
	preparedImage(image: MvHeartPreparedImage): B;
}
/** Native-host lifetime only. The source Recipe cannot supply pixels, functions,
 * this map or the Rust owner. Admission remains pending until actual factories
 * and native upload promises settle. dispose drains factories but never frees
 * the shared owner; its host must await this settlement before owner.dispose. */
export function createHeartRecipeRuntime<B extends HeartBitmap>({
	owner,
	capabilityJson,
	nativePixels,
	sessionCeilingBytes,
	recipeReservationBytes,
	createBitmap,
	signal,
}: {
	owner: HeartOwnerApi;
	capabilityJson: () => string;
	/** Existing byte-admitted native resource loader; no URL/fake-size fallback. */
	nativePixels: (
		resource: HeartNativePixels["resource"],
	) => Promise<HeartNativePixels>;
	/** Host policy, never authored settings. Every live lease reserves this amount. */
	sessionCeilingBytes: number;
	/** Actual outer compositor/post/retained-resource reservation from the host. */
	recipeReservationBytes: number;
	createBitmap: Parameters<
		typeof createHeartOwnerProvider<B>
	>[0]["createBitmap"];
	signal?: AbortSignal;
}) {
	const cap: { maxOwnerBytes: number; maxOwnerSessions: number } =
		JSON.parse(capabilityJson());
	if (
		!integer(sessionCeilingBytes) ||
		!Number.isSafeInteger(recipeReservationBytes) ||
		recipeReservationBytes < 0 ||
		!integer(cap.maxOwnerBytes) ||
		!integer(cap.maxOwnerSessions) ||
		sessionCeilingBytes + recipeReservationBytes > cap.maxOwnerBytes
	)
		throw Error("Heart Recipe joint reservation exceeds Rust owner capability");
	const controller = new AbortController();
	const abort = () => controller.abort(signal?.reason);
	if (signal?.aborted) abort();
	else signal?.addEventListener("abort", abort, { once: true });
	type Provider = Awaited<ReturnType<typeof createHeartOwnerProvider<B>>>;
	const sessions = new Map<string, Provider>();
	const pending = new Map<string, Promise<Provider>>();
	const readyFrames = new Map<string, HeartRecipeReadyFrame<B>>();
	let disposed = false,
		generation = 0;
	const check = () => {
		controller.signal.throwIfAborted();
		if (disposed) throw Error("Heart Recipe owner runtime disposed");
	};
	const sessionKey = (node: MvHeartRecipeRequestNode) =>
		key({
			nodeId: node.nodeId,
			source: node.request.source,
			background: node.request.background,
			character: node.request.character,
			scene: node.request.frame.scene,
		});
	const providerFor = (node: MvHeartRecipeRequestNode): Promise<Provider> => {
		check();
		const cacheKey = sessionKey(node),
			existing = sessions.get(cacheKey),
			inflight = pending.get(cacheKey);
		if (existing) return Promise.resolve(existing);
		if (inflight) return inflight;
		const count = sessions.size + pending.size + 1;
		if (
			count > cap.maxOwnerSessions ||
			recipeReservationBytes + count * sessionCeilingBytes > cap.maxOwnerBytes
		)
			throw Error("Heart Recipe live lease/joint reservation exhausted");
		const preparing = (async () => {
			const request = node.request;
			if (
				request.status !== "pendingNativeOwner" ||
				request.reservation.nativeFactsPending !== true ||
				request.provenance.review.status !== "accepted"
			)
				throw Error(
					"Heart Recipe requires a Rust pending-owner request and reviewed evidence",
				);
			const descriptorBytes = [
				request.source,
				request.background,
				request.character,
			].reduce((sum, r) => sum + (r?.byteLength ?? 0), 0);
			if (descriptorBytes !== request.reservation.declaredEncodedBytes)
				throw Error("Heart Recipe static descriptor reservation mismatch");
			const load = async (resource: HeartNativePixels["resource"]) => {
				const pixels = await nativePixels(resource);
				check();
				if (key(pixels.resource) !== key(resource))
					throw Error("Heart Recipe native resource descriptor substitution");
				return pixels;
			};
			// Sequential loads remain in the tracked factory lifetime, so cancellation
			// drains every started native operation before the host frees its owner.
			const source = await load(request.source);
			const background = request.background
				? await load(request.background)
				: undefined;
			const character = request.character
				? await load(request.character)
				: undefined;
			check();
			const provider = await createHeartOwnerProvider({
				owner,
				source,
				background,
				character,
				sky:
					request.frame.scene.kind === "skyShatter"
						? request.frame.scene.settings
						: undefined,
				ceilingBytes: sessionCeilingBytes,
				capabilityJson,
				createBitmap,
				signal: controller.signal,
			});
			if (disposed || controller.signal.aborted) {
				provider.dispose();
				check();
			}
			sessions.set(cacheKey, provider);
			return provider;
		})();
		pending.set(cacheKey, preparing);
		void preparing.then(
			() => pending.delete(cacheKey),
			() => pending.delete(cacheKey),
		);
		return preparing;
	};
	const prepare = async (node: MvHeartRecipeRequestNode) => {
		check();
		const snapshot = structuredClone(node);
		const provider = await providerFor(snapshot);
		check();
		let frame: MvHeartNativeOwnerFrame;
		try {
			frame = provider.frame(snapshot.request.frame);
		} catch (error) {
			provider.dispose();
			sessions.delete(sessionKey(snapshot));
			throw error;
		}
		const ready: HeartRecipeReadyFrame<B> = {
			status: "readyNativeOwner",
			frame,
			preparedImage: (image) => provider.preparedImage(image),
		};
		return { key: JSON.stringify(snapshot), ready };
	};
	return {
		/** Exact frame request key includes mapped time and complete audio evidence. */
		readyFrames,
		async prepareFrame(nodes: readonly MvHeartRecipeRequestNode[]) {
			check();
			readyFrames.clear();
			const current = ++generation;
			if (nodes.length > cap.maxOwnerSessions)
				throw Error("Heart Recipe frame exceeds admitted request count");
			try {
				for (const node of nodes) {
					const result = await prepare(node);
					check();
					if (current !== generation)
						throw Error("Heart Recipe frame request superseded");
					readyFrames.set(result.key, result.ready);
				}
			} catch (error) {
				if (current === generation) readyFrames.clear();
				throw error;
			}
		},
		reservationReport() {
			return {
				nativeFactsPending: pending.size > 0,
				liveSessions: sessions.size,
				pendingSessions: pending.size,
				reservedOwnerBytes:
					(sessions.size + pending.size) * sessionCeilingBytes,
				recipeReservationBytes,
				jointReservedBytes:
					recipeReservationBytes +
					(sessions.size + pending.size) * sessionCeilingBytes,
				maxJointBytes: cap.maxOwnerBytes,
			};
		},
		async dispose() {
			disposed = true;
			controller.abort();
			signal?.removeEventListener("abort", abort);
			await Promise.allSettled(pending.values());
			for (const provider of sessions.values()) provider.dispose();
			sessions.clear();
			readyFrames.clear();
		},
	};
}
export function createNativeHeartRecipeRuntime(
	input: Omit<
		Parameters<typeof createHeartRecipeRuntime<ImageBitmap>>[0],
		"createBitmap"
	>,
) {
	return createHeartRecipeRuntime({
		...input,
		createBitmap: createHeartNativeUploadBitmap,
	});
}
