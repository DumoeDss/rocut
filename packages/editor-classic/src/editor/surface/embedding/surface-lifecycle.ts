import type { EditorSession, EditorSessionRootHandle } from "../../session";

import type { OnSurfaceReady } from "./types";

type SurfaceVisibility = "visible" | "hidden";

interface SurfaceGeneration {
	readonly id: number;
	readonly session: EditorSession;
	readonly handle: EditorSessionRootHandle;
	active: boolean;
	cleaned: boolean;
	desiredVisibility: SurfaceVisibility;
	dispatchedVisibility: SurfaceVisibility;
	reconciling: boolean;
}

function asError({
	reason,
	fallback,
}: {
	reason: unknown;
	fallback: string;
}): Error {
	return reason instanceof Error
		? reason
		: new Error(fallback, { cause: reason });
}

export function createSurfaceLifecycleController({
	onReady,
	onError,
}: {
	onReady: OnSurfaceReady;
	onError: (error: Error) => void;
}) {
	let nextGeneration = 0;
	let current: SurfaceGeneration | null = null;
	const pending = new Set<Promise<void>>();
	const suspendingSessions = new WeakSet<EditorSession>();

	function report(error: Error): void {
		try {
			onError(error);
		} catch (reportError) {
			console.error("Editor Surface error reporter failed:", reportError);
		}
	}

	function isLive(generation: SurfaceGeneration): boolean {
		return generation.active && current === generation;
	}

	function track(run: Promise<void>): Promise<void> {
		pending.add(run);
		void run.finally(() => pending.delete(run));
		return run;
	}

	function reconcileVisibility(generation: SurfaceGeneration): void {
		if (!isLive(generation) || generation.reconciling) return;
		generation.reconciling = true;
		const run = (async () => {
			while (
				isLive(generation) &&
				generation.desiredVisibility !== generation.dispatchedVisibility
			) {
				const visibility = generation.desiredVisibility;
				generation.dispatchedVisibility = visibility;
				if (!isLive(generation)) return;
				try {
					if (visibility === "hidden") {
						suspendingSessions.add(generation.session);
						try {
							await generation.session.suspend();
						} finally {
							suspendingSessions.delete(generation.session);
						}
					} else await generation.session.resume();
				} catch (reason) {
					if (isLive(generation)) {
						report(
							asError({
								reason,
								fallback: `Failed to make the Editor Surface ${visibility}.`,
							}),
						);
					}
				}
			}
		})().finally(() => {
			generation.reconciling = false;
			if (
				isLive(generation) &&
				generation.desiredVisibility !== generation.dispatchedVisibility
			) {
				reconcileVisibility(generation);
			}
		});
		track(run);
	}

	function cleanupGeneration(generation: SurfaceGeneration): void {
		if (generation.cleaned) return;
		generation.cleaned = true;
		generation.active = false;
		if (current === generation) current = null;

		let unmount: Promise<void>;
		try {
			// Invoke synchronously so the session releases its root before a
			// Strict-Mode-shaped setup runs again. Only settlement is asynchronous.
			unmount = Promise.resolve(generation.session.unmount());
		} catch (reason) {
			report(
				asError({ reason, fallback: "Failed to unmount the Editor Surface." }),
			);
			return;
		}
		track(
			unmount.catch((reason) => {
				// Cleanup failure belongs to this mount generation even though callbacks
				// were invalidated first; it must remain attributable.
				report(
					asError({
						reason,
						fallback: "Failed to unmount the Editor Surface.",
					}),
				);
			}),
		);
	}

	return {
		mount({
			session,
			target,
		}: {
			session: EditorSession;
			target: Element;
		}): () => void {
			if (current) cleanupGeneration(current);

			let handle: EditorSessionRootHandle;
			try {
				handle = session.mount({ target });
			} catch (reason) {
				report(
					asError({ reason, fallback: "Failed to mount the Editor Surface." }),
				);
				return () => {};
			}

			// `mount` intentionally retains a suspended session's lifecycle state. Seed
			// reconciliation from that real state so the component's initial visibility
			// publication can resume a visible remount (or suspend a hidden fresh mount)
			// exactly once instead of assuming every generation starts visible.
			const mountedVisibility: SurfaceVisibility =
				session.state === "suspended" || suspendingSessions.has(session)
					? "hidden"
					: "visible";
			const generation: SurfaceGeneration = {
				id: ++nextGeneration,
				session,
				handle,
				active: true,
				cleaned: false,
				desiredVisibility: mountedVisibility,
				dispatchedVisibility: mountedVisibility,
				reconciling: false,
			};
			current = generation;

			void handle.ready.then(
				() => {
					if (!isLive(generation) || generation.handle !== handle) return;
					try {
						onReady();
					} catch (reason) {
						if (isLive(generation)) {
							report(
								asError({
									reason,
									fallback: "Editor Surface onReady callback failed.",
								}),
							);
						}
					}
				},
				(reason) => {
					if (!isLive(generation) || generation.handle !== handle) return;
					report(
						asError({
							reason,
							fallback: "Editor Surface readiness failed.",
						}),
					);
				},
			);

			return () => cleanupGeneration(generation);
		},

		setVisibility(visibility: SurfaceVisibility): void {
			const generation = current;
			if (!generation || !isLive(generation)) return;
			generation.desiredVisibility = visibility;
			reconcileVisibility(generation);
		},

		async whenIdle(): Promise<void> {
			while (pending.size > 0) {
				await Promise.all([...pending]);
			}
		},
	};
}
