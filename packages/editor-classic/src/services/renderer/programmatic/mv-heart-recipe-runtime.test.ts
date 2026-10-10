import { expect, test } from "bun:test";
import type { MvHeartRecipeRequestNode } from "@opencut/editor-contracts";
import { createHeartRecipeRuntime } from "./mv-heart-recipe-runtime";
import { runInNewContext } from "node:vm";
import { MV_RECIPE_RENDERER_SOURCE } from "./mv-recipe-renderer";
import {
	FakeOwner,
	source,
	bitmap,
} from "./mv-heart-owner-provider-test-fixture";
const ceiling = 64 * 1024 * 1024;
const capabilityJson = () =>
	JSON.stringify({ maxOwnerBytes: 256 * 1024 * 1024, maxOwnerSessions: 4 });
test("fixed Recipe renderer rejects pending requests and substituted frame variants", () => {
	const api: {
		render(
			canvas: unknown,
			plan: unknown,
			assets: unknown,
			create: unknown,
		): void;
	} = runInNewContext(`${MV_RECIPE_RENDERER_SOURCE};({render:renderMvRecipe})`);
	const allocated: { width: number; height: number }[] = [];
	const create = () => {
		const canvas = { width: 1920, height: 1080, getContext: () => ({}) };
		allocated.push(canvas);
		return canvas;
	};
	const request = node();
	const plan = {
		version: 1,
		outputRoles: ["subject"],
		post: [],
		root: request,
	};
	expect(() => api.render(create(), plan, {}, create)).toThrow(
		"pending or unresolved",
	);
	const ready = {
		status: "readyNativeOwner",
		frame: { kind: "skyShatter", plan: { commands: [] } },
	};
	expect(() =>
		api.render(
			create(),
			plan,
			{ heartFrames: new Map([[JSON.stringify(request), ready]]) },
			create,
		),
	).toThrow("variant mismatch");
	expect(
		allocated.filter((canvas) => canvas.width === 1 && canvas.height === 1)
			.length,
	).toBe(2);
});
/** Structural owner protocol fixture; not a native decoding or pixel oracle. */
function node(songTicks = 120000): MvHeartRecipeRequestNode {
	return {
		kind: "heartOwnerRequest",
		role: "subject",
		nodeId: "heart-leaf",
		request: {
			status: "pendingNativeOwner",
			source: source().resource,
			background: null,
			character: null,
			frame: {
				scene: { kind: "heartShatter", settings: { heart: "heart" } },
				shotStartTicks: 0,
				shotEndTicks: 600000,
				songTicks,
				beats: [0, 60000, 120000, 180000],
				bpm: 120,
			},
			provenance: {
				schema: "creator-mv-audio/1",
				inputSha256: "a".repeat(64),
				vocalSha256: null,
				manifestSha256: "b".repeat(64),
				musicSha256: "c".repeat(64),
				envelopesSha256: "d".repeat(64),
				review: { status: "accepted", reference: "fixture reviewed evidence" },
			},
			downbeats: [0, 180000],
			stops: null,
			reservation: {
				nativeFactsPending: true,
				declaredEncodedBytes: 3,
				ownerMaxBytes: 256 * 1024 * 1024,
				ownerMaxSessions: 4,
				frameMetadataMaxBytes: 65536,
			},
		},
	};
}
test("Recipe mapped frame requests reuse immutable sessions and retain only the current ready-frame map", async () => {
	const owner = new FakeOwner(),
		image = bitmap();
	let uploads = 0,
		reads = 0;
	const runtime = createHeartRecipeRuntime({
		owner,
		capabilityJson,
		nativePixels: async () => {
			reads++;
			return source();
		},
		sessionCeilingBytes: ceiling,
		recipeReservationBytes: 16 * 1024 * 1024,
		createBitmap: async () => {
			uploads++;
			return image;
		},
	});
	const a = node(),
		b = node(128040);
	expect(runtime.readyFrames.size).toBe(0);
	await runtime.prepareFrame([a, b]);
	expect(runtime.readyFrames.size).toBe(2);
	expect(
		runtime.readyFrames.get(JSON.stringify(a))?.frame.identity.sessionId,
	).toBe(1);
	expect(
		runtime.readyFrames.get(JSON.stringify(b))?.frame.identity.sessionId,
	).toBe(1);
	expect(uploads).toBe(1);
	expect(reads).toBe(1);
	expect(owner.extractions).toBe(1);
	await runtime.prepareFrame([node(240000)]);
	expect(runtime.readyFrames.size).toBe(1);
	expect(runtime.readyFrames.has(JSON.stringify(a))).toBe(false);
	expect(runtime.reservationReport().jointReservedBytes).toBe(80 * 1024 * 1024);
	await runtime.dispose();
	expect(image.closed).toBe(1);
	expect(owner.cancelled).toEqual([1]);
});
test("Recipe owner frame rejection closes its uploads and cancels exactly its own lease", async () => {
	const owner = new FakeOwner(),
		image = bitmap();
	owner.badFrame = true;
	const runtime = createHeartRecipeRuntime({
		owner,
		capabilityJson,
		nativePixels: async () => source(),
		sessionCeilingBytes: ceiling,
		recipeReservationBytes: 16 * 1024 * 1024,
		createBitmap: async () => image,
	});
	await expect(runtime.prepareFrame([node()])).rejects.toThrow();
	expect(runtime.readyFrames.size).toBe(0);
	expect(owner.entries.size).toBe(0);
	expect(runtime.reservationReport().reservedOwnerBytes).toBe(0);
	expect(image.closed).toBe(1);
	expect(owner.cancelled).toEqual([1]);
	await runtime.dispose();
	expect(owner.cancelled).toEqual([1]);
});
test("Recipe outer compositor reservation cannot be omitted from the shared256MiB budget", async () => {
	const owner = new FakeOwner();
	let reads = 0;
	const runtime = createHeartRecipeRuntime({
		owner,
		capabilityJson,
		nativePixels: async () => {
			reads++;
			return source();
		},
		sessionCeilingBytes: ceiling,
		recipeReservationBytes: 16 * 1024 * 1024,
		createBitmap: async () => bitmap(),
	});
	const nodes = Array.from({ length: 4 }, (_, i) => ({
		...node(),
		nodeId: `heart-${i}`,
	}));
	await expect(runtime.prepareFrame(nodes)).rejects.toThrow(
		"joint reservation",
	);
	expect(reads).toBe(3);
	expect(owner.entries.size).toBe(3);
	expect(runtime.readyFrames.size).toBe(0);
	expect(runtime.reservationReport().jointReservedBytes).toBe(
		208 * 1024 * 1024,
	);
	await runtime.dispose();
	expect(owner.entries.size).toBe(0);
});
test("Recipe dispose drains an in-flight native load before the shared owner may be freed", async () => {
	const owner = new FakeOwner();
	let resume: (value: ReturnType<typeof source>) => void = () => {};
	const runtime = createHeartRecipeRuntime({
		owner,
		capabilityJson,
		nativePixels: () =>
			new Promise((resolve) => {
				resume = resolve;
			}),
		sessionCeilingBytes: ceiling,
		recipeReservationBytes: 16 * 1024 * 1024,
		createBitmap: async () => bitmap(),
	});
	const preparing = runtime.prepareFrame([node()]);
	let disposed = false;
	const disposal = runtime.dispose().then(() => {
		disposed = true;
	});
	await Promise.resolve();
	expect(disposed).toBe(false);
	expect(owner.cancelled).toEqual([]);
	resume(source());
	await expect(preparing).rejects.toThrow();
	await disposal;
	expect(disposed).toBe(true);
	expect(owner.entries.size).toBe(0);
	expect(owner.next).toBe(1);
});
