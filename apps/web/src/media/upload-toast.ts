import { toast } from "sonner";
import type { SessionResources, TimerHandle } from "@/editor/session/resources";
import {
	SessionActivityGenerationError,
	type SessionResourceLifecycle,
} from "@/editor/session/session-resources";

type PaintActivityLifecycle = Pick<
	SessionResourceLifecycle,
	| "assertActivityGeneration"
	| "getActivityGeneration"
	| "subscribeActivityLifecycle"
>;

function hasPaintActivityLifecycle(
	resources: SessionResources,
): resources is SessionResources & PaintActivityLifecycle {
	return (
		"assertActivityGeneration" in resources &&
		typeof resources.assertActivityGeneration === "function" &&
		"getActivityGeneration" in resources &&
		typeof resources.getActivityGeneration === "function" &&
		"subscribeActivityLifecycle" in resources &&
		typeof resources.subscribeActivityLifecycle === "function"
	);
}

function resolvePaintActivityLifecycle(
	resources: SessionResources,
): PaintActivityLifecycle {
	if (!hasPaintActivityLifecycle(resources)) {
		throw new Error("Paint waits require session activity-lifecycle controls.");
	}
	return resources;
}

export interface MediaUploadToastResult {
	uploadedCount: number;
	assetNames?: string[];
}

function getAssetLabel({ count }: { count: number }): string {
	return count === 1 ? "media asset" : "media assets";
}

export function waitForNextPaint(resources: SessionResources): Promise<void> {
	const lifecycle = resolvePaintActivityLifecycle(resources);
	const generation = lifecycle.getActivityGeneration();
	return new Promise((resolve, reject) => {
		let firstFrame: TimerHandle | null = null;
		let secondFrame: TimerHandle | null = null;
		let settled = false;
		let unsubscribe = () => {};

		const finish = (error?: unknown) => {
			if (settled) return;
			settled = true;
			firstFrame?.cancel();
			secondFrame?.cancel();
			unsubscribe();
			if (error !== undefined) reject(error);
			else resolve();
		};

		unsubscribe = lifecycle.subscribeActivityLifecycle({
			onSuspend: ({ generation: actualGeneration }) => {
				finish(
					new SessionActivityGenerationError({
						expectedGeneration: generation,
						actualGeneration,
					}),
				);
			},
		});

		try {
			firstFrame = resources.requestAnimationFrame({
				handler: () => {
					firstFrame = null;
					try {
						lifecycle.assertActivityGeneration({ generation });
						secondFrame = resources.requestAnimationFrame({
							handler: () => {
								secondFrame = null;
								try {
									lifecycle.assertActivityGeneration({ generation });
									finish();
								} catch (error) {
									finish(error);
								}
							},
						});
					} catch (error) {
						finish(error);
					}
				},
			});
		} catch (error) {
			finish(error);
		}
	});
}

export async function showMediaUploadToast<T extends MediaUploadToastResult>({
	filesCount,
	promise,
	resources,
}: {
	filesCount: number;
	promise: Promise<T> | (() => Promise<T>);
	resources: SessionResources;
}) {
	const run = typeof promise === "function" ? promise : () => promise;
	const toastPromise = toast.promise(
		async () => {
			await waitForNextPaint(resources);
			return run();
		},
		{
			loading: `Uploading ${getAssetLabel({ count: filesCount })}...`,
			success: ({ uploadedCount, assetNames }) => {
				if (uploadedCount === 1) {
					const assetName = assetNames?.[0];
					return assetName
						? `${assetName} has been uploaded`
						: "1 media asset has been uploaded";
				}

				if (uploadedCount > 1) {
					return `${uploadedCount} media assets have been uploaded`;
				}

				return "No media assets were uploaded";
			},
			error: `Failed to upload ${getAssetLabel({ count: filesCount })}`,
		},
	);

	return toastPromise.unwrap();
}
