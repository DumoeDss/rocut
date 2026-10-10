import type { MvRecipePlan } from "@opencut/editor-contracts";
import type { HeartNativeImageInput } from "./mv-heart-native-pixels";
import { prepareHeartNativeFrames } from "./mv-heart-native-host";
import { prepareNightNativeFrames } from "./mv-night-native-host";
import { prepareMemoriesNativeFrames } from "./mv-memories-native-host";
import { prepareJzNativeFrames } from "./mv-jz-native-host";
import { nightNativeRequests } from "./mv-night-native-transport";
import { jzNativeRequests } from "./mv-jz-native-transport";
import { heartNativeRequests } from "./mv-heart-native-transport";
import { memoriesNativeRequests } from "./mv-memories-native-transport";

/** Synchronous plan probe so owner-free recipes keep a fully synchronous
 * ready→render handshake; owner preparation stays message-driven async. */
export function hasMvNativeOwnerPlan(plan: MvRecipePlan): boolean {
	return (
		!!nightNativeRequests(plan.root).length ||
		!!jzNativeRequests(plan.root).length ||
		!!heartNativeRequests(plan.root).length ||
		!!memoriesNativeRequests(plan.root).length
	);
}

/** Night completes and releases its large native frame before smaller owners
 * are prepared. Only its final bitmaps coexist with Heart/Memories leases.
 * All graph/copy ceilings come from the canonical Rust request receipts. */
export async function prepareMvNativeOwners({
	plan,
	input,
	signal,
}: {
	plan: MvRecipePlan;
	input: HeartNativeImageInput;
	signal?: AbortSignal;
}) {
	type Group = {
		transfers: ImageBitmap[];
		rasterByteLimit: number;
		dispose(): Promise<void>;
	};
	const groups: Group[] = [];
	let disposal: Promise<void> | undefined;
	const dispose = () =>
		(disposal ??= (async () => {
			await Promise.allSettled(
				[...groups].reverse().map((group) => group.dispose()),
			);
		})());
	try {
		const night = await prepareNightNativeFrames({ plan, input, signal });
		if (night) groups.push(night);
		signal?.throwIfAborted();
		const jz = await prepareJzNativeFrames({ plan, input, signal });
		if (jz) groups.push(jz);
		signal?.throwIfAborted();
		const heart = await prepareHeartNativeFrames({ plan, input, signal });
		if (heart) groups.push(heart);
		signal?.throwIfAborted();
		const memories = await prepareMemoriesNativeFrames({ plan, input, signal });
		if (memories) groups.push(memories);
		signal?.throwIfAborted();
		if (!groups.length) return undefined;
		return {
			heartFrames: heart?.packets,
			nightFrames: night?.packets,
			memoriesFrames: memories?.packets,
			jzFrames: jz?.packets,
			transfers: [...new Set(groups.flatMap((group) => group.transfers))],
			rasterByteLimit: Math.min(
				...groups.map((group) => group.rasterByteLimit),
			),
			dispose,
		};
	} catch (error) {
		await dispose();
		throw error;
	}
}
