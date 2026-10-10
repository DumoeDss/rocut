import type { ProgrammaticResource } from "@opencut/editor-contracts";
import type { MvMemoriesRecipeRequestNode } from "../../../../../editor-contracts/src/mv-memories-recipe";
import { createMemoriesOwnerProvider } from "./mv-memories-owner-provider";
import type { MemoriesOwnerApi, MemoriesOwnerStatics } from "./mv-memories-owner-protocol";
import type { MemoriesNativePlatform } from "./mv-memories-owner-native";
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/** Shipped native realm only. Frames are drawn while the Rust publication is
 * alive, then finished and released; transient burn pixels never become JSON. */
export function createMemoriesRecipeRuntime({ owner, statics, loadBytes, createNative,
	sessionCeilingBytes, recipeReservationBytes, maxLiveSessions, signal,
}: {
	owner: MemoriesOwnerApi;
	statics: MemoriesOwnerStatics;
	loadBytes: (resource: ProgrammaticResource) => Promise<Uint8Array>;
	createNative: () => MemoriesNativePlatform;
	sessionCeilingBytes: number;
	recipeReservationBytes: number;
	maxLiveSessions: number;
	signal?: AbortSignal;
}) {
	const cap: { maxOwnerBytes: number; maxOwnerSessions: number; opaqueStages: boolean } = JSON.parse(statics.capabilityJson());
	if (![sessionCeilingBytes, maxLiveSessions, cap.maxOwnerBytes, cap.maxOwnerSessions].every(v => Number.isSafeInteger(v) && v > 0)
		|| !Number.isSafeInteger(recipeReservationBytes) || recipeReservationBytes < 0
		|| maxLiveSessions > cap.maxOwnerSessions || !cap.opaqueStages
		|| recipeReservationBytes + maxLiveSessions * sessionCeilingBytes > cap.maxOwnerBytes)
		throw Error("Memories Recipe joint reservation exceeds native capability");
	const controller = new AbortController();
	const abort = () => controller.abort(signal?.reason);
	if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
	type Provider = Awaited<ReturnType<typeof createMemoriesOwnerProvider>>;
	type Entry = { provider: Provider; native: MemoriesNativePlatform };
	const sessions = new Map<string, Entry>(), pending = new Map<string, Promise<Entry>>();
	let disposed = false, active: Promise<void> | undefined;
	const check = () => { controller.signal.throwIfAborted(); if (disposed) throw Error("Memories Recipe disposed"); };
	const key = (node: MvMemoriesRecipeRequestNode) => JSON.stringify([node.nodeId, node.request.args, node.request.resources]);
	const providerFor = (node: MvMemoriesRecipeRequestNode) => {
		check();
		const id = key(node), ready = sessions.get(id), existing = pending.get(id);
		if (ready) return Promise.resolve(ready);
		if (existing) return existing;
		if (sessions.size + pending.size >= maxLiveSessions) throw Error("Memories Recipe live leases exhausted");
		const request = node.request, host = request.reservation.host;
		if (request.status !== "pendingNativeOwner" || !request.reservation.nativeFactsPending
			|| request.provenance.review.status !== "accepted" || !host
			|| host.sessionCeilingBytes !== sessionCeilingBytes || host.recipeReservationBytes !== recipeReservationBytes
			|| host.maxLiveSessions !== maxLiveSessions
			|| request.resources.reduce((sum, r) => sum + r.byteLength, 0) !== request.reservation.declaredEncodedBytes)
			throw Error("Memories Recipe missing admitted Rust request/reservation");
		const native = createNative();
		const factory = (async () => {
			try {
				const provider = await createMemoriesOwnerProvider({ owner, statics, args: request.args,
					resources: request.resources, ceilingBytes: sessionCeilingBytes, loadBytes,
					native, signal: controller.signal });
				if (disposed || controller.signal.aborted) { await provider.dispose(); check(); }
				const result = { provider, native }; sessions.set(id, result); return result;
			} catch (error) { native.dispose(); throw error; }
		})();
		pending.set(id, factory);
		void factory.then(() => pending.delete(id), () => pending.delete(id));
		return factory;
	};
	return {
		/** Host traverses ref/panels/transition with its ordinary compositor and
		 * invokes draw for each leaf with that leaf's mapped song/shot clock. */
		async drawFrame(node: MvMemoriesRecipeRequestNode, ctx: Context) {
			check(); if (active) throw Error("Memories Recipe frame already in flight");
			const snapshot = structuredClone(node);
			const run = async () => {
				const entry = await providerFor(snapshot); check();
				try { await entry.provider.frame({ input: snapshot.request.frame,
					draw: plan => entry.native.draw({ ctx, plan }) }); }
				catch (error) { await entry.provider.dispose(); sessions.delete(key(snapshot)); throw error; }
			};
			active = run(); try { await active; } finally { active = undefined; }
		},
		/** Called once with the complete expanded frame, before any draw. This
		 * retires inactive sequence/ref instances rather than exhausting leases. */
		async retainFrame(nodes: readonly MvMemoriesRecipeRequestNode[]) {
			check(); if (active) throw Error("Memories Recipe cannot retire an active frame");
			const ids = new Set(nodes.map(key));
			if (ids.size > maxLiveSessions) throw Error("Memories Recipe expanded frame exceeds admitted count");
			for (const [id, entry] of sessions) if (!ids.has(id)) { await entry.provider.dispose(); sessions.delete(id); }
		},
		reservationReport() { const live = sessions.size + pending.size; return {
			liveSessions: sessions.size, pendingSessions: pending.size, reservedOwnerBytes: live * sessionCeilingBytes,
			recipeReservationBytes, jointReservedBytes: recipeReservationBytes + live * sessionCeilingBytes,
			maxJointBytes: cap.maxOwnerBytes }; },
		async dispose() {
			disposed = true; controller.abort(); signal?.removeEventListener("abort", abort);
			await Promise.allSettled(pending.values());
			if (active) await Promise.allSettled([active]);
			await Promise.allSettled([...sessions.values()].map(entry => entry.provider.dispose()));
			sessions.clear();
		},
	};
}
