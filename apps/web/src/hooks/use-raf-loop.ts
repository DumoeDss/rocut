import { useEffect } from "react";
import type { SessionResources, TimerHandle } from "@/editor/session/resources";
import type { SessionResourceLifecycle } from "@/editor/session/session-resources";

type RafActivityLifecycle = Pick<
	SessionResourceLifecycle,
	"getActivityGeneration" | "isActivityAdmitted" | "subscribeActivityLifecycle"
>;

function hasRafActivityLifecycle(
	resources: SessionResources,
): resources is SessionResources & RafActivityLifecycle {
	return (
		"getActivityGeneration" in resources &&
		typeof resources.getActivityGeneration === "function" &&
		"isActivityAdmitted" in resources &&
		typeof resources.isActivityAdmitted === "function" &&
		"subscribeActivityLifecycle" in resources &&
		typeof resources.subscribeActivityLifecycle === "function"
	);
}

function resolveRafActivityLifecycle(
	resources: SessionResources,
): RafActivityLifecycle {
	if (!hasRafActivityLifecycle(resources)) {
		throw new Error("RAF loops require session activity-lifecycle controls.");
	}
	return resources;
}

export function useRafLoop({
	callback,
	resources,
}: {
	callback: ({ time }: { time: number }) => void;
	resources: SessionResources;
}) {
	useEffect(
		() => createRafLoop({ callback, resources }),
		[callback, resources],
	);
}

export function createRafLoop({
	callback,
	resources,
	onRequest,
}: {
	callback: ({ time }: { time: number }) => void;
	resources: SessionResources;
	onRequest?: (args: {
		resourceId: TimerHandle["resourceId"];
		generation: number;
	}) => void;
}): () => void {
	const lifecycle = resolveRafActivityLifecycle(resources);
	let request: TimerHandle | null = null;
	let previousTime: number | null = null;
	let stopped = false;

	function stopCurrentGeneration(): void {
		request?.cancel();
		request = null;
		previousTime = null;
	}

	function schedule(): void {
		if (stopped || !lifecycle.isActivityAdmitted()) return;
		request = resources.requestAnimationFrame({
			handler: (time) => loop({ time }),
		});
		try {
			onRequest?.({
				resourceId: request.resourceId,
				generation: lifecycle.getActivityGeneration(),
			});
		} catch (error) {
			request.cancel();
			request = null;
			throw error;
		}
	}

	function loop({ time }: { time: number }): void {
		request = null;
		if (previousTime !== null) {
			callback({ time: time - previousTime });
		}
		previousTime = time;
		schedule();
	}

	const unsubscribe = lifecycle.subscribeActivityLifecycle({
		onSuspend: stopCurrentGeneration,
		onResume: schedule,
	});
	schedule();
	return () => {
		stopped = true;
		unsubscribe();
		stopCurrentGeneration();
	};
}
